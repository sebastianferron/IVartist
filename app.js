(() => {
  "use strict";

  const { defaults, photos, plans, photoSource, uploadPattern, communityCountries, interestOptions, mergeHomeConfig, normalizeWhatsAppNumber, zonedDateTimeToDate } = window.homeConfig;
  const payment = window.academyPayment;
  const { setAvatar, socialLinks } = window.communityProfile;
  const $ = (selector) => document.querySelector(selector);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const localServer = "http://127.0.0.1:4187";
  const homeQuery = new URLSearchParams(location.search);
  const preview = homeQuery.get("preview") === "1";
  let retryOffer = homeQuery.get("inscripcion");
  let activeConfig = defaults;
  let currentStudent = null;
  let paymentOffers = [];
  let catalogSignature = "";
  let ribbon;
  let planPhotos;
  let countdownTimer;
  let subscriptionLiveTimer;
  let lastAnnouncedMinute;

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value || "";
  }

  function safeHref(value, fallback = "#") {
    const href = (value || "").trim();
    if (!href) return fallback;
    if (/^#[a-z][\w-]*$/i.test(href) || (/^\/(?![\/\\])/.test(href) && !/[\u0000-\u0020\\]/u.test(href)) || /^https?:\/\/[^\s\\]+$/i.test(href)) {
      return href;
    }
    return fallback;
  }

  function render(config, { preview = false } = {}) {
    activeConfig = mergeHomeConfig(config);
    applySectionOrder();
    const motionMap = { "0": "0.72", "1": "1", "2": "1.3" };
    document.documentElement.style.setProperty("--motion-multiplier", motionMap[activeConfig.motionIntensity] || "1");

    document.title = activeConfig.pageTitle;
    $('meta[name="description"]').content = activeConfig.pageDescription;
    for (const element of document.querySelectorAll("[data-copy]")) {
      element.textContent = activeConfig[element.dataset.copy];
    }
    const interests = communityForm.elements.interest;
    const selectedInterest = interests.value;
    const options = interestOptions(activeConfig);
    interests.replaceChildren(interests.options[0], ...options.map((interest) => new Option(interest, interest)));
    interests.value = options.includes(selectedInterest) ? selectedInterest : "";
    renderStudentAccount();
    setText("#countdown-timezone", activeConfig.countdownTimezoneText || timezoneLabel(activeConfig.countdownTimezone));
    const whatsapp = $("#whatsapp-contact");
    const contactNumber = normalizeWhatsAppNumber(activeConfig.whatsappNumber);
    whatsapp.hidden = !contactNumber;
    if (contactNumber) whatsapp.href = `https://wa.me/${contactNumber}`;
    else whatsapp.removeAttribute("href");

    renderPhotos(activeConfig.featuredImage);
    renderPlans();
    window.renderSocialClips(activeConfig);
    renderRibbon();
    renderSparkles();
    startCountdown();
    $("#preview-flag").classList.toggle("is-visible", preview);
  }

  function applySectionOrder() {
    const main = $("#contenido");
    const sections = activeConfig.sectionOrder.map((id) => document.getElementById(id));
    if (sections.every((section, index) => main.children[index] === section)) return;
    main.append(...sections);
    const target = document.getElementById(location.hash.slice(1));
    if (target && main.contains(target)) {
      requestAnimationFrame(() => target.scrollIntoView({ block: "start", behavior: "instant" }));
    }
  }

  function renderSparkles() {
    const strength = { "0": 0, "1": 0.28, "2": 0.42, "3": 0.58 }[activeConfig.sparkleIntensity] ?? 0.28;
    const period = Number(activeConfig.sparkleSpeed) || Number(defaults.sparkleSpeed);
    const accents = [
      [5, 19, 13, 0.44], [7, 74, 10, 0.19], [24, 11, 12, 0.64], [32, 85, 8, 0.32],
      [51, 10, 13, 0.81], [68, 88, 10, 0.53], [82, 18, 8, 0.26], [94, 28, 14, 0.69], [95, 78, 11, 0.08],
    ];
    const aboutAccents = [
      [5, 17, 19, 0.12, "crescent"], [4, 51, 9, 0.61, "star"], [5, 78, 14, 0.76, "moon"],
      [20, 8, 11, 0.43, "star"], [38, 12, 8, 0.23, "star"], [60, 11, 23, 0.66, "moon"],
      [76, 17, 9, 0.34, "star"], [91, 24, 23, 0.53, "crescent"], [94, 57, 12, 0.8, "star"],
      [91, 82, 18, 0.21, "moon"], [67, 90, 11, 0.7, "star"], [32, 92, 14, 0.46, "crescent"],
    ];
    for (const [index, id] of ["inicio", "subscripciones", "comunidad", "clips", "quien-soy", "cursos", "resenas"].entries()) {
      const block = document.getElementById(id);
      block.querySelector(":scope > .section-sparkles")?.remove();
      block.classList.toggle("has-section-sparkles", Boolean(strength));
      if (!strength) continue;
      const layer = document.createElement("div");
      layer.className = "section-sparkles";
      layer.setAttribute("aria-hidden", "true");
      layer.style.setProperty("--sparkle-strength", strength);
      const details = id === "quien-soy" ? aboutAccents : accents;
      for (const [x, y, size, phase, shape] of details) {
        const detail = document.createElement("span");
        if (shape) detail.dataset.shape = shape;
        detail.style.left = `${x}%`;
        detail.style.top = `${y}%`;
        detail.style.setProperty("--sparkle-size", `${size}px`);
        detail.style.animationDuration = `${period * (1 + phase * 0.38)}s`;
        detail.style.animationDelay = `${-period * (phase + index * 0.13)}s`;
        layer.append(detail);
      }
      block.prepend(layer);
    }
  }

  let nextReviewPage = 1;
  async function loadReviews() {
    const button = $("#reviews-more");
    const feedback = $("#reviews-feedback");
    if (button.disabled || !nextReviewPage) return;
    button.disabled = true;
    feedback.textContent = "";
    try {
      const { reviews, nextPage } = await payment.request(`/reviews?page=${nextReviewPage}`);
      const list = $("#reviews-list");
      for (const { course, name, rating, comment, demo, profile } of reviews) {
        const card = document.createElement("li");
        card.className = "review-card";
        const heading = document.createElement("h3");
        heading.textContent = course;
        const score = document.createElement("span");
        score.className = "review-card__rating";
        score.setAttribute("role", "img");
        score.setAttribute("aria-label", `${rating} de 5 estrellas`);
        const emptyStars = document.createElement("span");
        emptyStars.textContent = "☆".repeat(5 - rating);
        score.append("★".repeat(rating), emptyStars);
        const quote = document.createElement("blockquote");
        quote.textContent = comment;
        const attribution = document.createElement("div");
        attribution.className = "review-card__attribution";
        const author = document.createElement(profile?.url ? "a" : "span");
        author.className = "review-card__author";
        if (profile?.url) author.href = profile.url;
        const avatar = document.createElement("img");
        avatar.className = "profile-avatar";
        avatar.alt = "";
        avatar.loading = "lazy";
        setAvatar(avatar, profile?.avatar);
        author.append(avatar, demo ? activeConfig.reviewsDemoLabel : name);
        attribution.append(author);
        if (profile?.socials.length) attribution.append(socialLinks(profile.socials));
        card.append(heading, score, quote, attribution);
        list.append(card);
      }
      nextReviewPage = nextPage;
      button.hidden = !nextPage;
      $("#reviews-empty").hidden = list.children.length > 0;
    } catch {
      feedback.textContent = "No se pudieron cargar las reseñas.";
    } finally {
      button.disabled = false;
    }
  }

  function renderPhotos(featuredId) {
    const selected = photos.find((photo) => photo.id === featuredId);
    const featured = selected || (uploadPattern.test(featuredId)
      ? { id: featuredId, focal: "50% 32%", mobile: "50% 28%" }
      : photos.find((photo) => photo.id === defaults.featuredImage));
    const media = $("#hero-media");
    const image = media.querySelector("img");
    media.dataset.photo = featured.id;
    const source = photoSource(featured.id);
    if (image.getAttribute("src") !== source) image.src = source;
    image.style.setProperty("--focal", featured.focal);
    image.style.setProperty("--focal-mobile", featured.mobile);

    const available = photos.filter((photo) => photo.id !== featured.id);
    const portrait = available.find((photo) => photo.id === activeConfig.aboutImage)
      || available.find((photo) => photo.id === "editorial")
      || available.find((photo) => photo.id === "bolivia");
    $("#about-photo").replaceChildren(contentPhoto(portrait));
    $("#portfolio").replaceChildren(...available.filter((photo) => photo !== portrait).map((photo) => {
      const card = document.createElement("article");
      card.className = "course-card";
      const example = document.createElement("figure");
      example.className = "course-card__example";
      const frame = document.createElement("div");
      frame.className = "course-card__image-frame";
      frame.append(contentPhoto(photo));
      example.append(frame);
      const sampleTitle = activeConfig[`photoTitle-${photo.id}`];
      const courseTitle = activeConfig[`courseTitle-${photo.id}`] || sampleTitle;
      if (sampleTitle && sampleTitle !== courseTitle) {
        const caption = document.createElement("figcaption");
        caption.textContent = sampleTitle;
        example.append(caption);
      }
      const info = document.createElement("div");
      info.className = "course-card__info";
      const title = document.createElement("h3");
      title.textContent = courseTitle;
      info.append(title);
      const copy = activeConfig[`courseCopy-${photo.id}`];
      if (copy) {
        const description = document.createElement("p");
        description.textContent = copy;
        info.append(description);
      }
      card.append(example, info);
      return card;
    }));
  }

  function contentPhoto(photo) {
    const image = document.createElement("img");
    image.src = photoSource(photo.id);
    image.alt = activeConfig[`photoAlt-${photo.id}`];
    image.loading = "lazy";
    image.decoding = "async";
    image.style.objectPosition = photo.mobile;
    return image;
  }

  function publishedSubscriptionOffers() {
    return paymentOffers.filter(({ id }) => id.startsWith("oferta-"));
  }

  function renderPlans(published = publishedSubscriptionOffers()) {
    const cards = [];
    for (const { id } of plans) {
      const plan = (field) => activeConfig[`${id}-${field}`];
      if (!plan("enabled")) continue;

      const article = document.createElement("article");
      article.className = "subscription-plan";
      const cover = document.createElement("div");
      cover.className = "subscription-plan__cover";
      const photo = photos.find((item) => item.id === plan("photo"));
      const image = contentPhoto(photo);
      const photoButton = document.createElement("button");
      photoButton.type = "button";
      photoButton.className = "subscription-plan__photo";
      photoButton.setAttribute("aria-label", `Mostrar en color: ${plan("name")}`);
      photoButton.setAttribute("aria-pressed", "false");
      photoButton.append(image);
      const title = document.createElement("h3");
      title.textContent = plan("name");
      cover.append(photoButton, title);

      const benefits = document.createElement("dl");
      benefits.className = "subscription-plan__benefits";
      for (const benefit of ["first", "second"]) {
        if (!plan(`${benefit}-title`) && !plan(`${benefit}-detail`)) continue;
        const row = document.createElement("div");
        const heading = document.createElement("dt");
        heading.textContent = plan(`${benefit}-title`);
        const detail = document.createElement("dd");
        detail.textContent = plan(`${benefit}-detail`);
        row.append(heading, detail);
        benefits.append(row);
      }
      const price = document.createElement("p");
      price.className = "subscription-plan__price";
      price.dataset.purchasePrice = id;

      const action = document.createElement("a");
      action.className = "subscription-plan__action";
      action.href = "#comunidad";
      action.dataset.purchase = id;
      action.dataset.purchaseTitle = plan("name");
      action.setAttribute("aria-haspopup", "dialog");
      appendRollingLabel(action, plan("cta") || defaults[`${id}-cta`]);
      article.append(cover, benefits, price, action);
      cards.push(article);
    }
    planPhotos?.abort();
    const liveAction = $("#subscription-live-action");
    liveAction.dataset.purchase = "live";
    liveAction.dataset.purchaseTitle = activeConfig.countdownTitle;
    liveAction.setAttribute("aria-haspopup", "dialog");
    liveAction.hidden = !activeConfig.subscriptionLiveCta;
    liveAction.replaceChildren();
    if (!liveAction.hidden) {
      appendRollingLabel(liveAction, activeConfig.subscriptionLiveCta);
    }
    const featured = $("#subscription-live");
    const liveCards = [featured];
    const otherCards = [];
    for (const offer of published) {
      (offer.category === "live" ? liveCards : otherCards).push(subscriptionOfferCard(offer));
    }
    const planMiddle = Math.floor(cards.length / 2);
    const offerMiddle = Math.floor(otherCards.length / 2);
    $("#subscription-plans").replaceChildren(
      ...cards.slice(0, planMiddle), ...otherCards.slice(0, offerMiddle),
      ...liveCards,
      ...otherCards.slice(offerMiddle), ...cards.slice(planMiddle),
    );
    catalogSignature = JSON.stringify(published);
    renderPlanPrices();
    planPhotos = setupPlanPhotos();
    requestAnimationFrame(centerSubscriptionLiveCards);
  }

  function renderPlanPrices() {
    for (const element of document.querySelectorAll("[data-purchase-price]")) {
      const id = element.dataset.purchasePrice;
      const offer = paymentOffers.find((item) => item.id === id);
      const price = offer ? payment.price.format(offer.cents / 100) : activeConfig[`${id}-price`];
      element.textContent = price || activeConfig.subscriptionPricePending;
      element.hidden = id === "live" && !price;
      element.classList.toggle("subscription-plan__price--pending", !price);
    }
  }

  function subscriptionOfferCard(offer) {
    const live = offer.category === "live";
    const card = document.createElement("article");
    card.className = live ? "subscription-live" : "subscription-plan subscription-offer";
    const cover = document.createElement("div");
    cover.className = live ? "subscription-live__cover" : "subscription-plan__cover";
    const photo = photos.find(({ id }) => id === offer.cover);
    if (offer.coverUrl) {
      const image = document.createElement("img");
      image.src = offer.coverUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      cover.append(image);
    } else if (photo) cover.append(contentPhoto(photo));
    if (live) {
      const badge = document.createElement("span");
      badge.className = "subscription-live__badge";
      badge.textContent = activeConfig.subscriptionLiveBadge || defaults.subscriptionLiveBadge;
      cover.append(badge);
    }
    const title = document.createElement("h3");
    title.textContent = offer.title;
    cover.append(title);
    const info = document.createElement("div");
    info.className = live ? "subscription-live__info" : "subscription-offer__info";
    const zone = "America/La_Paz";
    const date = live && offer.startsAt ? zonedDateTimeToDate(offer.startsAt, zone) : null;
    if (date && Number.isFinite(+date)) {
      const schedule = document.createElement("div");
      schedule.className = "subscription-live__schedule";
      const time = document.createElement("time");
      time.dateTime = date.toISOString();
      time.textContent = new Intl.DateTimeFormat("es-BO", { dateStyle: "long", timeStyle: "short", hour12: false, timeZone: zone }).format(date);
      const timezone = document.createElement("span");
      timezone.textContent = timezoneLabel(zone);
      schedule.append(time, timezone);
      info.append(schedule);
    }
    const description = document.createElement("p");
    if (live) description.className = "subscription-live__description";
    description.textContent = offer.description;
    info.append(description);
    if (offer.category === "course" && offer.chapterCount > 0) {
      const chapters = document.createElement("p");
      chapters.className = "subscription-offer__chapters";
      chapters.textContent = `${offer.chapterCount} ${offer.chapterCount === 1 ? "capítulo" : "capítulos"}`;
      info.append(chapters);
    }
    const amount = document.createElement("p");
    amount.className = "subscription-plan__price subscription-offer__price";
    amount.textContent = payment.price.format(offer.cents / 100);
    const action = document.createElement("a");
    action.className = live ? "subscription-plan__action subscription-live__action" : "subscription-plan__action";
    action.href = "#comunidad";
    action.dataset.purchase = offer.id;
    action.dataset.purchaseTitle = offer.title;
    action.setAttribute("aria-haspopup", "dialog");
    appendRollingLabel(action, offer.demo ? "Probar inscripción" : live ? "Inscribirme" : "Pagar curso");
    if (live) {
      info.append(amount);
      card.append(cover, info, action);
    } else card.append(cover, info, amount, action);
    return card;
  }

  function updateSubscriptionNavigation() {
    const row = $("#subscription-plans");
    const navigation = $("#subscription-navigation");
    const remaining = row.scrollWidth - row.clientWidth - row.scrollLeft;
    navigation.hidden = row.scrollWidth - row.clientWidth <= 2;
    navigation.firstElementChild.setAttribute("aria-disabled", String(row.scrollLeft <= 2));
    navigation.lastElementChild.setAttribute("aria-disabled", String(remaining <= 2));
  }

  function centerSubscriptionLiveCards() {
    const row = $("#subscription-plans");
    const liveCards = [...row.querySelectorAll(".subscription-live:not([hidden])")];
    if (liveCards.length && row.scrollWidth > row.clientWidth) {
      const first = liveCards[0].getBoundingClientRect();
      const last = liveCards.at(-1).getBoundingClientRect();
      const viewport = row.getBoundingClientRect();
      const right = last.right - first.left <= row.clientWidth ? last.right : first.right;
      row.scrollBy({ left: (first.left + right - viewport.left - viewport.right) / 2, behavior: "instant" });
    }
    updateSubscriptionNavigation();
  }

  function appendRollingLabel(action, label) {
    const mask = document.createElement("span");
    mask.className = "subscription-plan__action-mask";
    const original = document.createElement("span");
    original.textContent = label;
    const duplicate = original.cloneNode(true);
    duplicate.setAttribute("aria-hidden", "true");
    mask.append(original, duplicate);

    const arrow = document.createElement("span");
    arrow.className = "subscription-plan__arrow";
    arrow.setAttribute("aria-hidden", "true");
    const track = document.createElement("span");
    for (let copy = 0; copy < 2; copy += 1) {
      const glyph = document.createElement("span");
      glyph.textContent = "→";
      track.append(glyph);
    }
    arrow.append(track);
    action.append(mask, arrow);
  }

  function setupPlanPhotos() {
    const section = $("#subscripciones");
    const reset = $("#subscription-reset");
    const buttons = [...section.querySelectorAll(".subscription-plan__photo")];
    const coarse = window.matchMedia("(any-pointer: coarse)");
    const events = new AbortController();
    const { signal } = events;
    let selected = null;
    let preview = null;

    function update() {
      for (const button of buttons) {
        button.classList.toggle("is-in-color", button === (preview || selected));
        button.setAttribute("aria-pressed", String(button === selected));
      }
      reset.hidden = !buttons.length || (!coarse.matches && !selected);
    }

    function clear() {
      selected = null;
      preview = null;
      update();
    }

    for (const button of buttons) {
      button.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "mouse") return;
        selected = null;
        preview = button;
        update();
      }, { signal });
      const endPreview = () => {
        if (preview !== button) return;
        preview = null;
        update();
      };
      button.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "mouse") endPreview();
      }, { signal });
      button.addEventListener("pointercancel", endPreview, { signal });
      button.addEventListener("focus", () => {
        if (!button.matches(":focus-visible")) return;
        if (selected !== button) selected = null;
        preview = button;
        update();
      }, { signal });
      button.addEventListener("blur", endPreview, { signal });
      button.addEventListener("click", (event) => {
        if (event.pointerType === "mouse") return;
        selected = selected === button ? null : button;
        preview = null;
        update();
      }, { signal });
    }
    reset.addEventListener("click", () => {
      const hadSelection = selected;
      clear();
      if (reset.hidden && hadSelection) {
        hadSelection.focus({ preventScroll: true });
        clear();
      }
    }, { signal });
    section.addEventListener("focusout", (event) => {
      if (!section.contains(event.relatedTarget)) clear();
    }, { signal });
    coarse.addEventListener("change", update, { signal });
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) events.abort();
    }, { signal });
    update();
    return events;
  }

  function renderRibbon() {
    const announcement = $("#announcement");
    const message = activeConfig.announcementText.trim();
    ribbon?.destroy();
    ribbon = null;
    announcement.hidden = !activeConfig.announcementEnabled || !message;
    $("#inicio").classList.toggle("has-announcement", !announcement.hidden);
    setText("#announcement-readable", message);
    if (!announcement.hidden) ribbon = mountRibbon(announcement, message);
  }

  function mountRibbon(announcement, message) {
    const hero = $("#inicio");
    const svg = $("#announcement-ribbon");
    const band = $("#announcement-band");
    const paths = $("#announcement-paths");
    const track = $("#announcement-track");
    const measure = $("#announcement-measure");
    const events = new AbortController();
    const namespace = "http://www.w3.org/2000/svg";
    let rows = [];
    let start = 0;
    let distance = 1;
    let travel = 0;
    let desired = 0;
    let progress;
    let visible = false;
    let frame = 0;
    let lastTime;

    function textWidth(value) {
      measure.textContent = value;
      return measure.getComputedTextLength();
    }

    function wrapText(lineLimit) {
      const lines = [];
      let line = "";
      for (const word of message.toLocaleUpperCase("es").split(/\s+/)) {
        const combined = line ? `${line} ${word}` : word;
        if (textWidth(combined) <= lineLimit) {
          line = combined;
          continue;
        }
        if (line) lines.push(line);
        line = word;
        if (textWidth(word) <= lineLimit) continue;
        // Split a long unbroken label without losing or shrinking its characters.
        line = "";
        const glyphs = new Intl.Segmenter("es", { granularity: "grapheme" }).segment(word);
        for (const { segment } of glyphs) {
          if (line && textWidth(line + segment) > lineLimit) {
            lines.push(line);
            line = "";
          }
          line += segment;
        }
      }
      if (line) lines.push(line);
      return lines;
    }

    function draw() {
      // Preserve the 28% → 6% mapping and fit its travel to the space available around the copy.
      const offset = (0.28 - 0.22 * progress - 0.17) * travel / 0.22;
      for (const { element, center } of rows) {
        element.setAttribute("startOffset", (center + offset).toFixed(3));
      }
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = undefined;
    }

    function tick(time) {
      frame = 0;
      const dt = Math.max(0, Math.min(0.1, (time - lastTime) / 1000));
      lastTime = time;
      progress += (desired - progress) * (1 - Math.exp(-dt / 0.14));
      if (Math.abs(desired - progress) <= 0.0001) progress = desired;
      draw();
      if (progress !== desired) frame = requestAnimationFrame(tick);
      else lastTime = undefined;
    }

    function syncScroll() {
      desired = Math.max(0, Math.min(1, (scrollY - start) / distance));
      if (progress === undefined || reducedMotion.matches) {
        stop();
        if (progress !== desired) {
          progress = desired;
          draw();
        }
      }
      if (!visible || document.hidden || reducedMotion.matches || progress === desired || frame) return;
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    }

    function layout() {
      const { width, height, top, bottom } = announcement.getBoundingClientRect();
      if (!width || !height) return;
      const viewport = document.documentElement.clientHeight;
      // The hero already provides the scroll distance. End with the ribbon still in view.
      start = Math.max(hero.getBoundingClientRect().top + scrollY, top + scrollY - viewport * 0.88);
      distance = Math.max(1, bottom + scrollY - viewport * 0.12 - start);

      const edge = Math.max(16, width * 0.04);
      travel = Math.min(180, width * 0.2);
      const lines = wrapText(width - 2 * edge - travel);
      const lineHeight = parseFloat(getComputedStyle(measure).fontSize) * 1.18;
      const stroke = Math.min(height - 12, Math.max(58, Math.min(84, width * 0.054), lines.length * lineHeight + 20));
      // This curve reaches about 80% of the control-point excursion. Leave room for its stroke.
      const bend = Math.min(height * 0.44, ((height - stroke) / 2 - 5) / 0.82);
      const curve = (y) => `M -48 ${y} C ${width * 0.14} ${y + bend}, ${width * 0.34} ${y + bend}, ${width * 0.53} ${y} S ${width * 0.82} ${y - bend}, ${width + 48} ${y - bend * 0.25}`;

      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.style.setProperty("--ribbon-stroke", `${stroke}px`);
      band.setAttribute("d", curve(height / 2));
      paths.replaceChildren();
      track.replaceChildren();
      rows = lines.map((line, index) => {
        const path = document.createElementNS(namespace, "path");
        path.id = `announcement-line-${index}`;
        path.setAttribute("d", curve(height / 2 + (index - (lines.length - 1) / 2) * lineHeight));
        paths.append(path);

        const text = document.createElementNS(namespace, "text");
        const element = document.createElementNS(namespace, "textPath");
        element.setAttribute("href", `#${path.id}`);
        element.textContent = line;
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "central");
        text.append(element);
        track.append(text);

        return { element, center: path.getTotalLength() / 2 };
      });
      if (lines.length === 1 && width >= 1000) {
        const [{ element, center }] = rows;
        const gap = textWidth(lines[0]) + edge;
        for (const direction of [-1, 1]) {
          const copy = element.cloneNode();
          copy.textContent = direction < 0 ? `${lines[0]}  ✦` : `✦  ${lines[0]}`;
          element.parentElement.append(copy);
          rows.push({ element: copy, center: center + direction * gap });
        }
      }
      syncScroll();
      draw();
      announcement.classList.add("is-ready");
    }

    const resize = new ResizeObserver(layout);
    resize.observe(hero);
    resize.observe(announcement);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) syncScroll();
      else stop();
    });
    intersection.observe(announcement);
    window.addEventListener("scroll", syncScroll, { passive: true, signal: events.signal });
    window.addEventListener("resize", layout, { signal: events.signal });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else syncScroll();
    }, { signal: events.signal });
    reducedMotion.addEventListener("change", syncScroll, { signal: events.signal });
    window.addEventListener("pagehide", (event) => event.persisted ? stop() : destroy(), { signal: events.signal });
    window.addEventListener("pageshow", layout, { signal: events.signal });
    document.fonts.ready.then(() => {
      if (!events.signal.aborted) layout();
    });
    layout();

    function destroy() {
      stop();
      events.abort();
      resize.disconnect();
      intersection.disconnect();
      announcement.classList.remove("is-ready");
    }
    return { destroy };
  }

  function formatEventDate(date, timeZone) {
    if (Number.isNaN(date.getTime())) return "FECHA POR CONFIRMAR";
    try {
      const formatted = new Intl.DateTimeFormat("es-BO", {
        timeZone,
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
      return formatted.replace(/\./g, "").replace(",", " ·").toLocaleUpperCase("es-BO");
    } catch (_error) {
      return "FECHA POR CONFIRMAR";
    }
  }

  function timezoneLabel(timeZone) {
    const names = {
      "America/La_Paz": "HORA BOLIVIA · GMT−4",
      "America/Lima": "HORA PERÚ · GMT−5",
      "America/Argentina/Buenos_Aires": "HORA ARGENTINA · GMT−3",
      "America/Mexico_City": "HORA CIUDAD DE MÉXICO",
    };
    return names[timeZone] || timeZone.replaceAll("_", " ").toLocaleUpperCase("es");
  }

  function startCountdown() {
    window.clearInterval(countdownTimer);
    lastAnnouncedMinute = null;
    const card = $("#countdown-card");
    card.hidden = !activeConfig.countdownEnabled;
    updateCourseLinks();
    const target = zonedDateTimeToDate(activeConfig.countdownTarget, activeConfig.countdownTimezone);
    renderSubscriptionLive(target);
    if (card.hidden) return;

    setText("#countdown-date", formatEventDate(target, activeConfig.countdownTimezone));

    const tick = () => {
      const distance = target.getTime() - Date.now();
      if (!Number.isFinite(distance)) {
        setText("#countdown-live", "La fecha del próximo curso todavía no está confirmada.");
        return;
      }

      if (distance <= 0) {
        ["days", "hours", "minutes", "seconds"].forEach((id) => setText(`#${id}`, "00"));
        handleCountdownEnd(card);
        return false;
      }

      card.hidden = false;
      $("#countdown").hidden = false;
      const days = Math.floor(distance / 86400000);
      const hours = Math.floor((distance % 86400000) / 3600000);
      const minutes = Math.floor((distance % 3600000) / 60000);
      const seconds = Math.floor((distance % 60000) / 1000);
      setText("#days", String(days).padStart(2, "0"));
      setText("#hours", String(hours).padStart(2, "0"));
      setText("#minutes", String(minutes).padStart(2, "0"));
      setText("#seconds", String(seconds).padStart(2, "0"));

      const minuteKey = `${days}-${hours}-${minutes}`;
      if (minuteKey !== lastAnnouncedMinute) {
        lastAnnouncedMinute = minuteKey;
        setText("#countdown-live", `Faltan ${days} días, ${hours} horas y ${minutes} minutos para ${activeConfig.countdownTitle}.`);
      }
      return true;
    };

    if (tick()) {
      countdownTimer = window.setInterval(() => {
        if (!tick()) window.clearInterval(countdownTimer);
      }, 1000);
    }
  }

  function renderSubscriptionLive(target) {
    window.clearTimeout(subscriptionLiveTimer);
    const card = $("#subscription-live");
    const zone = activeConfig.countdownTimezone;
    const end = activeConfig.subscriptionLiveEndsAt ? zonedDateTimeToDate(activeConfig.subscriptionLiveEndsAt, zone) : target;
    const remaining = Number(end) - Date.now();
    const hidden = !(activeConfig.subscriptionLiveEnabled && activeConfig.countdownEnabled && Number.isFinite(+target) && remaining > 0);
    if (card.hidden !== hidden) {
      card.hidden = hidden;
      requestAnimationFrame(centerSubscriptionLiveCards);
    }
    if (card.hidden) return;

    const time = $("#subscription-live-date");
    time.dateTime = target.toISOString();
    time.textContent = new Intl.DateTimeFormat("es-BO", { dateStyle: "long", timeStyle: "short", hour12: false, timeZone: zone }).format(target);
    setText("#subscription-live-zone", activeConfig.countdownTimezoneText || timezoneLabel(zone));
    subscriptionLiveTimer = window.setTimeout(() => renderSubscriptionLive(target), Math.min(remaining, 2147483647));
  }

  function handleCountdownEnd(card) {
    if (activeConfig.countdownEndBehavior === "hide") {
      card.hidden = true;
      updateCourseLinks();
      return;
    }
    $("#countdown").hidden = true;
    if (activeConfig.countdownEndBehavior === "closed") {
      setText("#countdown-title", activeConfig.countdownClosedTitle);
      setText("#countdown-subtitle", activeConfig.countdownClosedCopy);
      setText("#countdown-live", activeConfig.countdownClosedTitle);
    } else {
      setText("#countdown-title", activeConfig.countdownStartedTitle);
      setText("#countdown-subtitle", activeConfig.countdownStartedCopy);
      setText("#countdown-live", activeConfig.countdownStartedTitle);
    }
  }

  function updateCourseLinks() {
    const courseHidden = $("#countdown-card").hidden;
    $(".course-position").hidden = courseHidden;
    for (const [selector, value, fallback, label] of [
      ["#primary-cta", activeConfig.primaryHref, "#subscripciones", activeConfig.primaryText],
      ["#secondary-cta", activeConfig.secondaryHref, "#cursos", activeConfig.secondaryText],
      ["#announcement-link", activeConfig.announcementHref, "#proximo-curso", activeConfig.announcementText],
      ["#subscriptions-cta", activeConfig.subscriptionsHref, "#cursos", activeConfig.subscriptionsCta],
      ["#next-course-link", activeConfig.coursesHref, "#subscripciones", activeConfig.coursesCta],
      ["#academy-home-link", activeConfig.academyHref, "/mi-espacio", activeConfig.academyCta],
      ["#countdown-cta", activeConfig.countdownButtonHref, "#subscripciones", activeConfig.countdownButtonText],
    ]) {
      const href = safeHref(value, fallback);
      const link = $(selector);
      const missingCourse = courseHidden && href === "#proximo-curso";
      link.href = missingCourse ? "#cursos" : href;
      link.hidden = !label || (missingCourse && selector === "#next-course-link");
    }
  }

  function positionCourseAnchor() {
    if (location.hash === "#proximo-curso" && !$("#countdown-card").hidden) {
      $("#proximo-curso").scrollIntoView({ behavior: "instant" });
    }
  }

  async function loadHome() {
    const status = $("#home-status");
    function showFallback(message) {
      render({ ...defaults, announcementEnabled: false, countdownEnabled: false });
      status.hidden = false;
      status.textContent = message;
    }
    if (location.protocol === "file:") {
      $("#admin-lock").href = `${localServer}/admin`;
      showFallback("Vista local sin conexión a la publicación. Consulta el sitio para ver las fechas vigentes.");
      return;
    }

    try {
      const response = await fetch(preview ? "/api/home?preview=1" : "/api/home");
      if (preview && response.status === 401) {
        location.replace("/admin/login");
        return;
      }
      if (!response.ok) throw new Error("No se pudo cargar la portada.");
      render(await response.json(), { preview });
      status.hidden = true;
      status.textContent = "";
    } catch {
      if (["127.0.0.1", "localhost"].includes(location.hostname) && location.port === "4173") {
        location.replace(`${localServer}${location.pathname}${location.search}${location.hash}`);
        return;
      }
      showFallback(preview
        ? "No pudimos cargar el borrador. Se muestra una vista de respaldo."
        : "No pudimos cargar la portada publicada. Se muestra una vista de respaldo. Recarga la página para consultar las fechas vigentes.");
    }
  }

  const communityForm = $("#community-form");
  const communityFormHome = communityForm.parentElement;
  const siteAccount = $("#site-account");
  const accountControl = $("#site-account-control");
  const accountMenu = $("#site-account-menu");
  const accountLogout = $("#site-account-logout");
  const accountMenuFeedback = $("#site-account-menu-feedback");
  const accountDialog = $("#account-dialog");
  const accountForm = $("#account-login");
  const accountFeedback = $("#account-login-feedback");
  const checkoutDialog = $("#checkout-dialog");
  const checkoutPayment = $("#checkout-payment");
  const checkoutFeedback = $("#checkout-feedback");
  const checkoutSpace = $("#checkout-space");
  const paymentAlert = $("#payment-web-alert");
  const paymentAlertLink = $("#payment-web-alert-link");
  const referralField = $("#community-referral-field");
  const referralInput = communityForm.elements.referralCode;
  const invitedWith = new URLSearchParams(location.search).get("ref")?.trim().toUpperCase() || "";
  if (/^[A-Z0-9][A-Z0-9-]{3,23}$/.test(invitedWith)) referralInput.value = invitedWith;
  let currentReferrals;
  let checkoutSelection;
  let checkoutOrderStatus;
  let loginSelection;
  let accountReadVersion = 0;
  let signingOut = false;
  const passwordInput = communityForm.elements.password;
  const passwordToggle = $("#community-password-toggle");
  const countrySelect = communityForm.elements.country;
  const departmentSelect = communityForm.elements.department;
  const citySelect = communityForm.elements.city;
  const [cityPlaceholder, otherCityOption] = citySelect.options;
  const otherCityInput = communityForm.elements.otherCity;
  countrySelect.replaceChildren(...Object.entries(communityCountries).map(([code, { name }]) => new Option(name, code, code === "BO", code === "BO")));
  departmentSelect.append(...communityCountries.BO.departments.map((department) => new Option(department, department)));

  function toggleOtherCity() {
    const show = !citySelect.disabled && citySelect.value === otherCityOption.value;
    $("#community-other-city").hidden = !show;
    otherCityInput.required = show;
    otherCityInput.disabled = !show;
  }

  function updateCountryFields() {
    const { prefix, cities } = communityCountries[countrySelect.value];
    const isBolivia = countrySelect.value === "BO";
    $("#community-phone-prefix").textContent = prefix;
    $("#community-department-field").hidden = !isBolivia;
    departmentSelect.disabled = !isBolivia;
    departmentSelect.value = "";
    $("#community-city-field").hidden = isBolivia;
    citySelect.disabled = isBolivia;
    citySelect.replaceChildren(cityPlaceholder, ...(cities || []).map((city) => new Option(city, city)), otherCityOption);
    citySelect.value = "";
    otherCityInput.value = "";
    toggleOtherCity();
  }
  countrySelect.addEventListener("change", updateCountryFields);
  citySelect.addEventListener("change", toggleOtherCity);
  updateCountryFields();

  function setPasswordVisible(visible) {
    passwordInput.type = visible ? "text" : "password";
    passwordToggle.setAttribute("aria-pressed", String(visible));
  }
  passwordToggle.addEventListener("click", () => setPasswordVisible(passwordInput.type === "password"));

  function setAccountMenu(open) {
    accountMenu.hidden = !open;
    if (currentStudent) siteAccount.setAttribute("aria-expanded", String(open));
    if (open) accountMenuFeedback.textContent = "";
  }

  function renderStudentAccount() {
    window.ivannaApp.setStudent(currentStudent);
    const signedIn = Boolean(currentStudent);
    const label = signedIn ? activeConfig.accountMemberLabel : activeConfig.accountGuestLabel;
    siteAccount.classList.toggle("is-signed-in", signedIn);
    if (signedIn) {
      siteAccount.setAttribute("role", "button");
      siteAccount.setAttribute("aria-controls", accountMenu.id);
      siteAccount.setAttribute("aria-expanded", String(!accountMenu.hidden));
      siteAccount.removeAttribute("aria-haspopup");
    } else {
      setAccountMenu(false);
      siteAccount.removeAttribute("role");
      siteAccount.removeAttribute("aria-expanded");
      siteAccount.setAttribute("aria-controls", accountDialog.id);
      siteAccount.setAttribute("aria-haspopup", "dialog");
    }
    siteAccount.title = label;
    setText("#site-account-label", label);
    setText("#community-member-name", currentStudent?.name);
    $("#community-register-copy").hidden = signedIn;
    $("#community-member-copy").hidden = !signedIn;
    $("#community-member").hidden = !signedIn;
    communityForm.hidden = signedIn;
    referralField.hidden = !currentReferrals?.invitesEnabled;
    referralInput.disabled = referralField.hidden;
  }

  async function refreshStudentAccount() {
    if (preview || location.protocol === "file:" || signingOut) return;
    const version = accountReadVersion;
    try {
      const data = await payment.request("");
      if (version !== accountReadVersion) return;
      currentStudent = data.student;
      currentReferrals = data.referrals;
      if (!currentStudent) paymentAlert.hidden = true;
      paymentOffers = data.offers || [];
      renderStudentAccount();
      const published = publishedSubscriptionOffers();
      if (JSON.stringify(published) === catalogSignature) renderPlanPrices();
      else renderPlans(published);
      const order = checkoutSelection && data.orders.find((item) => item.offerId === checkoutSelection.id);
      if (checkoutOrderStatus && order && order.status !== checkoutOrderStatus) renderCheckoutOrder(checkoutSelection, data);
      const rejected = retryOffer && data.orders.find((item) => item.status === "rejected" && item.offerId === retryOffer);
      if (rejected && !checkoutDialog.open && !accountDialog.open) {
        retryOffer = null;
        openCheckout({ id: rejected.offerId, title: rejected.title });
      }
      payment.showApprovalAlerts(data.orders, (approved) => {
        paymentAlertLink.href = payment.orderLink(approved);
        paymentAlert.hidden = false;
        setText("#payment-web-alert-text", `${payment.paymentMessage(approved).title} · ${approved.title}`);
      });
    } catch {
      // The account link still opens the sign-in page if the status could not be loaded.
    }
  }

  function renderCheckoutOrder(selected, data) {
    if (!checkoutDialog.open || checkoutSelection !== selected) return;
    const order = data.orders.find((item) => item.offerId === selected.id);
    if (!order) throw new Error("No se encontró esta inscripción.");
    checkoutOrderStatus = order.status;
    const statusTitle = ["submitted", "approved"].includes(order.status) ? payment.paymentMessage(order)?.title : null;
    setText("#checkout-title", statusTitle || (order.demo ? "Simulación de pago por QR" : "Pago por QR"));
    setText("#checkout-context", order.title);
    checkoutFeedback.textContent = "";
    checkoutSpace.hidden = !["submitted", "approved"].includes(order.status);
    checkoutSpace.href = payment.orderLink(order);
    payment.render(checkoutPayment, order, (updated) => renderCheckoutOrder(selected, updated), {
      statusInHeading: Boolean(statusTitle), referrals: data.referrals,
      onCancel() {
        if (!checkoutDialog.open || checkoutSelection !== selected) return;
        checkoutOrderStatus = undefined;
        checkoutPayment.replaceChildren();
        setText("#checkout-title", "Inscripción cancelada");
        checkoutFeedback.textContent = "Ya no hay una inscripción activa para este curso. Puedes iniciar otra cuando quieras.";
        $("#checkout-title").focus();
        refreshStudentAccount();
      },
    });
    $("#checkout-title").focus();
  }

  async function beginCheckoutPayment(selected) {
    if (!checkoutDialog.open || checkoutSelection !== selected) return;
    setText("#checkout-title", "Pago por QR");
    checkoutFeedback.textContent = "Preparando tu inscripción…";
    try {
      renderCheckoutOrder(selected, await payment.request("/order", { offerId: selected.id }));
    } catch (error) {
      if (checkoutDialog.open && checkoutSelection === selected) checkoutFeedback.textContent = error.message;
    }
  }

  function openCheckout(selected) {
    checkoutSelection = selected;
    checkoutOrderStatus = undefined;
    setText("#checkout-title", "Inscripción");
    setText("#checkout-context", selected.title);
    checkoutPayment.replaceChildren();
    checkoutSpace.hidden = true;
    checkoutFeedback.textContent = "";
    if (!currentStudent) $("#checkout-registration").append(communityForm);
    renderStudentAccount();
    if (!checkoutDialog.open) checkoutDialog.showModal();
    if (currentStudent) beginCheckoutPayment(selected);
  }

  $("#subscripciones").addEventListener("click", async (event) => {
    const link = event.target.closest("[data-purchase]");
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !checkoutDialog.showModal) return;
    event.preventDefault();
    const selected = { id: link.dataset.purchase, title: link.dataset.purchaseTitle };
    if (preview || location.protocol === "file:") {
      checkoutSelection = selected;
      setText("#checkout-context", selected.title);
      checkoutFeedback.textContent = "La inscripción está disponible en la portada publicada.";
      if (!checkoutDialog.open) checkoutDialog.showModal();
      return;
    }
    await refreshStudentAccount();
    openCheckout(selected);
  });

  checkoutDialog.addEventListener("close", () => {
    if (checkoutDialog.open) return;
    checkoutSelection = undefined;
    checkoutOrderStatus = undefined;
    if (communityForm.parentElement !== communityFormHome) communityFormHome.insertBefore(communityForm, $("#community-member"));
    setPasswordVisible(false);
  });

  async function submitStudent(path, payload, fallback) {
    const response = await fetch(`/api/academy/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    const result = await response?.json().catch(() => null);
    if (response?.status === 202 && path === "register" && result?.emailVerificationRequired) return null;
    if (!response?.ok || !result?.student) throw new Error(result?.error || fallback);
    return result.student;
  }

  async function openStudentAccess(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !accountDialog.showModal) return;
    event.preventDefault();
    const fromIcon = event.currentTarget === siteAccount;
    if (fromIcon && currentStudent) {
      setAccountMenu(accountMenu.hidden);
      return;
    }
    const selected = event.currentTarget.id === "academy-home-link" && checkoutDialog.open ? checkoutSelection : undefined;
    await refreshStudentAccount();
    if (selected && checkoutSelection !== selected) return;
    if (currentStudent) {
      if (selected) beginCheckoutPayment(selected);
      else if (fromIcon) setAccountMenu(true);
      else location.assign(siteAccount.href);
    } else if (!accountDialog.open) {
      loginSelection = selected;
      if (selected) checkoutDialog.close();
      accountDialog.showModal();
    }
  }
  siteAccount.addEventListener("click", openStudentAccess);
  $("#academy-home-link").addEventListener("click", openStudentAccess);
  siteAccount.addEventListener("keydown", (event) => {
    if (currentStudent && event.key === " ") {
      event.preventDefault();
      if (!event.repeat) setAccountMenu(accountMenu.hidden);
    }
  });
  accountControl.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || accountMenu.hidden) return;
    event.preventDefault();
    setAccountMenu(false);
    siteAccount.focus();
  });
  document.addEventListener("click", (event) => {
    if (!accountMenu.hidden && !accountControl.contains(event.target)) setAccountMenu(false);
  });
  accountMenu.querySelector("a").addEventListener("click", () => setAccountMenu(false));
  accountLogout.addEventListener("click", async () => {
    if (!currentStudent || signingOut) return;
    signingOut = true;
    accountReadVersion += 1;
    accountLogout.disabled = true;
    accountMenuFeedback.textContent = "";
    try {
      const data = await payment.request("/logout", {});
      currentStudent = data.student;
      currentReferrals = data.referrals;
      paymentAlert.hidden = true;
      renderStudentAccount();
      $("#site-account-status").textContent = "Sesión cerrada.";
      siteAccount.focus();
    } catch (error) {
      accountMenuFeedback.textContent = error.message;
    } finally {
      accountLogout.disabled = false;
      signingOut = false;
    }
  });

  $("#account-register-link").addEventListener("click", (event) => {
    const selected = loginSelection;
    accountDialog.close();
    if (!selected) return;
    event.preventDefault();
    openCheckout(selected);
  });
  accountDialog.addEventListener("close", () => {
    if (accountDialog.open) return;
    loginSelection = undefined;
    accountForm.reset();
    accountFeedback.textContent = "";
  });

  accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = accountForm.querySelector("button[type=submit]");
    if (button.disabled) return;
    const selected = loginSelection;
    button.disabled = true;
    accountFeedback.textContent = activeConfig.accountLoginPending;
    try {
      currentStudent = await submitStudent("login", Object.fromEntries(new FormData(accountForm)), activeConfig.accountLoginError);
      renderStudentAccount();
      accountForm.reset();
      if (accountDialog.open && loginSelection === selected) {
        if (selected) {
          accountDialog.close();
          openCheckout(selected);
        } else location.assign(siteAccount.href);
      }
    } catch (error) {
      if (accountDialog.open) accountFeedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  communityForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const feedback = $("#community-feedback");
    const button = form.querySelector("button[type=submit]");
    if (preview) {
      feedback.textContent = "El registro está disponible en la portada publicada.";
      return;
    }
    if (button.disabled) return;
    const selected = checkoutDialog.open ? checkoutSelection : undefined;
    button.disabled = true;
    feedback.textContent = activeConfig.communityPending;
    try {
      const payload = Object.fromEntries(new FormData(form));
      if (payload.city === otherCityOption.value) payload.city = payload.otherCity;
      delete payload.otherCity;
      payload.whatsappConsent = form.elements.whatsappConsent.checked;
      currentStudent = await submitStudent("register", payload, activeConfig.communityError);
      form.reset();
      setPasswordVisible(false);
      updateCountryFields();
      if (!currentStudent) {
        feedback.textContent = "Si el correo está disponible, recibirás un enlace para completar tu cuenta. Revisa también el correo no deseado.";
        return;
      }
      feedback.textContent = activeConfig.communitySuccess;
      renderStudentAccount();
      if (selected) await beginCheckoutPayment(selected);
      else location.assign("/mi-espacio");
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const subscriptionRow = $("#subscription-plans");
  subscriptionRow.addEventListener("scroll", updateSubscriptionNavigation, { passive: true });
  window.addEventListener("resize", centerSubscriptionLiveCards);
  $("#subscription-navigation").addEventListener("click", (event) => {
    const button = event.target.closest("[data-subscription-step]");
    if (!button || button.getAttribute("aria-disabled") === "true") return;
    const card = subscriptionRow.querySelector("article:not([hidden])");
    if (!card) return;
    const gap = parseFloat(getComputedStyle(subscriptionRow).columnGap) || 0;
    subscriptionRow.scrollBy({ left: Number(button.dataset.subscriptionStep) * (card.offsetWidth + gap), behavior: reducedMotion.matches ? "instant" : "smooth" });
  });

  paymentAlert.querySelector("button").addEventListener("click", () => { paymentAlert.hidden = true; });
  refreshStudentAccount();
  window.setInterval(() => { if (currentStudent) refreshStudentAccount(); }, 15000);
  $("#reviews-more").addEventListener("click", loadReviews);
  if (location.protocol !== "file:") loadReviews();
  window.addEventListener("pageshow", ({ persisted }) => {
    if (persisted) {
      setAccountMenu(false);
      setPasswordVisible(false);
      refreshStudentAccount();
    }
  });

  loadHome().then(() => {
    window.matchMedia("(max-width: 820px)").addEventListener("change", positionCourseAnchor);
    positionCourseAnchor();
  });
})();
