"use strict";

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { createInterface } = require("node:readline");
const { Writable } = require("node:stream");
const { defaults, fields, photos, uploadPattern, mergeHomeConfig, parseSocialClip, normalizeWhatsAppNumber, normalizeSectionOrder } = require("./home-config");
const { createAcademy } = require("./academy-server");
const { createAccountMailer, createPaymentMailer } = require("./academy-mail");
const { localMedia } = require("./academy-media");
const { decodeTotpSecret, acceptedTotp } = require("./academy-auth");

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".svg": "image/svg+xml" };
const SESSION_AGE = 8 * 60 * 60 * 1000;
const RETRY_WINDOW = 15 * 60 * 1000;
const passwordKey = promisify(scrypt);
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const contentPolicy = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const DEFAULT_DATA_DIR = process.env.IVANNA_DATA_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), "IvannaMakeupAcademy");
const staticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/mi-espacio", "academy.html"],
  ["/manifest.webmanifest", "manifest.webmanifest"],
  ["/pwa-offline.html", "pwa-offline.html"],
  ["/assets/app-192.png", "assets/app-192.png"],
  ["/assets/app-512.png", "assets/app-512.png"],
  ["/academy-ranking.css", "academy-ranking.css"],
  ["/academy-ranking.js", "academy-ranking.js"],
  ["/academy-finance-admin.js", "academy-finance-admin.js"],
  ["/academy-finance.css", "academy-finance.css"],
  ["/assets/logo-iv.png", "assets/logo-iv.png"],
  ["/assets/avatar-generico.svg", "assets/avatar-generico.svg"],
  ["/assets/reel-maquillaje-artistico.jpg", "assets/reel-maquillaje-artistico.jpg"],
  ["/assets/reel-arte-sobre-la-piel.jpg", "assets/reel-arte-sobre-la-piel.jpg"],
  ["/favicon.ico", "assets/favicon.ico"],
  ...["styles.css", "admin.css", "academy.css", "academy-payment.css", "academy-shell.css", "app-notifications.css", "profile.css", "navigation.css", "app.js", "admin.js", "dashboard.js", "academy.js", "academy-admin.js", "academy-payment.js", "academy-discussion.js", "academy-feed.js", "app-notifications.js", "academy-notifications-sw.js", "profile.js", "home-config.js", "social-clips.js", "navigation.js"].map((file) => [`/${file}`, file]),
  ...photos.map(({ id }) => [`/assets/hero-${id}.jpeg`, `assets/hero-${id}.jpeg`]),
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readJsonFile(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

function writeJsonFile(file, data) {
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.unlinkSync(temporary);
    throw error;
  }
}

async function readBody(req, maxBytes) {
  const declared = Number(req.headers["content-length"]);
  if (declared > maxBytes) throw new RequestError(413, "El archivo o formulario supera el tamaño admitido.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) throw new RequestError(413, "El archivo o formulario supera el tamaño admitido.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new RequestError(415, "Se esperaba un formulario JSON.");
  }
  const body = await readBody(req, maxBytes);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new RequestError(400, "El formulario no es válido.");
  }
}

function photoExtension(bytes) {
  if (bytes.length < 16) return null;
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

function safeLink(value) {
  return value === "" || /^#[a-z][\w-]*$/i.test(value)
    || (/^\/(?![\/\\])/.test(value) && !/[\u0000-\u0020\\]/u.test(value))
    || /^https?:\/\/[^\s\\]+$/i.test(value);
}

function validateSocialClips(clips, uploads) {
  if (!Array.isArray(clips)) throw new RequestError(400, "Revisa la lista de clips.");
  const existing = new Set();
  return clips.map((entry, index) => {
    const url = entry?.url;
    const title = entry?.title ?? "";
    const cover = entry?.cover ?? "";
    const item = typeof url === "string" && url.length <= 500 ? parseSocialClip(url) : null;
    if (!item) throw new RequestError(400, `Pega el enlace completo de YouTube, Instagram o TikTok en el clip ${index + 1}.`);
    if (typeof title !== "string" || title.length > 90) throw new RequestError(400, `Revisa el título del clip ${index + 1}.`);
    const clipUpload = typeof cover === "string" && uploadPattern.test(cover) && uploads.exists(cover);
    if (cover !== "" && !clipUpload && !photos.some(({ id }) => id === cover)) throw new RequestError(400, `Revisa la captura del clip ${index + 1}.`);
    if (existing.has(item.key)) throw new RequestError(400, `El clip ${index + 1} ya está en la lista.`);
    existing.add(item.key);
    return { url: item.url, title: title.trim(), ...(cover && { cover }) };
  });
}

function validateConfig(config, uploads) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new RequestError(400, "Configuración inválida.");
  const validated = { ...defaults };
  for (const field of fields) {
    if (!Object.hasOwn(config, field.key)) continue;
    const value = config[field.key];
    const invalid = () => { throw new RequestError(400, `Revisa el campo «${field.label}».`); };
    if (field.type === "clips") {
      validated[field.key] = validateSocialClips(value, uploads);
      continue;
    }
    if (field.type === "section-order") {
      if (!Array.isArray(value) || value.length !== new Set(value).size || value.some((id) => !defaults.sectionOrder.includes(id))) invalid();
      validated[field.key] = normalizeSectionOrder(value);
      continue;
    }
    if (field.type === "checkbox") {
      if (typeof value !== "boolean") invalid();
      validated[field.key] = value;
      continue;
    }

    if (typeof value !== "string" || value.length > (field.max ?? 120)) invalid();
    const clean = value.trim();
    if (field.key === "whatsappNumber" && clean) {
      const number = normalizeWhatsAppNumber(clean);
      if (!number) throw new RequestError(400, "Escribe el número de WhatsApp con su código de país, por ejemplo +591 seguido de los ocho dígitos.");
      validated[field.key] = `+${number}`;
      continue;
    }
    const isUpload = field.key === "featuredImage" && uploadPattern.test(clean) && uploads.exists(clean);
    if (field.type === "select" && !isUpload && !field.options.some(([choice]) => choice === clean)) invalid();
    if (field.type === "link" && !safeLink(clean)) invalid();
    if (field.type === "datetime-local" && clean) {
      const date = new Date(`${clean}Z`);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(clean) || !Number.isFinite(+date) || date.toISOString().slice(0, 16) !== clean) invalid();
    }
    validated[field.key] = clean;
  }
  if (validated.countdownEnabled && !validated.countdownTarget) throw new RequestError(400, "Indica la fecha y hora del próximo curso.");
  if (validated.subscriptionLiveEndsAt && validated.countdownTarget && validated.subscriptionLiveEndsAt <= validated.countdownTarget) {
    throw new RequestError(400, "El fin del evento debe ser posterior a su inicio.");
  }
  return mergeHomeConfig(validated);
}

function createAdmin(username, password, dataDir = DEFAULT_DATA_DIR, { superadmin = false } = {}) {
  if (!/^[a-z\d._@-]{3,80}$/i.test(username)) throw new Error("Indica un usuario de entre 3 y 80 caracteres.");
  if (password.length < 14 || password.length > 128) throw new Error("La contraseña debe tener entre 14 y 128 caracteres.");
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "admin.json");
  const normalizedUsername = username.toLowerCase();
  const existing = superadmin ? readJsonFile(file, null) : null;
  if (existing && existing.username !== normalizedUsername) {
    throw new Error("La cuenta existente pertenece a otro usuario. Se conservó su acceso.");
  }
  const salt = randomBytes(16).toString("hex");
  const credentials = { ...existing, username: normalizedUsername, role: superadmin ? "superadmin" : "admin", salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
  if (existing) writeJsonFile(file, credentials);
  else fs.writeFileSync(file, JSON.stringify(credentials, null, 2), { mode: 0o600, flag: "wx" });
  const legacyCode = path.join(dataDir, "codigo-de-activacion.txt");
  if (fs.existsSync(legacyCode)) fs.unlinkSync(legacyCode);
}

function readPassword() {
  return new Promise((resolve, reject) => {
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const input = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY, historySize: 0 });
    input.once("close", () => reject(new Error("La entrada de la contraseña se canceló.")));
    process.stdout.write("Contraseña (entrada oculta): ");
    input.question("", (password) => {
      resolve(password);
      input.close();
      process.stdout.write("\n");
    });
  });
}

function createApplication({
  dataDir = DEFAULT_DATA_DIR, sendPaymentEmail = createPaymentMailer(), sendPush, plugNmeetTransport, wahaTransport,
  publicOrigin = process.env.IVANNA_PUBLIC_ORIGIN, documents, media, pages, playbackSecret, pushContact,
  sendAccountEmail = createAccountMailer(), verificationSecret = process.env.IVANNA_EMAIL_VERIFICATION_KEY,
  adminTotpSecret = process.env.IVANNA_ADMIN_TOTP_SECRET, requireAdminMfa = process.env.IVANNA_REQUIRE_ADMIN_MFA === "1", checkpointNotifications,
} = {}) {
  const external = publicOrigin ? new URL(publicOrigin) : null;
  if (external && (external.protocol !== "https:" || external.href !== `${external.origin}/`)) {
    throw new Error("IVANNA_PUBLIC_ORIGIN debe ser un origen HTTPS sin rutas.");
  }
  const uploads = media?.uploads || localMedia(path.join(dataDir, "uploads"));
  const readDocument = documents ? documents.read : readJsonFile;
  const writeDocument = documents ? documents.write : writeJsonFile;
  const adminFile = path.join(dataDir, "admin.json");
  const stateFile = path.join(dataDir, "home.json");
  const adminSessionFile = path.join(dataDir, "admin-sessions.json");
  const account = readDocument(adminFile, null);
  const accountRole = account?.role === "superadmin" ? "superadmin" : "admin";
  const totpSecret = decodeTotpSecret(adminTotpSecret);
  const dummySalt = randomBytes(16).toString("hex");

  let state = readDocument(stateFile, { revision: 0, published: defaults, draft: defaults, updatedAt: null, publishedAt: null });
  for (const version of ["published", "draft"]) {
    const config = state[version];
    const updated = mergeHomeConfig(config);
    if (!config || !Object.hasOwn(config, "communityTitle")) {
      if (config?.academyCta === "Entrar a la academia") updated.academyCta = defaults.academyCta;
      if (config?.academyHref === "/academia") updated.academyHref = defaults.academyHref;
      if (config?.aboutCopy === defaults.aboutCopy.replace("En mis cursos", "En la academia")) updated.aboutCopy = defaults.aboutCopy;
    }
    state[version] = updated;
  }
  const access = documents ? readDocument(adminSessionFile, null) : null;
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const credentialVersion = account ? digest(`${account.username}:${account.passwordHash}:${accountRole}:${totpSecret?.toString("hex") || ""}`) : "";
  const sameCredentials = access?.credentialVersion === credentialVersion;
  const sessions = new Map(sameCredentials ? access.sessions || [] : []);
  const adminAttempts = new Map(sameCredentials ? access.attempts || [] : []);
  let totpStep = sameCredentials ? access.totpStep || 0 : 0;
  function persistAdminAccess() {
    if (documents) writeDocument(adminSessionFile, { credentialVersion, sessions: [...sessions], attempts: [...adminAttempts], totpStep });
  }

  function currentSession(req) {
    const token = /(?:^|;\s*)ivanna_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || "")?.[1];
    if (!token) return null;
    const key = digest(token);
    const session = sessions.get(key);
    if (!session) return null;
    if (session.expires <= Date.now()) {
      sessions.delete(key);
      persistAdminAccess();
      return null;
    }
    return { token, ...session };
  }

  function setSession(res, req, previous) {
    if (previous) sessions.delete(digest(previous.token));
    const now = Date.now();
    for (const [token, session] of sessions) if (session.expires <= now) sessions.delete(token);
    const token = randomBytes(32).toString("hex");
    sessions.set(digest(token), { username: account.username, role: accountRole, authenticatedAt: now, expires: now + SESSION_AGE });
    persistAdminAccess();
    const secure = req.ivannaSecure ? "; Secure" : "";
    res.setHeader("Set-Cookie", `ivanna_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_AGE / 1000}${secure}`);
  }

  function handleFailure() {
    throw new RequestError(401, "Los datos de acceso no coinciden.");
  }

  function reserveAdminAttempt(req) {
    const timestamp = Date.now();
    const key = digest(req.socket?.remoteAddress || "unknown");
    for (const [source, attempt] of adminAttempts) if (attempt.until <= timestamp) adminAttempts.delete(source);
    const attempt = adminAttempts.get(key) || { until: timestamp + RETRY_WINDOW, count: 0 };
    if (attempt.count >= 6) throw new RequestError(429, "Demasiados intentos desde esta conexión. Espera unos minutos.");
    if (!adminAttempts.has(key) && adminAttempts.size >= 1000) adminAttempts.delete(adminAttempts.keys().next().value);
    adminAttempts.set(key, { ...attempt, count: attempt.count + 1 });
    persistAdminAccess();
    return key;
  }

  function json(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  }

  function redirect(res, location) {
    res.writeHead(303, { Location: location });
    res.end();
  }

  function file(res, filename, head) {
    const bytes = pages ? pages[filename] : fs.readFileSync(path.join(__dirname, filename));
    if (bytes === undefined) throw new RequestError(404, "Página no encontrada.");
    res.writeHead(200, { "Content-Type": MIME[path.extname(filename)], "Content-Length": Buffer.byteLength(bytes) });
    res.end(head ? undefined : bytes);
  }

  const academy = createAcademy(dataDir, {
    RequestError, readJsonFile: readDocument, writeJsonFile: writeDocument, readJsonBody, readBody, photoExtension, json, currentAdmin: currentSession,
    publishedHome: () => state.published, sendPaymentEmail, sendPush, plugNmeetTransport, wahaTransport, publicOrigin: external?.origin,
    scheduledNotifications: Boolean(documents), academyMedia: media?.academy, playbackSecret, pushContact, checkpointNotifications,
    sendAccountEmail, verificationSecret, requireVerifiedAccounts: Boolean(external || sendAccountEmail),
  });

  async function handle(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", contentPolicy);
    try {
      const host = req.headers.host || "";
      const isPublicHost = host.toLowerCase() === external?.host;
      if (!isPublicHost && !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host)) throw new RequestError(400, "Usa la dirección configurada del sitio.");
      req.ivannaSecure = Boolean(isPublicHost || req.socket?.encrypted);
      const origin = isPublicHost ? external.origin : `${req.ivannaSecure ? "https" : "http"}://${host}`;
      const url = new URL(req.url, origin);
      if (url.origin !== origin) throw new RequestError(400, "Dirección inválida.");
      const route = url.pathname;
      if (route === "/mi-espacio") {
        res.setHeader("Permissions-Policy", "display-capture=(), camera=(), microphone=()");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "no-referrer");
      }
      const read = req.method === "GET" || req.method === "HEAD";
      const head = req.method === "HEAD";
      const session = currentSession(req);
      if (!read && req.headers.origin !== origin) throw new RequestError(403, "Solicitud de origen no autorizado.");

      if (route.startsWith("/admin") || route.startsWith("/api/admin") || route.startsWith("/api/academy") || route === "/mi-espacio" || url.searchParams.has("preview")) res.setHeader("X-Robots-Tag", "noindex, nofollow");
      if (read && route === "/academia") return redirect(res, "/mi-espacio");
      if (read && /^\/perfil\/(?:[a-f0-9]{32}|ejemplo-[a-z-]{1,40})$/.test(route)) return file(res, "profile.html", head);
      if (read && route === "/admin") return redirect(res, session ? "/admin/dashboard" : "/admin/login");
      const payment = /^[a-f0-9]{32}$/.test(url.searchParams.get("payment") || "") ? url.searchParams.get("payment") : "";
      const paymentQuery = payment ? `?payment=${payment}` : "";
      const dashboard = `/admin/dashboard${paymentQuery}${payment ? "#academy-payments" : ""}`;
      if (read && route === "/admin/login") return session ? redirect(res, dashboard) : file(res, "admin-login.html", head);
      if (read && route === "/admin/dashboard") return session ? file(res, "admin-dashboard.html", head) : redirect(res, `/admin/login${paymentQuery}`);
      if (route === "/api/academy" || route.startsWith("/api/academy/") || route === "/api/admin/academy" || route.startsWith("/api/admin/academy/")) {
        return await academy.handle(req, res, route, read, session);
      }
      if (req.method === "POST" && route === "/api/admin/login") {
        const { username, password, totp } = await readJsonBody(req, 2048) ?? {};
        if (requireAdminMfa && !totpSecret) throw new RequestError(503, "El acceso administrativo requiere configurar el segundo factor.");
        const source = reserveAdminAttempt(req);
        if (typeof username !== "string" || username.length > 80 || typeof password !== "string" || password.length > 128) handleFailure();
        const selected = username.trim().toLowerCase() === account?.username ? account : null;
        const hash = await passwordKey(password, selected?.salt || dummySalt, 64);
        if (!selected || !timingSafeEqual(hash, Buffer.from(selected.passwordHash, "hex"))) handleFailure();
        if (totpSecret) {
          const step = acceptedTotp(totpSecret, totp, totpStep);
          if (step === null) handleFailure();
          totpStep = step;
        }
        adminAttempts.delete(source);
        setSession(res, req, session);
        return json(res, 200, { username: account.username, role: accountRole });
      }

      if (route.startsWith("/api/admin/")) {
        if (!session) throw new RequestError(401, "Inicia sesión para entrar al panel.");
        if (req.method === "POST" && route === "/api/admin/logout") {
          sessions.delete(digest(session.token));
          persistAdminAccess();
          res.setHeader("Set-Cookie", `ivanna_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${req.ivannaSecure ? "; Secure" : ""}`);
          return json(res, 200, {});
        }
        if (read && route === "/api/admin/home") return json(res, 200, { ...state, username: session.username, role: session.role });
        if (req.method === "PUT" && route === "/api/admin/home") {
          const { config, revision, publish } = await readJsonBody(req) ?? {};
          if (!currentSession(req)) throw new RequestError(401, "La sesión ha terminado.");
          if (revision !== state.revision) throw new RequestError(409, "Otra edición se guardó primero. Recarga el panel para obtener la última versión.");
          const draft = validateConfig(config, uploads);
          const updatedAt = new Date().toISOString();
          const next = { ...state, draft, updatedAt, revision: state.revision + 1 };
          if (publish === true) Object.assign(next, { published: draft, publishedAt: updatedAt });
          writeDocument(stateFile, next);
          state = next;
          return json(res, 200, { ...state, username: session.username, role: session.role });
        }
        if (req.method === "POST" && route === "/api/admin/photo") {
          const bytes = await readBody(req, MAX_PHOTO_BYTES);
          if (!currentSession(req)) throw new RequestError(401, "La sesión ha terminado.");
          const extension = photoExtension(bytes);
          if (!extension) throw new RequestError(415, "Selecciona una foto JPG, PNG o WebP.");
          const id = `upload-${randomBytes(16).toString("hex")}.${extension}`;
          await uploads.write(id, bytes);
          return json(res, 201, { id });
        }
      }

      const isPreview = url.searchParams.get("preview") === "1";
      if (read && route === "/api/home") {
        if (isPreview && !session) throw new RequestError(401, "Inicia sesión para ver el borrador.");
        return json(res, 200, isPreview ? state.draft : state.published);
      }
      if (read && route.startsWith("/media/")) {
        const id = route.slice("/media/".length);
        const clips = state.published.socialClips;
        const published = id === state.published.featuredImage || (Array.isArray(clips) && clips.some((clip) => clip?.cover === id));
        if (!uploadPattern.test(id) || (!session && !published) || !uploads.exists(id)) {
          throw new RequestError(404, "Foto no disponible.");
        }
        if (head) {
          const length = await uploads.size(id);
          if (!Number.isSafeInteger(length)) throw new RequestError(404, "Foto no disponible.");
          res.writeHead(200, { "Content-Type": MIME[path.extname(id)], "Content-Length": length });
          return res.end();
        }
        const bytes = await uploads.read(id);
        if (!bytes) throw new RequestError(404, "Foto no disponible.");
        res.writeHead(200, { "Content-Type": MIME[path.extname(id)], "Content-Length": bytes.length });
        return res.end(bytes);
      }
      if (read && staticFiles.has(route)) {
        if ((route === "/" || route === "/index.html") && isPreview && !session) return redirect(res, "/admin/login");
        if ((route === "/" || route === "/index.html") && url.searchParams.get("admin") === "1") return redirect(res, "/admin");
        return file(res, staticFiles.get(route), head);
      }
      throw new RequestError(404, "Página no encontrada.");
    } catch (error) {
      if (!res.headersSent && req.ivannaBodyDeadline?.aborted) return json(res, 408, { error: "El plazo para enviar el formulario terminó." });
      if (!(error instanceof RequestError)) console.error(error);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : "Ocurrió un error al completar la operación." });
      else res.end();
    }
  }
  return { handle, runPaymentNotifications: academy.runPaymentNotifications, runAccountNotifications: academy.runAccountNotifications, startPaymentNotifications: academy.startPaymentNotifications };
}

function createServer(options) {
  const app = createApplication(options);
  const server = http.createServer(app.handle);
  server.once("listening", () => {
    const stop = app.startPaymentNotifications();
    server.once("close", stop);
  });
  return server;
}

if (require.main === module) {
  const operation = process.argv[2];
  if (["--create-admin", "--set-superadmin"].includes(operation)) {
    const username = process.argv[3] || "";
    const superadmin = operation === "--set-superadmin";
    readPassword().then((password) => {
      createAdmin(username, password, DEFAULT_DATA_DIR, { superadmin });
      console.log(superadmin ? `Superadmin configurado: ${username}` : `Administrador creado: ${username}`);
    }).catch((error) => {
      console.error(error.code === "EEXIST" ? "Ya hay una cuenta administradora. Se conservó sin cambios." : error.message);
      process.exitCode = 1;
    });
  } else if (["--seed-demo", "--seed-demo-student"].includes(operation)) {
    (async () => {
      const academy = createAcademy(DEFAULT_DATA_DIR, { RequestError, readJsonFile, writeJsonFile, photoExtension });
      if (operation === "--seed-demo-student") {
        const { email, password } = await academy.seedDemoStudent();
        console.log(password ? `Cuenta de prueba: ${email}\nContraseña: ${password}` : `La cuenta de prueba ya existe: ${email}`);
        return;
      }
      const added = await academy.seedDemoCourses();
      console.log(added ? `Publicaciones de demostración agregadas: ${added}.` : "Las publicaciones de demostración ya existen.");
    })().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } else {
    const port = Number(process.env.IVANNA_PORT || 4187);
    createServer().listen(port, "127.0.0.1", () => console.log(`Ivanna Saldaña · Makeup Artist · http://127.0.0.1:${port}/`));
  }
}

module.exports = { createAdmin, createServer, createApplication, browserAssets: [...new Set(staticFiles.values())] };
