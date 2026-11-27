"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { Readable } = require("node:stream");
const { createAdmin, createApplication, createServer } = require("./server");
const { defaults } = require("./home-config");

test("el límite del panel no bloquea a operadores de otra conexión", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ivanna-admin-limit-test-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const credentials = { username: "admin-limite", password: "Clave larga para límites" };
  assert.throws(() => createAdmin(credentials.username, "contraseña", dataDir), /14 y 128/);
  createAdmin(credentials.username, credentials.password, dataDir);
  const app = createApplication({ dataDir });
  const login = async (remoteAddress, password, username = credentials.username) => {
    const body = Buffer.from(JSON.stringify({ username, password }));
    const req = Readable.from([body]);
    Object.assign(req, { method: "POST", url: "/api/admin/login", socket: { remoteAddress }, headers: {
      host: "localhost", origin: "http://localhost", "content-type": "application/json",
    } });
    let status;
    const res = { setHeader() {}, writeHead(code) { status = code; }, end() {} };
    await app.handle(req, res);
    return status;
  };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    assert.equal(await login("192.0.2.10", "Entrada de prueba", `cuenta-${attempt}`), 401);
  }
  assert.equal(await login("192.0.2.10", credentials.password), 429);
  assert.equal(await login("192.0.2.20", credentials.password), 200);
});

test("la titularidad del correo se confirma antes del alta y de cambiar el correo activo", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ivanna-verify-test-"));
  const emails = [];
  const server = createServer({ dataDir, sendAccountEmail: async (email) => { emails.push(email); } }).listen(0, "127.0.0.1");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (route, data, cookie = "", method = "POST") => fetch(`${origin}/api/academy${route}`, {
    method, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const credentials = {
    name: "Estudiante de prueba", email: "registro@example.test", password: "La contraseña inicial de prueba",
    country: "BO", department: "Santa Cruz", age: "24", whatsapp: "70000000", interest: "Maquillaje profesional",
  };
  const requested = await send("/register", credentials);
  assert.equal(requested.status, 202);
  assert.equal(requested.headers.get("Set-Cookie"), null);
  assert.equal((await send("/login", credentials)).status, 401);
  assert.equal(emails[0]?.email, credentials.email);
  const challenge = (fragment) => {
    const [, id, token] = fragment.match(/=([a-f0-9]{32})\.([a-f0-9]{64})$/);
    return { id, token };
  };
  const signup = challenge(emails[0].fragment);
  assert.equal((await send("/register/verify", { ...signup, password: "Una contraseña diferente" })).status, 401);
  const activated = await send("/register/verify", { ...signup, password: credentials.password });
  assert.equal(activated.status, 201);
  assert.equal((await activated.json()).account.emailVerified, true);
  const cookie = activated.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await send("/register/verify", { ...signup, password: credentials.password })).status, 400);

  const email = "correo-nuevo@example.test";
  const pending = await send("/account", { name: credentials.name, email, whatsapp: "+59170000000", currentPassword: credentials.password }, cookie, "PUT");
  assert.equal(pending.status, 202);
  assert.equal((await pending.json()).student.email, credentials.email);
  assert.equal((await send("/login", { ...credentials, email })).status, 401);
  const change = challenge(emails.find((item) => item.email === email).fragment);
  assert.equal((await send("/account/verify", change)).status, 401);
  const confirmed = await send("/account/verify", change, cookie);
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).student.email, email);
  assert.equal((await send("/login", credentials)).status, 401);
  const nextLogin = await send("/login", { ...credentials, email });
  assert.equal(nextLogin.status, 200);
  assert.ok(emails.some(({ email, kind }) => email === credentials.email && kind === "changed"));
});

test("el panel autentica al usuario y solo expone el contenido publicado", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ivanna-cms-test-"));
  const activationFile = path.join(dataDir, "codigo-de-activacion.txt");
  let server;
  let origin;
  const start = async () => {
    server = createServer({ dataDir }).listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  };
  let cookie = "";
  const get = (route, authenticated = false) => fetch(origin + route, {
    headers: authenticated ? { Cookie: cookie } : {},
    redirect: "manual",
  });
  const send = (route, data, { method = "POST", from = origin, authenticated = true } = {}) => fetch(origin + route, {
    method,
    headers: {
      Origin: from,
      "Content-Type": Buffer.isBuffer(data) ? "image/jpeg" : "application/json",
      ...(authenticated ? { Cookie: cookie } : {}),
    },
    body: Buffer.isBuffer(data) ? data : JSON.stringify(data),
  });

  try {
    const credentials = { username: "editora-prueba", password: "Clave ficticia de pruebas 2026" };
    fs.writeFileSync(activationFile, "código anterior de prueba");
    createAdmin(credentials.username, credentials.password, dataDir);
    fs.writeFileSync(path.join(dataDir, "home.json"), JSON.stringify({
      revision: 0, updatedAt: null, publishedAt: null,
      published: { ...defaults, brandSubtitle: "MAKEUP ACADEMY" },
      draft: { ...defaults, footerSubtitle: "Makeup Academy · Santa Cruz" },
    }));
    assert.equal(fs.existsSync(activationFile), false);
    assert.throws(() => createAdmin("otra-editora", credentials.password, dataDir), { code: "EEXIST" });
    await start();
    assert.equal((await get("/admin/dashboard")).headers.get("location"), "/admin/login");
    assert.equal((await get("/api/admin/home")).status, 401);
    assert.equal((await get("/api/home?preview=1")).status, 401);
    assert.equal((await get("/.data/codigo-de-activacion.txt")).status, 404);
    assert.equal((await send("/api/admin/home", { config: defaults }, { method: "PUT" })).status, 401);
    assert.equal((await send("/api/admin/login", {}, { from: "https://otro.example" })).status, 403);
    const login = await send("/api/admin/login", credentials);
    assert.equal(login.status, 200);
    const header = login.headers.get("set-cookie");
    assert.match(header, /HttpOnly; SameSite=Strict/);
    cookie = header.split(";")[0];
    assert.equal((await send("/api/admin/setup", {})).status, 404);
    const publicHome = await (await get("/api/home")).json();
    assert.equal(publicHome.countdownButtonHref, "#subscripciones");
    assert.equal(publicHome.primaryHref, "#subscripciones");
    assert.equal(publicHome.brandSubtitle, "MAKEUP ARTIST");
    assert.equal(publicHome.whatsappNumber, "");
    assert.deepEqual(publicHome.sectionOrder, defaults.sectionOrder);
    assert.deepEqual(publicHome.socialClips, defaults.socialClips);
    assert.doesNotMatch((await get("/")).headers.get("content-security-policy"), /frame-src[^;]*https:/);
    const logo = await get("/assets/logo-iv.png");
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    const favicon = await get("/favicon.ico");
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers.get("content-type"), "image/x-icon");
    assert.equal(Buffer.from(await favicon.arrayBuffer()).readUInt16LE(4), 3);
    assert.equal((await (await get("/api/home?preview=1", true)).json()).footerSubtitle, "Makeup Artist · Santa Cruz");
    assert.equal((await get("/admin/dashboard", true)).status, 200);

    const photo = fs.readFileSync(path.join(__dirname, "assets", "hero-purple.jpeg"));
    const upload = await send("/api/admin/photo", photo);
    assert.equal(upload.status, 201);
    const { id } = await upload.json();
    const secondUpload = await send("/api/admin/photo", photo);
    assert.equal(secondUpload.status, 201);
    const { id: clipCapture } = await secondUpload.json();
    assert.equal((await get(`/media/${id}`)).status, 404);
    assert.equal((await get(`/media/${id}`, true)).status, 200);
    const draft = { ...defaults, featuredImage: id, announcementText: "Cintillo en borrador", navCourses: "Clases", aboutCopy: "Biografía revisada", "esencial-price": "Bs 120 / mes", "esencial-href": "https://pagos.example/qr" };
    draft.whatsappNumber = "+1 (202) 555-0144";
    draft.sectionOrder = ["inicio", "quien-soy", ...defaults.sectionOrder.filter((id) => id !== "inicio" && id !== "quien-soy")];
    const clips = [
      { url: "https://www.youtube.com/shorts/M7lc1UVf-VE?si=prueba", title: "Un short" },
      { url: "https://www.instagram.com/reel/ABC_def0123/", title: "Un reel", cover: clipCapture },
      { url: "https://www.tiktok.com/@scout2015/video/6718335390845095173", title: "" },
    ];
    draft.socialClips = clips;
    draft.socialClipSpeed = "96";
    draft.sparkleSpeed = "5";
    draft.sparkleIntensity = "2";
    const invalidClips = { ...draft, socialClips: [{ url: "https://www.youtube.com.example.test/shorts/M7lc1UVf-VE" }] };
    assert.equal((await send("/api/admin/home", { config: invalidClips, revision: 0 }, { method: "PUT" })).status, 400);
    const invalidCover = { ...draft, socialClips: [{ ...clips[1], cover: "https://externo.example/pic.jpg" }] };
    assert.equal((await send("/api/admin/home", { config: invalidCover, revision: 0 }, { method: "PUT" })).status, 400);
    const invalidEvent = { ...draft, subscriptionLiveEndsAt: draft.countdownTarget };
    assert.equal((await send("/api/admin/home", { config: invalidEvent, revision: 0 }, { method: "PUT" })).status, 400);
    const invalidWhatsApp = { ...draft, whatsappNumber: "+12025550144?text=otro" };
    assert.equal((await send("/api/admin/home", { config: invalidWhatsApp, revision: 0 }, { method: "PUT" })).status, 400);
    const invalidOrder = { ...draft, sectionOrder: ["inicio", "inicio", "fuera-del-sitio"] };
    assert.equal((await send("/api/admin/home", { config: invalidOrder, revision: 0 }, { method: "PUT" })).status, 400);
    assert.equal((await send("/api/admin/home", { config: draft, revision: 0 }, { method: "PUT" })).status, 200);
    assert.equal((await get(`/media/${clipCapture}`)).status, 404);
    assert.equal((await get(`/media/${clipCapture}`, true)).status, 200);
    assert.equal((await (await get("/api/home")).json()).announcementText, defaults.announcementText);
    assert.equal((await (await get("/api/home")).json()).whatsappNumber, "");
    assert.deepEqual((await (await get("/api/home")).json()).sectionOrder, defaults.sectionOrder);
    assert.deepEqual((await (await get("/api/home?preview=1", true)).json()).sectionOrder, draft.sectionOrder);
    assert.equal((await (await get("/api/home?preview=1", true)).json()).whatsappNumber, "+12025550144");
    assert.equal((await (await get("/api/home?preview=1", true)).json()).aboutCopy, draft.aboutCopy);
    assert.equal((await (await get("/api/home")).json())["esencial-price"], "");
    assert.deepEqual((await (await get("/api/home")).json()).socialClips, defaults.socialClips);
    assert.equal((await (await get("/api/home?preview=1", true)).json()).socialClips[0].url, "https://www.youtube.com/shorts/M7lc1UVf-VE");
    assert.equal((await send("/api/admin/home", { config: draft, revision: 0 }, { method: "PUT" })).status, 409);
    const publish = await send("/api/admin/home", { config: draft, revision: 1, publish: true }, { method: "PUT" });
    assert.equal(publish.status, 200);
    assert.equal((await (await get("/api/home")).json()).navCourses, "Clases");
    assert.equal((await (await get("/api/home")).json())["esencial-price"], "Bs 120 / mes");
    const publishedClips = await (await get("/api/home")).json();
    assert.equal(publishedClips.whatsappNumber, "+12025550144");
    assert.deepEqual(publishedClips.sectionOrder, draft.sectionOrder);
    assert.equal(publishedClips.socialClipSpeed, "96");
    assert.equal(publishedClips.sparkleSpeed, "5");
    assert.equal(publishedClips.sparkleIntensity, "2");
    assert.deepEqual(publishedClips.socialClips.slice(1), clips.slice(1));
    assert.equal((await get("/assets/reel-maquillaje-artistico.jpg")).headers.get("content-type"), "image/jpeg");
    assert.equal((await get(`/media/${clipCapture}`)).status, 200);
    assert.equal((await get(`/media/${id}`)).status, 200);
    const photoInfo = await fetch(`${origin}/media/${id}`, { method: "HEAD" });
    assert.equal(photoInfo.status, 200);
    assert.equal(Number(photoInfo.headers.get("content-length")), photo.length);
    assert.equal((await photoInfo.arrayBuffer()).byteLength, 0);
    assert.equal((await send("/api/admin/logout", {})).status, 200);
    assert.equal((await get("/api/admin/home", true)).status, 401);

    await new Promise((resolve) => server.close(resolve));
    await start();
    assert.equal((await (await get("/api/home")).json()).featuredImage, id);
    assert.equal((await send("/api/admin/login", { ...credentials, password: "incorrecta" })).status, 401);
    assert.equal((await send("/api/admin/login", credentials)).status, 200);

    await new Promise((resolve) => server.close(resolve));
    const updated = { ...credentials, password: "Otra clave ficticia de prueba" };
    createAdmin(updated.username, updated.password, dataDir, { superadmin: true });
    assert.throws(() => createAdmin("otro-usuario", updated.password, dataDir, { superadmin: true }), /cuenta existente/);
    assert.throws(() => createAdmin(updated.username, credentials.password, dataDir), { code: "EEXIST" });
    const accountFile = path.join(dataDir, "admin.json");
    assert.ok(!fs.readFileSync(accountFile, "utf8").includes(updated.password));

    await start();
    assert.equal((await send("/api/admin/login", credentials)).status, 401);
    const elevated = await send("/api/admin/login", updated);
    assert.equal(elevated.status, 200);
    assert.deepEqual(await elevated.json(), { username: updated.username, role: "superadmin" });
    cookie = elevated.headers.get("set-cookie").split(";")[0];
    assert.equal((await (await get("/api/admin/home", true)).json()).role, "superadmin");
    assert.equal((await send(`/api/admin/accounts/${updated.username}`, {}, { method: "DELETE" })).status, 404);
    assert.equal((await (await get("/api/admin/home", true)).json()).role, "superadmin");
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
