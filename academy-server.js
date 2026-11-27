"use strict";

const path = require("node:path");
const { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { communityCountries, interestOptions, normalizeWhatsAppNumber, plans, photos, zonedDateTimeToDate } = require("./home-config");
const { createFeed } = require("./academy-feed-server");
const { createPush, pushEndpoint, subscriptionData } = require("./academy-push");
const { createReferrals } = require("./academy-referrals");
const { createFinance } = require("./academy-finance");
const { createPlugNmeet } = require("./academy-plugnmeet");
const { createWaha } = require("./academy-waha");
const { localMedia } = require("./academy-media");

const deriveKey = promisify(scrypt);
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const LIMIT_WINDOW = 15 * 60 * 1000;
const MB = 1024 * 1024;
const AVATAR_LIMIT = 5 * MB;
const VIDEO_LINK_TTL = 20 * 60_000;
const MEDIA = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", mp4: "video/mp4" };
const SOCIAL_NETWORKS = [
  { key: "instagram", label: "Instagram", base: "https://www.instagram.com/", pattern: /^(?!\.)[a-z0-9_.]{1,30}(?<!\.)$/i },
  { key: "tiktok", label: "TikTok", base: "https://www.tiktok.com/@", pattern: /^(?!\.)[a-z0-9_.]{1,24}(?<!\.)$/i },
  { key: "facebook", label: "Facebook", base: "https://www.facebook.com/", pattern: /^(?!\.)[a-z0-9.]{1,50}(?<!\.)$/i },
  { key: "youtube", label: "YouTube", base: "https://www.youtube.com/@", pattern: /^[\p{L}\p{N}][\p{L}\p{M}\p{N}._·-]{0,29}$/u },
];
const EMPTY_COURSE = { title: "", description: "", price: "", instructions: "", qr: "", chapters: [], liveUrl: "" };
const MAX_CHAPTERS = 24;
const chapterId = /^(?:legacy|[a-f0-9]{32})$/;
const DEMO_REVIEWS = [
  { id: "demo-1", course: "Esencial", name: "Ejemplo 1", rating: 5, comment: "Me gustó ver cómo preparar la piel y elegir una base que quedara natural. Ahora repito la rutina con los productos que ya tengo." },
  { id: "demo-2", course: "Editorial", name: "Ejemplo 2", rating: 4, comment: "Los ejercicios de color me ayudaron a pasar de una referencia a un look propio. La parte de texturas fue mi favorita." },
  { id: "demo-3", course: "Artístico", name: "Ejemplo 3", rating: 5, comment: "Terminé con un diseño de body paint que pude llevar del boceto a la práctica. Las explicaciones sobre composición me dieron confianza." },
].map((review) => ({ ...review, status: "approved", demo: true, revision: 0, createdAt: "1970-01-01T00:00:00.000Z" }));
const EMPTY_STATE = { revision: 0, draft: EMPTY_COURSE, published: null, offerDrafts: {}, offers: {}, sessions: [], students: [], orders: [], paymentEmails: [], paymentWhatsApp: [], discussion: {}, feed: [], news: [], pushSubscriptions: [], pushJobs: [], financeEntries: [], demoReviews: DEMO_REVIEWS };
const EMPTY_DISCUSSION = { hearts: [], comments: [] };
const RANKING_EXAMPLES = [
  ["ejemplo-valentina-rios", "Valentina Ríos", "Maquillaje editorial", 48],
  ["ejemplo-natalia-vega", "Natalia Vega", "Maquillaje social", 42],
  ["ejemplo-camila-molina", "Camila Molina", "Body paint", 35],
  ["ejemplo-daniela-paz", "Daniela Paz", "Caracterización artística", 27],
  ["ejemplo-sofia-flores", "Sofía Flores", "Automaquillaje", 21],
].map(([slug, name, specialty, points], index) => ({ slug, name, specialty, points, rank: index + 1, url: `/perfil/${slug}` }));
const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIMARY = "principal";
const CATEGORIES = new Set(["live", "special", "course"]);
const LEGACY_OFFERS = new Map([
  [PRIMARY, { title: "Curso principal existente", category: "course" }],
  ["live", { title: "Evento en vivo destacado", category: "live" }],
  ...plans.map(({ id, name }) => [id, { title: name, category: "course" }]),
]);
const customOfferId = /^oferta-[a-f0-9]{32}$/;
const orderOffer = (order) => order.offerId || PRIMARY;
const NEWS_DESTINATIONS = {
  "": null,
  feed: { url: "/mi-espacio#feed", label: "Ver comunidad" },
  courses: { url: "/#subscripciones", label: "Ver subscripciones" },
  shop: { url: "/mi-espacio#shop", label: "Ver Shop" },
  portfolio: { url: "/#cursos", label: "Ver portafolio de cursos" },
};
const id = () => randomBytes(16).toString("hex");
const now = () => new Date().toISOString();
const sessionDigest = (token) => createHash("sha256").update(token).digest("hex");
const demoOfferId = (slug) => `oferta-${sessionDigest(`ivanna:demo:${slug}`).slice(0, 32)}`;

function courseChapters(course) {
  if (Array.isArray(course?.chapters)) return course.chapters;
  if (!course?.lessonTitle && !course?.lessonText && !course?.video) return [];
  return [{ id: "legacy", title: course.lessonTitle, text: course.lessonText, video: course.video }];
}

function chapterVersion(chapter) {
  return createHash("sha256").update(chapter.video || chapter.text || "").digest("hex");
}

function chapterSeen(order, chapter) {
  if (!order.seenChapters) return Boolean(order.completedAt);
  return order.seenChapters[chapter.id]?.version === chapterVersion(chapter);
}

function courseCompleted(order, chapters) {
  return chapters.length > 0 && chapters.every((chapter) => chapterSeen(order, chapter));
}

function newsPost(postId, { title, body, at }, destination) {
  return { id: postId, text: body, at, news: { title, destination }, photos: [], hearts: [], comments: [] };
}

function importPublishedNews(state) {
  const imported = [];
  const news = state.news.map((message) => {
    const postId = /^novedad-([a-f0-9]{32})$/.exec(message.id)?.[1];
    if (!postId || message.postId) return message;
    const destination = Object.values(NEWS_DESTINATIONS).find((item) => item?.url === message.url) || null;
    if (!state.feed.some((post) => post.id === postId)) imported.push(newsPost(postId, message, destination));
    return { ...message, postId, url: `/mi-espacio#publicacion-${postId}` };
  });
  return { ...state, news, feed: [...state.feed, ...imported].sort((a, b) => b.at.localeCompare(a.at)) };
}

function createAcademy(dataDir, helpers) {
  const { RequestError, readJsonFile, writeJsonFile, readJsonBody, readBody, photoExtension, json, currentAdmin, publishedHome, sendPaymentEmail, sendPush, plugNmeetTransport, wahaTransport, publicOrigin, scheduledNotifications = false } = helpers;
  const stateFile = path.join(dataDir, "academy.json");
  const media = helpers.academyMedia || localMedia(path.join(dataDir, "academy-media"));
  let state = importPublishedNews({ ...EMPTY_STATE, ...readJsonFile(stateFile, EMPTY_STATE) });
  const attemptsFile = path.join(dataDir, "auth-attempts.json");
  const attempts = new Map(scheduledNotifications ? readJsonFile(attemptsFile, []) : []);
  const dummySalt = id();
  const playbackSecret = helpers.playbackSecret || randomBytes(32);
  let sendingEmails = false;
  let sendingWhatsApp = false;
  const push = createPush(dataDir, { readJsonFile, writeJsonFile, sendPush, contact: helpers.pushContact });
  const referrals = createReferrals({ getState: () => state, RequestError });
  const plugNmeet = createPlugNmeet({ getSettings: () => state.plugNmeet, RequestError, requireText, id, transport: plugNmeetTransport });
  const waha = createWaha({ getSettings: () => state.waha, RequestError, requireText, id, publicOrigin, transport: wahaTransport });

  function save(next) {
    writeJsonFile(stateFile, next);
    state = next;
  }

  function saveOrder(order, notify = false) {
    const previous = state.orders.find((existing) => existing.id === order.id);
    const earned = previous?.status !== "approved" && order.status === "approved" ? referrals.newReward(order) : null;
    if (earned) order = { ...order, referralReward: earned };
    const orders = state.orders.filter((existing) => existing.id !== order.id);
    const email = notify && !order.demo && state.students.find(({ id }) => id === order.studentId)?.email;
    const outbox = email ? [...state.paymentEmails, {
      id: `payment/${order.id}/${order.submissionId}/${order.status}`, orderId: order.id,
      title: order.title, email, status: order.status, createdAt: order.updatedAt, attempts: 0,
    }] : state.paymentEmails;
    const config = waha.settings();
    const alert = notify && !order.demo && order.status === "submitted" && config.enabled;
    const paymentWhatsApp = alert ? [...state.paymentWhatsApp.filter((item) => item.orderId !== order.id), {
      orderId: order.id, submissionId: order.submissionId, destinationId: config.destinationId, attempts: 0,
    }] : state.paymentWhatsApp;
    save({ ...state, orders: [...orders, order], paymentEmails: outbox, paymentWhatsApp });
    if (!scheduledNotifications) {
      if (email) queueMicrotask(runPaymentEmails);
      if (alert) queueMicrotask(runPaymentWhatsApp);
    }
    const notification = paymentNotification(order);
    if (notification && previous?.status !== order.status) dispatchPush(notification, order.studentId);
    if (earned) dispatchPush(referralNotification(order), earned.studentId);
  }

  function referralNotification(order) {
    const id = `referido-${order.id}`;
    return {
      id, tag: id, title: "Ganaste un descuento por invitar",
      body: `Tienes ${order.referralReward.percent} % de descuento para una próxima compra.`,
      url: "/mi-espacio#referidos", at: order.reviewedAt || order.updatedAt,
    };
  }

  function paymentNotification(order) {
    const titles = {
      submitted: "Verificando comprobante",
      approved: offerCategory(orderOffer(order)) === "live" ? "Tu acceso al vivo está listo" : "Tu curso está listo para ver",
      rejected: "Corrige el comprobante",
    };
    const title = titles[order.status];
    if (!title) return null;
    const target = order.status === "approved" ? "inscripcion" : "aviso";
    const at = (order.status === "submitted" ? order.submittedAt : order.reviewedAt) || order.updatedAt;
    return { id: `pago-${order.id}-${order.status}-${at}`, title, body: order.title, url: `/mi-espacio#${target}-${order.id}`, tag: `pago-${order.id}`, at };
  }

  function dispatchPush(message, studentId) {
    const recipients = state.pushSubscriptions.filter((item) => !studentId || item.studentId === studentId);
    if (!recipients.length) return;
    if (scheduledNotifications) {
      save({ ...state, pushJobs: [...state.pushJobs, { message, ...(studentId && { studentId }) }] });
      return;
    }
    deliverPush(recipients, message).catch(() => console.warn("No se pudo completar el envío de avisos web."));
  }

  function deliverPush(recipients, message) {
    return push.deliver(recipients, message, (expired) => {
      const pushSubscriptions = state.pushSubscriptions.filter((item) => item !== expired);
      if (pushSubscriptions.length !== state.pushSubscriptions.length) save({ ...state, pushSubscriptions });
    });
  }

  async function notifications(req, res, route, read) {
    if (read && route === "/api/academy/notifications") {
      const session = studentSession(req);
      const orders = session ? state.orders.filter(({ studentId }) => studentId === session.studentId) : [];
      const earned = session ? state.orders.filter((order) => order.referralReward?.studentId === session.studentId).map(referralNotification) : [];
      const visibleNews = new Set(state.feed.filter((post) => post.news && !post.hidden && !post.deleted).map((post) => post.id));
      const entries = [...orders.map(paymentNotification).filter(Boolean), ...earned, ...state.news.filter(({ postId }) => visibleNews.has(postId))]
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
      return json(res, 200, { entries, signedIn: Boolean(session) });
    }
    if (read && route === "/api/academy/notifications/key") {
      requireStudent(req);
      return json(res, 200, { key: push.publicKey() });
    }
    if (route !== "/api/academy/notifications/subscription" || !["PUT", "DELETE"].includes(req.method)) {
      throw new RequestError(404, "Página no encontrada.");
    }
    requireStudent(req);
    const input = await readJsonBody(req, 4096);
    const { digest, studentId } = requireStudent(req);
    const endpoint = pushEndpoint(input?.endpoint);
    if (!endpoint) throw new RequestError(400, "El navegador no proporcionó una dirección de avisos compatible.");
    if (req.method === "DELETE") {
      save({ ...state, pushSubscriptions: state.pushSubscriptions.filter((item) => item.studentId !== studentId || item.subscription.endpoint !== endpoint) });
      return json(res, 200, { enabled: false });
    }
    const subscription = subscriptionData(input);
    if (!subscription) throw new RequestError(400, "La suscripción de avisos no es válida.");
    const remaining = state.pushSubscriptions.filter((item) => item.subscription.endpoint !== endpoint);
    const devices = remaining.filter((item) => item.studentId === studentId).slice(-11);
    const others = remaining.filter((item) => item.studentId !== studentId);
    save({ ...state, pushSubscriptions: [...others, ...devices, { studentId, digest, subscription }] });
    return json(res, 200, { enabled: true });
  }

  async function manageNews(req, res, read) {
    if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
    if (read) return json(res, 200, { entries: state.news });
    if (req.method !== "POST") throw new RequestError(404, "Página no encontrada.");
    const multipart = /^multipart\/form-data(?:\s*;|$)/i.test(req.headers["content-type"] || "");
    const { form, images } = multipart ? await feed.readPhotoForm(req) : { images: [] };
    const input = form ? Object.fromEntries(form) : await readJsonBody(req, 12 * 1024);
    if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
    const title = requireText(input?.title, 90, "Título", true);
    const body = requireText(input?.body, 1800, "Mensaje", true);
    const destination = input?.destination ?? "";
    if (typeof destination !== "string" || !Object.hasOwn(NEWS_DESTINATIONS, destination)) throw new RequestError(400, "Elige un enlace para la noticia.");
    const postId = id();
    const newsId = `novedad-${postId}`;
    const preview = Array.from(body.replace(/\s+/g, " "));
    const excerpt = preview.length > 140 ? `${preview.slice(0, 137).join("").trimEnd()}…` : preview.join("");
    const at = now();
    const message = { id: newsId, postId, tag: newsId, title, body: excerpt, url: `/mi-espacio#publicacion-${postId}`, at };
    await feed.saveWithPhotos(newsPost(postId, { title, body, at }, NEWS_DESTINATIONS[destination]), images, (post) => {
      save({ ...state, news: [message, ...state.news].slice(0, 30), feed: [post, ...state.feed] });
    });
    if (input.push === true || input.push === "on") dispatchPush(message);
    return json(res, 201, { entries: state.news });
  }

  function updatePaymentEmail(id, details) {
    save({ ...state, paymentEmails: state.paymentEmails.map((job) => job.id === id ? { ...job, ...details } : job) });
  }

  async function runPaymentEmails() {
    if (!sendPaymentEmail || sendingEmails) return;
    sendingEmails = true;
    try {
      const timestamp = Date.now();
      const pending = state.paymentEmails.filter((job) => !job.sentAt && !job.failedAt && (job.nextAttemptAt || 0) <= timestamp);
      for (const job of pending.slice(0, 10)) {
        const elapsed = job.firstAttemptAt && timestamp - Date.parse(job.firstAttemptAt);
        if (job.attempts >= 7 || elapsed >= 23 * 60 * 60 * 1000) {
          updatePaymentEmail(job.id, { failedAt: now() });
          continue;
        }
        const attempts = job.attempts + 1;
        updatePaymentEmail(job.id, { attempts, firstAttemptAt: job.firstAttemptAt || now(), nextAttemptAt: timestamp + 60_000 * 2 ** (attempts - 1) });
        try {
          await sendPaymentEmail(job);
          updatePaymentEmail(job.id, { sentAt: now() });
        } catch {
          if (attempts === 7) updatePaymentEmail(job.id, { failedAt: now() });
        }
      }
    } catch (error) {
      console.error("No se pudo actualizar la cola de correo.", error.code || "");
    } finally {
      sendingEmails = false;
    }
  }

  async function runPaymentWhatsApp() {
    if (sendingWhatsApp || !waha.settings().enabled) return;
    sendingWhatsApp = true;
    const update = (job, details) => save({
      ...state,
      paymentWhatsApp: state.paymentWhatsApp.map((item) => item.orderId === job.orderId && item.submissionId === job.submissionId ? { ...item, ...details } : item),
    });
    try {
      const timestamp = Date.now();
      const pending = state.paymentWhatsApp.filter((job) => !job.delivery && (job.nextAttemptAt || 0) <= timestamp);
      for (const job of pending.slice(0, 5)) {
        const config = waha.settings();
        if (!config.enabled) break;
        const order = state.orders.find((item) => item.id === job.orderId);
        if (config.destinationId !== job.destinationId || order?.status !== "submitted" || order.submissionId !== job.submissionId) {
          update(job, { delivery: "skipped" });
          continue;
        }
        if (job.attempts >= 7) {
          update(job, { delivery: "failed" });
          continue;
        }
        const attempts = job.attempts + 1;
        update(job, { attempts, nextAttemptAt: timestamp + 60_000 * 2 ** (attempts - 1) });
        try {
          const extension = order.receipt?.split(".").at(-1);
          const bytes = config.attachReceipt && validAsset(order.receipt, "receipt") && await media.read(order.receipt);
          const file = bytes ? { data: bytes.toString("base64"), mimetype: MEDIA[extension], filename: `comprobante.${extension}` } : null;
          if (waha.settings() !== config || state.orders.find((item) => item.id === job.orderId) !== order) continue;
          const student = state.students.find((item) => item.id === order.studentId);
          update(job, { delivery: await waha.notify(config, order, student, file) });
        } catch {
          if (attempts === 7) update(job, { delivery: "failed" });
        }
      }
    } catch (error) {
      console.error("No se pudo actualizar la cola de WhatsApp.", error.code || "");
    } finally {
      sendingWhatsApp = false;
    }
  }

  async function runPaymentNotifications() {
    for (const { message, studentId } of state.pushJobs.slice(0, 5)) {
      const recipients = state.pushSubscriptions.filter((item) => !studentId || item.studentId === studentId);
      await deliverPush(recipients, message);
      save({ ...state, pushJobs: state.pushJobs.filter((job) => job.message.id !== message.id) });
    }
    await Promise.all([runPaymentEmails(), runPaymentWhatsApp()]);
  }

  function startPaymentNotifications() {
    const timer = setInterval(runPaymentNotifications, 30_000);
    queueMicrotask(runPaymentNotifications);
    return () => clearInterval(timer);
  }

  function paymentHistory(order) {
    if (order.paymentHistory) return order.paymentHistory;
    const history = [{ status: "awaiting_receipt", at: order.createdAt }];
    if (order.submittedAt) history.push({ status: "submitted", at: order.submittedAt });
    if (order.reviewedAt && ["approved", "rejected"].includes(order.status)) {
      history.push({ status: order.status, at: order.reviewedAt, reviewer: order.reviewer, note: order.note });
    }
    return history;
  }

  function requireText(value, max, label, required = false) {
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
      throw new RequestError(400, `Revisa el campo «${label}».`);
    }
    return value.trim();
  }

  function registrationProfile(body) {
    const { country, interest } = body;
    if (typeof country !== "string" || !Object.hasOwn(communityCountries, country)) throw new RequestError(400, "Selecciona un país de la lista.");
    // Earlier versions of the registration form submitted a city for Bolivia.
    const location = country === "BO" && Object.hasOwn(body, "department")
      ? { department: body.department }
      : { city: requireText(body.city, 100, "Ciudad", true) };
    if (Object.hasOwn(location, "department") && !communityCountries.BO.departments.includes(location.department)) {
      throw new RequestError(400, "Selecciona uno de los nueve departamentos de Bolivia.");
    }
    if ((typeof body.age !== "string" && typeof body.age !== "number") || !/^\d{1,3}$/.test(String(body.age))) {
      throw new RequestError(400, "Escribe una edad válida en años.");
    }
    const age = Number(body.age);
    if (age < 1 || age > 120) throw new RequestError(400, "Escribe una edad válida en años.");

    const { prefix } = communityCountries[country];
    const number = requireText(body.whatsapp, 24, "WhatsApp", true).replace(/[\s().-]/g, "");
    if (country === "BO" && !/^\d{8}$/.test(number)) throw new RequestError(400, "Para Bolivia, escribe los 8 dígitos de WhatsApp sin el +591.");
    if (!/^\d{6,14}$/.test(number) || `${prefix}${number}`.length > 16) throw new RequestError(400, "Escribe un número de WhatsApp válido sin el prefijo del país.");
    if (!interestOptions(publishedHome()).includes(interest)) throw new RequestError(400, "Selecciona un interés de la lista. Si la lista cambió, recarga la página.");

    return { country, ...location, age, whatsapp: `${prefix}${number}`, interest, whatsappConsent: body.whatsappConsent === true };
  }

  function validAsset(value, kind) {
    const extension = kind === "video" ? "mp4" : kind === "receipt" ? "jpg|png|webp|pdf" : "jpg|png|webp";
    return typeof value === "string" && new RegExp(`^${kind}-[a-f0-9]{32}\\.(?:${extension})$`).test(value)
      && media.exists(value);
  }

  function checkChapters(input, publish, category) {
    if (category === "live") return [];
    const chapters = input?.chapters === undefined ? courseChapters(input) : input.chapters;
    const limit = category === "special" ? 1 : MAX_CHAPTERS;
    if (!Array.isArray(chapters) || chapters.length > limit || (publish && !chapters.length)) {
      throw new RequestError(400, category === "special" ? "El especial necesita una sola lección para publicarse." : `Agrega entre 1 y ${limit} capítulos para publicar el curso.`);
    }
    const ids = new Set();
    return chapters.map((chapter, index) => {
      const position = index + 1;
      const key = chapter?.id || id();
      if (typeof key !== "string" || !chapterId.test(key) || ids.has(key)) throw new RequestError(400, "Hay capítulos duplicados o con una referencia inválida.");
      ids.add(key);
      const title = requireText(chapter?.title ?? "", 120, `Título del capítulo ${position}`, publish);
      const text = requireText(chapter?.text ?? "", 12000, `Contenido del capítulo ${position}`);
      const video = chapter?.video || "";
      if (video && !validAsset(video, "video")) throw new RequestError(400, `Vuelve a subir el video del capítulo ${position}.`);
      if (publish && !text && !video) throw new RequestError(400, `Agrega texto o video al capítulo ${position}.`);
      return { id: key, title, text, video };
    });
  }

  function checkCourse(input, publish, category, requiresCover, demo) {
    const isLive = category === "live";
    const liveProvider = isLive && !demo && input?.liveProvider === "plugnmeet" ? "plugnmeet" : "manual";
    if (publish && liveProvider === "plugnmeet") plugNmeet.config();
    const course = {
      category,
      title: requireText(input?.title, 120, "Título", publish),
      description: requireText(input?.description, 1200, "Descripción", publish),
      price: requireText(input?.price, 14, "Precio en bolivianos", publish),
      instructions: requireText(demo?.instructions ?? input?.instructions, 900, "Instrucciones de pago", publish),
      qr: demo?.qr || input?.qr || "",
      chapters: checkChapters(input, publish, category),
      liveUrl: isLive && !demo && liveProvider === "manual" ? requireText(input?.liveUrl || "", 500, "Enlace privado de la transmisión", publish) : "",
      ...(liveProvider === "plugnmeet" && { liveProvider }),
      startsAt: isLive ? requireText(input?.startsAt || "", 16, "Fecha y hora del vivo") : "",
      cover: requireText(input?.cover || "", 48, "Portada"),
      ...(demo && { demo: true, ...(demo.demoVideo && { demoVideo: demo.demoVideo }) }),
    };
    const validPrice = /^\d{1,7}(?:[.,]\d{1,2})?$/.test(course.price);
    if ((course.price && !validPrice) || (publish && (!validPrice || Number(course.price.replace(",", ".")) <= 0))) {
      throw new RequestError(400, "Indica un precio mayor que cero en bolivianos, con hasta dos decimales.");
    }
    if ((publish || course.qr) && !validAsset(course.qr, "qr")) throw new RequestError(400, "Sube una imagen del QR para publicar el curso.");
    if (course.liveUrl) {
      let url;
      try { url = new URL(course.liveUrl); } catch {}
      if (!url || url.protocol !== "https:" || url.username || url.password) throw new RequestError(400, "Usa un enlace HTTPS válido para la transmisión.");
      course.liveUrl = url.href;
    }
    if (course.startsAt) {
      const date = new Date(`${course.startsAt}Z`);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(course.startsAt) || !Number.isFinite(+date) || date.toISOString().slice(0, 16) !== course.startsAt) {
        throw new RequestError(400, "Indica una fecha y hora válidas para el vivo.");
      }
    }
    if ((publish && requiresCover && !course.cover) || (course.cover && !photos.some(({ id }) => id === course.cover) && !validAsset(course.cover, "cover"))) {
      throw new RequestError(400, "Sube una imagen de portada o elige una de la galería.");
    }
    return course;
  }

  function studentSession(req) {
    const token = /(?:^|;\s*)ivanna_student=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || "")?.[1];
    if (!token) return null;
    const digest = sessionDigest(token);
    return state.sessions.find((session) => session.digest === digest && session.expires > Date.now()) || null;
  }

  function requireStudent(req) {
    const session = studentSession(req);
    if (!session) throw new RequestError(401, "Inicia sesión como estudiante.");
    return session;
  }

  function createStudentSession(studentId) {
    const token = randomBytes(32).toString("hex");
    return { token, session: { digest: sessionDigest(token), studentId, expires: Date.now() + SESSION_SECONDS * 1000 } };
  }

  function setStudentCookie(req, res, token) {
    res.setHeader("Set-Cookie", `ivanna_student=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${req.ivannaSecure ? "; Secure" : ""}`);
  }

  function openSession(req, res, student, registering) {
    const previous = studentSession(req);
    const timestamp = Date.now();
    const sessions = state.sessions.filter((session) => session.digest !== previous?.digest && session.expires > timestamp);
    const { token, session } = createStudentSession(student.id);
    const pushSubscriptions = state.pushSubscriptions.flatMap((item) => {
      if (item.digest !== previous?.digest) return [item];
      return item.studentId === student.id ? [{ ...item, digest: session.digest }] : [];
    });
    save({ ...state, students: registering ? [...state.students, student] : state.students, sessions: [...sessions, session], pushSubscriptions });
    setStudentCookie(req, res, token);
  }

  function allowAuthAttempt(req, scope = "login") {
    const timestamp = Date.now();
    const endpoint = `${scope}:${sessionDigest(req.socket?.remoteAddress || "unknown")}`;
    for (const [key, value] of attempts) if (value.start + LIMIT_WINDOW <= timestamp) attempts.delete(key);
    const counter = attempts.get(endpoint) || { start: timestamp, count: 0 };
    if (counter.count >= 30) throw new RequestError(429, "Demasiados intentos. Espera unos minutos y vuelve a intentar.");
    counter.count += 1;
    attempts.set(endpoint, counter);
    if (scheduledNotifications) writeJsonFile(attemptsFile, [...attempts]);
  }

  function findOrder(studentId, offerId = PRIMARY) {
    return state.orders.find((order) => order.studentId === studentId && orderOffer(order) === offerId);
  }

  function lookupOffer(offerId) {
    return offerId === PRIMARY ? state.published : state.offers[offerId];
  }

  function offerCategory(offerId) {
    const legacy = LEGACY_OFFERS.get(offerId);
    if (legacy) return legacy.category;
    if (typeof offerId !== "string" || !customOfferId.test(offerId)) return null;
    return state.offerDrafts[offerId]?.category || state.offers[offerId]?.category || null;
  }

  function catalogIds() {
    return [...new Set([...LEGACY_OFFERS.keys(), ...Object.keys(state.offerDrafts), ...Object.keys(state.offers)])].filter(offerCategory);
  }

  function publicOffer(offer) {
    return { title: offer.title, description: offer.description, cents: offer.cents, ...(offer.demo && { demo: true }) };
  }

  function publicStudent(student) {
    return student ? { name: student.name, email: student.email } : null;
  }

  function publicName(student) {
    const first = student?.name.trim().split(/\s+/u)[0];
    return first && !first.includes("@") ? first : "Participante";
  }

  function communityProfile(student, { hasReview, publicParticipant = false } = {}) {
    const { avatar, handles = {}, specialty } = student.communityProfile || {};
    const socials = SOCIAL_NETWORKS.filter(({ key }) => handles[key]).map(({ key, label, base }) => ({
      key, label, handle: handles[key], href: `${base}${encodeURIComponent(handles[key])}`,
    }));
    const published = avatar || socials.length || specialty || (hasReview ?? state.orders.some((order) => order.studentId === student.id && order.review?.status === "approved"));
    const name = publicName(student);
    const displayName = student.name.trim().replace(/\s+/gu, " ");
    return {
      name, displayName: (!publicParticipant || published) && displayName && !displayName.includes("@") ? displayName : name, socials,
      ...(specialty && { specialty }),
      url: published || publicParticipant ? `/perfil/${student.id}` : null,
      avatar: avatar ? `/api/academy/profiles/${student.id}/avatar?v=${avatar}` : null,
    };
  }

  function hasPublicParticipation(student) {
    if (state.feed.some((post) => !post.hidden && !post.deleted && (post.studentId === student.id ||
      post.comments.some((comment) => comment.studentId === student.id && !comment.hidden && !comment.deleted)))) return true;
    if (student.demo) return false;
    return state.orders.some((order) => order.studentId === student.id && order.status === "approved" && !order.demo) ||
      Object.values(state.discussion).some(({ comments }) => comments.some((comment) => comment.studentId === student.id && comment.status === "approved"));
  }

  function communityRanking() {
    const scores = new Map(state.students.filter((student) => !student.demo).map((student) => [
      student.id, { student, purchases: 0, courseComments: 0, feedActivity: 0 },
    ]));
    function count(studentId, type) {
      const score = scores.get(studentId);
      if (!score) return;
      score[type] += 1;
    }
    for (const order of state.orders) {
      if (order.status === "approved" && !order.demo) count(order.studentId, "purchases");
    }
    for (const { comments } of Object.values(state.discussion)) {
      for (const comment of comments) if (comment.status === "approved") count(comment.studentId, "courseComments");
    }
    for (const post of state.feed) {
      if (post.hidden || post.deleted) continue;
      count(post.studentId, "feedActivity");
      for (const comment of post.comments) {
        if (!comment.hidden && !comment.deleted) count(comment.studentId, "feedActivity");
      }
    }
    return [...scores.values()].map((score) => ({
      ...score, points: score.purchases * 3 + score.courseComments * 2 + score.feedActivity,
    })).filter(({ points }) => points > 0)
      .sort((a, b) => b.points - a.points || b.purchases - a.purchases || b.courseComments - a.courseComments ||
        (a.student.createdAt ?? "").localeCompare(b.student.createdAt ?? "") || a.student.id.localeCompare(b.student.id))
      .slice(0, 5)
      .map(({ student, points }, index) => {
        const { displayName: name, avatar, url } = communityProfile(student, { publicParticipant: true });
        return { rank: index + 1, name, avatar, url, points };
      });
  }

  function publicOrder(order) {
    if (!order) return null;
    const { id, title, cents, status, instructions, note, updatedAt } = order;
    const offerId = orderOffer(order);
    const discount = order.discount && { kind: order.discount.kind, percent: order.discount.percent, savedCents: order.discount.savedCents, ...(order.discount.code && { code: order.discount.code }) };
    return {
      id, title, cents, status, instructions, note, updatedAt, offerId, category: offerCategory(offerId) || "course",
      completed: Boolean(order.completedAt), reviewStatus: order.review?.status ?? null,
      ...(discount && { baseCents: order.baseCents, discount }), ...(order.demo && { demo: true }),
    };
  }

  function studentOrder(order) {
    const details = publicOrder(order);
    const offer = lookupOffer(details.offerId);
    if (details.category === "live") {
      if (offer?.liveProvider === "plugnmeet") details.liveProvider = "plugnmeet";
      const home = publishedHome();
      const zone = details.offerId === "live" && !offer?.startsAt ? home.countdownTimezone : "America/La_Paz";
      const date = zonedDateTimeToDate(offer?.startsAt || (details.offerId === "live" ? home.countdownTarget : ""), zone);
      if (Number.isFinite(+date)) details.schedule = { date: date.toISOString(), zone };
    } else if (order.status === "approved") {
      const chapters = courseChapters(offer);
      details.chapters = chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, seen: chapterSeen(order, chapter) }));
      details.completed = courseCompleted(order, chapters);
    }
    return details;
  }

  function allReviews() {
    return [...state.orders.filter((order) => order.review).map((order) => ({ ...order.review, id: order.id, course: order.title, demo: Boolean(order.demo) })), ...state.demoReviews]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function viewDiscussion(offerId, studentId, page = 1) {
    const discussion = state.discussion[offerId] || EMPTY_DISCUSSION;
    const approved = discussion.comments.filter(({ status }) => status === "approved");
    const pageSize = 8;
    const from = (page - 1) * pageSize;
    const authors = new Map(state.students.map((student) => [student.id, student]));
    const comments = approved.slice(from, from + pageSize).map(({ id, studentId, text, at }) => ({ id, name: publicName(authors.get(studentId)), text, at }));
    return {
      count: discussion.hearts.length, loved: discussion.hearts.includes(studentId), comments,
      pending: discussion.comments.some((comment) => comment.studentId === studentId && comment.status === "pending"),
      nextPage: from + pageSize < approved.length ? page + 1 : null,
    };
  }

  function saveDiscussion(offerId, discussion) {
    save({ ...state, discussion: { ...state.discussion, [offerId]: discussion } });
  }

  function reviewText(input) {
    const rating = input?.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new RequestError(400, "Selecciona de 1 a 5 estrellas.");
    return { rating, comment: requireText(input.comment, 750, "Reseña", true) };
  }

  function studentView(session) {
    const published = state.published;
    const course = published?.open ? publicOffer(published) : null;
    const student = session && state.students.find((item) => item.id === session.studentId);
    const offers = catalogIds().filter((offerId) => offerId !== PRIMARY && lookupOffer(offerId)?.open).map((offerId) => {
      const offer = lookupOffer(offerId);
      const category = offerCategory(offerId);
      const cover = offer.cover || "";
      return {
        id: offerId, category, cover, startsAt: offer.startsAt || "", ...publicOffer(offer),
        ...(cover.startsWith("cover-") && { coverUrl: `/api/academy/covers/${cover}` }),
        ...(category === "course" && { chapterCount: courseChapters(offer).length }),
      };
    });
    const orders = student ? state.orders.filter((order) => order.studentId === student.id).map(studentOrder) : [];
    return {
      course, offers, student: publicStudent(student), profile: student ? communityProfile(student) : null,
      account: student ? { whatsapp: student.profile?.whatsapp || "" } : null,
      referrals: referrals.member(student),
      order: orders.find((order) => order.offerId === PRIMARY) || null, orders,
    };
  }

  function saveAccount(req, res, session, updated, secureChange) {
    const students = state.students.map((student) => student.id === updated.id ? updated : student);
    if (!secureChange) {
      save({ ...state, students });
      return json(res, 200, studentView(session));
    }
    const { token, session: replacement } = createStudentSession(updated.id);
    const sessions = state.sessions.filter(({ studentId }) => studentId !== updated.id);
    const pushSubscriptions = state.pushSubscriptions.flatMap((item) => {
      if (item.studentId !== updated.id) return [item];
      return item.digest === session.digest ? [{ ...item, digest: replacement.digest }] : [];
    });
    const orders = new Set(state.orders.filter(({ studentId }) => studentId === updated.id).map(({ id }) => id));
    const paymentEmails = state.paymentEmails.map((job) => orders.has(job.orderId) && !job.sentAt && !job.failedAt
      ? { ...job, email: updated.email } : job);
    save({ ...state, students, sessions: [...sessions, replacement], pushSubscriptions, paymentEmails });
    setStudentCookie(req, res, token);
    return json(res, 200, studentView(replacement));
  }

  async function updateAccount(req, res, changingPassword) {
    requireStudent(req);
    const body = await readJsonBody(req, 8192);
    let session = requireStudent(req);
    let student = state.students.find(({ id }) => id === session.studentId);
    const name = changingPassword ? student.name : requireText(body?.name, 100, "Nombre completo", true);
    const email = changingPassword ? student.email : requireText(body?.email, 160, "Correo electrónico", true).toLowerCase();
    if (!validEmail.test(email)) throw new RequestError(400, "Escribe un correo electrónico válido.");

    const emailChanged = student.email !== email;
    const secureChange = changingPassword || emailChanged;
    let credentials = {};
    if (secureChange) {
      const current = body?.currentPassword;
      if (typeof current !== "string" || current.length < 10 || current.length > 128) {
        throw new RequestError(400, "Escribe tu contraseña actual.");
      }
      const password = body?.newPassword;
      if (changingPassword && (typeof password !== "string" || password.length < 10 || password.length > 128)) {
        throw new RequestError(400, "Usa entre 10 y 128 caracteres para la nueva contraseña.");
      }
      if (changingPassword && password === current) throw new RequestError(400, "Elige una contraseña diferente de la actual.");
      allowAuthAttempt(req, student.id);
      const hash = await deriveKey(current, student.salt, 64);
      if (!timingSafeEqual(hash, Buffer.from(student.passwordHash, "hex"))) throw new RequestError(403, "La contraseña actual no coincide.");
      if (changingPassword) {
        const salt = id();
        credentials = { salt, passwordHash: (await deriveKey(password, salt, 64)).toString("hex") };
      }
      session = requireStudent(req);
      student = state.students.find(({ id }) => id === session.studentId);
    }
    if (emailChanged && state.students.some((item) => item.email === email && item.id !== student.id)) {
      throw new RequestError(409, "Ese correo electrónico ya está en uso.");
    }
    if (changingPassword) return saveAccount(req, res, session, { ...student, ...credentials }, true);

    const phone = requireText(body?.whatsapp, 32, "WhatsApp");
    const number = normalizeWhatsAppNumber(phone);
    if (phone && (!phone.startsWith("+") || !number)) throw new RequestError(400, "Escribe el WhatsApp con el código de país, por ejemplo +591 70000000.");
    const profile = { ...student.profile, whatsapp: number ? `+${number}` : "" };
    return saveAccount(req, res, session, { ...student, name, email, profile }, secureChange);
  }

  function adminView() {
    const students = new Map(state.students.map((student) => [student.id, student]));
    const whatsApp = new Map(state.paymentWhatsApp.map((job) => [job.orderId, job.delivery || "queued"]));
    const emails = new Map();
    for (const { orderId, status, sentAt, failedAt } of state.paymentEmails) {
      if (!emails.has(orderId)) emails.set(orderId, []);
      emails.get(orderId).push({ status, delivery: sentAt ? "sent" : failedAt ? "failed" : sendPaymentEmail ? "queued" : "unconfigured" });
    }
    const month = new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", month: "numeric", year: "numeric" });
    const approved = state.orders.filter((order) => order.status === "approved" && !order.demo);
    const current = Object.fromEntries(month.formatToParts(Date.now()).map(({ type, value }) => [type, value]));
    const monthLabel = new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", month: "short", year: "numeric" });
    const totals = new Map();
    for (const order of approved) {
      const period = month.format(new Date(order.reviewedAt));
      totals.set(period, (totals.get(period) || 0) + order.cents);
    }
    const revenue = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(Number(current.year), Number(current.month) - 6 + index, 15, 12));
      return { label: monthLabel.format(date), cents: totals.get(month.format(date)) || 0 };
    });
    return {
      draft: state.draft,
      revision: state.revision,
      open: Boolean(state.published?.open),
      publishedTitle: state.published?.title || null,
      offerDrafts: state.offerDrafts,
      offers: Object.fromEntries(catalogIds().filter((offerId) => state.offers[offerId]).map((offerId) => [offerId, {
        title: state.offers[offerId].title, open: state.offers[offerId].open,
      }])),
      catalog: catalogIds().map((offerId) => {
        const offer = lookupOffer(offerId);
        const draft = offerId === PRIMARY ? state.draft : state.offerDrafts[offerId];
        return {
          id: offerId, category: offerCategory(offerId),
          title: offer?.title || draft?.title || LEGACY_OFFERS.get(offerId)?.title || "Borrador sin título",
          status: offer?.open ? "open" : offer ? "closed" : "draft", cents: offer?.cents ?? null,
          ...(offer?.liveProvider === "plugnmeet" && { liveProvider: "plugnmeet" }),
        };
      }),
      reviews: allReviews(),
      courseComments: Object.entries(state.discussion).flatMap(([offerId, { comments }]) => comments.map(({ id, studentId, text, at, revision, status }) => ({
        id, text, at, revision, status, author: students.get(studentId)?.name || "Participante", course: lookupOffer(offerId)?.title || "Curso",
      }))).sort((a, b) => b.at.localeCompare(a.at)),
      paymentEmailConfigured: Boolean(sendPaymentEmail),
      students: state.students.map((student) => ({ ...publicStudent(student), profile: student.profile || null })).reverse(),
      orders: state.orders.filter((order) => order.status !== "awaiting_receipt").map((order) => ({
        ...publicOrder(order),
        student: { ...publicStudent(students.get(order.studentId)), whatsapp: students.get(order.studentId)?.profile?.whatsapp },
        receipt: order.receipt,
        submittedAt: order.submittedAt,
        submissionId: order.submissionId,
        paymentHistory: paymentHistory(order),
        emailStatus: emails.get(order.id) || [],
        whatsappStatus: whatsApp.get(order.id) || "",
      })).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
      metrics: {
        students: state.students.filter((student) => !student.demo).length,
        approved: approved.length,
        pending: state.orders.filter((order) => order.status === "submitted").length,
        monthCents: revenue.at(-1).cents,
        revenue,
      },
    };
  }

  function assetExtension(bytes, kind) {
    if (kind === "video") return bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp" && !["qt  ", "avif", "heic", "mif1"].includes(bytes.toString("ascii", 8, 12)) ? "mp4" : null;
    if (kind === "receipt" && bytes.length > 16 && bytes.toString("ascii", 0, 5) === "%PDF-") return "pdf";
    return photoExtension(bytes);
  }

  async function storeAsset(kind, bytes) {
    const extension = assetExtension(bytes, kind);
    if (!extension) throw new RequestError(415, kind === "video" ? "Selecciona un video MP4 válido." : "Selecciona un archivo con el formato indicado.");
    const filename = `${kind}-${id()}.${extension}`;
    await media.write(filename, bytes);
    return filename;
  }

  async function storeVideoStream(req) {
    const length = Number(req.headers["content-length"]);
    if (!Number.isSafeInteger(length) || length < 16) throw new RequestError(411, "Selecciona un archivo MP4 con tamaño conocido.");
    if (length > 64 * MB) throw new RequestError(413, "El video supera el límite de 64 MB.");
    const source = req.iterator({ destroyOnReturn: false });
    const parts = [];
    let size = 0;
    try {
      while (size < 16) {
        const part = await source.next();
        if (part.done) throw new RequestError(415, "Selecciona un video MP4 válido.");
        parts.push(part.value);
        size += part.value.length;
      }
      const header = Buffer.concat(parts.map((part) => part.subarray(0, 16))).subarray(0, 16);
      if (!assetExtension(header, "video")) throw new RequestError(415, "Selecciona un video MP4 válido.");
      const filename = `video-${id()}.mp4`;
      await media.writeStream(filename, length, parts, source);
      return filename;
    } finally {
      await source.return?.();
    }
  }

  async function seedDemoCourses() {
    const { demoOffers, demoQr, demoVideo } = require("./academy-demo");
    const pending = demoOffers.map((offer) => ({
      ...offer,
      id: demoOfferId(offer.slug),
    })).filter(({ id }) => !state.offerDrafts[id] && !state.offers[id]);
    if (!pending.length) return 0;

    const files = [];
    const addMedia = async (kind, bytes) => {
      const filename = await storeAsset(kind, bytes);
      files.push(filename);
      return filename;
    };
    try {
      const qr = await addMedia("qr", demoQr());
      const instructions = "Inscripción de demostración. El QR solo contiene un mensaje de prueba. Puedes descargarlo y pulsar «Simular aviso de pago» para practicar la revisión en el panel.";
      const liveDate = new Date(Date.now() + (7 * 24 - 4) * 60 * 60 * 1000).toISOString().slice(0, 10);
      const offerDrafts = { ...state.offerDrafts };
      const offers = { ...state.offers };
      for (const { id, category, title, description, price, cover, color, chapters } of pending) {
        const demo = { qr, instructions };
        if (category === "live") demo.demoVideo = await addMedia("video", demoVideo("Sala de transmision simulada", color));
        const lessons = await Promise.all((chapters || []).map(async ([title, text, label]) => ({ title, text, video: await addMedia("video", demoVideo(label, color)) })));
        const draft = checkCourse({ title, description, price, cover, chapters: lessons, startsAt: `${liveDate}T19:00` }, true, category, true, demo);
        offerDrafts[id] = draft;
        offers[id] = publishCourse(draft);
      }
      save({ ...state, revision: state.revision + 1, offerDrafts, offers });
      return pending.length;
    } catch (error) {
      for (const filename of files) await media.remove(filename);
      throw error;
    }
  }

  async function seedDemoStudent() {
    const { demoOffers, demoReceipt } = require("./academy-demo");
    const email = "demo-cursos@example.test";
    if (state.students.some((student) => student.email === email)) return { email };
    const demoCatalog = demoOffers.map(({ slug, category }) => ({ offerId: demoOfferId(slug), category, offer: lookupOffer(demoOfferId(slug)) }));
    if (demoCatalog.some(({ offer }) => !offer?.demo)) throw new Error("Ejecuta --seed-demo para cargar las tres publicaciones de demostración.");
    const password = randomBytes(12).toString("base64url");
    const salt = id();
    const key = await deriveKey(password, salt, 64);
    const timestamp = now();
    const student = { id: id(), email, name: "Participante demo", demo: true, salt, passwordHash: key.toString("hex"), createdAt: timestamp };
    const receipt = await storeAsset("receipt", demoReceipt());
    const orders = demoCatalog.map(({ offerId, category, offer }) => {
      const { title, cents, qr, instructions } = offer;
      const order = { id: id(), studentId: student.id, offerId, title, cents, qr, instructions, demo: true, receipt, submissionId: id(), status: "submitted", createdAt: timestamp, submittedAt: timestamp, updatedAt: timestamp };
      if (category === "live") return order;
      return { ...order, status: "approved", reviewedAt: timestamp, reviewer: "Simulación" };
    });
    try {
      save({ ...state, students: [...state.students, student], orders: [...state.orders, ...orders] });
    } catch (error) {
      await media.remove(receipt);
      throw error;
    }
    return { email, password };
  }

  function publishCourse(draft) {
    return { ...draft, cents: Math.round(Number(draft.price.replace(",", ".")) * 100), open: true, publishedAt: now() };
  }

  async function saveCommunityProfile(req, res) {
    requireStudent(req);
    const contentType = req.headers["content-type"] || "";
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) throw new RequestError(415, "Envía el formulario de perfil.");
    const body = await readBody(req, AVATAR_LIMIT + 64 * 1024);
    const form = await new Response(body, { headers: { "Content-Type": contentType } }).formData().catch(() => null);
    if (!form) throw new RequestError(400, "No se pudo leer el formulario de perfil.");
    const handles = {};
    for (const { key, label, pattern } of SOCIAL_NETWORKS) {
      const handle = requireText(form.get(key) ?? "", 100, label).replace(/^@/, "");
      if (!handle) continue;
      if (!pattern.test(handle)) throw new RequestError(400, `Escribe solo el nombre de usuario de ${label}.`);
      handles[key] = handle;
    }
    const file = form.get("avatar");
    if (file !== null && !(file instanceof Blob)) throw new RequestError(400, "Selecciona un archivo de imagen.");
    if (file?.size > AVATAR_LIMIT) throw new RequestError(413, "La foto supera el límite de 5 MB.");
    if (file?.name && !file.size) throw new RequestError(400, "El archivo de la foto está vacío.");
    const bytes = file?.size ? Buffer.from(await file.arrayBuffer()) : null;
    const session = requireStudent(req);
    const student = state.students.find((item) => item.id === session.studentId);
    const specialty = form.has("specialty")
      ? requireText(form.get("specialty"), 100, "Especialidad").replace(/\s+/gu, " ")
      : student.communityProfile?.specialty || "";
    const previous = student.communityProfile?.avatar || "";
    const avatar = bytes ? await storeAsset("avatar", bytes) : form.get("removeAvatar") === "1" ? "" : previous;
    const next = { ...student, communityProfile: { avatar, handles, specialty } };
    try {
      if (requireStudent(req).studentId !== student.id || !state.students.includes(student)) {
        throw new RequestError(409, "El perfil cambió mientras se guardaba. Vuelve a intentar.");
      }
      save({ ...state, students: state.students.map((item) => item.id === next.id ? next : item) });
    } catch (error) {
      if (bytes) await discardAsset(avatar, "avatar");
      throw error;
    }
    if (previous !== avatar) await discardAsset(previous, "avatar");
    return json(res, 200, { profile: communityProfile(next) });
  }

  async function discardAsset(filename, kind) {
    if (!validAsset(filename, kind)) return;
    try { await media.remove(filename); } catch { /* A response may still be reading the image. */ }
  }

  async function sendAsset(req, res, filename, kind, download = false) {
    if (!validAsset(filename, kind)) throw new RequestError(404, "Archivo no disponible.");
    const extension = path.extname(filename).slice(1);
    const size = await media.size(filename);
    if (!Number.isSafeInteger(size)) throw new RequestError(404, "Archivo no disponible.");
    const headers = { "Content-Type": MEDIA[extension], "Content-Length": size, "Cross-Origin-Resource-Policy": "same-origin" };
    let range;
    if (kind === "receipt") headers["Content-Disposition"] = `attachment; filename="comprobante.${extension}"`;
    if (kind === "qr" && download) headers["Content-Disposition"] = `attachment; filename="qr-pago.${extension}"`;
    if (kind === "video") {
      headers["Cache-Control"] = "private, no-store";
      headers["Content-Disposition"] = "inline";
      headers["Accept-Ranges"] = "bytes";
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
        const end = match?.[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start < 0 || start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${size}` });
          return res.end();
        }
        range = { start, end };
        headers["Content-Length"] = end - start + 1;
        headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      }
    }
    const stream = req.method === "HEAD" ? null : await media.stream(filename, range);
    res.writeHead(range ? 206 : 200, headers);
    if (!stream) return res.end();
    stream.on("error", () => res.destroy());
    res.once("close", () => stream.destroy());
    stream.pipe(res);
  }

  function playbackSignature(session, resource, filename, expires) {
    return createHmac("sha256", playbackSecret).update(JSON.stringify([session.digest, resource, filename, expires])).digest("hex");
  }

  function playbackUrl(session, resource, filename) {
    const expires = Date.now() + VIDEO_LINK_TTL;
    return `${resource}?expires=${expires}&key=${playbackSignature(session, resource, filename, expires)}`;
  }

  function sendProtectedVideo(req, res, session, resource, filename) {
    const query = new URL(req.url, "http://localhost").searchParams;
    const expires = Number(query.get("expires"));
    const key = query.get("key") || "";
    const { "sec-fetch-dest": destination, "sec-fetch-site": site, "sec-fetch-mode": mode } = req.headers;
    if ((destination && destination !== "video") || (site && site !== "same-origin") || mode === "navigate" || query.has("download") ||
        !Number.isSafeInteger(expires) || expires <= Date.now() || !/^[a-f0-9]{64}$/.test(key) ||
        !timingSafeEqual(Buffer.from(key, "hex"), Buffer.from(playbackSignature(session, resource, filename, expires), "hex"))) {
      throw new RequestError(403, "Abre el video desde el reproductor de Mi espacio.");
    }
    return sendAsset(req, res, filename, "video");
  }

  async function authenticate(req, res, registering) {
    allowAuthAttempt(req);
    const body = await readJsonBody(req);
    const email = typeof body?.email === "string" && body.email.length <= 160 ? body.email.trim().toLowerCase() : "";
    const password = body?.password;
    if (!validEmail.test(email) || typeof password !== "string" || password.length < 10 || password.length > 128) {
      throw new RequestError(400, "Usa un correo válido y una contraseña de 10 a 128 caracteres.");
    }

    const name = registering ? requireText(body.name, 100, "Nombre", true) : null;
    const profile = registering ? registrationProfile(body) : null;
    let student = state.students.find((item) => item.email === email);
    const salt = registering ? id() : student?.salt || dummySalt;
    const key = await deriveKey(password, salt, 64);
    if (registering) {
      if (state.students.some((item) => item.email === email)) throw new RequestError(409, "Ya hay una cuenta con ese correo. Inicia sesión.");
      const invitation = referrals.invitation(body.referralCode);
      student = { id: id(), name, email, profile, ...(invitation && { invitation }), salt, passwordHash: key.toString("hex"), createdAt: now() };
    } else {
      student = state.students.find((item) => item.email === email && item.salt === salt);
      if (!student || !timingSafeEqual(key, Buffer.from(student.passwordHash, "hex"))) throw new RequestError(401, "El correo o la contraseña no coinciden.");
    }
    openSession(req, res, student, registering);
    json(res, registering ? 201 : 200, studentView({ studentId: student.id }));
  }

  async function managePlugNmeet(req, res, route, read, admin) {
    const base = "/api/admin/academy/plugnmeet";
    const checkSession = () => {
      if (currentAdmin(req)?.token !== admin.token) throw new RequestError(401, "La sesión ha terminado.");
    };
    if (route === base) {
      if (read) return json(res, 200, { settings: plugNmeet.view() });
      if (req.method === "PUT") {
        const body = await readJsonBody(req, 8192);
        checkSession();
        save({ ...state, plugNmeet: plugNmeet.validate(body) });
        return json(res, 200, { settings: plugNmeet.view() });
      }
    }
    if (route === `${base}/test` && req.method === "POST") {
      await plugNmeet.testConnection();
      checkSession();
      return json(res, 200, { connected: true });
    }
    const match = /^\/api\/admin\/academy\/plugnmeet\/rooms\/(live|oferta-[a-f0-9]{32})\/(host|end|status|recordings|download)$/.exec(route);
    if (!match) throw new RequestError(404, "Página no encontrada.");
    const [, offerId, action] = match;
    const offer = lookupOffer(offerId);
    if (offerCategory(offerId) !== "live" || offer?.liveProvider !== "plugnmeet") throw new RequestError(404, "Este vivo no tiene una sala de PlugNmeet.");
    let result;
    if (read && action === "status") result = { active: await plugNmeet.status(offerId) };
    else if (read && action === "recordings") {
      const from = Number(new URL(req.url, "http://localhost").searchParams.get("from") ?? 0);
      result = await plugNmeet.recordings(offerId, from);
    } else if (req.method === "POST" && action === "host") {
      const moderator = createHash("sha256").update(admin.username).digest("hex").slice(0, 24);
      result = { url: await plugNmeet.join(offerId, offer.title, { id: moderator }, true) };
    } else if (req.method === "POST" && action === "end") {
      await plugNmeet.end(offerId);
      result = { active: false };
    } else if (req.method === "POST" && action === "download") {
      const input = await readJsonBody(req, 2048);
      checkSession();
      const recordId = requireText(input?.recordId, 160, "Grabación", true);
      result = { url: await plugNmeet.download(offerId, recordId, input?.from ?? 0) };
    } else throw new RequestError(404, "Página no encontrada.");
    checkSession();
    return json(res, 200, result);
  }

  async function adminRoutes(req, res, route, read, admin) {
    if (!admin) throw new RequestError(401, "Inicia sesión para entrar al panel.");
    if (route === "/api/admin/academy/finance" || route.startsWith("/api/admin/academy/finance/")) return finance(req, res, route, read);
    if (route === "/api/admin/academy/plugnmeet" || route.startsWith("/api/admin/academy/plugnmeet/")) {
      return managePlugNmeet(req, res, route, read, admin);
    }
    if (route === "/api/admin/academy/waha") {
      if (read) return json(res, 200, { settings: waha.view() });
      if (req.method !== "PUT") throw new RequestError(404, "Página no encontrada.");
      const body = await readJsonBody(req, 4096);
      if (currentAdmin(req)?.token !== admin.token) throw new RequestError(401, "La sesión ha terminado.");
      save({ ...state, waha: waha.validate(body) });
      if (!scheduledNotifications) queueMicrotask(runPaymentWhatsApp);
      return json(res, 200, { settings: waha.view() });
    }
    if (route === "/api/admin/academy/waha/test" && req.method === "POST") {
      const result = await waha.testConnection();
      if (currentAdmin(req)?.token !== admin.token) throw new RequestError(401, "La sesión ha terminado.");
      return json(res, 200, result);
    }
    if (route === "/api/admin/academy" && read) return json(res, 200, adminView());
    if (route === "/api/admin/academy/referrals") {
      if (read) return json(res, 200, { settings: referrals.settings() });
      if (req.method !== "PUT") throw new RequestError(404, "Página no encontrada.");
      const input = await readJsonBody(req, 4096);
      if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
      const settings = referrals.validate(input);
      save({ ...state, referralSettings: settings });
      return json(res, 200, { settings });
    }
    const catalogRoute = /^\/api\/admin\/academy\/(course|close)(?:\/([a-z]+|oferta-[a-f0-9]{32}))?$/.exec(route);
    const creating = catalogRoute?.[1] === "course" && !catalogRoute[2] && req.method === "POST";
    const offerId = creating ? `oferta-${id()}` : catalogRoute?.[2] || PRIMARY;
    if (catalogRoute && !creating && !offerCategory(offerId)) throw new RequestError(404, "Opción no disponible.");
    if (catalogRoute?.[1] === "course" && (req.method === "PUT" || creating)) {
      const body = await readJsonBody(req, 2 * MB);
      if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
      if (body?.revision !== state.revision) throw new RequestError(409, "El curso se editó en otra pestaña. Recarga el panel antes de guardar.");
      const category = creating ? body.category : offerCategory(offerId);
      if (!CATEGORIES.has(category)) throw new RequestError(400, "Selecciona Vivos, Especiales o Cursos.");
      const publishedOffer = lookupOffer(offerId);
      const requiresCover = customOfferId.test(offerId) && (!publishedOffer || Boolean(publishedOffer.cover));
      const savedDemo = state.offerDrafts[offerId]?.demo ? state.offerDrafts[offerId] : publishedOffer?.demo ? publishedOffer : null;
      const draft = checkCourse(body.course, body.publish === true, category, requiresCover, savedDemo);
      const next = { ...state, revision: state.revision + 1 };
      if (offerId === PRIMARY) next.draft = draft;
      else next.offerDrafts = { ...state.offerDrafts, [offerId]: draft };
      if (body.publish === true) {
        const published = publishCourse(draft);
        if (offerId === PRIMARY) next.published = published;
        else next.offers = { ...state.offers, [offerId]: published };
      }
      save(next);
      return json(res, creating ? 201 : 200, { ...adminView(), savedOfferId: offerId });
    }
    if (catalogRoute?.[1] === "close" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
      if (body?.revision !== state.revision) throw new RequestError(409, "El curso se editó en otra pestaña. Recarga el panel antes de cerrar.");
      const published = lookupOffer(offerId);
      if (published?.open) {
        const closed = { ...published, open: false };
        save(offerId === PRIMARY
          ? { ...state, revision: state.revision + 1, published: closed }
          : { ...state, revision: state.revision + 1, offers: { ...state.offers, [offerId]: closed } });
      }
      return json(res, 200, adminView());
    }
    const upload = /^\/api\/admin\/academy\/(qr|cover|video)$/.exec(route);
    if (req.method === "POST" && upload) {
      const kind = upload[1];
      if (kind === "video" && media.writeStream) {
        const filename = await storeVideoStream(req);
        if (!currentAdmin(req)) {
          await discardAsset(filename, "video");
          throw new RequestError(401, "La sesión ha terminado.");
        }
        return json(res, 201, { id: filename });
      }
      const bytes = await readBody(req, (kind === "video" ? 64 : 6) * MB);
      if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
      return json(res, 201, { id: await storeAsset(kind, bytes) });
    }
    const image = /^\/api\/admin\/academy\/image\/((qr|cover)-[a-f0-9]{32}\.(?:jpg|png|webp))$/.exec(route);
    if (read && image) return sendAsset(req, res, image[1], image[2]);
    const courseComment = /^\/api\/admin\/academy\/comments\/([a-f0-9]{32})$/.exec(route);
    if (courseComment && req.method === "PUT") {
      const body = await readJsonBody(req);
      if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
      if (!["approved", "rejected"].includes(body?.status)) throw new RequestError(400, "Selecciona aprobar u ocultar.");
      const entry = Object.entries(state.discussion).find(([, { comments }]) => comments.some(({ id }) => id === courseComment[1]));
      if (!entry) throw new RequestError(404, "Comentario no disponible.");
      const [offerId, discussion] = entry;
      const comment = discussion.comments.find(({ id }) => id === courseComment[1]);
      if (body.revision !== comment.revision) throw new RequestError(409, "El comentario cambió. Actualiza la lista.");
      saveDiscussion(offerId, { ...discussion, comments: discussion.comments.map((item) => item === comment ? { ...item, status: body.status, revision: item.revision + 1 } : item) });
      return json(res, 200, adminView());
    }
    const moderation = /^\/api\/admin\/academy\/reviews\/([a-f0-9]{32}|demo-[1-3])$/.exec(route);
    if (moderation && ["PUT", "DELETE"].includes(req.method)) {
      const body = await readJsonBody(req);
      if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
      const reviewId = moderation[1];
      const order = state.orders.find((item) => item.id === reviewId);
      const review = order?.review ?? state.demoReviews.find((item) => item.id === reviewId);
      if (!review) throw new RequestError(404, "Reseña no disponible.");
      if (review.revision !== body?.revision) throw new RequestError(409, "La reseña cambió. Actualiza la lista antes de continuar.");
      const updated = req.method === "DELETE" ? null : {
        ...review,
        ...reviewText(body),
        name: requireText(body.name, 100, "Nombre público", true),
        status: body.approve === true ? "approved" : review.status,
        revision: review.revision + 1,
      };
      if (order) saveOrder({ ...order, review: updated });
      else save({ ...state, demoReviews: state.demoReviews.flatMap((item) => item.id === reviewId ? updated ? [updated] : [] : [item]) });
      return json(res, 200, adminView());
    }
    const match = /^\/api\/admin\/academy\/orders\/([a-f0-9]{32})(\/receipt)?$/.exec(route);
    if (match) {
      if (read && match[2]) {
        const order = state.orders.find((item) => item.id === match[1] && item.receipt);
        return sendAsset(req, res, order?.receipt, "receipt");
      }
      if (req.method === "PUT" && !match[2]) {
        const body = await readJsonBody(req);
        const order = state.orders.find((item) => item.id === match[1]);
        const status = body?.decision;
        if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
        if (!order) throw new RequestError(404, "Orden no disponible.");
        if (!["approved", "rejected"].includes(status)) throw new RequestError(400, "Selecciona aprobar o rechazar.");
        const sameSubmission = body.submissionId ? body.submissionId === order.submissionId : Boolean(order.receipt && order.receipt === body.receipt);
        if (order.status !== "submitted" || !sameSubmission) throw new RequestError(409, "El aviso de pago cambió o ya fue revisado. Actualiza la lista.");
        if (status === "approved" && !validAsset(order.receipt, "receipt")) throw new RequestError(409, "El comprobante no está disponible. Pide al estudiante que lo adjunte de nuevo.");
        const note = status === "rejected" ? requireText(body.note, 500, "Motivo del rechazo", true) : "";
        const timestamp = now();
        const paymentHistoryNext = [...paymentHistory(order), { status, at: timestamp, reviewer: admin.username, note }];
        saveOrder({ ...order, status, note, reviewedAt: timestamp, updatedAt: timestamp, reviewer: admin.username, paymentHistory: paymentHistoryNext }, status === "approved");
        return json(res, 200, adminView());
      }
    }
    throw new RequestError(404, "Página no encontrada.");
  }

  async function handle(req, res, route, read, admin) {
    if (route === "/api/admin/academy/news") return manageNews(req, res, read);
    if (route === "/api/academy/notifications" || route.startsWith("/api/academy/notifications/")) return notifications(req, res, route, read);
    if (route === "/api/academy/feed" || route.startsWith("/api/academy/feed/")) return feed.handlePublic(req, res, route, read, admin);
    if (route === "/api/admin/academy/feed" || route.startsWith("/api/admin/academy/feed/")) return feed.handleAdmin(req, res, route, read, admin);
    if (route === "/api/admin/academy" || route.startsWith("/api/admin/academy/")) return adminRoutes(req, res, route, read, admin);
    if (read && route === "/api/academy") return json(res, 200, studentView(studentSession(req)));
    if (read && route === "/api/academy/ranking") {
      const participants = communityRanking();
      const examples = participants.length ? [] : RANKING_EXAMPLES.map(({ name, rank, points, url }) => ({ name, rank, points, url }));
      return json(res, 200, { participants, examples });
    }
    const cover = /^\/api\/academy\/covers\/(cover-[a-f0-9]{32}\.(?:jpg|png|webp))$/.exec(route);
    if (read && cover) {
      if (!Object.values(state.offers).some((offer) => offer.open && offer.cover === cover[1])) throw new RequestError(404, "Portada no disponible.");
      return sendAsset(req, res, cover[1], "cover");
    }
    if (read && route === "/api/academy/reviews") {
      const page = Number(new URL(req.url, "http://localhost").searchParams.get("page") || 1);
      if (!Number.isSafeInteger(page) || page < 1) throw new RequestError(400, "Página de reseñas no válida.");
      const pageSize = 6;
      const start = (page - 1) * pageSize;
      const all = allReviews().filter((review) => review.status === "approved");
      const students = new Map(state.students.map((student) => [student.id, student]));
      const authors = new Map(state.orders.filter((order) => order.review?.status === "approved").map((order) => [order.id, students.get(order.studentId)]));
      const reviews = all.slice(start, start + pageSize).map(({ id, course, name, rating, comment, demo }) => {
        const student = authors.get(id);
        return { course, name, rating, comment, demo, profile: student ? communityProfile(student, { hasReview: true }) : null };
      });
      return json(res, 200, { reviews, nextPage: start + pageSize < all.length ? page + 1 : null });
    }
    const profileRoute = /^\/api\/academy\/profiles\/([a-f0-9]{32})(\/avatar)?$/.exec(route);
    if (read && profileRoute) {
      const student = state.students.find((item) => item.id === profileRoute[1]);
      const profile = student && communityProfile(student, { publicParticipant: hasPublicParticipation(student) });
      if (!profile?.url) throw new RequestError(404, "Perfil no disponible.");
      if (profileRoute[2]) return sendAsset(req, res, student.communityProfile?.avatar, "avatar");
      return json(res, 200, { profile });
    }
    if (read && route.startsWith("/api/academy/profiles/ejemplo-")) {
      const example = RANKING_EXAMPLES.find(({ slug }) => route === `/api/academy/profiles/${slug}`);
      if (!example) throw new RequestError(404, "Perfil no disponible.");
      const { name, specialty, url } = example;
      return json(res, 200, { profile: { name, specialty, url, socials: [], demo: true } });
    }
    if (req.method === "POST" && route === "/api/academy/profile") return saveCommunityProfile(req, res);
    if (route === "/api/academy/referrals/code") {
      requireStudent(req);
      const body = req.method === "PUT" ? await readJsonBody(req, 4096) : null;
      const session = requireStudent(req);
      const student = state.students.find(({ id }) => id === session.studentId);
      if (read) {
        const code = new URL(req.url, "http://localhost").searchParams.get("code");
        return json(res, 200, referrals.checkCode(student, code));
      }
      if (req.method === "PUT") {
        const updated = referrals.updateCode(student, body?.code);
        if (updated !== student) {
          save({ ...state, students: state.students.map((item) => item.id === updated.id ? updated : item) });
        }
        return json(res, 200, studentView(session));
      }
      throw new RequestError(404, "Página no encontrada.");
    }
    if (req.method === "PUT" && ["/api/academy/account", "/api/academy/account/password"].includes(route)) {
      return updateAccount(req, res, route.endsWith("/password"));
    }
    if (req.method === "POST" && ["/api/academy/register", "/api/academy/login"].includes(route)) {
      return authenticate(req, res, route.endsWith("/register"));
    }
    if (req.method === "POST" && route === "/api/academy/logout") {
      const previous = studentSession(req);
      if (previous) save({ ...state, sessions: state.sessions.filter((session) => session.digest !== previous.digest), pushSubscriptions: state.pushSubscriptions.filter((item) => item.digest !== previous.digest) });
      res.setHeader("Set-Cookie", `ivanna_student=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${req.ivannaSecure ? "; Secure" : ""}`);
      return json(res, 200, studentView(null));
    }
    if (req.method === "POST" && route === "/api/academy/order") {
      requireStudent(req);
      const body = req.headers["content-type"] ? await readJsonBody(req) : {};
      const session = requireStudent(req);
      const offerId = body?.offerId ?? PRIMARY;
      if (!offerCategory(offerId)) throw new RequestError(404, "Opción no disponible.");
      const order = findOrder(session.studentId, offerId);
      if (order) return json(res, 200, studentView(session));
      const offer = lookupOffer(offerId);
      if (!offer?.open) throw new RequestError(409, "El pago de esta opción estará disponible cuando se abran sus inscripciones.");
      const { title, cents, qr, instructions, demo } = offer;
      const timestamp = now();
      const student = state.students.find(({ id }) => id === session.studentId);
      const pending = { id: id(), offerId, studentId: session.studentId, title, cents, qr, instructions, ...(demo && { demo: true }), status: "awaiting_receipt", createdAt: timestamp, updatedAt: timestamp };
      saveOrder(referrals.newQuote(student, pending));
      return json(res, 201, studentView(session));
    }
    const session = requireStudent(req);
    const resource = /^\/api\/academy\/orders\/([a-f0-9]{32})\/(qr|receipt|paid|discount|lesson(?:\/video)?|chapters(?:\/(legacy|[a-f0-9]{32})\/(?:video|seen))?|live(?:\/(?:player|video|join))?|complete|review|discussion(?:\/(?:heart|comment))?)$/.exec(route);
    const legacyAsset = /^\/api\/academy\/(?:order\/)?(qr|receipt|lesson(?:\/video)?)$/.exec(route);
    if (!resource && !legacyAsset) throw new RequestError(404, "Página no encontrada.");
    const order = resource ? state.orders.find((item) => item.id === resource[1] && item.studentId === session.studentId) : findOrder(session.studentId);
    if (resource && !order) throw new RequestError(404, "Inscripción no disponible.");
    const action = resource?.[2] ?? legacyAsset?.[1];
    if (req.method === "PUT" && action === "discount") {
      const body = await readJsonBody(req, 4096);
      const currentSession = requireStudent(req);
      const current = state.orders.find((item) => item.id === order.id && item.studentId === currentSession.studentId);
      if (!current) throw new RequestError(404, "Inscripción no disponible.");
      const student = state.students.find(({ id }) => id === currentSession.studentId);
      saveOrder(referrals.changeDiscount(student, current, body));
      return json(res, 200, studentView(currentSession));
    }
    if (action.startsWith("discussion")) {
      if (order?.status !== "approved") throw new RequestError(403, "El acceso al curso debe estar aprobado para participar.");
      const offerId = orderOffer(order);
      if (read && action === "discussion") {
        const page = Number(new URL(req.url, "http://localhost").searchParams.get("page") || 1);
        if (!Number.isSafeInteger(page) || page < 1) throw new RequestError(400, "Página de comentarios no válida.");
        return json(res, 200, viewDiscussion(offerId, session.studentId, page));
      }
      if (req.method === "POST" && action !== "discussion") {
        const body = await readJsonBody(req);
        const { studentId } = requireStudent(req);
        if (findOrder(studentId, offerId)?.status !== "approved") throw new RequestError(403, "El acceso al curso debe estar aprobado para participar.");
        const discussion = state.discussion[offerId] || EMPTY_DISCUSSION;
        if (action === "discussion/heart") {
          if (typeof body?.loved !== "boolean") throw new RequestError(400, "Selecciona añadir o quitar el corazón.");
          if (body.loved !== discussion.hearts.includes(studentId)) {
            const hearts = body.loved ? [...discussion.hearts, studentId] : discussion.hearts.filter((id) => id !== studentId);
            saveDiscussion(offerId, { ...discussion, hearts });
          }
        } else {
          const text = requireText(body?.text, 750, "Comentario", true);
          const requestId = body?.requestId;
          if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new RequestError(400, "Vuelve a intentar enviar el comentario.");
          if (!discussion.comments.some((comment) => comment.studentId === studentId && comment.requestId === requestId)) {
            const comment = { id: id(), requestId, studentId, text, status: "pending", at: now(), revision: 0 };
            saveDiscussion(offerId, { ...discussion, comments: [comment, ...discussion.comments] });
          }
        }
        return json(res, 200, viewDiscussion(offerId, studentId));
      }
      throw new RequestError(404, "Página no encontrada.");
    }
    if (req.method === "POST" && (action === "complete" || action === "review" || action.endsWith("/seen"))) {
      const body = await readJsonBody(req);
      const currentSession = requireStudent(req);
      const current = state.orders.find((item) => item.id === resource[1] && item.studentId === currentSession.studentId);
      if (current?.status !== "approved" || offerCategory(orderOffer(current)) === "live") {
        throw new RequestError(403, "Tu acceso al curso debe estar aprobado para guardar el avance o dejar una reseña.");
      }
      const chapters = courseChapters(lookupOffer(orderOffer(current)));
      if (action.endsWith("/seen")) {
        const chapter = chapters.find(({ id }) => id === resource[3]);
        if (!chapter) throw new RequestError(404, "Capítulo no disponible.");
        const version = chapterVersion(chapter);
        if (body?.version !== version) throw new RequestError(409, "El capítulo cambió. Ábrelo de nuevo antes de guardar el avance.");
        if (!chapterSeen(current, chapter)) {
          const timestamp = now();
          const next = { ...current, seenChapters: { ...current.seenChapters, [chapter.id]: { version, at: timestamp } } };
          if (!next.completedAt && courseCompleted(next, chapters)) next.completedAt = timestamp;
          saveOrder(next);
        }
        return json(res, 200, studentView(currentSession));
      }
      if (!courseCompleted(current, chapters)) throw new RequestError(409, "Completa todos los capítulos antes de finalizar el curso o dejar una reseña.");
      if (action === "complete") {
        return json(res, 200, studentView(currentSession));
      }
      if (current.review) throw new RequestError(409, "Ya enviaste una reseña de este curso.");
      const content = reviewText(body);
      const name = publicName(state.students.find((student) => student.id === currentSession.studentId));
      saveOrder({ ...current, review: { ...content, name, status: "pending", revision: 0, createdAt: now() } });
      return json(res, 201, studentView(currentSession));
    }
    if (req.method === "POST" && action === "paid") {
      throw new RequestError(400, "Debes pagar el curso, adjuntar el comprobante y esperar la aprobación para poder ingresar.");
    }
    if (req.method === "POST" && action === "receipt") {
      if (!order || !["awaiting_receipt", "rejected"].includes(order.status)) throw new RequestError(409, "Esta inscripción ya está en revisión o no está disponible.");
      const expectedTotal = new URL(req.url, "http://localhost").searchParams.get("cents");
      if (expectedTotal !== null && expectedTotal !== String(order.cents)) throw new RequestError(409, "El total cambió. Actualiza la inscripción y verifica el monto antes de adjuntar el comprobante.");
      const bytes = await readBody(req, 8 * MB);
      if (!bytes.length) throw new RequestError(400, "Adjunta un comprobante para enviar el pago a revisión.");
      const current = findOrder(requireStudent(req).studentId, orderOffer(order));
      if (current !== order) throw new RequestError(409, "La orden cambió mientras subías el archivo. Recarga la página.");
      const receipt = await storeAsset("receipt", bytes);
      if (findOrder(requireStudent(req).studentId, orderOffer(order)) !== order) {
        await discardAsset(receipt, "receipt");
        throw new RequestError(409, "La orden cambió mientras subías el archivo. Recarga la página.");
      }
      const timestamp = now();
      const paymentHistoryNext = [...paymentHistory(order), { status: "submitted", at: timestamp }];
      saveOrder({ ...order, receipt, status: "submitted", note: "", submissionId: id(), submittedAt: timestamp, updatedAt: timestamp, paymentHistory: paymentHistoryNext }, true);
      return json(res, 200, studentView(session));
    }
    if (read && action === "qr") {
      if (!order || order.status === "approved") throw new RequestError(404, "QR no disponible.");
      return sendAsset(req, res, order.qr, "qr", new URL(req.url, "http://localhost").searchParams.has("download"));
    }
    if (req.method === "POST" && action === "live/join") {
      const offerId = orderOffer(order);
      const offer = lookupOffer(offerId);
      if (order.status !== "approved" || offerCategory(offerId) !== "live") throw new RequestError(403, "La transmisión se habilita al aprobar el pago.");
      if (offer?.liveProvider !== "plugnmeet" || order.demo) throw new RequestError(404, "Esta transmisión no usa PlugNmeet.");
      const student = state.students.find(({ id }) => id === session.studentId);
      const url = await plugNmeet.join(offerId, offer.title, { name: publicName(student), id: student.id });
      if (requireStudent(req).digest !== session.digest || lookupOffer(offerId)?.liveProvider !== "plugnmeet") throw new RequestError(409, "Vuelve a abrir el acceso al vivo.");
      return json(res, 200, { url });
    }
    if (read && /^live(?:\/|$)/.test(action)) {
      if (order?.status !== "approved" || offerCategory(orderOffer(order)) !== "live") throw new RequestError(403, "La transmisión se habilita al aprobar el pago.");
      const offer = lookupOffer(orderOffer(order));
      if (offer?.demoVideo) {
        if (action === "live/video") return sendProtectedVideo(req, res, session, route, offer.demoVideo);
        if (action === "live/player") return json(res, 200, { title: offer.title, videoUrl: playbackUrl(session, route.replace(/player$/, "video"), offer.demoVideo) });
        res.writeHead(303, { Location: `/mi-espacio#inscripcion-${order.id}` });
        return res.end();
      }
      if (action !== "live") throw new RequestError(404, "Video no disponible.");
      const link = offer?.liveUrl;
      if (!link) throw new RequestError(404, "No hay enlace de transmisión.");
      res.writeHead(303, { Location: link });
      return res.end();
    }
    if (read && /^(?:lesson|chapters)(?:\/|$)/.test(action)) {
      if (order?.status !== "approved" || offerCategory(orderOffer(order)) === "live") throw new RequestError(403, "La lección se habilita al aprobar el pago.");
      const offer = lookupOffer(orderOffer(order));
      if (!offer) throw new RequestError(404, "Curso no disponible.");
      const chapters = courseChapters(offer);
      if (action === "chapters") {
        return json(res, 200, {
          title: offer.title,
          chapters: chapters.map((chapter) => {
            const { id, title, text, video } = chapter;
            return { id, title, text, version: chapterVersion(chapter), hasVideo: Boolean(video), ...(video && { videoUrl: playbackUrl(session, `${route}/${id}/video`, video) }) };
          }),
        });
      }
      const chapter = resource?.[3] ? chapters.find(({ id }) => id === resource[3]) : chapters[0];
      if (!chapter) throw new RequestError(404, "Capítulo no disponible.");
      if (action.endsWith("/video")) return sendProtectedVideo(req, res, session, route, chapter.video);
      if (action.endsWith("/seen")) throw new RequestError(404, "Página no encontrada.");
      return json(res, 200, { title: chapter.title, text: chapter.text, hasVideo: Boolean(chapter.video), ...(chapter.video && { videoUrl: playbackUrl(session, `${route}/video`, chapter.video) }) });
    }
    throw new RequestError(404, "Página no encontrada.");
  }

  const finance = createFinance({
    getState: () => state, saveEntries: (financeEntries) => save({ ...state, financeEntries }),
    RequestError, readBody, readJsonBody, requireText, json, currentAdmin, storeAsset, discardAsset, sendAsset,
    orderOffer, offerCategory, communityCountries, id, now,
  });

  const feed = createFeed({
    RequestError, readBody, readJsonBody, json, currentAdmin, requireStudent, studentSession, requireText, storeAsset, discardAsset, sendAsset, id, now,
    getPosts: () => state.feed,
    savePosts: (posts) => save({ ...state, feed: posts }),
    getAuthors: () => new Map(state.students.map((student) => {
      const { name, avatar, url } = communityProfile(student, { publicParticipant: true });
      return [student.id, { name, avatar, url }];
    })),
  });

  return { handle, seedDemoCourses, seedDemoStudent, startPaymentNotifications, runPaymentNotifications };
}

module.exports = { createAcademy };
