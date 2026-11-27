"use strict";

const offline = "/pwa-offline.html";
const cacheName = "ivanna-pwa-1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.add(offline)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith("ivanna-pwa-") && name !== cacheName)
    .map((name) => caches.delete(name)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.mode !== "navigate" || url.origin !== self.location.origin || !["/", "/mi-espacio"].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(offline)) || Response.error()));
});

function destination(path) {
  if (typeof path !== "string") return "/mi-espacio";
  try {
    const url = new URL(path, self.location.origin);
    if (url.origin === self.location.origin && ["/", "/mi-espacio"].includes(url.pathname)) return url.href;
  } catch { /* Abre Mi espacio para cualquier ruta inválida. */ }
  return "/mi-espacio";
}

self.addEventListener("push", (event) => {
  let message;
  try { message = event.data?.json(); } catch { /* Usa el aviso genérico. */ }
  event.waitUntil(self.registration.showNotification(message?.title || "Tienes un nuevo aviso", {
    body: message?.body || "Consulta tus notificaciones en Mi espacio.",
    icon: "/assets/app-192.png",
    tag: message?.tag || "ivanna-aviso",
    data: { url: destination(message?.url) },
  }).then(async () => {
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) client.postMessage("ivanna:notifications");
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(destination(event.notification.data?.url), self.location.origin);
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find((client) => new URL(client.url).pathname === url.pathname);
    if (existing) {
      const target = existing.url === url.href ? existing : await existing.navigate(url.href).catch(() => null);
      if (target) return target.focus();
    }
    return self.clients.openWindow(url.href);
  })());
});
