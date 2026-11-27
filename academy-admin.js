(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const form = $("#course-editor");
  const editorStatus = $("#academy-editor-status");
  const paymentsStatus = $("#academy-payments-status");
  const refresh = $("#academy-reload-payments");
  const reviewList = $("#academy-review-list");
  const reviewStatus = $("#academy-reviews-status");
  const reloadReviews = $("#academy-reload-reviews");
  const commentList = $("#academy-comment-list");
  const commentStatus = $("#academy-comments-status");
  const reloadComments = $("#academy-reload-comments");
  const { communityCountries, photos, photoSource } = window.homeConfig;
  const currency = new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB" });
  const dateFormat = new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/La_Paz" });
  const courseFields = ["title", "description", "price", "instructions", "liveProvider", "liveUrl", "startsAt", "cover"];
  const categoryNames = { live: ["Vivos", "Nuevo vivo"], special: ["Especiales", "Nuevo especial"], course: ["Cursos", "Nuevo curso"] };
  const catalogView = $("#academy-catalog-view");
  const catalogList = $("#academy-catalog-list");
  const catalogStatus = $("#academy-catalog-status");
  const create = $("#academy-create");
  const chapterList = $("#academy-chapters");
  const addChapter = $("#academy-add-chapter");
  const coverSelect = form.elements.cover;
  const localDrafts = new Map();
  let category = "course";
  let selection = null;
  let editorData;
  let paymentsPage = 1;
  let activeView;
  let polling = false;
  let reviewSignature = "";
  let commentSignature = "";
  let qr = "";
  let chapters = [];
  let revision = 0;
  let busy = false;
  coverSelect.append(...photos.map(({ id, title }) => new Option(title, id)));

  async function request(route, method = "GET", data) {
    const options = { method };
    if (data instanceof Blob || data instanceof FormData) options.body = data;
    else if (data !== undefined) {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(data);
    }
    const response = await fetch(`/api/admin/academy${route}`, options);
    if (response.status === 401) {
      location.replace("/admin/login");
      throw new Error("La sesión ha terminado.");
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo completar la operación.");
    return result;
  }

  function updateFiles() {
    const preview = $("#academy-qr-preview");
    preview.hidden = !qr;
    if (qr) preview.querySelector("img").src = `/api/admin/academy/image/${encodeURIComponent(qr)}`;
    else preview.querySelector("img").removeAttribute("src");
    const cover = coverSelect.value;
    const coverPreview = $("#academy-cover-preview");
    coverPreview.hidden = !cover;
    if (cover) coverPreview.querySelector("img").src = cover.startsWith("cover-") ? `/api/admin/academy/image/${encodeURIComponent(cover)}` : `/${photoSource(cover)}`;
    else coverPreview.querySelector("img").removeAttribute("src");
  }

  function selectCover(cover) {
    coverSelect.querySelector("[data-uploaded]")?.remove();
    if (cover.startsWith("cover-")) {
      const option = new Option("Imagen subida", cover);
      option.dataset.uploaded = "";
      coverSelect.append(option);
    }
    coverSelect.value = cover;
  }

  function emptyChapter() {
    return { id: "", title: "", text: "", video: "" };
  }

  function fillCourse(data) {
    const entry = data.catalog.find(({ id }) => id === selection.id);
    const saved = selection.id === "principal" ? data.draft : data.offerDrafts[selection.id];
    const draft = localDrafts.get(selection.key) ?? saved ?? { title: entry?.title };
    selectCover(draft.cover || "");
    for (const field of courseFields.filter((name) => name !== "cover")) {
      form.elements.namedItem(field).value = draft[field] || (field === "liveProvider" ? "manual" : "");
    }
    qr = draft.qr || "";
    const previousLesson = draft.lessonTitle || draft.lessonText || draft.video
      ? [{ id: "legacy", title: draft.lessonTitle || "", text: draft.lessonText || "", video: draft.video || "" }] : [];
    chapters = (draft.chapters || previousLesson).map((chapter) => ({ ...chapter }));
    if (!chapters.length && selection.category !== "live") chapters.push(emptyChapter());
    revision = data.revision;
    renderChapters();
    updateFiles();
  }

  function updateCourseControls() {
    const live = selection?.category === "live";
    const custom = Boolean(selection && (!selection.id || selection.id.startsWith("oferta-")));
    const demo = Boolean(editorData?.offerDrafts[selection?.id]?.demo);
    $("#academy-live-fields").hidden = !live;
    $("#academy-course-fields").hidden = live;
    $("#academy-catalog-cover").hidden = !custom;
    $("#academy-catalog-date").hidden = !custom || !live;
    const managed = form.elements.liveProvider.value === "plugnmeet";
    $("#academy-live-provider-field").hidden = demo;
    $("#academy-live-link-field").hidden = demo || managed;
    $("#academy-live-demo").hidden = !demo || !live;
    $("#academy-qr-field").hidden = demo;
    $("#academy-instructions-field").hidden = demo;
    form.elements.liveProvider.disabled = busy || !live || demo;
    form.elements.liveUrl.disabled = busy || !live || demo || managed;
    form.elements.startsAt.disabled = busy || !custom || !live;
    coverSelect.disabled = busy || !custom;
    $("#academy-cover-file").disabled = busy || !custom;
    addChapter.disabled = busy || chapters.length >= 24;
    for (const [index, row] of [...chapterList.children].entries()) {
      row.querySelector('[data-action="up"]').disabled = busy || index === 0;
      row.querySelector('[data-action="down"]').disabled = busy || index === chapters.length - 1;
    }
  }

  function courseValues() {
    return { qr, chapters: chapters.map((chapter) => ({ ...chapter })), ...Object.fromEntries(courseFields.map((field) => [field, form.elements.namedItem(field).value])) };
  }

  function renderChapters(openIndex = 0) {
    const special = selection.category === "special";
    $("#academy-chapter-label").textContent = special ? "Lección del especial" : "Capítulos";
    $("#academy-chapter-help").hidden = special;
    addChapter.hidden = special;
    const template = $("#academy-chapter-template");
    chapterList.replaceChildren(...chapters.map((chapter, index) => {
      const row = template.content.firstElementChild.cloneNode(true);
      const summary = row.querySelector("summary");
      const label = special ? "Lección" : `Capítulo ${index + 1}`;
      const updateSummary = () => { summary.textContent = chapter.title.trim() ? `${label} · ${chapter.title.trim()}` : label; };
      row.open = special || index === openIndex;
      updateSummary();
      for (const field of ["title", "text"]) {
        const input = row.querySelector(`[data-field="${field}"]`);
        input.value = chapter[field];
        input.addEventListener("input", () => {
          chapter[field] = input.value;
          if (field === "title") updateSummary();
        });
      }
      const video = row.querySelector('[data-field="video"]');
      const videoState = row.querySelector("[data-video-state]");
      const removeVideo = row.querySelector('[data-action="remove-video"]');
      const updateVideo = () => { videoState.hidden = removeVideo.hidden = !chapter.video; };
      updateVideo();
      video.addEventListener("change", () => uploadFile(video, "video", 64, (data, filename) => {
        if (data.chapters[index]) data.chapters[index].video = filename;
        updateVideo();
      }));
      removeVideo.addEventListener("click", () => {
        chapter.video = "";
        updateVideo();
        video.focus();
        editorStatus.textContent = "Guarda el borrador para conservar el cambio.";
      });
      row.querySelector("[data-reorder]").hidden = special;
      for (const [action, offset] of [["up", -1], ["down", 1], ["remove", 0]]) {
        const button = row.querySelector(`[data-action="${action}"]`);
        button.setAttribute("aria-label", `${button.textContent.replace(" capítulo", "")} capítulo ${index + 1}`);
        button.addEventListener("click", () => {
          chapters.splice(index, 1);
          if (offset) chapters.splice(index + offset, 0, chapter);
          const next = Math.min(index + offset, chapters.length - 1);
          renderChapters(next);
          (chapterList.children[next]?.querySelector("summary") || addChapter).focus();
        });
      }
      return row;
    }));
    updateCourseControls();
  }

  addChapter.addEventListener("click", () => {
    chapters.push(emptyChapter());
    renderChapters(chapters.length - 1);
    chapterList.lastElementChild.querySelector('[data-field="title"]').focus();
  });

  function rememberCourse() {
    if (selection) localDrafts.set(selection.key, courseValues());
  }

  function openCourse(id = null) {
    if (busy || !editorData) return;
    selection = { id, category, key: id || `new-${category}` };
    fillCourse(editorData);
    editorStatus.textContent = "";
    renderCatalog();
    $("#academy-course-editor-title").focus();
  }

  function renderCatalog() {
    const [title, createLabel] = categoryNames[category];
    $("#academy-category-title").textContent = title;
    create.textContent = createLabel;
    create.disabled = busy || !editorData;
    catalogView.hidden = Boolean(selection);
    form.hidden = !selection;
    const record = editorData?.catalog.find(({ id }) => id === selection?.id);
    showRoom(record?.liveProvider === "plugnmeet" ? record.id : "");
    if (!editorData) return;
    if (selection) {
      const heading = $("#academy-course-editor-title");
      heading.textContent = record ? `Editar ${record.title}` : createLabel;
      $("#academy-publication").textContent = record?.status === "open" ? "Inscripciones abiertas" : record?.status === "closed" ? "Inscripciones cerradas" : "Borrador";
      $("#academy-close").hidden = record?.status !== "open";
      form.querySelector('[value="publish"]').textContent = record ? "Publicar y abrir inscripciones" : "Crear y publicar";
      return;
    }

    const status = { open: "Inscripciones abiertas", closed: "Inscripciones cerradas", draft: "Borrador" };
    const entries = editorData.catalog.filter((item) => item.category === category);
    catalogStatus.textContent = entries.length ? "" : "Todavía no hay publicaciones en esta categoría.";
    catalogList.replaceChildren(...entries.map((entry) => {
      const row = make("li", "", "catalog-list__item");
      const info = make("div");
      info.append(make("strong", entry.title), make("p", `${status[entry.status]}${entry.cents === null ? "" : ` · ${currency.format(entry.cents / 100)}`}`));
      const button = make("button", "Editar", "admin-secondary");
      button.type = "button";
      button.setAttribute("aria-label", `Editar ${entry.title}`);
      button.addEventListener("click", () => openCourse(entry.id));
      row.append(info, button);
      return row;
    }));
  }

  document.addEventListener("dashboard:category", (event) => {
    if (category === event.detail) return;
    rememberCourse();
    selection = null;
    category = event.detail;
    renderCatalog();
  });
  create.addEventListener("click", () => openCourse());
  form.elements.liveProvider.addEventListener("change", updateCourseControls);
  $("#academy-catalog-back").addEventListener("click", () => {
    rememberCourse();
    selection = null;
    renderCatalog();
    create.focus();
  });

  function render(data) {
    editorData = data;
    renderCatalog();
    renderMetrics(data.metrics);
    refresh.hidden = false;
    $("#academy-email-configuration").textContent = data.paymentEmailConfigured
      ? "Resend configurado. Revisión de pagos muestra el estado de los avisos por correo."
      : "Por conectar. Configura el remitente y la clave de Resend en el servidor. Los correos pendientes se guardan en la cola.";
    renderStudents(data.students);
    renderOrders(data.orders);
    renderReviews(data.reviews);
    renderCourseComments(data.courseComments || []);
  }

  function renderMetrics(metrics) {
    $("#academy-month").textContent = currency.format(metrics.monthCents / 100);
    $("#academy-student-count").textContent = metrics.students;
    $("#academy-approved-count").textContent = metrics.approved;
    $("#academy-pending-count").textContent = metrics.pending;
    renderRevenue(metrics.revenue);
  }

  function make(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function renderStudents(students) {
    const list = $("#academy-student-list");
    const status = $("#academy-student-status");
    status.hidden = students.length > 0;
    status.textContent = "Los registros de la comunidad aparecerán aquí.";
    list.hidden = !students.length;
    const rows = document.createDocumentFragment();
    for (const { name, email, profile } of students) {
      const row = make("li");
      const details = make("details");
      details.append(make("summary", name));
      const info = make("dl");
      const fields = [["Correo electrónico", email]];
      if (profile) fields.push(
        ["País", communityCountries[profile.country]?.name || profile.country],
        profile.department ? ["Departamento", profile.department] : ["Ciudad", profile.city], ["Edad", String(profile.age)],
        ["WhatsApp", profile.whatsapp], ["Interés", profile.interest], ["Permiso de contacto", profile.whatsappConsent ? "Autorizado por WhatsApp" : "Sin autorización"],
      );
      for (const [label, value] of fields) info.append(make("dt", label), make("dd", value));
      details.append(info);
      row.append(details);
      rows.append(row);
    }
    list.replaceChildren(rows);
  }

  function renderRevenue(revenue) {
    const maximum = Math.max(...revenue.map((item) => item.cents));
    const chart = $("#academy-revenue");
    chart.hidden = !maximum;
    $("#academy-revenue-empty").hidden = Boolean(maximum);
    if (!maximum) return;
    chart.replaceChildren(...revenue.map(({ label, cents }) => {
      const item = make("li");
      const bar = make("div", "", "academy-revenue__bar");
      bar.style.setProperty("--bar-width", `${cents / maximum * 100}%`);
      bar.setAttribute("aria-hidden", "true");
      item.append(make("span", label), bar, make("strong", currency.format(cents / 100)));
      return item;
    }));
  }

  const linkedPayment = new URLSearchParams(location.search).get("payment");

  function renderOrders(orders) {
    const labels = { awaiting_receipt: "Inscripción iniciada", submitted: "Verificando comprobante", approved: "Pago aprobado y acceso habilitado", rejected: "Comprobante rechazado" };
    const emailLabels = { queued: "En cola", sent: "Enviado al proveedor", failed: "Falló el envío", unconfigured: "Pendiente de configuración" };
    const sorted = [...orders].sort((a, b) => Number(b.id === linkedPayment) - Number(a.id === linkedPayment)
      || Number(b.status === "submitted") - Number(a.status === "submitted"));
    const pageSize = 20;
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    paymentsPage = Math.min(paymentsPage, pages);
    $("#academy-payments-pagination").hidden = pages < 2;
    $("#academy-payments-previous").disabled = paymentsPage <= 1;
    $("#academy-payments-next").disabled = paymentsPage >= pages;
    $("#academy-payments-page").textContent = `Página ${paymentsPage} de ${pages}`;
    const start = (paymentsPage - 1) * pageSize;
    const cards = sorted.slice(start, start + pageSize).map((order) => {
      const card = make("article", "", "academy-order-review");
      card.id = `pago-${order.id}`;
      if (order.id === linkedPayment) card.classList.add("academy-order-review--linked");
      const heading = make("h3", order.title);
      const status = make("p", labels[order.status], "academy-status");
      const fields = make("dl", "", "academy-payment-detail");
      const details = [
        ["Estudiante", order.student?.name || "Estudiante"],
        ["Correo", order.student?.email || ""],
        ["WhatsApp", order.student?.whatsapp || ""],
        [order.demo ? "Monto de prueba" : order.status === "approved" ? "Monto confirmado" : "Monto a verificar", currency.format(order.cents / 100)],
      ];
      if (order.bankReference) details.push(["Referencia bancaria", order.bankReference]);
      if (order.discount) {
        const names = { promo: "Código promocional", invite: "Invitación", reward: "Premio por invitación" };
        details.push(["Precio original", currency.format(order.baseCents / 100)],
          ["Descuento", `${order.discount.percent} % · ${order.discount.code || names[order.discount.kind]}`]);
      }
      for (const [label, value] of details) if (value) fields.append(make("dt", label), make("dd", value));
      card.append(heading, status, fields);
      if (order.receipt) {
        const file = make("a", "Descargar comprobante", "back-link");
        file.href = `/api/admin/academy/orders/${order.id}/receipt`;
        card.append(file);
      } else card.append(make("p", "Aviso de pago sin comprobante adjunto."));
      const whatsappLabels = { queued: "En cola", attached: "Enviado con comprobante", link: "Enviado con enlace al comprobante", failed: "Falló el envío", skipped: "Aviso omitido",
        unknown: "Resultado sin confirmar. Revisa WhatsApp." };
      if (order.whatsappStatus) card.append(make("p", `WhatsApp · ${whatsappLabels[order.whatsappStatus]}`, "academy-status"));
      if (order.note) card.append(make("p", order.note, "academy-prose"));
      const process = make("details", "", "academy-order-process");
      const steps = make("ol");
      for (const { status, at, note, reviewer } of order.paymentHistory || []) {
        const step = make("li", labels[status]);
        if (Number.isFinite(Date.parse(at))) {
          const date = make("time", dateFormat.format(new Date(at)));
          date.dateTime = at;
          step.append(" · ", date);
        }
        if (reviewer) step.append(` · ${reviewer}`);
        if (note) step.append(make("p", note));
        steps.append(step);
      }
      process.append(make("summary", "Historial del pago"), steps);
      const email = order.emailStatus?.at(-1);
      if (email) process.append(make("p", `Último aviso por correo · ${emailLabels[email.delivery]}`));
      card.append(process);
      if (order.status !== "submitted") return card;

      const review = make("form");
      const reference = make("input");
      reference.type = "text";
      reference.maxLength = 80;
      reference.autocomplete = "off";
      reference.spellcheck = false;
      if (!order.demo) {
        const bank = make("label", "Referencia de la operación verificada en el banco");
        bank.append(reference);
        review.append(bank);
      }
      const label = make("label", "Motivo, si rechazas el comprobante");
      const note = make("textarea");
      note.rows = 2;
      note.maxLength = 500;
      label.append(note);
      const actions = make("div", "", "academy-admin-actions");
      for (const [value, text, style] of [["approved", order.category === "live" ? "Aprobar y habilitar live" : "Aprobar y habilitar curso", "admin-primary"], ["rejected", "Rechazar", "admin-secondary"]]) {
        const button = make("button", text, style);
        button.type = "submit";
        button.value = value;
        button.disabled = value === "approved" && !order.receipt;
        actions.append(button);
      }
      review.append(label, actions);
      review.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (review.dataset.busy) return;
        const decision = event.submitter?.value;
        if (!decision) return;
        if (decision === "approved" && !order.demo && !reference.value.trim()) {
          paymentsStatus.textContent = "Ingresa la referencia de la operación tal como aparece en el banco.";
          reference.focus();
          return;
        }
        if (decision === "rejected" && !note.value.trim()) {
          paymentsStatus.textContent = "Escribe el motivo antes de rechazar el comprobante.";
          note.focus();
          return;
        }
        review.dataset.busy = "true";
        for (const button of actions.children) button.disabled = true;
        try {
          render(await request(`/orders/${order.id}`, "PUT", { decision, note: note.value, receipt: order.receipt,
            submissionId: order.submissionId, bankReference: reference.value }));
          paymentsStatus.textContent = decision === "approved" ? "Pago aprobado. El acceso ya aparece en Mi espacio." : "Pago rechazado. El estudiante puede enviar otro aviso.";
        } catch (error) {
          paymentsStatus.textContent = error.message;
        } finally {
          delete review.dataset.busy;
          for (const button of actions.children) button.disabled = button.value === "approved" && !order.receipt;
        }
      });
      card.append(review);
      return card;
    });
    if (!cards.length) cards.push(make("p", "Los avisos de «Ya pagué» aparecerán aquí."));
    $("#academy-order-list").replaceChildren(...cards);
  }

  for (const [selector, step] of [["#academy-payments-previous", -1], ["#academy-payments-next", 1]]) {
    $(selector).addEventListener("click", () => {
      paymentsPage += step;
      renderOrders(editorData.orders);
    });
  }

  const reviewVersion = (reviews) => JSON.stringify(reviews.map(({ id, revision }) => [id, revision]));

  function renderCourseComments(comments) {
    const signature = reviewVersion(comments);
    if (signature === commentSignature) return;
    commentSignature = signature;
    const labels = { pending: "Pendiente", approved: "Publicado", rejected: "Oculto" };
    const pending = comments.filter(({ status }) => status === "pending").length;
    commentStatus.textContent = pending ? `Comentarios por revisar: ${pending}.` : "No hay comentarios pendientes.";
    commentList.replaceChildren(...[...comments].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending")).map((comment) => {
      const card = make("article", "", "academy-order-review");
      card.append(make("h3", comment.course), make("p", `${comment.author} · ${dateFormat.format(new Date(comment.at))}`), make("p", labels[comment.status], "academy-status"), make("p", comment.text, "academy-prose"));
      const actions = make("div", "", "academy-admin-actions");
      const decisions = [];
      if (comment.status !== "approved") decisions.push(["approved", "Aprobar comentario", "admin-primary"]);
      if (comment.status !== "rejected") decisions.push(["rejected", "Ocultar comentario", "admin-secondary"]);
      for (const [status, label, className] of decisions) {
        const button = make("button", label, className);
        button.type = "button";
        button.addEventListener("click", async () => {
          if (card.dataset.busy) return;
          card.dataset.busy = "1";
          for (const control of actions.children) control.disabled = true;
          try {
            render(await request(`/comments/${comment.id}`, "PUT", { status, revision: comment.revision }));
            commentStatus.textContent = status === "approved" ? "Comentario publicado en el curso." : "Comentario oculto.";
          } catch (error) {
            commentStatus.textContent = error.message;
          } finally {
            delete card.dataset.busy;
            for (const control of actions.children) control.disabled = false;
          }
        });
        actions.append(button);
      }
      card.append(actions);
      return card;
    }));
  }

  function renderReviews(reviews) {
    const signature = reviewVersion(reviews);
    if (signature === reviewSignature) return;
    reviewSignature = signature;
    reloadReviews.hidden = false;
    const pending = reviews.filter(({ status }) => status === "pending").length;
    reviewStatus.textContent = pending ? `${pending} ${pending === 1 ? "reseña pendiente" : "reseñas pendientes"} de aprobación.` : "No hay reseñas pendientes.";
    const sorted = [...reviews].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
    reviewList.replaceChildren(...sorted.map(reviewEditor));
  }

  function reviewEditor(review) {
    const card = make("details", "", "academy-order-review academy-review-editor");
    const status = `${review.status === "pending" ? "Pendiente" : "Publicada"}${review.demo ? " · Demo" : ""}`;
    card.append(make("summary", `${status} · ${review.course} · ${review.name} · ${review.rating}/5`));
    if (review.progressSource === "self-reported") {
      card.append(make("p", "Finalización registrada por el reproductor de la participante."));
    }
    const editor = make("form");
    const name = make("input");
    name.value = review.name;
    name.required = true;
    name.maxLength = 100;
    const rating = make("select");
    rating.append(...[1, 2, 3, 4, 5].map((value) => new Option(`${value} ${value === 1 ? "estrella" : "estrellas"}`, value)));
    rating.value = review.rating;
    const comment = make("textarea");
    comment.value = review.comment;
    comment.rows = 3;
    comment.maxLength = 750;
    comment.required = true;
    for (const [label, field] of [["Nombre público", name], ["Calificación", rating], ["Reseña", comment]]) {
      const wrapper = make("label", label);
      wrapper.append(field);
      editor.append(wrapper);
    }
    const actions = make("div", "", "academy-admin-actions");
    const save = make("button", "Guardar cambios", "admin-secondary");
    save.type = "submit";
    actions.append(save);
    if (review.status === "pending") {
      const approve = make("button", "Aprobar y publicar", "admin-primary");
      approve.type = "submit";
      approve.value = "approve";
      actions.append(approve);
    }
    const remove = make("button", "Eliminar reseña", "admin-secondary");
    remove.type = "button";
    const confirm = make("button", "Confirmar eliminación", "admin-secondary");
    confirm.type = "button";
    confirm.hidden = true;
    actions.append(remove, confirm);
    const feedback = make("p");
    feedback.setAttribute("role", "status");
    editor.append(actions, feedback);
    card.append(editor);

    async function moderate(method, payload, message) {
      if (editor.dataset.busy) return;
      editor.dataset.busy = "true";
      for (const button of actions.children) button.disabled = true;
      try {
        render(await request(`/reviews/${review.id}`, method, { revision: review.revision, ...payload }));
        reviewStatus.textContent = message;
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        delete editor.dataset.busy;
        for (const button of actions.children) button.disabled = false;
      }
    }

    editor.addEventListener("submit", (event) => {
      event.preventDefault();
      const approve = event.submitter?.value === "approve";
      moderate("PUT", { name: name.value, rating: Number(rating.value), comment: comment.value, approve }, approve ? "Reseña publicada en la portada." : "Cambios guardados.");
    });
    remove.addEventListener("click", () => {
      confirm.hidden = !confirm.hidden;
      if (!confirm.hidden) confirm.focus();
    });
    confirm.addEventListener("click", () => moderate("DELETE", {}, "Reseña eliminada."));
    return card;
  }

  function setBusy(value) {
    busy = value;
    for (const control of form.querySelectorAll("button, input, textarea, select")) control.disabled = value;
    create.disabled = value || !editorData;
    if (!value) updateCourseControls();
  }

  async function edit(action, progress) {
    if (busy) return;
    editorStatus.textContent = progress;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      editorStatus.textContent = error.message;
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!selection) return;
    const selected = selection;
    const publish = event.submitter?.value === "publish";
    const payload = courseValues();
    edit(async () => {
      const route = selected.id ? `/course/${selected.id}` : "/course";
      const data = await request(route, selected.id ? "PUT" : "POST", { course: payload, revision, publish, category: selected.category });
      localDrafts.delete(selected.key);
      if (selection === selected) {
        selection = { ...selected, id: data.savedOfferId, key: data.savedOfferId };
        fillCourse(data);
        editorStatus.textContent = publish ? "Publicado en Subscripciones. Las inscripciones están abiertas." : "Borrador guardado.";
      }
      render(data);
    }, "Guardando el curso…");
  });
  $("#academy-close").addEventListener("click", () => edit(async () => {
    const selected = selection;
    if (!selected?.id) return;
    const data = await request(`/close/${selected.id}`, "POST", { revision });
    revision = data.revision;
    render(data);
    if (selection === selected) editorStatus.textContent = "Inscripciones cerradas. Los estudiantes con pago aprobado conservan el acceso.";
  }, "Cerrando inscripciones…"));

  function uploadFile(input, kind, limit, attach) {
    const file = input.files[0];
    input.value = "";
    if (!file || !selection) return;
    const selected = selection;
    if (file.size > limit * 1024 * 1024) {
      editorStatus.textContent = `El archivo supera el límite de ${limit} MB.`;
      return;
    }
    edit(async () => {
      const { id } = await request(`/${kind}`, "POST", file);
      if (selection !== selected) {
        const draft = localDrafts.get(selected.key);
        if (draft) attach(draft, id, false);
        return;
      }
      attach({ chapters }, id, true);
      updateFiles();
      editorStatus.textContent = "Archivo listo. Guarda el borrador o publica el curso para conservarlo.";
    }, "Subiendo archivo…");
  }

  for (const kind of ["qr", "cover"]) {
    const input = $(`#academy-${kind}-file`);
    input.addEventListener("change", () => uploadFile(input, kind, 6, (draft, filename, isCurrent) => {
      if (!isCurrent) draft[kind] = filename;
      else if (kind === "cover") selectCover(filename);
      else qr = filename;
    }));
  }
  coverSelect.addEventListener("change", updateFiles);
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    try {
      render(await request(""));
      paymentsStatus.textContent = "Lista actualizada.";
    } catch (error) {
      paymentsStatus.textContent = error.message;
    } finally {
      refresh.disabled = false;
    }
  });
  reloadReviews.addEventListener("click", async () => {
    reloadReviews.disabled = true;
    try {
      reviewSignature = "";
      render(await request(""));
    } catch (error) {
      reviewStatus.textContent = error.message;
    } finally {
      reloadReviews.disabled = false;
    }
  });
  reloadComments.addEventListener("click", async () => {
    reloadComments.disabled = true;
    try {
      commentSignature = "";
      render(await request(""));
    } catch (error) {
      commentStatus.textContent = error.message;
    } finally {
      reloadComments.disabled = false;
    }
  });
  const feedList = $("#admin-feed-list");
  const feedStatus = $("#admin-feed-status");
  const feedMore = $("#admin-feed-more");
  const newsForm = $("#academy-news-form");
  const newsStatus = $("#academy-news-status");
  const referralForm = $("#admin-referrals-form");
  const referralStatus = $("#admin-referrals-status");
  const saveReferral = referralForm.querySelector("button");
  let feedCursor;

  function moderationButton(route, entry, label, status) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-secondary";
    const update = () => { button.textContent = entry.hidden ? `Restaurar ${label}` : `Ocultar ${label}`; };
    update();
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const { hidden } = await request(route, "PUT", { hidden: !entry.hidden });
        entry.hidden = hidden;
        update();
        status.textContent = hidden ? "Contenido oculto." : "Contenido visible otra vez.";
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
    return button;
  }

  function textBlock(tag, text) {
    const block = document.createElement(tag);
    block.textContent = text;
    return block;
  }

  function moderationCard(post) {
    const card = document.createElement("article");
    card.className = "academy-moderation-card";
    const route = `/feed/posts/${post.id}`;
    card.append(textBlock("h3", post.news ? `Noticia · ${post.news.title}` : post.author.name), textBlock("p", post.text || "Publicación con fotos"));
    for (const [index, src] of post.photos.entries()) {
      const image = document.createElement("img");
      image.src = src;
      image.alt = `Foto ${index + 1} de la publicación`;
      image.loading = "lazy";
      card.append(image);
    }
    card.append(moderationButton(route, post, "publicación", feedStatus));
    const details = document.createElement("details");
    const summary = textBlock("summary", `Comentarios (${post.commentCount})`);
    const comments = document.createElement("ul");
    const commentStatus = textBlock("p", "");
    commentStatus.role = "status";
    const more = textBlock("button", "Ver más comentarios");
    more.type = "button";
    more.className = "admin-secondary";
    more.hidden = true;
    let cursor;
    let loaded = false;
    async function loadComments() {
      more.disabled = true;
      try {
        const result = await request(`${route}/comments${cursor ? `?before=${cursor}` : ""}`);
        for (const comment of result.comments) {
          const item = document.createElement("li");
          item.append(textBlock("strong", comment.author.name), textBlock("p", comment.text),
            moderationButton(`${route}/comments/${comment.id}`, comment, "comentario", commentStatus));
          comments.append(item);
        }
        cursor = result.next;
        more.hidden = !cursor;
        loaded = true;
        commentStatus.textContent = comments.children.length ? "" : "Todavía no hay comentarios.";
      } catch (error) { commentStatus.textContent = error.message; }
      finally { more.disabled = false; }
    }
    details.append(summary, commentStatus, comments, more);
    details.addEventListener("toggle", () => { if (details.open && !loaded && !more.disabled) loadComments(); });
    more.addEventListener("click", loadComments);
    card.append(details);
    return card;
  }

  async function loadModeration(append = false) {
    if (feedMore.disabled) return;
    feedMore.disabled = true;
    try {
      const { posts, next } = await request(append && feedCursor ? `/feed?before=${feedCursor}` : "/feed");
      if (!append) feedList.replaceChildren();
      feedList.append(...posts.map(moderationCard));
      feedCursor = next;
      feedMore.hidden = !next;
      feedStatus.textContent = feedList.children.length ? "" : "Todavía no hay publicaciones.";
    } catch (error) { feedStatus.textContent = error.message; }
    finally { feedMore.disabled = false; }
  }

  function showNews({ entries }) {
    $("#academy-news-list").replaceChildren(...entries.map(({ title, at, url }) => {
      const item = document.createElement("li");
      const link = textBlock("a", title);
      link.href = url;
      item.append(link, document.createTextNode(` · ${dateFormat.format(new Date(at))}`));
      return item;
    }));
  }

  function fillReferrals({ settings: { promo, invites } }) {
    const fields = referralForm.elements;
    fields.promoEnabled.checked = promo.enabled;
    fields.promoCode.value = promo.code;
    fields.promoPercent.value = promo.percent;
    fields.invitesEnabled.checked = invites.enabled;
    fields.buyerPercent.value = invites.buyerPercent;
    fields.referrerPercent.value = invites.referrerPercent;
    fields.samePercent.checked = invites.buyerPercent === invites.referrerPercent;
    updateReferrerField();
    saveReferral.disabled = false;
  }

  function updateReferrerField() {
    const same = referralForm.elements.samePercent.checked;
    $("#referrer-percent-field").hidden = same;
    referralForm.elements.referrerPercent.disabled = same;
  }

  referralForm.elements.samePercent.addEventListener("change", updateReferrerField);

  feedMore.addEventListener("click", () => loadModeration(true));
  const roomPanel = $("#academy-room-panel");
  const roomStatus = $("#academy-room-status");
  const roomList = $("#academy-room-recordings");
  const roomMore = $("#academy-room-more");
  const roomCourses = $("#academy-room-courses");
  let roomId = "";
  let nextRecordingPage = null;
  let roomOperation;

  function showRoom(id) {
    roomPanel.hidden = !id;
    if (roomId === id) return;
    roomId = id;
    roomOperation = null;
    nextRecordingPage = null;
    roomStatus.textContent = "";
    roomList.replaceChildren();
    roomList.hidden = roomMore.hidden = roomCourses.hidden = true;
    for (const button of roomPanel.querySelectorAll("[data-room-action]")) button.disabled = false;
    roomMore.disabled = false;
  }

  async function roomAction(action, { from = 0, recordId = "" } = {}) {
    if (!roomId || roomOperation) return;
    if (action === "end" && !confirm("¿Cerrar la sala para todas las personas conectadas?")) return;
    const operation = roomOperation = Symbol();
    const controls = [...roomPanel.querySelectorAll("button")];
    for (const button of controls) button.disabled = true;
    roomStatus.textContent = "Consultando PlugNmeet…";
    try {
      const method = ["status", "recordings"].includes(action) ? "GET" : "POST";
      const query = action === "recordings" ? `?from=${from}` : "";
      const result = await request(`/plugnmeet/rooms/${roomId}/${action}${query}`, method, action === "download" ? { from, recordId } : undefined);
      if (roomOperation !== operation) return;
      if (result.url) {
        roomStatus.textContent = action === "download" ? "Descarga preparada." : "Abriendo la sala…";
        location.assign(result.url);
      } else if (action === "recordings") {
        if (!from) roomList.replaceChildren();
        for (const record of result.records) {
          const row = make("li", "", "catalog-list__item");
          const info = make("div");
          const when = record.timestamp ? new Date(record.timestamp < 1e11 ? record.timestamp * 1000 : record.timestamp) : null;
          const details = [when && Number.isFinite(+when) ? dateFormat.format(when) : "", record.bytes ? `${(record.bytes / 1048576).toFixed(1)} MB` : ""].filter(Boolean);
          info.append(make("strong", record.title || "Grabación del vivo"));
          if (details.length) info.append(make("p", details.join(" · ")));
          const download = make("button", "Descargar grabación", "admin-secondary");
          download.type = "button";
          download.addEventListener("click", () => roomAction("download", { from, recordId: record.id }));
          row.append(info, download);
          roomList.append(row);
        }
        roomList.hidden = roomCourses.hidden = !roomList.children.length;
        nextRecordingPage = result.next;
        roomMore.hidden = nextRecordingPage === null;
        roomStatus.textContent = roomList.hidden ? "Aún no hay grabaciones disponibles. Si acabas de cerrar la sala, espera a que se procese el video." : "";
      } else roomStatus.textContent = result.active ? "La sala está abierta." : "La sala está cerrada.";
    } catch (error) {
      if (roomOperation === operation) roomStatus.textContent = error.message;
    } finally {
      if (roomOperation === operation) {
        roomOperation = null;
        for (const button of controls) button.disabled = false;
      }
    }
  }
  for (const button of roomPanel.querySelectorAll("[data-room-action]")) button.addEventListener("click", () => roomAction(button.dataset.roomAction));
  roomMore.addEventListener("click", () => roomAction("recordings", { from: nextRecordingPage }));

  function setupIntegration(name, collect, secretSaved, connectedMessage) {
    const config = $(`#${name}-settings`);
    const save = config.querySelector('[type="submit"]');
    const test = $(`#${name}-test`);
    const status = $(`#${name}-status`);
    let loaded = false;
    function fill({ settings }) {
      const { room, ...fields } = settings;
      for (const [key, value] of Object.entries({ ...fields, ...room })) {
        const field = config.elements.namedItem(key);
        if (!field) continue;
        if (field.type === "checkbox") field.checked = Boolean(value);
        else field.value = value;
      }
      config.querySelector('[type="password"]').value = "";
      if (config.elements.confirmDelivery) config.elements.confirmDelivery.checked = false;
      $(`#${name}-secret-status`).textContent = secretSaved(settings) ? "Guardada. Deja este campo vacío para conservarla." : "";
      loaded = true;
    }
    function action(work) {
      save.disabled = test.disabled = true;
      return work().catch((error) => { status.textContent = error.message; }).finally(() => {
        save.disabled = test.disabled = !loaded;
      });
    }
    document.addEventListener("dashboard:view", ({ detail }) => {
      if (detail !== name || loaded) return;
      action(async () => fill(await request(`/${name}`)));
    });
    config.addEventListener("submit", (event) => {
      event.preventDefault();
      if (save.disabled) return;
      const values = collect(config);
      status.textContent = "Guardando…";
      action(async () => {
        fill(await request(`/${name}`, "PUT", values));
        status.textContent = "Configuración guardada.";
      });
    });
    test.addEventListener("click", () => {
      status.textContent = "Probando la conexión guardada…";
      action(async () => { status.textContent = connectedMessage(await request(`/${name}/test`, "POST")); });
    });
  }

  setupIntegration("waha", ({ elements }) => ({
    ...Object.fromEntries(["address", "apiKey", "session", "recipient", "siteUrl"].map((key) => [key, elements[key].value])),
    enabled: elements.enabled.checked, attachReceipt: elements.attachReceipt.checked, confirmDelivery: elements.confirmDelivery.checked,
  }), (settings) => settings.keySaved, ({ status }) => `Sesión de WhatsApp · ${status}`);
  setupIntegration("plugnmeet", (config) => {
    const { elements } = config;
    const room = Object.fromEntries([...config.querySelectorAll(".plugnmeet-options input")].map((input) => [input.name, input.checked]));
    for (const key of ["capacity", "duration", "emptyTimeout"]) room[key] = Number(elements[key].value);
    room.welcomeMessage = elements.welcomeMessage.value;
    return {
      ...Object.fromEntries(["serverUrl", "clientUrl", "apiKey", "apiSecret", "moderator", "language"].map((key) => [key, elements[key].value])),
      enabled: elements.enabled.checked, room,
    };
  }, (settings) => settings.secretSaved, () => "Conexión con PlugNmeet confirmada.");

  document.addEventListener("dashboard:view", ({ detail }) => {
    activeView = detail;
    if (detail === "academy-feed-admin") loadModeration();
    if (detail === "academy-news") request("/news").then(showNews).catch((error) => { newsStatus.textContent = error.message; });
    if (detail === "academy-referrals" && saveReferral.disabled) {
      request("/referrals").then(fillReferrals).catch((error) => { referralStatus.textContent = error.message; });
    }
  });
  referralForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saveReferral.disabled) return;
    const fields = referralForm.elements;
    const settings = {
      promo: { enabled: fields.promoEnabled.checked, code: fields.promoCode.value, percent: Number(fields.promoPercent.value) },
      invites: {
        enabled: fields.invitesEnabled.checked,
        buyerPercent: Number(fields.buyerPercent.value),
        referrerPercent: Number(fields.samePercent.checked ? fields.buyerPercent.value : fields.referrerPercent.value),
      },
    };
    saveReferral.disabled = true;
    referralStatus.textContent = "Guardando…";
    try {
      fillReferrals(await request("/referrals", "PUT", settings));
      referralStatus.textContent = "Descuentos actualizados.";
    } catch (error) { referralStatus.textContent = error.message; }
    finally { saveReferral.disabled = false; }
  });
  newsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = newsForm.querySelector("button");
    if (button.disabled) return;
    const values = new FormData(newsForm);
    const push = values.get("push") === "on";
    button.disabled = true;
    newsStatus.textContent = "";
    try {
      showNews(await request("/news", "POST", values));
      newsForm.reset();
      newsStatus.textContent = push ? "Noticia publicada. Enviando avisos a los dispositivos suscritos." : "Noticia publicada en el feed y en la campanita.";
    } catch (error) { newsStatus.textContent = error.message; }
    finally { button.disabled = false; }
  });

  request("").then((data) => {
    render(data);
    paymentsStatus.textContent = "";
    window.setInterval(async () => {
      const sections = {
        "academy-payments": ["payments", $("#academy-order-list")],
        "resumen": ["summary"],
        "academy-students": ["students", $("#academy-student-list")],
        "academy-reviews": ["reviews", reviewList],
        "academy-comments": ["comments", commentList],
      };
      const currentView = () => activeView || document.querySelector("[data-dashboard-view]:not([hidden])")?.id;
      const view = currentView();
      const context = sections[view];
      if (!context || polling || document.hidden || busy) return;
      const [section, list] = context;
      const previous = editorData;
      const editing = () => list?.contains(document.activeElement) || list?.querySelector("[data-busy]")
        || (section === "payments" && [...list.querySelectorAll("textarea, input[name=bankReference]")].some((input) => input.value.trim()));
      const stale = () => previous !== editorData || editing() || view !== currentView() || document.hidden;
      if (stale()) return;
      polling = true;
      try {
        const { token } = await request(`/changes?section=${section}`);
        if (token === previous.changeTokens?.[section] || stale()) return;
        const next = await request(`/section?section=${section}`);
        if (stale()) return;
        editorData = { ...previous, ...next, changeTokens: { ...previous.changeTokens, ...next.changeTokens } };
        if (section === "payments") {
          renderMetrics(next.metrics);
          renderOrders(next.orders);
          paymentsStatus.textContent = next.metrics.pending ? `Pagos por revisar: ${next.metrics.pending}.` : "No hay pagos por revisar.";
        } else if (section === "summary") renderMetrics(next.metrics);
        else if (section === "students") renderStudents(next.students);
        else if (section === "reviews") renderReviews(next.reviews);
        else renderCourseComments(next.courseComments);
      } catch { /* La acción de actualizar permite reintentar. */ }
      finally { polling = false; }
    }, 15000);
  }).catch((error) => {
    catalogStatus.textContent = error.message;
    $("#academy-publication").textContent = error.message;
    $("#academy-student-status").textContent = error.message;
    paymentsStatus.textContent = error.message;
    reviewStatus.textContent = error.message;
    commentStatus.textContent = error.message;
  });
})();
