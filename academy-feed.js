(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const { request } = window.academyPayment;
  const { setAvatar } = window.communityProfile;
  const form = $("#feed-compose");
  const list = $("#feed-posts");
  const status = $("#feed-status");
  const more = $("#feed-more");
  const previous = $("#feed-prev");
  const pagination = $("#feed-pagination");
  const pageLabel = $("#feed-page");
  const dates = new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeStyle: "short" });
  const relative = new Intl.RelativeTimeFormat("es-BO", { numeric: "auto" });
  const icons = {
    heart: '<path d="M20.8 9a4.6 4.6 0 0 1-1.4 3.3L12 20l-7.4-7.7a4.6 4.6 0 1 1 6.6-6.5l.8.8.8-.8a4.6 4.6 0 0 1 8 3.2Z"/>',
    comment: '<path d="M20 10.8a8 8 0 0 1-8 8 8.6 8.6 0 0 1-2.6-.4L4 20l1.4-4.3A8 8 0 1 1 20 10.8Z"/>',
    share: '<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="5" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="m8 10.8 8-4.6m-8 7 8 4.6"/>',
  };
  const root = "/feed/posts/";
  let student;
  const cursors = [null];
  let pageIndex = 0;
  let singlePost = false;
  let generation = 0;
  let draftId;
  let previews = [];

  function node(tag, text = "", className = "") {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }

  function linkedText(text) {
    const paragraph = node("p", "", "feed-text");
    const urls = /(?:https?:\/\/|www\.)[^\s<>"“”]+|(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:[/?#][^\s<>"“”]*)?/gi;
    let start = 0;
    for (const match of text.matchAll(urls)) {
      if (match.index > 0 && /[\p{L}\p{N}_@:/.-]/u.test(text[match.index - 1])) continue;
      let label = match[0].replace(/[.,!?;:\]}]+$/u, "");
      while (label.endsWith(")") && label.split(")").length > label.split("(").length) label = label.slice(0, -1);
      let destination;
      try { destination = new URL(/^https?:\/\//i.test(label) ? label : `https://${label}`); } catch { continue; }
      if (!["http:", "https:"].includes(destination.protocol) || destination.username || destination.password) continue;
      const link = node("a", label);
      link.href = destination.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer ugc";
      paragraph.append(text.slice(start, match.index), link);
      start = match.index + label.length;
    }
    paragraph.append(text.slice(start));
    return paragraph;
  }

  async function run(button, message, action) {
    if (button.disabled) return;
    button.disabled = true;
    message.textContent = "";
    try { await action(); }
    catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  }

  function byline({ author, at, news }) {
    const row = node(author.url ? "a" : "div", "", "feed-byline");
    if (author.url) {
      row.href = author.url;
      row.setAttribute("aria-label", `Ver perfil de ${author.name}`);
    }
    const image = node("img", "", "profile-avatar");
    image.alt = "";
    image.loading = "lazy";
    setAvatar(image, author.avatar);
    const details = node("div");
    const name = node("strong", author.name);
    const hours = Math.max(0, (Date.now() - Date.parse(at)) / 3_600_000);
    const time = node("time", hours < 1 ? relative.format(-Math.floor(hours * 60), "minute") :
      hours < 24 ? relative.format(-Math.floor(hours), "hour") : relative.format(-Math.floor(hours / 24), "day"));
    time.dateTime = at;
    time.title = dates.format(new Date(at));
    const identity = node("div", "", "feed-identity");
    identity.append(name);
    if (news) identity.append(node("span", "Noticia", "feed-news-label"));
    details.append(identity, time);
    row.append(image, details);
    return row;
  }

  function action(text) {
    const button = node("button", text, "academy-text-button");
    button.type = "button";
    return button;
  }

  function socialAction(kind, label) {
    const button = node("button", "", `feed-social-action feed-${kind}`);
    button.type = "button";
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[kind]}</svg>`;
    button.append(node("span", label));
    return button;
  }

  function commentsFor(post, count, content, toggle) {
    const entries = node("ul");
    const feedback = node("p");
    feedback.role = "status";
    const next = action("Ver más comentarios");
    next.hidden = true;
    let before;
    let loaded = false;
    let commentId;
    let requestCount = 0;
    const route = `${root}${post.id}/comments`;

    async function load(append = false) {
      const current = ++requestCount;
      const page = await request(append ? `${route}?before=${before}` : route);
      if (current !== requestCount) return;
      if (!append) entries.replaceChildren();
      for (const comment of page.comments) {
        const item = node("li");
        item.append(byline(comment), linkedText(comment.text));
        if (comment.own) {
          const remove = action("Eliminar comentario");
          remove.addEventListener("click", () => {
            if (!confirm("¿Eliminar tu comentario?")) return;
            run(remove, feedback, async () => {
              await request(`${route}/${comment.id}`, undefined, "DELETE");
              post.commentCount = Math.max(0, post.commentCount - 1);
              count.textContent = commentLabel(post.commentCount);
              window.academyRanking.refresh();
              await load();
            });
          });
          item.append(remove);
        }
        entries.append(item);
      }
      before = page.next;
      next.hidden = !before;
      loaded = true;
      if (!entries.children.length) feedback.textContent = "Aún no hay comentarios.";
    }

    for (const control of [toggle, count]) {
      control.setAttribute("aria-controls", content.id);
      control.setAttribute("aria-expanded", "false");
      control.addEventListener("click", () => {
        content.hidden = !content.hidden;
        toggle.setAttribute("aria-expanded", String(!content.hidden));
        count.setAttribute("aria-expanded", String(!content.hidden));
        if (!content.hidden && !loaded) run(next, feedback, () => load());
        if (!content.hidden && control === toggle) content.querySelector("textarea")?.focus({ preventScroll: true });
      });
    }
    next.addEventListener("click", () => run(next, feedback, () => load(true)));
    content.append(feedback, entries, next);
    if (!student) return;
    const commentForm = node("form", "", "feed-comment-form");
    const label = node("label", "Tu comentario");
    const input = node("textarea");
    input.rows = 2;
    input.maxLength = 750;
    input.required = true;
    input.addEventListener("input", () => { commentId = undefined; });
    label.append(input);
    const send = node("button", "Enviar comentario", "admin-primary");
    const sendStatus = node("p");
    sendStatus.role = "status";
    commentForm.append(label, send, sendStatus);
    commentForm.addEventListener("submit", (event) => {
      event.preventDefault();
      run(send, sendStatus, async () => {
        commentId ||= crypto.randomUUID();
        const draft = commentId;
        const result = await request(route, { text: input.value, requestId: commentId });
        count.textContent = commentLabel(post.commentCount = result.commentCount);
        if (draft === commentId) {
          input.value = "";
          commentId = undefined;
        }
        sendStatus.textContent = "Comentario publicado.";
        window.academyRanking.refresh();
        feedback.textContent = "";
        await load();
      });
    });
    content.append(commentForm);
  }

  const commentLabel = (count) => count === 1 ? "1 comentario" : `${count} comentarios`;

  function card(post) {
    const element = node("article", "", "feed-post");
    element.id = `publicacion-${post.id}`;
    const header = node("header", "", "feed-post-header");
    header.append(byline(post));
    const body = node("div", "", "feed-post-body");
    if (post.news) body.append(node("h3", post.news.title));
    if (post.text) body.append(linkedText(post.text));
    const destination = post.news?.destination;
    if (destination) {
      const link = node("a", destination.label, "feed-news-link");
      link.href = destination.url;
      body.append(link);
    }
    element.append(header, body);
    if (post.photos.length) {
      const images = node("div", "", "feed-photos");
      images.dataset.count = post.photos.length;
      post.photos.forEach((url, index) => {
        const image = node("img");
        image.src = url;
        image.alt = `Foto ${index + 1} de la publicación de ${post.author.name}`;
        image.loading = "lazy";
        images.append(image);
      });
      element.append(images);
    }
    const counters = node("div", "", "feed-counters");
    const count = node("button", commentLabel(post.commentCount));
    count.type = "button";
    const reactions = node("span", "", "feed-reactions");
    const symbol = node("span", "♥");
    symbol.setAttribute("aria-hidden", "true");
    const total = node("output");
    total.setAttribute("aria-label", "Total de corazones");
    reactions.append(symbol, total);
    counters.append(reactions, count);
    const controls = node("div", "", "feed-actions");
    const heart = socialAction("heart", "Me gusta");
    heart.disabled = !student;
    heart.setAttribute("aria-label", "Me gusta esta publicación");
    function updateHeart({ hearts, loved }) {
      heart.setAttribute("aria-pressed", String(loved));
      total.textContent = hearts;
      post.loved = loved;
    }
    const feedback = node("p", "", "feed-post-feedback");
    feedback.role = "status";
    updateHeart(post);
    heart.addEventListener("click", () => run(heart, feedback, async () => {
      updateHeart(await request(`${root}${post.id}/heart`, { loved: !post.loved }, "PUT"));
    }));
    controls.append(heart);
    if (post.own) {
      const remove = action("Eliminar publicación");
      remove.classList.add("feed-commands");
      remove.addEventListener("click", () => {
        if (!confirm("¿Eliminar tu publicación?")) return;
        run(remove, feedback, async () => {
          await request(`${root}${post.id}`, undefined, "DELETE");
          if (singlePost) {
            history.replaceState(null, "", "#feed");
            await load();
          } else await load(pageIndex);
          status.textContent = "Publicación eliminada.";
          window.ivannaApp.refresh();
          window.academyRanking.refresh();
        });
      });
      header.append(remove);
    }
    const toggle = socialAction("comment", "Comentar");
    const share = socialAction("share", "Compartir");
    const fallback = node("input", "", "feed-share-link");
    fallback.readOnly = true;
    fallback.hidden = true;
    fallback.setAttribute("aria-label", "Enlace de la publicación para copiar");
    share.addEventListener("click", async () => {
      const url = new URL(`/mi-espacio#${element.id}`, location.origin).href;
      try {
        if (navigator.share) await navigator.share({ title: post.news?.title || "Feed de Ivanna Saldaña", url });
        else {
          await navigator.clipboard.writeText(url);
          feedback.textContent = "Enlace copiado.";
        }
      } catch (error) {
        if (error.name === "AbortError") return;
        fallback.value = url;
        fallback.hidden = false;
        fallback.select();
        feedback.textContent = "Copia el enlace de la publicación.";
      }
    });
    controls.append(toggle, share);
    const comments = node("div", "", "feed-comments");
    comments.id = `comentarios-${post.id}`;
    comments.hidden = true;
    commentsFor(post, count, comments, toggle);
    element.append(counters, controls, feedback, fallback, comments);
    return element;
  }

  function linkedPost() {
    return location.hash.match(/^#publicacion-([a-f0-9]{32})$/)?.[1];
  }

  async function load(index = 0, { target, scroll = false } = {}) {
    const current = ++generation;
    const before = cursors[index];
    const result = target ? await request(`${root}${target}`).catch(() => null) : null;
    const page = result ? { posts: [result.post], next: null } :
      await request(`/feed?limit=3${before ? `&before=${before}` : ""}`);
    if (generation !== current) return;
    if (!page.posts.length && index > 0) return load(index - 1, { scroll });
    list.replaceChildren(...page.posts.map(card));
    pageIndex = index;
    singlePost = Boolean(result);
    cursors.length = index + 1;
    if (page.next) cursors.push(page.next);
    previous.hidden = !index && !singlePost;
    previous.textContent = singlePost ? "Volver a recientes" : "Anteriores";
    more.hidden = !page.next;
    pagination.hidden = previous.hidden && more.hidden;
    pageLabel.textContent = singlePost ? "" : `Página ${index + 1}`;
    status.textContent = target && !result ? "Esta publicación ya no está disponible." :
      page.posts.length ? "" : "Sé la primera en compartir una experiencia.";
    if (result) list.firstElementChild.scrollIntoView({ block: "start" });
    else if (scroll) {
      list.focus({ preventScroll: true });
      list.scrollIntoView({ block: "start" });
    }
  }

  function clearPreviews() {
    previews.forEach((url) => URL.revokeObjectURL(url));
    previews = [];
    $("#feed-preview").replaceChildren();
  }

  form.addEventListener("input", () => { draftId = undefined; });
  form.elements.photos.addEventListener("change", () => {
    clearPreviews();
    const files = [...form.elements.photos.files];
    if (files.length > 4 || files.some(({ size }) => size > 5 * 1024 * 1024)) {
      form.elements.photos.value = "";
      status.textContent = "Selecciona hasta 4 fotos de 5 MB cada una.";
      return;
    }
    status.textContent = "";
    for (const [index, file] of files.entries()) {
      const image = node("img");
      image.alt = `Vista previa de la foto ${index + 1}`;
      image.src = URL.createObjectURL(file);
      previews.push(image.src);
      $("#feed-preview").append(image);
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(form.querySelector("button"), status, async () => {
      const owner = student;
      const body = new FormData(form);
      draftId ||= crypto.randomUUID();
      const draft = draftId;
      body.set("requestId", draft);
      await request("/feed", body);
      if (owner !== student) return;
      if (draft === draftId) {
        form.reset();
        clearPreviews();
        draftId = undefined;
      }
      window.ivannaApp.refresh();
      window.academyRanking.refresh();
      if (linkedPost()) history.replaceState(null, "", "#feed");
      await load();
      status.textContent = "Publicación compartida.";
    });
  });
  more.addEventListener("click", () => run(more, status, () => load(pageIndex + 1, { scroll: true })));
  previous.addEventListener("click", () => run(previous, status, () => {
    if (singlePost) {
      history.replaceState(null, "", "#feed");
      return load(0, { scroll: true });
    }
    return load(pageIndex - 1, { scroll: true });
  }));

  const dock = [...document.querySelectorAll("[data-dock]")];
  dock[0].addEventListener("click", () => { if (student) $("#perfil").open = true; });
  function highlight() {
    const hash = location.hash.slice(1);
    const selected = ["student-access", "referidos"].includes(hash) ? "perfil" : hash.startsWith("publicacion-") ? "feed" :
      /^(inscripcion-|aviso-|avisos-de-pago|student-lesson)/.test(hash) ? "mis-cursos" : hash || (student ? "mis-cursos" : "feed");
    for (const link of dock) {
      if (link.dataset.dock === selected) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    if ((hash === "perfil" || hash === "referidos") && student) $("#perfil").open = true;
  }
  addEventListener("hashchange", () => {
    highlight();
    const target = linkedPost();
    if (target || (location.hash === "#feed" && singlePost)) {
      load(0, { target }).catch((error) => { status.textContent = error.message; });
    }
  });
  window.academyFeed = {
    reload() {
      load(pageIndex, { target: linkedPost() }).catch((error) => { status.textContent = error.message; });
    },
    setStudent(account, profile) {
      const next = account?.email || null;
      window.academyFeed.setAvatar(profile?.avatar);
      const firstName = account?.name?.trim().split(/\s+/u)[0];
      form.elements.text.placeholder = firstName ? `¿Qué quieres compartir, ${firstName}?` : "¿Qué quieres compartir?";
      if (student === next) return;
      student = next;
      form.reset();
      clearPreviews();
      draftId = undefined;
      form.hidden = !student;
      $("#feed-signin").hidden = Boolean(student);
      dock[0].href = student ? "#perfil" : "#student-access";
      dock[1].href = student ? "#mis-cursos" : "/#cursos";
      highlight();
      list.replaceChildren();
      load(0, { target: linkedPost() }).catch((error) => { status.textContent = error.message; });
    },
    setAvatar(source) {
      const avatar = $("#feed-composer-avatar");
      if (avatar.dataset.source === (source || "")) return;
      avatar.dataset.source = source || "";
      setAvatar(avatar, source);
    },
  };
  window.academyFeed.setStudent(null);
})();
