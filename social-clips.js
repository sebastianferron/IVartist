(() => {
  "use strict";

  const { defaults, parseSocialClip, socialClipCover } = window.homeConfig;
  const section = document.querySelector("#clips");
  const viewport = document.querySelector("#social-clips-viewport");
  const track = document.querySelector("#social-clips-track");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let unmount;

  function createCycle(clips, repeated = false) {
    const cycle = document.createElement("ul");
    cycle.className = "social-clips__cycle";
    if (repeated) cycle.setAttribute("aria-hidden", "true");

    for (const clip of clips) {
      const card = document.createElement("li");
      card.className = "social-clips__card";
      const preview = document.createElement("a");
      preview.className = "social-clips__preview";
      preview.href = clip.url;
      preview.target = "_blank";
      preview.rel = "noopener noreferrer";
      preview.setAttribute("aria-label", clip.title ? `Ver ${clip.title} en ${clip.platform}` : `Ver clip en ${clip.platform}`);
      if (repeated) preview.tabIndex = -1;

      const poster = document.createElement("img");
      poster.className = "social-clips__poster";
      poster.src = clip.cover;
      poster.alt = "";
      poster.loading = "lazy";
      poster.decoding = "async";

      const badge = document.createElement("span");
      badge.className = "social-clips__badge";
      badge.dataset.platform = clip.key.split(":")[0];
      badge.setAttribute("aria-hidden", "true");

      const play = document.createElement("span");
      play.className = "social-clips__play";
      play.setAttribute("aria-hidden", "true");

      const caption = document.createElement("div");
      caption.className = "social-clips__caption";
      const platform = document.createElement("span");
      platform.textContent = clip.platform;
      if (clip.title) {
        const title = document.createElement("strong");
        title.textContent = clip.title;
        caption.append(title);
      }
      caption.append(platform);
      preview.append(poster, badge, play, caption);
      card.append(preview);
      cycle.append(card);
    }
    return cycle;
  }

  window.renderSocialClips = (config) => {
    unmount?.();
    unmount = undefined;
    const clips = [];
    for (const entry of Array.isArray(config.socialClips) ? config.socialClips : []) {
      const clip = parseSocialClip(entry?.url);
      if (!clip) continue;
      const cover = socialClipCover(clip, entry.cover);
      if (cover) clips.push({ ...clip, title: entry.title, cover });
    }
    track.replaceChildren();
    section.hidden = !clips.length;
    if (!clips.length) return;

    const events = new AbortController();
    const { signal } = events;
    const speed = Number(config.socialClipSpeed) || Number(defaults.socialClipSpeed);
    const original = createCycle(clips);
    track.append(original);
    viewport.scrollLeft = 0;
    let distance = 0;
    let offset = 0;
    let lastScroll = 0;
    let previousFrame;
    let frame = 0;
    let visible = false;
    let hovered = false;
    let manualUntil = 0;

    function tick(time) {
      frame = 0;
      if (viewport.scrollLeft !== lastScroll) offset = viewport.scrollLeft;
      if (previousFrame !== undefined && time >= manualUntil) {
        const travel = Math.min(time - previousFrame, 50) * speed / 1000;
        offset = ((offset - travel) % distance + distance) % distance;
        viewport.scrollLeft = offset;
      }
      lastScroll = viewport.scrollLeft;
      previousFrame = time;
      updateMotion();
    }

    function updateMotion() {
      const moving = visible && distance > 0 && !document.hidden && !reducedMotion.matches && !hovered && !viewport.querySelector(":focus-visible");
      if (moving && !frame) frame = requestAnimationFrame(tick);
      else if (!moving) {
        cancelAnimationFrame(frame);
        frame = 0;
        previousFrame = undefined;
      }
    }

    function layout() {
      const nextDistance = original.getBoundingClientRect().width;
      if (!nextDistance || !viewport.clientWidth) return;
      const progress = distance ? viewport.scrollLeft % distance / distance : 0;
      distance = nextDistance;
      const extra = reducedMotion.matches ? 0 : Math.ceil(viewport.clientWidth / distance);
      while (track.children.length > extra + 1) track.lastElementChild.remove();
      while (track.children.length < extra + 1) track.append(createCycle(clips, true));
      offset = progress * distance;
      viewport.scrollLeft = offset;
      lastScroll = viewport.scrollLeft;
      updateMotion();
    }

    viewport.addEventListener("pointerenter", (event) => {
      hovered = event.pointerType === "mouse" || event.pointerType === "pen";
      updateMotion();
    }, { signal });
    viewport.addEventListener("pointerleave", () => {
      hovered = false;
      updateMotion();
    }, { signal });
    for (const type of ["pointerdown", "touchmove", "wheel"]) {
      viewport.addEventListener(type, () => { manualUntil = performance.now() + 1800; }, { passive: true, signal });
    }
    viewport.addEventListener("focusin", updateMotion, { signal });
    viewport.addEventListener("focusout", () => queueMicrotask(updateMotion), { signal });
    document.addEventListener("visibilitychange", updateMotion, { signal });
    reducedMotion.addEventListener("change", layout, { signal });

    const resize = new ResizeObserver(layout);
    resize.observe(viewport);
    resize.observe(original);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      updateMotion();
    });
    intersection.observe(viewport);
    layout();

    unmount = () => {
      visible = false;
      updateMotion();
      events.abort();
      intersection.disconnect();
      resize.disconnect();
    };
  };
})();
