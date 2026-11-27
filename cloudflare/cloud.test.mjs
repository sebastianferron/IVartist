import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const wrangler = join(dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
const { Miniflare, convertV4MiniflareOptions } = createRequire(wrangler)("miniflare");
const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "https://ivanna.example.test";

test("Pages y el Worker conservan sesiones y cursos, y guardan el video en R2 privado", async () => {
  const scratch = join(root, ".wrangler");
  await mkdir(scratch, { recursive: true });
  const temp = await mkdtemp(join(scratch, "test-"));
  let miniflare;
  try {
    const logs = join(temp, "logs");
    const out = join(temp, "bundle");
    await mkdir(logs);
    execFileSync(process.execPath, [wrangler, "deploy", "--config", "cloudflare/wrangler.worker.jsonc", "--dry-run", "--outdir", out], {
      cwd: root, env: { ...process.env, WRANGLER_LOG_PATH: logs, WRANGLER_SEND_METRICS: "false" }, stdio: "pipe",
    });
    const modules = [{ path: join(out, "worker.js"), type: "ESModule" }];
    for (const file of (await readdir(out)).filter((name) => name.endsWith(".html"))) {
      modules.push({ path: join(out, file), type: "Text" });
    }
    const credentials = { username: "admin-prueba", password: "Solo para pruebas de Cloudflare" };
    const salt = "6".repeat(32);
    let revision = 0;
    const documents = {};
    const emails = [];
    const settings = convertV4MiniflareOptions({
      cf: false,
      r2Persist: join(temp, "r2"),
      workers: [
        {
          name: "pages", modules: true, scriptPath: join(root, "cloudflare", "pages.mjs"),
          serviceBindings: { IVARTIST_API: "api" },
        },
        {
          name: "api", modulesRoot: out, modules, compatibilityDate: "2026-11-26", compatibilityFlags: ["nodejs_compat"],
          durableObjects: { IVARTIST_STATE: { className: "IvartistState", useSQLite: true } },
          unsafeEphemeralDurableObjects: true,
          r2Buckets: ["IVARTIST_MEDIA"],
          bindings: {
            IVANNA_PUBLIC_ORIGIN: origin, SUPABASE_URL: "https://supabase.example.test", SUPABASE_SECRET_KEY: "sb_secret_test",
            RESEND_API_KEY: "resend-fixture", IVANNA_EMAIL_FROM: "Ivanna <cursos@example.test>",
            IVANNA_STATE_KEY: "a".repeat(64), IVANNA_ADMIN_ACCOUNT: JSON.stringify({
              username: credentials.username, role: "superadmin", salt,
              passwordHash: scryptSync(credentials.password, salt, 64).toString("hex"),
            }),
          },
        },
      ],
    });
    settings.workers[1].dev.outboundService = { type: "fetcher", async handler(request) {
      if (new URL(request.url).hostname === "api.resend.com") {
        assert.equal(request.headers.get("Authorization"), "Bearer resend-fixture");
        emails.push({ key: request.headers.get("Idempotency-Key"), ...(await request.json()) });
        return Response.json({ id: "accepted-test" });
      }
      if (request.headers.get("apikey") !== "sb_secret_test") return new Response(null, { status: 401 });
      const route = new URL(request.url).pathname;
      if (route.endsWith("/ivartist_read_state")) return Response.json({ revision, documents });
      if (!route.endsWith("/ivartist_commit_state")) return new Response(null, { status: 404 });
      const change = await request.json();
      if (change.expected_revision !== revision) return new Response(null, { status: 409 });
      Object.assign(documents, change.changes);
      for (const key of change.removed) delete documents[key];
      return Response.json(++revision);
    } };
    miniflare = new Miniflare(settings);
    const bucket = await miniflare.getR2Bucket("IVARTIST_MEDIA", "api");
    const call = (route, { method = "GET", data, cookie, extraHeaders } = {}) => {
      const headers = new Headers(extraHeaders);
      if (method !== "GET") headers.set("Origin", origin);
      if (cookie) headers.set("Cookie", cookie);
      const binary = Buffer.isBuffer(data);
      if (data !== undefined) headers.set("Content-Type", binary ? "application/octet-stream" : "application/json");
      if (binary) headers.set("Content-Length", String(data.length));
      return miniflare.dispatchFetch(origin + route, { method, headers, redirect: "manual", body: binary ? data : JSON.stringify(data) });
    };
    const page = await call("/");
    assert.equal(page.status, 200, await page.clone().text());
    assert.match(await page.text(), /id="subscripciones"/);
    const guest = await call("/admin/dashboard");
    assert.equal(guest.status, 303, await guest.clone().text());
    const login = await call("/api/admin/login", { method: "POST", data: credentials });
    assert.equal(login.status, 200, await login.clone().text());
    const admin = login.headers.get("Set-Cookie").split(";")[0];
    assert.match(login.headers.get("Set-Cookie"), /; Secure/);
    assert.equal((await call("/api/admin/academy", { cookie: admin })).status, 200);

    const video = Buffer.from("0000ftypisom000000000000", "ascii");
    const upload = await call("/api/admin/academy/video", { method: "POST", data: video, cookie: admin });
    assert.equal(upload.status, 201, await upload.clone().text());
    const { id: filename } = await upload.json();
    const object = await bucket.get(`academy/${filename}`);
    assert.deepEqual(Buffer.from(await object.arrayBuffer()), video);
    assert.equal((await call("/api/academy/lesson/video")).status, 401);
    const image = await readFile(join(root, "assets", "hero-purple.jpeg"));
    const qr = await call("/api/admin/academy/qr", { method: "POST", data: image, cookie: admin });
    assert.equal(qr.status, 201, await qr.clone().text());
    const saved = await call("/api/admin/academy/course", {
      method: "PUT", cookie: admin,
      data: {
        revision: 0, publish: true,
        course: { title: "Prueba del Worker", description: "Curso de prueba", price: "5", instructions: "QR de prueba", qr: (await qr.json()).id,
          chapters: [{ title: "Lección de prueba", video: filename }] },
      },
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    const reread = await (await call("/api/admin/academy", { cookie: admin })).json();
    assert.equal(reread.draft.chapters[0].video, filename);
    assert.equal((await call("/api/academy/order", { method: "POST", data: {} })).status, 401);
    const registration = await call("/api/academy/register", {
      method: "POST",
      data: { name: "Estudiante de prueba", email: "participante@example.test", password: "Clave de estudiante para pruebas", country: "BO",
        department: "Santa Cruz", age: "25", whatsapp: "70000000", interest: "Maquillaje profesional" },
    });
    assert.equal(registration.status, 201, await registration.clone().text());
    const student = registration.headers.get("Set-Cookie").split(";")[0];
    const enrollment = await call("/api/academy/order", { method: "POST", data: {}, cookie: student });
    assert.equal(enrollment.status, 201, await enrollment.clone().text());
    const { order } = await enrollment.json();
    const orderPath = `/api/academy/orders/${order.id}`;
    assert.equal((await call(`${orderPath}/chapters`, { cookie: student })).status, 403);
    assert.equal((await call(`${orderPath}/receipt`, { method: "POST", data: image, cookie: student })).status, 200);
    const adminPath = `/api/admin/academy/orders/${order.id}`;
    const review = (await (await call("/api/admin/academy", { cookie: admin })).json()).orders[0];
    assert.equal((await call(`${adminPath}/receipt`, { cookie: student })).status, 401);
    assert.equal((await call(adminPath, { method: "PUT", data: { decision: "approved", submissionId: review.submissionId }, cookie: admin })).status, 200);
    const chapters = await call(`${orderPath}/chapters`, { cookie: student });
    assert.equal(chapters.status, 200, await chapters.clone().text());
    const { videoUrl } = (await chapters.json()).chapters[0];
    assert.equal((await call(videoUrl)).status, 401);
    const playback = await call(videoUrl, { cookie: student, extraHeaders: { Range: "bytes=0-7" } });
    assert.equal(playback.status, 206, await playback.clone().text());
    assert.deepEqual(Buffer.from(await playback.arrayBuffer()), video.subarray(0, 8));
    const state = await miniflare.getDurableObjectNamespace("IVARTIST_STATE", "api");
    await state.get(state.idFromName("ivartist")).notifications();
    assert.equal(emails.length, 2);
    assert.ok(emails.every(({ to, key }) => to[0] === "participante@example.test" && key));
  } finally {
    await miniflare?.dispose();
    await rm(temp, { recursive: true, force: true });
  }
});
