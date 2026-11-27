(() => {
  "use strict";

  const header = document.querySelector("[data-sticky-header]");
  const links = header ? [...header.querySelectorAll('nav a[href^="#"]')] : [];
  const sections = [...document.querySelectorAll("main > section[id]")];
  const menuHashes = new Set(links.map((link) => link.hash));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const transitionsInProgress = new WeakMap();
  const menuAnimations = new WeakMap();
  let scheduled = 0;
  let activeSection;
  let pendingSection;

  function animateSection(section) {
    if (reducedMotion.matches) return;
    transitionsInProgress.get(section)?.forEach((animation) => animation.cancel());
    const items = section.classList.contains("hero")
      ? [section.querySelector(".hero__copy")]
      : [...section.children].filter((element) => !element.hidden && !element.classList.contains("section-sparkles"));
    const animations = items.filter(Boolean).map((element, index) => element.animate([
      { opacity: .48, translate: "0 20px" },
      { opacity: 1, translate: "0 0" },
    ], { duration: 640, delay: Math.min(index, 2) * 65, easing: "cubic-bezier(.22,.8,.25,1)", fill: "backwards" }));
    transitionsInProgress.set(section, animations);
  }

  function updateNavigation() {
    scheduled = 0;
    const headerBottom = header.getBoundingClientRect().bottom;
    const boundary = headerBottom + 26;
    const menuSections = document.querySelectorAll("main > section[id]");
    activeSection = [...menuSections].findLast((section) => menuHashes.has(`#${section.id}`) && !section.hidden && section.getBoundingClientRect().top <= boundary);
    for (const link of links) {
      if (link.hash === `#${activeSection?.id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    if (!pendingSection) return;
    const { section, startsAt } = pendingSection;
    const { top, bottom } = section.getBoundingClientRect();
    const root = document.scrollingElement;
    const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
    const atAnchor = top >= headerBottom - 30 && top <= boundary + 46;
    const atStart = section.id === "inicio" && root.scrollTop <= 2 && top <= boundary;
    if (bottom > headerBottom && (atStart || atAnchor || (atEnd && top < innerHeight - 40))) {
      pendingSection = undefined;
      menuAnimations.set(section, performance.now());
      animateSection(section);
    } else if (performance.now() - startsAt < 2200) {
      scheduled = requestAnimationFrame(updateNavigation);
    } else pendingSection = undefined;
  }

  if (header) {
    const measureHeader = () => {
      document.documentElement.style.setProperty("--nav-offset", `${Math.ceil(header.getBoundingClientRect().height)}px`);
      if (links.length && !scheduled) scheduled = requestAnimationFrame(updateNavigation);
    };
    new ResizeObserver(measureHeader).observe(header);
    measureHeader();
  }

  if (links.length) {
    document.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href^="#"]');
      if (!link || event.defaultPrevented || link.target) return;
      const destination = sections.find((section) => link.hash === `#${section.id}`);
      if (!destination) return;
      if (reducedMotion.matches) return;
      pendingSection = { section: destination, startsAt: performance.now() };
      if (!scheduled) scheduled = requestAnimationFrame(updateNavigation);
    });
    window.addEventListener("scroll", () => {
      if (!scheduled) scheduled = requestAnimationFrame(updateNavigation);
    }, { passive: true });
  }

  const transitions = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !pendingSection && performance.now() - (menuAnimations.get(entry.target) ?? -Infinity) > 800) {
        animateSection(entry.target);
      }
    }
  }, { rootMargin: "0px 0px -11% 0px" });

  for (const section of document.querySelectorAll("main > section:not(.hero), .academy-intro, .academy-columns > section")) {
    transitions.observe(section);
  }

  const editor = document.querySelector("#editor-sections");
  if (editor) {
    for (const section of editor.children) transitions.observe(section);
    new MutationObserver((entries) => {
      for (const { addedNodes, removedNodes } of entries) {
        for (const section of addedNodes) if (section instanceof HTMLElement) transitions.observe(section);
        for (const section of removedNodes) if (section instanceof HTMLElement) transitions.unobserve(section);
      }
    }).observe(editor, { childList: true });
  }
})();
