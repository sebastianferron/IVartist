import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import server from "../server.js";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
await rm(dist, { force: true, recursive: true });
await mkdir(dist, { recursive: true });
for (const name of server.browserAssets) {
  if (name === "academy.html" || name === "index.html") continue;
  await mkdir(new URL(`${dirname(name)}/`, dist), { recursive: true });
  await cp(new URL(name, root), new URL(name, dist));
}
await cp(new URL("./pages.mjs", import.meta.url), new URL("_worker.js", dist));
await cp(new URL("assets/favicon.ico", root), new URL("favicon.ico", dist));
await writeFile(new URL("404.html", dist), "<!doctype html><meta charset=utf-8><title>Página no encontrada</title><p>Página no encontrada. <a href=/>Volver al inicio</a>");
await writeFile(new URL("_routes.json", dist), JSON.stringify({
  version: 1,
  include: ["/", "/index.html", "/api/*", "/admin", "/admin/*", "/academia", "/mi-espacio", "/perfil/*", "/media/*"],
  exclude: [],
}));
await writeFile(new URL("_headers", dist), "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n");
