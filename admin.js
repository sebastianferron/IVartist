(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  async function api(route, method = "GET", payload) {
    const options = { method };
    if (payload instanceof Blob) {
      options.body = payload;
    } else if (payload !== undefined) {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(route, options);
    if (response.status === 401 && $("#home-editor")) {
      location.replace("/admin/login");
      throw new Error("La sesión ha terminado.");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
    return data;
  }

  function setupLogin(form) {
    const status = $("#login-status");
    const button = form.querySelector("button");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      status.textContent = "";
      try {
        await api("/api/admin/login", "POST", Object.fromEntries(new FormData(form)));
        const payment = new URLSearchParams(location.search).get("payment");
        location.replace(/^[a-f0-9]{32}$/.test(payment || "") ? `/admin/dashboard?payment=${payment}#academy-payments` : "/admin/dashboard");
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  }

  async function setupDashboard(form) {
    const { fields, editorGroups, homeSections, keys, photoSource, uploadPattern, mergeHomeConfig, parseSocialClip, socialClipCover } = window.homeConfig;
    const status = $("#editor-status");
    const publishedStatus = $("#published-status");
    const submitButtons = Array.from(form.querySelectorAll("button[type=submit]"));
    const logout = $("#logout");
    let revision;
    let working = false;
    let dirty = false;
    let legacy = null;

    function formValues() {
      return Object.fromEntries(fields.map(({ key, type }) => {
        if (type === "section-order") return [key, [...$("#home-section-order").children].map(({ dataset }) => dataset.section)];
        if (type === "clips") {
          const clips = [...$("#social-clip-rows").children].map((row) => ({
            url: row.querySelector("[type=url]").value.trim(),
            title: row.querySelector("[type=text]").value.trim(),
            cover: row.dataset.cover,
          })).filter(({ url, title, cover }) => url || title || cover);
          return [key, clips];
        }
        const control = form.elements.namedItem(key);
        return [key, type === "checkbox" ? control.checked : control.value.trim()];
      }));
    }

    function fill(config) {
      const merged = mergeHomeConfig(config);
      for (const { key, type, options } of fields) {
        const value = merged[key];
        if (type === "section-order") {
          renderSectionOrder(value);
          continue;
        }
        if (type === "clips") {
          const rows = $("#social-clip-rows");
          rows.replaceChildren();
          if (Array.isArray(value)) for (const item of value) rows.append(createClipRow(item));
          continue;
        }
        const control = form.elements.namedItem(key);
        if (type === "checkbox") control.checked = Boolean(value);
        else if (key === "featuredImage" && uploadPattern.test(value)) {
          addUploadOption(control, value);
          control.value = value;
        } else if (type !== "select" || options.some(([id]) => id === value)) control.value = value;
      }
      showPhoto();
    }

    function showPhoto() {
      const selected = form.elements.featuredImage.value;
      $("#selected-photo").src = new URL(photoSource(selected), `${location.origin}/`).href;
    }

    function addUploadOption(control, id) {
      if (!Array.from(control.options).some((option) => option.value === id)) {
        control.add(new Option("Fotografía subida al hero", id));
      }
    }

    function markDirty() {
      dirty = true;
      status.textContent = "Tienes cambios por guardar.";
    }

    function renderSectionOrder(order) {
      const list = $("#home-section-order");
      const labels = new Map(homeSections);
      list.replaceChildren(...order.map((id, index) => {
        const row = document.createElement("li");
        row.dataset.section = id;
        const name = document.createElement("span");
        name.textContent = labels.get(id);
        const actions = document.createElement("div");
        actions.className = "section-order__actions";
        for (const [label, delta] of [["Subir", -1], ["Bajar", 1]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "admin-secondary";
          button.textContent = label;
          button.setAttribute("aria-label", `${label} ${name.textContent}`);
          const target = index + delta;
          button.disabled = target < 0 || target >= order.length;
          button.addEventListener("click", () => {
            const next = [...order];
            [next[index], next[target]] = [next[target], next[index]];
            renderSectionOrder(next);
            markDirty();
            const moved = list.children[target];
            const equivalent = moved.querySelector(`[aria-label="${label} ${name.textContent}"]`);
            (equivalent.disabled ? moved.querySelector("button:not(:disabled)") : equivalent)?.focus();
          });
          actions.append(button);
        }
        row.append(name, actions);
        return row;
      }));
    }

    function setWorking(value) {
      working = value;
      for (const button of submitButtons) button.disabled = value;
      $("#hero-upload").disabled = value;
      for (const input of form.querySelectorAll(".clip-editor__cover input")) input.disabled = value;
    }

    function showState(state) {
      revision = state.revision;
      const formatter = new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/La_Paz" });
      publishedStatus.textContent = state.publishedAt
        ? `Última publicación: ${formatter.format(new Date(state.publishedAt))}, hora de Bolivia.`
        : "Estás editando la configuración inicial de la portada.";
    }

    function createClipRow({ url = "", title = "", cover = "" } = {}) {
      const row = document.createElement("div");
      row.className = "clip-editor__row";
      row.dataset.cover = cover;
      const urlLabel = document.createElement("label");
      urlLabel.textContent = "Enlace del clip";
      const urlInput = document.createElement("input");
      urlInput.type = "url";
      urlInput.maxLength = 500;
      urlInput.value = url;
      urlLabel.append(urlInput);
      const titleLabel = document.createElement("label");
      titleLabel.textContent = "Título (opcional)";
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.maxLength = 90;
      titleInput.value = title;
      titleLabel.append(titleInput);
      const capture = document.createElement("div");
      capture.className = "clip-editor__cover";
      const image = document.createElement("img");
      image.alt = "Captura del clip";
      const captureLabel = document.createElement("label");
      captureLabel.textContent = "Subir captura del clip";
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      const captureStatus = document.createElement("small");
      captureStatus.setAttribute("role", "status");
      captureLabel.append(input, captureStatus);
      capture.append(image, captureLabel);

      function showCapture() {
        const source = socialClipCover(parseSocialClip(urlInput.value), row.dataset.cover);
        image.hidden = !source;
        if (source) image.src = new URL(source, `${location.origin}/`).href;
        else image.removeAttribute("src");
        captureStatus.textContent = source ? "Captura lista. Puedes reemplazarla." : "JPG, PNG o WebP de hasta 6 MB.";
      }

      const remove = document.createElement("button");
      remove.className = "admin-secondary";
      remove.type = "button";
      remove.textContent = "Quitar clip";
      remove.addEventListener("click", () => {
        row.remove();
        markDirty();
        $("#social-add-clip").focus();
      });
      row.addEventListener("input", markDirty);
      urlInput.addEventListener("input", showCapture);
      input.addEventListener("change", async () => {
        const file = input.files[0];
        if (!file || working) return;
        if (file.size > 6 * 1024 * 1024) {
          captureStatus.textContent = "La captura supera el límite de 6 MB.";
          input.value = "";
          return;
        }
        setWorking(true);
        urlInput.disabled = true;
        remove.disabled = true;
        captureStatus.textContent = "Subiendo captura…";
        try {
          const { id } = await api("/api/admin/photo", "POST", file);
          row.dataset.cover = id;
          showCapture();
          markDirty();
        } catch (error) {
          captureStatus.textContent = error.message;
        } finally {
          input.value = "";
          urlInput.disabled = false;
          remove.disabled = false;
          setWorking(false);
        }
      });
      row.append(urlLabel, titleLabel, remove, capture);
      showCapture();
      return row;
    }

    function build(group) {
      if (group.area !== "orden-secciones") {
        const isText = group.area === "textos";
        const anchor = document.createElement("a");
        anchor.href = `#${group.id}`;
        anchor.textContent = group.title;
        $(isText ? "#editor-nav" : "#settings-nav").append(anchor);
        $(isText ? "#editor-index" : "#settings-index").append(anchor.cloneNode(true));
      }

      const section = document.createElement("section");
      section.className = "editor-section";
      section.id = group.id;
      section.hidden = true;
      const title = document.createElement("h2");
      title.textContent = group.title;
      const controls = document.createElement("div");
      controls.className = "editor-fields";

      for (const field of group.fields) {
        if (field.type === "section-order") {
          const workspace = document.createElement("div");
          workspace.className = "wide-field";
          const help = document.createElement("p");
          help.textContent = "Mueve las secciones y publica los cambios para actualizar el orden de la portada.";
          const list = document.createElement("ol");
          list.id = "home-section-order";
          list.className = "section-order";
          workspace.append(help, list);
          controls.append(workspace);
          continue;
        }
        if (field.type === "clips") {
          const editor = document.createElement("div");
          editor.className = "wide-field clip-editor";
          const help = document.createElement("p");
          help.textContent = "Pega un enlace público de YouTube, Instagram o TikTok y sube una captura del clip. Al publicar, aparecen los clips que ya tienen captura.";
          const rows = document.createElement("div");
          rows.id = "social-clip-rows";
          rows.className = "clip-editor__rows";
          const add = document.createElement("button");
          add.id = "social-add-clip";
          add.className = "admin-secondary";
          add.type = "button";
          add.textContent = "Agregar clip";
          add.addEventListener("click", () => {
            const row = createClipRow();
            rows.append(row);
            row.querySelector("input").focus();
          });
          editor.append(help, rows, add);
          controls.append(editor);
          continue;
        }
        const label = document.createElement("label");
        label.append(field.label);
        const tag = field.type === "select" || field.type === "textarea" ? field.type : "input";
        const control = document.createElement(tag);
        control.name = field.key;
        if (field.max) control.maxLength = field.max;
        if (tag === "input") control.type = field.type === "link" ? "text" : field.type;
        if (field.type === "select") {
          for (const [id, name] of field.options) control.add(new Option(name, id));
        }
        if (field.type === "textarea") control.rows = 3;
        if (field.type === "checkbox") label.className = "check-field";
        if (field.type === "textarea") label.className = "wide-field";
        label.append(control);
        controls.append(label);
      }

      section.append(title, controls);
      if (group.id === "hero") {
        const upload = document.createElement("div");
        upload.className = "photo-upload";
        upload.id = "hero-photo";
        const image = document.createElement("img");
        image.id = "selected-photo";
        image.alt = "Foto seleccionada para el hero";
        const label = document.createElement("label");
        label.textContent = "Subir otra foto del hero";
        const input = document.createElement("input");
        input.id = "hero-upload";
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp";
        const help = document.createElement("small");
        help.textContent = "JPG, PNG o WebP de hasta 6 MB. Guarda el borrador para previsualizarla.";
        label.append(input, help);
        upload.append(image, label);
        section.append(upload);
        input.addEventListener("change", async () => {
          const photo = input.files[0];
          if (!photo || working) return;
          if (photo.size > 6 * 1024 * 1024) {
            status.textContent = "La foto supera el límite de 6 MB.";
            input.value = "";
            return;
          }
          setWorking(true);
          status.textContent = "Subiendo foto…";
          try {
            const { id } = await api("/api/admin/photo", "POST", photo);
            addUploadOption(form.elements.featuredImage, id);
            form.elements.featuredImage.value = id;
            showPhoto();
            markDirty();
          } catch (error) {
            status.textContent = error.message;
          } finally {
            input.value = "";
            setWorking(false);
          }
        });
      }
      $("#editor-sections").append(section);
    }

    try {
      const state = await api("/api/admin/home");
      for (const group of editorGroups) build(group);
      fill(state.draft);
      showState(state);
      $("#account-name").textContent = state.username;
      $("#session-status").textContent = `Sesión activa de ${state.username}. Puedes cerrarla desde el encabezado.`;
      $("#superadmin-status").hidden = state.role !== "superadmin";
      form.hidden = false;
      document.dispatchEvent(new Event("dashboard:editor-ready"));
      logout.disabled = false;

      if (state.revision === 0) {
        try {
          legacy = JSON.parse(localStorage.getItem(keys.draft) || localStorage.getItem(keys.published) || "null");
        } catch {}
        if (legacy) $("#import-legacy").hidden = false;
      }
    } catch (error) {
      publishedStatus.textContent = error.message;
      return;
    }

    $("#import-legacy").addEventListener("click", () => {
      fill(legacy);
      $("#import-legacy").hidden = true;
      status.textContent = "Edición anterior cargada. Guarda el borrador o publica los cambios.";
      dirty = true;
    });
    form.addEventListener("input", (event) => {
      if (event.target.name) markDirty();
    });
    form.elements.featuredImage.addEventListener("change", showPhoto);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (working) return;
      const action = event.submitter?.value || "draft";
      const config = formValues();
      setWorking(true);
      $("#editor-sections").inert = true;
      status.textContent = "Guardando…";
      try {
        const next = await api("/api/admin/home", "PUT", { config, revision, publish: action === "publish" });
        showState(next);
        dirty = false;
        $("#import-legacy").hidden = true;
        if (action === "preview") location.assign("/?preview=1");
        else status.textContent = action === "publish" ? "Cambios publicados en la portada." : "Borrador guardado.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        $("#editor-sections").inert = false;
        setWorking(false);
      }
    });

    logout.addEventListener("click", async () => {
      try {
        await api("/api/admin/logout", "POST", {});
        location.replace("/admin/login");
      } catch (error) {
        status.textContent = error.message;
      }
    });
    window.addEventListener("beforeunload", (event) => {
      if (dirty) event.preventDefault();
    });
  }

  if ($("#login-form")) setupLogin($("#login-form"));
  if ($("#home-editor")) setupDashboard($("#home-editor"));
})();
