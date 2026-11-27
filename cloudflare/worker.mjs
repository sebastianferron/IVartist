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
  const input = request.body ? Readable.fromWeb(request.body) : Readable.from([]);
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

  #run(work) {
    const current = this.#tail.then(async () => {
      const documents = await openDocuments(this.env);
      const media = {
        academy: bucketMedia(this.env.IVARTIST_MEDIA, documents, "academy"),
        uploads: bucketMedia(this.env.IVARTIST_MEDIA, documents, "home"),
      };
      const playbackSecret = createHash("sha256").update(`ivartist-video:${this.env.IVANNA_STATE_KEY}`).digest();
      const app = server.createApplication({
        dataDir: "/tmp/ivartist", documents, media, pages, playbackSecret, publicOrigin: this.env.IVANNA_PUBLIC_ORIGIN,
        pushContact: this.env.IVANNA_PUSH_CONTACT, sendPaymentEmail: mail.createPaymentMailer(this.env),
        plugNmeetTransport: providerFetch, wahaTransport: providerFetch,
      });
      const result = await work(app);
      try {
        await documents.commit();
      } catch (error) {
        if (result instanceof Response) await result.body?.cancel();
        throw error;
      }
      this.ctx.waitUntil(Promise.all([media.academy.clean(), media.uploads.clean()]).catch(() => console.warn("No se pudieron limpiar archivos retirados.")));
      return result;
    });
    this.#tail = current.catch(() => {});
    return current;
  }

  async fetch(request) {
    try {
      return await this.#run((app) => handleRequest(app, request));
    } catch (error) {
      console.error(error.message);
      return unavailable(error.status === 409 ? 409 : 503);
    }
  }

  async notifications() {
    await this.#run((app) => app.runPaymentNotifications());
  }
}

function site(env) {
  return env.IVARTIST_STATE.get(env.IVARTIST_STATE.idFromName("ivartist"));
}

export default {
  async fetch(request, env) {
    if (!env.IVANNA_PUBLIC_ORIGIN || new URL(request.url).origin !== env.IVANNA_PUBLIC_ORIGIN) {
      return new Response("Usa la dirección configurada del sitio.", { status: 400 });
    }
    try {
      return await site(env).fetch(request);
    } catch (error) {
      console.error("No se pudo conectar con el estado del sitio.", error.message);
      return unavailable();
    }
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(site(env).notifications());
  },
};
