(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const { endpoint, request } = window.academyPayment;
  const heart = $("#course-heart");
  const count = $("#course-heart-count");
  const icon = heart.querySelector(".course-heart__icon");
  const form = $("#course-comment-form");
  const field = $("#course-comment-text");
  const send = $("#course-comment-send");
  const status = $("#course-discussion-status");
  const list = $("#course-comment-list");
  const more = $("#course-comments-more");
  const dateFormat = new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/La_Paz" });
  let active;

  function updateHeart(data) {
    heart.setAttribute("aria-pressed", String(data.loved));
    icon.textContent = data.loved ? "♥" : "♡";
    count.textContent = data.count;
    heart.setAttribute("aria-label", `${data.loved ? "Quitar corazón" : "Dar un corazón"} · ${data.count} ${data.count === 1 ? "corazón" : "corazones"}`);
  }

  function commentItem({ id, name, text, at }) {
    const item = document.createElement("li");
    item.dataset.commentId = id;
    const header = document.createElement("header");
    const author = document.createElement("strong");
    author.textContent = name;
    const date = document.createElement("time");
    date.dateTime = at;
    date.textContent = dateFormat.format(new Date(at));
    header.append(author, date);
    const content = document.createElement("p");
    content.textContent = text;
    item.append(header, content);
    return item;
  }

  function updateComments(session, data, append) {
    const existing = append ? new Set([...list.children].map((item) => item.dataset.commentId)) : new Set();
    if (!append) list.replaceChildren();
    list.append(...data.comments.filter(({ id }) => !existing.has(id)).map(commentItem));
    session.page = data.nextPage;
    more.textContent = "Ver más comentarios";
    more.hidden = !data.nextPage;
  }

  async function load(session, page = 1) {
    more.disabled = true;
    try {
      const data = await request(`${session.route}?page=${page}`);
      if (active !== session) return;
      if (page === 1) {
        updateHeart(data);
        heart.disabled = send.disabled = false;
        status.textContent = data.pending ? "Tienes un comentario pendiente de aprobación." : data.comments.length ? "" : "Todavía no hay comentarios publicados.";
      }
      updateComments(session, data, page !== 1);
    } catch (error) {
      if (active !== session) return;
      status.textContent = error.message;
      session.page = page;
      more.textContent = "Reintentar cargar comentarios";
      more.hidden = false;
    } finally {
      if (active === session) more.disabled = false;
    }
  }

  function open(order) {
    if (active?.id === order.id) return;
    const session = { id: order.id, route: endpoint(order, "discussion"), page: 1, requestId: null };
    active = session;
    heart.disabled = send.disabled = true;
    field.disabled = false;
    more.hidden = true;
    updateHeart({ loved: false, count: 0 });
    form.reset();
    list.replaceChildren();
    status.textContent = "Cargando comentarios…";
    load(session);
  }

  heart.addEventListener("click", async () => {
    const session = active;
    if (!session || heart.disabled) return;
    const loved = heart.getAttribute("aria-pressed") !== "true";
    heart.disabled = true;
    try {
      const data = await request(`${session.route}/heart`, { loved });
      if (active === session) updateHeart(data);
    } catch (error) {
      if (active === session) status.textContent = error.message;
    } finally {
      if (active === session) heart.disabled = false;
    }
  });

  field.addEventListener("input", () => { if (active) active.requestId = null; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const session = active;
    const text = field.value.trim();
    if (!session || send.disabled) return;
    if (!text) {
      status.textContent = "Escribe un comentario antes de enviarlo.";
      field.focus();
      return;
    }
    session.requestId ||= crypto.randomUUID();
    field.disabled = send.disabled = true;
    status.textContent = "Enviando comentario…";
    try {
      const data = await request(`${session.route}/comment`, { text, requestId: session.requestId });
      if (active !== session) return;
      session.requestId = null;
      form.reset();
      updateComments(session, data, false);
      status.textContent = "Comentario enviado y pendiente de aprobación.";
    } catch (error) {
      if (active === session) status.textContent = error.message;
    } finally {
      if (active === session) field.disabled = send.disabled = false;
    }
  });
  more.addEventListener("click", () => { if (active?.page) load(active, active.page); });
  window.academyDiscussion = { open, close: () => { active = null; } };
})();
