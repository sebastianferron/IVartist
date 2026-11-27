"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { createAdmin, createServer } = require("./server");
const { defaults } = require("./home-config");

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
