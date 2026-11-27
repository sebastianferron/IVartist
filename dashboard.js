(() => {
  "use strict";

  const main = document.querySelector("#dashboard-content");
  const menu = document.querySelector("#dashboard-menu");
  const toggle = document.querySelector("#dashboard-menu-toggle");
  const views = [...main.querySelectorAll("[data-dashboard-view]")];
  const editors = new Map(window.homeConfig.editorGroups.map(({ id, area }) => [id, area]));
  const categories = new Map([...main.querySelectorAll("[data-catalog-category]")].map((link) => [link.hash.slice(1), link.dataset.catalogCategory]));

  function resolve(id) {
    if (id === "hero-photo") return "hero";
    if (id === "academy-editor") return "catalogo-cursos";
    if (id === "editor-title") return "textos";
    if (categories.has(id) || editors.has(id) || ["textos", "configuracion"].includes(id)) return id;
    if (editors.has(`textos-${id}`)) return `textos-${id}`;
    return views.some((view) => view.id === id && view.id !== "home-settings") ? id : "resumen";
  }

  function show(resetScroll = false) {
    const id = resolve(location.hash.slice(1));
    const category = categories.get(id);
    const editSection = editors.has(id);
    const viewId = category ? "academy-editor" : editSection || ["textos", "configuracion"].includes(id) ? "home-settings" : id;
    for (const view of views) view.hidden = view.id !== viewId;
    const title = document.querySelector("#editor-title");
    const area = editors.get(id) || id;
    title.textContent = { textos: "Textos", configuracion: "Configuración", "orden-secciones": "Orden de secciones" }[area] || "Configuración de la portada";
    title.hidden = editSection;
    document.querySelector("#editor-index").hidden = id !== "textos";
    document.querySelector("#settings-index").hidden = id !== "configuracion";
    document.querySelector("#editor-workspace").hidden = !editSection;
    for (const section of document.querySelector("#editor-sections").children) section.hidden = section.id !== id;
    for (const link of document.querySelectorAll("#dashboard-menu nav a, .catalog-tabs a")) {
      const linkId = link.hash.slice(1);
      if (linkId === id) {
        link.setAttribute("aria-current", "page");
        const submenu = link.closest(".dashboard-menu-group");
        if (submenu) submenu.open = true;
      } else link.removeAttribute("aria-current");
    }
    if (category) document.dispatchEvent(new CustomEvent("dashboard:category", { detail: category }));
    document.dispatchEvent(new CustomEvent("dashboard:view", { detail: viewId }));
    if (resetScroll) {
      window.scrollTo({ top: 0, behavior: "instant" });
      main.focus({ preventScroll: true });
    }
  }

  toggle.addEventListener("click", () => {
    if (menu.open) return;
    menu.showModal();
    toggle.setAttribute("aria-expanded", "true");
  });
  menu.addEventListener("close", () => toggle.setAttribute("aria-expanded", "false"));
  menu.addEventListener("click", (event) => {
    if (event.target !== menu) return;
    const bounds = menu.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) menu.close();
  });
  document.addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href^='#']");
    if (!link || (!menu.contains(link) && !main.contains(link))) return;
    event.preventDefault();
    const id = resolve(link.hash.slice(1));
    if (location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
    if (menu.open) menu.close();
    show(true);
  });
  document.addEventListener("dashboard:editor-ready", () => show());
  window.addEventListener("hashchange", () => show(true));
  show();
})();
