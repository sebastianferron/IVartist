(() => {
  "use strict";

  const slot = document.querySelector("#site-notification-slot");
  if (!slot) return;
  const { request } = window.academyPayment;
  const supported = isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const registration = isSecureContext && "serviceWorker" in navigator
    ? navigator.serviceWorker.register("/academy-notifications-sw.js").then(() => navigator.serviceWorker.ready).catch(() => null)
    : Promise.resolve(null);
  const dateFormat = new Intl.DateTimeFormat("es-BO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/La_Paz" });
  const ownerKey = "ivanna.pushOwner";
  let studentEmail;
  let entries = [];
  let read = new Set();
  let refreshId = 0;
  let installPrompt;

  slot.innerHTML = `
    <button class="notification-bell" type="button" aria-label="Notificaciones" aria-controls="notifications-panel" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>
      <span class="notification-count" aria-hidden="true" hidden></span>
    </button>
    <section class="notification-panel" id="notifications-panel" aria-labelledby="notifications-title" hidden>
      <header><h2 id="notifications-title">Notificaciones</h2><button type="button" data-mark-all hidden>Marcar como leídas</button></header>
      <p class="notification-empty"></p>
      <ul class="notification-list"></ul>
      <footer>
        <button type="button" data-push-enable hidden>Activar notificaciones</button>
        <button type="button" data-install>Instalar app</button>
        <a href="/mi-espacio#student-access" data-signin>Inicia sesión para recibir tus avisos</a>
        <p class="notification-status" role="status"></p>
      </footer>
    </section>`;

  const bell = slot.querySelector(".notification-bell");
  const panel = slot.querySelector(".notification-panel");
  const count = slot.querySelector(".notification-count");
  const list = slot.querySelector(".notification-list");
  const empty = slot.querySelector(".notification-empty");
  const status = slot.querySelector(".notification-status");
  const enable = slot.querySelector("[data-push-enable]");
  const install = slot.querySelector("[data-install]");
  const markAll = slot.querySelector("[data-mark-all]");
  const signin = slot.querySelector("[data-signin]");
  const storageKey = () => `ivanna.notifications.${studentEmail || "guest"}`;
  const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function stored(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function store(key, value) {
    try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* Los avisos se pueden abrir sin almacenamiento local. */ }
  }

  function draw() {
    const unread = entries.filter(({ id }) => !read.has(id)).length;
    bell.setAttribute("aria-label", unread ? `Notificaciones, ${unread} sin leer` : "Notificaciones");
    count.hidden = unread === 0;
    count.textContent = unread > 9 ? "9+" : String(unread);
    markAll.hidden = unread === 0;
    empty.textContent = entries.length ? "" : "Todavía no tienes avisos.";
    if (panel.hidden) return;
    list.replaceChildren(...entries.map((entry) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = entry.url;
      link.classList.toggle("notification-unread", !read.has(entry.id));
      const title = document.createElement("strong");
      title.textContent = entry.title;
      const body = document.createElement("span");
      body.textContent = entry.body;
      const date = document.createElement("time");
      date.dateTime = entry.at;
      date.textContent = Number.isFinite(Date.parse(entry.at)) ? dateFormat.format(new Date(entry.at)) : "";
      link.append(title, body, date);
      link.addEventListener("click", () => {
        markRead([entry.id]);
        close();
        draw();
      });
      item.append(link);
      return item;
    }));
  }

  function markRead(ids) {
    ids.forEach((id) => read.add(id));
    store(storageKey(), JSON.stringify([...read].slice(-160)));
  }

  async function refresh() {
    const id = ++refreshId;
    try {
      const result = await request("/notifications");
      if (id !== refreshId) return;
      if (JSON.stringify(entries) !== JSON.stringify(result.entries)) {
        entries = result.entries;
        draw();
      } else empty.textContent = entries.length ? "" : "Todavía no tienes avisos.";
    } catch {
      if (id === refreshId && !entries.length) empty.textContent = "No se pudieron consultar los avisos. Vuelve a abrir la campanita para reintentar.";
    }
  }

  function updateActions() {
    signin.hidden = Boolean(studentEmail);
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    enable.hidden = !studentEmail;
    enable.textContent = studentEmail && hasPermission() && stored(ownerKey) === studentEmail
      ? "Desactivar notificaciones" : "Activar notificaciones";
    install.hidden = installed();
    if (studentEmail && ios && !installed()) enable.title = "Instala la app y ábrela desde la pantalla de inicio.";
    else enable.removeAttribute("title");
  }

  const hasPermission = () => supported && Notification.permission === "granted";

  function close(focus = false) {
    panel.hidden = true;
    bell.setAttribute("aria-expanded", "false");
    if (focus) bell.focus();
  }

  bell.addEventListener("click", () => {
    if (!panel.hidden) return close();
    panel.hidden = false;
    bell.setAttribute("aria-expanded", "true");
    updateActions();
    draw();
    refresh();
  });
  document.addEventListener("click", (event) => { if (!slot.contains(event.target)) close(); });
  slot.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.stopPropagation();
    close(true);
  });
  markAll.addEventListener("click", () => {
    markRead(entries.map(({ id }) => id));
    draw();
    bell.focus();
  });

  enable.addEventListener("click", async () => {
    const owner = studentEmail;
    if (!owner) return;
    if (!supported) {
      status.textContent = "Abre la app instalada en iPhone o iPad, o usa un navegador compatible en un sitio HTTPS.";
      return;
    }
    enable.disabled = true;
    try {
      const disable = hasPermission() && stored(ownerKey) === owner;
      const permission = disable ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        status.textContent = permission === "denied" ? "Habilita las notificaciones en los permisos del sitio y vuelve a intentarlo."
          : "Puedes activar las notificaciones cuando quieras.";
        return;
      }
      const worker = await registration;
      if (!worker) throw new Error("No se pudo iniciar el servicio de notificaciones.");
      let subscription = await worker.pushManager.getSubscription();
      if (disable) {
        if (subscription) {
          await request("/notifications/subscription", { endpoint: subscription.endpoint }, "DELETE");
          await subscription.unsubscribe();
        }
        store(ownerKey, null);
        status.textContent = "Notificaciones desactivadas en este dispositivo.";
      } else {
        const { key } = await request("/notifications/key");
        const encoded = key.replace(/-/g, "+").replace(/_/g, "/");
        const publicKey = Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
        const subscribedKey = subscription?.options.applicationServerKey;
        const previousKey = subscribedKey && new Uint8Array(subscribedKey);
        if (previousKey && (previousKey.length !== publicKey.length || !publicKey.every((byte, index) => byte === previousKey[index]))) {
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription ||= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
        if (owner !== studentEmail) return;
        await request("/notifications/subscription", subscription.toJSON(), "PUT");
        store(ownerKey, owner);
        status.textContent = "Notificaciones activadas en este dispositivo.";
      }
    } catch (error) {
      status.textContent = error.name === "AbortError" || error.name === "NotAllowedError"
        ? "No se pudo completar la activación. Revisa los permisos de este navegador." : error.message;
    } finally {
      enable.disabled = false;
      updateActions();
    }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    updateActions();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = undefined;
    install.hidden = true;
    status.textContent = "App instalada.";
  });
  install.addEventListener("click", async () => {
    if (!installPrompt) {
      status.textContent = "En iPhone o iPad, toca Compartir y luego Añadir a pantalla de inicio. En otros dispositivos, busca Instalar app en el menú del navegador.";
      return;
    }
    const prompt = installPrompt;
    installPrompt = undefined;
    try { await prompt.prompt(); } catch { status.textContent = "Abre el menú del navegador para instalar la app."; }
  });

  navigator.serviceWorker?.addEventListener("message", (event) => { if (event.data === "ivanna:notifications") refresh(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("focus", refresh);
  window.setInterval(() => { if (!document.hidden && (studentEmail || !panel.hidden)) refresh(); }, 30_000);
  window.ivannaApp = {
    refresh,
    updateEmail(previous, next) {
      if (!previous || !next || previous === next) return;
      if (stored(ownerKey) === previous) store(ownerKey, next);
      const oldKey = `ivanna.notifications.${previous}`;
      const saved = stored(oldKey);
      if (saved !== null) {
        store(`ivanna.notifications.${next}`, saved);
        store(oldKey, null);
      }
    },
    setStudent(account) {
      const next = account?.email || null;
      if (studentEmail === next) return;
      if (studentEmail && !next && stored(ownerKey) === studentEmail) store(ownerKey, null);
      studentEmail = next;
      entries = [];
      try {
        const saved = JSON.parse(stored(storageKey()) || "[]");
        read = new Set(Array.isArray(saved) ? saved : []);
      } catch { read = new Set(); }
      status.textContent = "";
      updateActions();
      draw();
      refresh();
    },
  };
  window.ivannaApp.setStudent(null);
})();
