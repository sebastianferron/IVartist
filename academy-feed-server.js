"use strict";

const photoLimit = 5 * 1024 * 1024;
const maxPhotos = 4;
const publicRoot = "/api/academy/feed";
const adminRoot = "/api/admin/academy/feed";
const requestIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function createFeed({ RequestError, readBody, readJsonBody, json, currentAdmin, requireStudent, studentSession, requireText, storeAsset, discardAsset, sendAsset, id, now, getPosts, savePosts, getAuthors }) {
  function cursorPage(req, records, visible, pageSize) {
    const cursor = new URL(req.url, "http://localhost").searchParams.get("before");
    const index = cursor ? records.findIndex((item) => item.id === cursor) : -1;
    if (cursor && index === -1) throw new RequestError(400, "Actualiza la lista para seguir. El contenido cambió.");
    const paged = records.slice(index + 1).filter(visible).slice(0, pageSize + 1);
    const items = paged.slice(0, pageSize);
    return { items, next: paged.length > pageSize ? items.at(-1).id : null };
  }

  const publicContent = (item) => !item.hidden && !item.deleted;
  const available = (item) => !item.deleted;

  function postView(post, studentId, authors, admin = false) {
    const official = { name: "Ivanna Saldaña", avatar: "/assets/logo-iv.png" };
    return {
      id: post.id, text: post.text, at: post.at,
      author: post.news ? official : authors.get(post.studentId) || { name: "Participante" },
      photos: post.photos.map((_, index) => `${publicRoot}/posts/${post.id}/photos/${index}`),
      hearts: post.hearts.length, loved: post.hearts.includes(studentId),
      commentCount: post.comments.filter(admin ? available : publicContent).length,
      own: Boolean(studentId && studentId === post.studentId),
      ...(post.news && { news: post.news }),
      ...(admin && { hidden: Boolean(post.hidden) }),
    };
  }

  function postPage(req, res, studentId, admin = false) {
    const limit = Number(new URL(req.url, "http://localhost").searchParams.get("limit") ?? 10);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new RequestError(400, "El tamaño de página no es válido.");
    const { items, next } = cursorPage(req, getPosts(), admin ? available : publicContent, limit);
    const authors = getAuthors();
    return json(res, 200, { posts: items.map((post) => postView(post, studentId, authors, admin)), next });
  }

  function commentPage(req, res, post, studentId, admin = false) {
    const { items, next } = cursorPage(req, post.comments, admin ? available : publicContent, 12);
    const authors = getAuthors();
    const comments = items.map(({ id, text, at, studentId: authorId, hidden }) => ({
      id, text, at, author: authors.get(authorId) || { name: "Participante" },
      own: Boolean(studentId && studentId === authorId), ...(admin && { hidden: Boolean(hidden) }),
    }));
    return json(res, 200, { comments, next });
  }

  function savePost(post) {
    savePosts(getPosts().map((current) => current.id === post.id ? post : current));
  }

  function getPost(postId, allowHidden = false) {
    const post = getPosts().find(({ id }) => id === postId);
    if (!post || post.deleted || (post.hidden && !allowHidden)) throw new RequestError(404, "La publicación no está disponible.");
    return post;
  }

  function getComment(post, commentId, allowHidden = false) {
    const comment = post.comments.find(({ id }) => id === commentId);
    if (!comment || comment.deleted || (comment.hidden && !allowHidden)) throw new RequestError(404, "El comentario no está disponible.");
    return comment;
  }

  function validateRequestId(value) {
    if (typeof value !== "string" || !requestIdPattern.test(value)) throw new RequestError(400, "Vuelve a intentar el envío.");
    return value;
  }

  async function readPhotoForm(req) {
    const contentType = req.headers["content-type"] || "";
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) throw new RequestError(415, "Envía el formulario de publicación.");
    const body = await readBody(req, maxPhotos * photoLimit + 256 * 1024);
    const form = await new Response(body, { headers: { "Content-Type": contentType } }).formData().catch(() => null);
    if (!form) throw new RequestError(400, "No se pudo leer la publicación.");
    const files = form.getAll("photos").filter((item) => !(item instanceof Blob && !item.name && !item.size));
    if (files.length > maxPhotos) throw new RequestError(400, "Puedes adjuntar hasta 4 fotos por publicación.");
    if (files.some((file) => !(file instanceof Blob) || !file.size)) throw new RequestError(400, "Selecciona archivos de imagen válidos.");
    if (files.some((file) => file.size > photoLimit)) throw new RequestError(413, "Cada foto puede pesar hasta 5 MB.");
    const images = await Promise.all(files.map(async (file) => Buffer.from(await file.arrayBuffer())));
    return { form, images };
  }

  async function saveWithPhotos(post, images, persist) {
    try {
      for (const image of images) post.photos.push(await storeAsset("feed", image));
      return persist(post);
    } catch (error) {
      for (const photo of post.photos) await discardAsset(photo, "feed");
      throw error;
    }
  }

  async function createPost(req, res) {
    requireStudent(req);
    const { form, images } = await readPhotoForm(req);
    const requestId = validateRequestId(form.get("requestId"));
    const text = requireText(form.get("text") ?? "", 1800, "Publicación");
    if (!text && !images.length) throw new RequestError(400, "Escribe algo o adjunta al menos una foto.");
    const { studentId } = requireStudent(req);
    const existing = getPosts().find((post) => post.studentId === studentId && post.requestId === requestId);
    if (existing) {
      const post = getPost(existing.id);
      return json(res, 200, { post: postView(post, studentId, getAuthors()) });
    }

    const post = { id: id(), requestId, studentId, text, photos: [], at: now(), hearts: [], comments: [] };
    const saved = await saveWithPhotos(post, images, (entry) => {
      if (requireStudent(req).studentId !== studentId) throw new RequestError(401, "La sesión ha terminado.");
      const duplicate = getPosts().find((item) => item.studentId === studentId && item.requestId === requestId);
      if (duplicate) return getPost(duplicate.id);
      savePosts([entry, ...getPosts()]);
      return entry;
    });
    if (saved !== post) for (const photo of post.photos) await discardAsset(photo, "feed");
    return json(res, saved === post ? 201 : 200, { post: postView(saved, studentId, getAuthors()) });
  }

  async function handlePublic(req, res, route, read, admin) {
    const studentId = studentSession(req)?.studentId;
    if (route === publicRoot && read) return postPage(req, res, studentId);
    if (route === publicRoot && req.method === "POST") return createPost(req, res);
    const match = /^\/api\/academy\/feed\/posts\/([a-f0-9]{32})(?:\/(heart|comments|photos)(?:\/([a-f0-9]{32}|[0-3]))?)?$/.exec(route);
    if (!match) throw new RequestError(404, "Página no encontrada.");
    const [, postId, action, childId] = match;
    if (read && !action) return json(res, 200, { post: postView(getPost(postId), studentId, getAuthors()) });
    if (read && action === "photos" && /^[0-3]$/.test(childId || "")) {
      return sendAsset(req, res, getPost(postId, Boolean(admin)).photos[Number(childId)], "feed");
    }
    if (read && action === "comments" && !childId) return commentPage(req, res, getPost(postId), studentId);
    if (req.method === "DELETE" && (!action || action === "comments" && childId)) {
      const session = requireStudent(req);
      const post = getPost(postId, true);
      if (action === "comments") {
        const comment = getComment(post, childId, true);
        if (comment.studentId !== session.studentId) throw new RequestError(403, "Solo puedes retirar tus propios comentarios.");
        savePost({ ...post, comments: post.comments.map((item) => item === comment ? { ...item, text: "", deleted: true } : item) });
      } else {
        if (post.studentId !== session.studentId) throw new RequestError(403, "Solo puedes retirar tus propias publicaciones.");
        savePost({ ...post, text: "", comments: [], hearts: [], photos: [], deleted: true });
        for (const photo of post.photos) await discardAsset(photo, "feed");
      }
      return json(res, 200, { removed: true });
    }
    if (!childId && (action === "heart" && req.method === "PUT" || action === "comments" && req.method === "POST")) {
      requireStudent(req);
      const body = await readJsonBody(req);
      const { studentId } = requireStudent(req);
      const post = getPost(postId);
      if (action === "heart") {
        if (typeof body?.loved !== "boolean") throw new RequestError(400, "Indica si quieres añadir o quitar tu corazón.");
        const hearts = post.hearts.filter((authorId) => authorId !== studentId);
        if (body.loved) hearts.push(studentId);
        if (hearts.length !== post.hearts.length) savePost({ ...post, hearts });
        return json(res, 200, { hearts: hearts.length, loved: body.loved });
      }
      const text = requireText(body?.text, 750, "Comentario", true);
      const requestId = validateRequestId(body?.requestId);
      const previous = post.comments.find((comment) => comment.studentId === studentId && comment.requestId === requestId);
      if (previous) return json(res, 200, { commentCount: post.comments.filter(publicContent).length });
      const comment = { id: id(), requestId, studentId, text, at: now() };
      const next = { ...post, comments: [comment, ...post.comments] };
      savePost(next);
      return json(res, 201, { commentCount: next.comments.filter(publicContent).length });
    }
    throw new RequestError(404, "Página no encontrada.");
  }

  async function handleAdmin(req, res, route, read, admin) {
    if (!admin) throw new RequestError(401, "Inicia sesión para entrar al panel.");
    if (read && route === adminRoot) return postPage(req, res, null, true);
    const match = /^\/api\/admin\/academy\/feed\/posts\/([a-f0-9]{32})(?:\/comments(?:\/([a-f0-9]{32}))?)?$/.exec(route);
    if (!match) throw new RequestError(404, "Página no encontrada.");
    const [, postId, commentId] = match;
    if (read && route.endsWith("/comments")) return commentPage(req, res, getPost(postId, true), null, true);
    if (req.method !== "PUT" || route.endsWith("/comments")) throw new RequestError(404, "Página no encontrada.");
    const body = await readJsonBody(req);
    if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
    if (typeof body?.hidden !== "boolean") throw new RequestError(400, "Selecciona ocultar o mostrar.");
    const post = getPost(postId, true);
    if (commentId) {
      const comment = getComment(post, commentId, true);
      savePost({ ...post, comments: post.comments.map((item) => item === comment ? { ...item, hidden: body.hidden } : item) });
    } else savePost({ ...post, hidden: body.hidden });
    return json(res, 200, { hidden: body.hidden });
  }

  return { handlePublic, handleAdmin, readPhotoForm, saveWithPhotos };
}

module.exports = { createFeed };
