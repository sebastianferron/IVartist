import { Buffer } from "node:buffer";
import { PassThrough, Readable } from "node:stream";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { DurableObject } from "cloudflare:workers";
import server from "../server.js";
import mail from "../academy-mail.js";
import index from "../index.html";
import academy from "../academy.html";
import profile from "../profile.html";
import login from "../admin-login.html";
import dashboard from "../admin-dashboard.html";
import { openDocuments } from "./supabase.mjs";
import { bucketMedia } from "./media.mjs";

const pages = {
  "index.html": index, "academy.html": academy, "profile.html": profile,
  "admin-login.html": login, "admin-dashboard.html": dashboard,
};

function providerTransport(allowedOrigins) {
  const origins = new Set((allowedOrigins || "").split(",").map((value) => {
    try {
      const url = new URL(value.trim());
      if (url.protocol === "https:" && url.href === `${url.origin}/`) return url.origin;
    } catch { /* Invalid entries grant no access. */ }
    return null;
  }));
  return (url, options) => {
    if (!origins.has(url.origin)) throw new Error("El origen del proveedor no está autorizado en el Worker.");
    return providerFetch(url, options);
  };
}

async function providerFetch(url, { method = "POST", headers, body, timeout = 12_000 }) {
  const response = await fetch(url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(timeout) });
  const parts = [];
  let length = 0;
  for await (const part of response.body || []) {
    length += part.byteLength;
    if (length > 128 * 1024) throw new Error("Respuesta demasiado grande.");
    parts.push(part);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { /* The caller checks the result. */ }
  return { status: response.status, result };
}

async function handleRequest(app, request) {
  const url = new URL(request.url);
  const deadline = request.body ? AbortSignal.timeout(60_000) : undefined;
  const input = request.body ? Readable.fromWeb(request.body, { signal: deadline }) : Readable.from([]);
  input.on("error", () => {}); // The request handler handles stream errors when it consumes the body.
  input.ivannaBodyDeadline = deadline;
  input.headers = Object.fromEntries(request.headers);
  input.headers.host = url.host;
  input.url = url.pathname + url.search;
  input.method = request.method;
  const from = request.headers.get("CF-Connecting-IP");
  input.socket = { remoteAddress: from && isIP(from) ? from : "unknown", encrypted: true };
  const output = new PassThrough();
  const headers = new Headers();
  let code = 200;
  output.setHeader = (key, value) => headers.set(key, value);
  output.writeHead = (status, values) => {
    code = status;
    for (const [key, value] of Object.entries(values || {})) headers.set(key, value);
    output.headersSent = true;
  };
  const body = Readable.toWeb(output, { strategy: { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength } });
  await app.handle(input, output);
  const empty = request.method === "HEAD" || [204, 205, 304].includes(code);
  return new Response(empty ? null : body, { status: code, headers });
}

const unavailable = (status = 503) => Response.json({
  error: status === 409 ? "El sitio cambió en otra sesión. Vuelve a intentar." : "El servicio está temporalmente indisponible.",
}, { status, headers: { "Cache-Control": "no-store" } });

export class IvartistState extends DurableObject {
  #tail = Promise.resolve();

  async notifications() {
    const storage = this.ctx.storage;
    const current = this.#tail.then(async () => {
      await runApplication(this.env, this.ctx, {
        detached: true,
        names: [
          "academy.paymentEmails", "academy.paymentWhatsApp", "academy.orders", "academy.students", "academy.waha",
          "academy.pushSubscriptions", "academy.pushJobs", "push-keys.json", "academy.accountEmailJobs",
          "academy.pendingRegistrations", "academy.plugNmeet", "academy-media.json", "home-media.json",
          "academy-media-deletions.json", "home-media-deletions.json",
        ],
        async work(app, documents, media) {
          documents.rotate();
          await documents.commit();
          await app.runAccountNotifications?.();
          await app.runPaymentNotifications();
          for (const bucket of Object.values(media)) {
            await bucket.reconcile(storage);
          }
        },
      });
    });
    this.#tail = current.catch(() => {});
    return current;
  }
}

const videoScope = ["academy.sessions", "academy.orders", "academy.published", "academy.offers", "academy.offerDrafts", "academy-media.json"];

function requestDocuments(request, url) {
  if (!["GET", "HEAD"].includes(request.method)) return;
  const route = url.pathname;
  if (route === "/" || route === "/index.html" || route === "/api/home") {
    const names = route === "/api/home" ? ["home.json"] : [];
    if (url.searchParams.get("preview") === "1" && request.headers.get("cookie")) names.push("admin-sessions.json");
    return names;
  }
  if (route === "/mi-espacio" || route === "/academia" || route.startsWith("/perfil/")) return [];
  if (["/admin", "/admin/login", "/admin/dashboard"].includes(route)) return ["admin-sessions.json"];
  if (route === "/api/admin/home") return ["admin-sessions.json", "home.json"];
  if (route.startsWith("/media/")) return ["home.json", "home-media.json", "admin-sessions.json"];
  if (/^\/api\/academy\/(?:orders\/[a-f0-9]{32}\/(?:lesson|live|chapters\/(?:legacy|[a-f0-9]{32}))|(?:order\/)?lesson)\/video$/.test(route)) return videoScope;
  if (route === "/api/academy") {
    const names = ["academy.published", "academy.offers", "academy.offerDrafts", "academy.referralSettings"];
    if (/(?:^|;\s*)ivanna_student=[a-f0-9]{64}(?:;|$)/.test(request.headers.get("cookie") || "")) {
      names.push("academy.sessions", "academy.students", "academy.orders");
    }
    return names;
  }
  if (route === "/api/academy/ranking") return ["academy.students", "academy.orders", "academy.discussion", "academy.feed"];
  if (route === "/api/academy/reviews") return ["academy.students", "academy.orders", "academy.demoReviews"];
  if (route === "/api/academy/notifications") return ["academy.sessions", "academy.orders", "academy.offers", "academy.offerDrafts", "academy.news", "academy.feed"];
  if (route.startsWith("/api/academy/profiles/ejemplo-")) return [];
  if (route.startsWith("/api/academy/profiles/")) {
    return ["academy.students", "academy.sessions", "academy.orders", "academy.discussion", "academy.feed", "academy-media.json"];
  }
  if (["/api/academy/feed", "/api/admin/academy/feed"].includes(route) ||
      route.startsWith("/api/academy/feed/posts/") || route.startsWith("/api/admin/academy/feed/posts/")) {
    return ["admin-sessions.json", "academy.sessions", "academy.students", "academy.orders", "academy.feed", "academy-media.json"];
  }
  if (route.startsWith("/api/academy/covers/")) return ["academy.offers", "academy-media.json"];
  if (["/api/admin/academy/changes", "/api/admin/academy/section"].includes(route)) {
    const section = url.searchParams.get("section");
    const names = new Map([
      ["payments", ["academy.orders", "academy.paymentEmails", "academy.paymentWhatsApp"]],
      ["summary", ["academy.orders", "academy.students"]],
      ["students", ["academy.students"]],
      ["reviews", ["academy.orders", "academy.demoReviews"]],
      ["comments", ["academy.discussion"]],
    ]);
    const expanded = route.endsWith("/section");
    const scope = ["admin-sessions.json", ...(names.get(section) || [])];
    if (expanded && ["payments", "comments"].includes(section)) scope.push("academy.students");
    if (expanded && section === "comments") scope.push("academy.published", "academy.offers");
    return scope;
  }
}

async function runApplication(env, ctx, { work, names, detached = false }) {
  const documents = await openDocuments(env, { names, detached });
  const media = {
    academy: bucketMedia(env.IVARTIST_MEDIA, documents, "academy"),
    uploads: bucketMedia(env.IVARTIST_MEDIA, documents, "home"),
  };
  const transport = providerTransport(env.IVANNA_PROVIDER_ORIGINS);
  const app = server.createApplication({
    dataDir: "/tmp/ivartist", documents, media, pages, publicOrigin: env.IVANNA_PUBLIC_ORIGIN,
    playbackSecret: env.IVANNA_PLAYBACK_KEY || createHash("sha256").update(`ivartist-video:${env.IVANNA_STATE_KEY}`).digest(),
    verificationSecret: env.IVANNA_EMAIL_VERIFICATION_KEY || createHash("sha256").update(`ivartist-verify:${env.IVANNA_STATE_KEY}`).digest("hex"),
    pushContact: env.IVANNA_PUSH_CONTACT, sendPaymentEmail: mail.createPaymentMailer(env),
    sendAccountEmail: mail.createAccountMailer?.(env), adminTotpSecret: env.IVANNA_ADMIN_TOTP_SECRET,
    requireAdminMfa: env.IVANNA_REQUIRE_ADMIN_MFA === "1",
    plugNmeetTransport: transport, wahaTransport: transport, checkpointNotifications: () => documents.commit(),
  });
  let result;
  try {
    result = await work(app, documents, media);
    await documents.commit();
    return result;
  } catch (error) {
    if (result instanceof Response) await result.body?.cancel().catch(() => {});
    if (error.status === 409 && !detached) {
      ctx.waitUntil(Promise.allSettled(Object.values(media).map((bucket) => bucket.rollback())));
    }
    throw error;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!env.IVANNA_PUBLIC_ORIGIN || url.origin !== env.IVANNA_PUBLIC_ORIGIN) {
      return new Response("Usa la dirección configurada del sitio.", { status: 400 });
    }
    try {
      return await runApplication(env, ctx, { names: requestDocuments(request, url), work: (app) => handleRequest(app, request) });
    } catch (error) {
      if (error.status !== 409) console.error("No se pudo completar la operación en el Worker.", error.message);
      return unavailable(error.status === 409 ? 409 : 503);
    }
  },
  scheduled(_event, env, ctx) {
    const notifier = env.IVARTIST_STATE.get(env.IVARTIST_STATE.idFromName("notifications"));
    ctx.waitUntil(notifier.notifications());
  },
};
