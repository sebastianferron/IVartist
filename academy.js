(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const { request, endpoint, paymentMessage, showApprovalAlerts } = window.academyPayment;
  const { setAvatar } = window.communityProfile;
  const discussion = window.academyDiscussion;
  const auth = $("#student-auth");
  const notice = $("#academy-message");
  const orderList = $("#student-orders");
  const paymentAlerts = $("#student-payment-alerts");
  const approvalAlert = $("#student-approval-alert");
  const video = $("#lesson-video");
  const player = $("#lesson-player");
  const playerStatus = $("#lesson-video-status");
  const startLesson = $("#lesson-start");
  const fullscreen = $("#lesson-fullscreen");
  const chapterProgressFeedback = $("#chapter-progress-feedback");
  const retryChapterProgress = $("#retry-chapter-progress");
  const completeReading = $("#complete-reading");
  const nextChapterDialog = $("#next-chapter-dialog");
  const chapterNav = $("#lesson-chapters");
  const chapterTitle = $("#lesson-chapter-title");
  const reviewForm = $("#course-review-form");
  const reviewFeedback = $("#review-feedback");
  const reviewToggle = $("#course-review-toggle");
  const commentsToggle = $("#course-comments-toggle");
  const reviewPanel = $("#course-review-panel");
  const commentsPanel = $("#course-discussion");
  const profilePanel = $("#perfil");
  const profileForm = $("#student-profile-form");
  const accountForm = $("#student-account-form");
  const accountStatus = $("#student-account-status");
  const verificationPanel = $("#email-confirmation");
  const verificationForm = $("#email-confirmation-form");
  const verificationStatus = $("#email-confirmation-status");
  const requestVerification = $("#request-email-verification");
  const passwordForm = $("#student-password-form");
  const passwordStatus = $("#student-password-status");
  const referralForm = $("#profile-referral-form");
  const referralCode = $("#profile-referral-code");
  const referralCodeStatus = $("#profile-referral-code-status");
  const profileStatus = $("#student-profile-status");
  const profileAvatar = $("#student-profile-avatar");
  const removeAvatar = $("#remove-profile-avatar");
  const viewProfile = $("#view-public-profile");
  let activeProfile;
  let photoPreview;
  let studentEmail;
  let studentName;
  let studentReferrals;
  let referralCheck = 0;
  let lessonRequest = 0;
  let currentLesson;
  let currentChapter;
  let participation = "comments";
  let nextChapter;
  let retryChapterSave;
  const savingChapters = new Set();
  let studentOrders = [];
  let lastOrderSignature = "";
  let activePlayback;
  let liveTimers = [];

  function renderPaymentAlerts(orders) {
    const latest = orders.filter((order) => paymentMessage(order)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    paymentAlerts.replaceChildren(...latest.map((order) => {
      const message = paymentMessage(order);
      const item = document.createElement("li");
      item.className = "payment-state";
      item.id = `aviso-${order.id}`;
      item.dataset.state = order.status;
      const title = document.createElement("strong");
      title.textContent = message.title;
      const detail = document.createElement("p");
      detail.textContent = order.title;
      item.append(title, detail);
      if (order.status !== "approved") {
        const status = document.createElement("p");
        status.className = "payment-help";
        status.textContent = message.detail;
        item.append(status);
      }
      if (order.status !== "submitted" || order.category === "live") {
        const link = document.createElement("a");
        link.href = order.status === "rejected" ? `/?inscripcion=${encodeURIComponent(order.offerId)}#subscripciones` : `#inscripcion-${order.id}`;
        link.className = "payment-download";
        link.textContent = order.status === "rejected" ? "Volver a adjuntar el comprobante" : order.category === "live" ? "Ver el vivo" : "Ver contenido";
        item.append(link);
      }
      return item;
    }));
    showApprovalAlerts(orders, (order) => { approvalAlert.textContent = `${paymentMessage(order).title} · ${order.title}`; });
  }

  function render({ student, profile, account, orders, referrals }, feedback) {
    const accountChanged = studentEmail !== student?.email;
    studentEmail = student?.email;
    studentName = student?.name;
    studentReferrals = referrals;
    studentOrders = orders;
    notice.textContent = feedback || (student ? `Hola, ${student.name}.` : "Entra para ver tus inscripciones y lecciones.");
    if (student && account?.emailVerified === false && !feedback) notice.textContent += " Verifica tu correo en Mi perfil antes de inscribirte.";
    renderEmailVerification(student, account);
    $("#student-access").hidden = Boolean(student);
    $("#student-logout").hidden = !student;
    $("#student-account").hidden = !student;
    profilePanel.hidden = !student;
    $("#avisos-de-pago").hidden = !student;
    window.academyFeed.setStudent(student, profile);
    window.ivannaApp.setStudent(student);
    renderReferrals(referrals);
    if (accountChanged) {
      fillProfile(profile);
      fillAccount(student, account);
      passwordForm.reset();
      setPasswordVisibility();
      passwordStatus.textContent = "";
      if (!student) {
        profilePanel.open = false;
        $("#profile-password").open = false;
      }
      if (student && location.hash === "#referidos") $("#referidos").scrollIntoView({ block: "start" });
      approvalAlert.textContent = "";
    } else if (student) updatePublicProfileLink(profile);
    $("#mis-cursos").hidden = !student;
    if (!student) {
      lessonRequest += 1;
      currentLesson = undefined;
      currentChapter = undefined;
      nextChapter = undefined;
      if (nextChapterDialog.open) nextChapterDialog.close();
      clearVideo();
      discussion.close();
      $("#student-lesson").hidden = true;
    }
    renderCompletion();
    const signature = JSON.stringify([studentEmail, orders]);
    if (signature !== lastOrderSignature) {
      lastOrderSignature = signature;
      liveTimers = [];
      const eligible = orders.filter(({ status, category }) => status === "approved" || (category === "live" && status === "submitted"))
        .sort((a, b) => Number(b.category === "live") - Number(a.category === "live"));
      orderList.replaceChildren(...eligible.map(orderCard));
      updateLiveTimers();
      renderPaymentAlerts(orders);
      if (student && !eligible.length) {
        const link = document.createElement("a");
        link.className = "academy-text-button";
        link.href = "/#subscripciones";
        link.textContent = "Explorar subscripciones ↗";
        orderList.append(link);
      }
      if (accountChanged && /^#(?:inscripcion|aviso)-/.test(location.hash)) {
        const target = document.getElementById(location.hash.slice(1)) || document.getElementById(`aviso-${location.hash.slice("#inscripcion-".length)}`);
        target?.scrollIntoView({ block: "start" });
      }
    }
  }

  function clearPhotoPreview() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    photoPreview = undefined;
  }

  function updateEmailConfirmation() {
    const current = accountForm.elements.currentPassword;
    const changed = Boolean(studentEmail && accountForm.elements.email.value.trim().toLowerCase() !== studentEmail);
    $("#account-confirm-email").hidden = !changed;
    current.required = changed;
    current.disabled = !changed;
    if (!changed) current.value = "";
  }

  function fillAccount(student, account) {
    accountForm.reset();
    accountForm.elements.name.value = student?.name || "";
    accountForm.elements.email.value = student?.email || "";
    accountForm.elements.whatsapp.value = account?.whatsapp || "";
    accountStatus.textContent = "";
    updateEmailConfirmation();
  }

  function verificationFromHash() {
    const match = /^#verificar-(registro|correo)=([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(location.hash);
    return match && { signup: match[1] === "registro", id: match[2], token: match[3] };
  }

  function renderEmailVerification(student, account) {
    const challenge = verificationFromHash();
    verificationPanel.hidden = !challenge;
    if (challenge) {
      const passwordLabel = $("#email-registration-password");
      passwordLabel.hidden = !challenge.signup;
      verificationForm.elements.password.required = challenge.signup;
      verificationForm.elements.password.disabled = !challenge.signup;
      verificationForm.hidden = !challenge.signup && !student;
      $("#email-confirmation-help").textContent = challenge.signup
        ? "Introduce la contraseña que elegiste para completar tu registro."
        : student ? "Confirma el correo solicitado para tu cuenta." : "Inicia sesión con tu correo actual para poder confirmar el cambio.";
    }
    const emailNotice = $("#student-email-notice");
    emailNotice.hidden = !student || (!account?.emailVerificationPending && account?.emailVerified !== false);
    emailNotice.textContent = account?.emailVerificationPending ? "Hay una verificación de correo pendiente de confirmación."
      : "Tu correo todavía no está verificado. Podrás inscribirte después de confirmarlo.";
    requestVerification.hidden = !student || account?.emailVerified !== false;
  }

  verificationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const challenge = verificationFromHash();
    const button = verificationForm.querySelector("button");
    if (!challenge || button.disabled) return;
    const hash = location.hash;
    const previous = studentEmail;
    button.disabled = true;
    verificationStatus.textContent = "Confirmando…";
    try {
      const { signup, id, token } = challenge;
      const password = verificationForm.elements.password.value;
      const data = await request(signup ? "/register/verify" : "/account/verify", { id, token, ...(signup && { password }) });
      if (location.hash === hash) history.replaceState(history.state, "", "#perfil");
      if (previous) window.ivannaApp.updateEmail(previous, data.student.email);
      verificationForm.reset();
      profilePanel.open = true;
      render(data, signup ? "Correo confirmado. Tu cuenta está lista." : "Correo confirmado. Los próximos avisos se enviarán a esta dirección.");
    } catch (error) {
      verificationStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  requestVerification.addEventListener("click", async () => {
    if (requestVerification.disabled) return;
    requestVerification.disabled = true;
    try {
      const data = await request("/account/verify/request", {});
      render(data, "Revisa el mensaje que te enviamos para confirmar tu correo.");
      accountStatus.textContent = "Enlace solicitado. Revisa también el correo no deseado.";
    } catch (error) {
      accountStatus.textContent = error.message;
    } finally {
      requestVerification.disabled = false;
    }
  });

  function setPasswordVisibility() {
    const show = passwordForm.elements.showPasswords.checked;
    for (const name of ["currentPassword", "newPassword", "confirmPassword"]) passwordForm.elements.namedItem(name).type = show ? "text" : "password";
  }

  function renderReferrals(referrals) {
    const { code = "", plan, demo, welcomePercent, rewardCount = 0, nextRewardPercent } = referrals || {};
    $("#referidos").hidden = !code && !welcomePercent && !rewardCount;
    $("#profile-referrals-share").hidden = !code;
    const welcome = $("#profile-referrals-welcome");
    welcome.hidden = !welcomePercent;
    welcome.textContent = welcomePercent ? `Tienes ${welcomePercent} % de descuento para tu primera compra.` : "";
    const earned = $("#profile-referrals-earned");
    earned.hidden = !rewardCount;
    earned.textContent = rewardCount ? `Descuentos disponibles: ${rewardCount}. El próximo es del ${nextRewardPercent} %.` : "";
    $("#profile-referral-plan").textContent = demo ? "Cuenta de demostración. Puedes probar la edición del código." : plan
      ? `Cuando alguien se registra con tu código, esa persona recibe ${plan.buyerPercent} % en su primera compra. Al aprobarse su primer pago, ganas ${plan.referrerPercent} % para tu próxima compra.`
      : "Puedes preparar tu código y tu enlace. Los descuentos se habilitan cuando Admin activa el programa.";
    if (referralCode.dataset.savedCode !== code) {
      referralCheck += 1;
      referralCode.dataset.savedCode = code;
      referralCode.value = code;
      referralCodeStatus.textContent = "";
    }
    const url = new URL("/#comunidad", location.origin);
    if (code) url.searchParams.set("ref", code);
    $("#profile-referral-link").value = code ? url.href : "";
  }

  referralCode.addEventListener("input", () => {
    referralCheck += 1;
    referralCodeStatus.textContent = "";
  });
  referralCode.addEventListener("focusout", async () => {
    const code = referralCode.value.trim();
    if (!code || code.toUpperCase() === referralCode.dataset.savedCode) return;
    const version = ++referralCheck;
    try {
      const { available } = await request(`/referrals/code?code=${encodeURIComponent(code)}`);
      if (version === referralCheck) referralCodeStatus.textContent = available ? "Código disponible." : "Ese código ya está en uso.";
    } catch (error) {
      if (version === referralCheck) referralCodeStatus.textContent = error.message;
    }
  });
  referralForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = referralForm.querySelector("button");
    if (button.disabled || !studentEmail) return;
    const owner = studentEmail;
    referralCheck += 1;
    button.disabled = true;
    referralCodeStatus.textContent = "";
    try {
      const data = await request("/referrals/code", { code: referralCode.value }, "PUT");
      if (studentEmail === owner) {
        render(data);
        referralCodeStatus.textContent = "Código guardado. Ya puedes copiar tu enlace actualizado.";
      }
    } catch (error) {
      if (studentEmail === owner) referralCodeStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  $("#copy-referral-link").addEventListener("click", async () => {
    const link = $("#profile-referral-link");
    if (!link.value) return;
    const status = $("#profile-referrals-status");
    try {
      await navigator.clipboard.writeText(link.value);
      status.textContent = "Enlace copiado.";
    } catch {
      link.select();
      status.textContent = "Copia el enlace seleccionado.";
    }
  });

  async function submitAccount(form, status, route, body, successMessage) {
    const owner = studentEmail;
    const button = form.querySelector("button[type=submit]");
    if (!owner || button.disabled) return;
    button.disabled = true;
    status.textContent = "Guardando…";
    try {
      const data = await request(route, body, "PUT");
      if (studentEmail !== owner) return;
      window.ivannaApp.updateEmail(owner, data.student.email);
      render(data);
      if (form === accountForm) {
        fillAccount(data.student, data.account);
        if (data.student.email === owner) window.academyFeed.reload();
        window.academyRanking.refresh();
      } else {
        form.reset();
        setPasswordVisibility();
      }
      status.textContent = form === accountForm && data.account?.emailVerificationPending
        ? "Abre el enlace que te enviamos al correo nuevo. Tu dirección actual se mantiene hasta confirmarlo." : successMessage;
    } catch (error) {
      if (studentEmail === owner) status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  accountForm.elements.email.addEventListener("input", updateEmailConfirmation);
  accountForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAccount(accountForm, accountStatus, "/account", Object.fromEntries(new FormData(accountForm)), "Datos actualizados.");
  });
  passwordForm.elements.showPasswords.addEventListener("change", setPasswordVisibility);
  passwordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const { currentPassword, newPassword, confirmPassword } = Object.fromEntries(new FormData(passwordForm));
    if (newPassword !== confirmPassword) {
      passwordStatus.textContent = "Las nuevas contraseñas deben coincidir.";
      passwordForm.elements.confirmPassword.focus();
      return;
    }
    submitAccount(passwordForm, passwordStatus, "/account/password", { currentPassword, newPassword }, "Contraseña actualizada. Las otras sesiones se cerraron.");
  });

  function updatePublicProfileLink(profile) {
    viewProfile.hidden = !profile?.url;
    if (profile?.url) viewProfile.href = profile.url;
    else viewProfile.removeAttribute("href");
  }

  function fillProfile(profile) {
    activeProfile = profile;
    window.academyFeed.setAvatar(profile?.avatar);
    clearPhotoPreview();
    profileForm.reset();
    profileForm.elements.visibility.value = profile?.visibility || "public";
    profileForm.elements.specialty.value = profile?.specialty || "";
    for (const { key, handle } of profile?.socials || []) profileForm.elements.namedItem(key).value = handle;
    for (const image of [profileAvatar, $("#profile-summary-avatar"), $("#student-account-avatar")]) setAvatar(image, profile?.avatar);
    removeAvatar.hidden = !profile?.avatar;
    profileStatus.textContent = "";
    updatePublicProfileLink(profile);
  }

  $("#student-account").addEventListener("click", () => { profilePanel.open = true; });
  profileForm.elements.avatar.addEventListener("change", () => {
    clearPhotoPreview();
    const file = profileForm.elements.avatar.files[0];
    const tooLarge = file?.size > 5 * 1024 * 1024;
    if (tooLarge) profileForm.elements.avatar.value = "";
    if (file && !tooLarge) {
      photoPreview = URL.createObjectURL(file);
      profileForm.elements.removeAvatar.value = "";
    }
    const current = profileForm.elements.removeAvatar.value ? null : activeProfile?.avatar;
    setAvatar(profileAvatar, photoPreview || current);
    removeAvatar.hidden = !photoPreview && !current;
    profileStatus.textContent = tooLarge ? "La foto supera el límite de 5 MB." : "";
  });
  removeAvatar.addEventListener("click", () => {
    clearPhotoPreview();
    profileForm.elements.avatar.value = "";
    profileForm.elements.removeAvatar.value = "1";
    setAvatar(profileAvatar, null);
    removeAvatar.hidden = true;
    profileStatus.textContent = "Guarda el perfil para quitar la foto.";
  });
  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const owner = studentEmail;
    const button = $("#save-student-profile");
    if (!owner || button.disabled) return;
    const data = new FormData(profileForm);
    const controls = [...profileForm.querySelectorAll("button, input, select")];
    for (const control of controls) control.disabled = true;
    profileStatus.textContent = "Guardando el perfil…";
    try {
      const { profile } = await request("/profile", data);
      if (studentEmail !== owner) return;
      fillProfile(profile);
      window.academyRanking.refresh();
      profileStatus.textContent = "Perfil actualizado.";
    } catch (error) {
      if (studentEmail === owner) profileStatus.textContent = error.message;
    } finally {
      for (const control of controls) control.disabled = false;
    }
  });

  function orderCard(order) {
    const article = document.createElement("article");
    article.className = `academy-panel academy-course-card${order.category === "live" ? " academy-course-card--live" : ""}`;
    article.id = `inscripcion-${order.id}`;
    const title = document.createElement("h3");
    title.textContent = order.title;
    const kind = document.createElement("p");
    kind.className = "academy-course-kind";
    kind.textContent = { live: "En vivo", special: "Especial", course: "Curso" }[order.category];

    if (order.category === "live") {
      const details = document.createElement("div");
      details.className = "academy-live-details";
      details.append(kind, title);
      article.append(details);
      const start = Date.parse(order.schedule?.date);
      if (Number.isFinite(start)) {
        const date = document.createElement("time");
        date.dateTime = order.schedule.date;
        date.textContent = new Intl.DateTimeFormat("es-BO", { dateStyle: "long", timeStyle: "short", hour12: false, timeZone: order.schedule.zone }).format(start);
        details.append(date);
        article.append(liveClock(start));
      } else {
        const schedule = document.createElement("p");
        schedule.textContent = "Fecha por confirmar";
        details.append(schedule);
      }
      if (order.status === "approved" && order.demo) {
        details.append(courseButton("Abrir vivo de prueba", () => openLesson(order), "admin-primary"));
      } else if (order.status === "approved" && order.liveProvider === "plugnmeet") {
        const feedback = document.createElement("p");
        feedback.role = "status";
        const join = document.createElement("button");
        join.type = "button";
        join.className = "admin-primary";
        join.textContent = "Entrar al vivo";
        join.addEventListener("click", async () => {
          join.disabled = true;
          feedback.textContent = "Conectando con la sala…";
          try {
            const { url } = await request(endpoint(order, "live/join"), {});
            location.assign(url);
          } catch (error) { feedback.textContent = error.message; }
          finally { join.disabled = false; }
        });
        details.append(join, feedback, courseButton("Comentarios", () => openLesson(order), "admin-secondary"));
      } else {
        const link = document.createElement("a");
        if (order.status === "approved") {
          link.className = "admin-primary";
          link.href = `/api/academy${endpoint(order, "live")}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Entrar al vivo ↗";
        } else {
          link.className = "academy-text-button";
          link.href = `#aviso-${order.id}`;
          link.textContent = "Ver aviso de inscripción";
        }
        details.append(link);
        if (order.status === "approved") details.append(courseButton("Comentarios", () => openLesson(order), "admin-secondary"));
      }
      return article;
    }

    article.append(kind, title);
    const chapters = order.chapters || [];
    if (chapters.length) {
      const summary = document.createElement("p");
      const seen = chapters.filter((chapter) => chapter.seen).length;
      summary.className = `academy-course-progress${order.completed ? " academy-progress-label" : ""}`;
      summary.textContent = order.completed ? "Curso finalizado" : order.category === "special" ? "Lección pendiente" : `${seen} de ${chapters.length} capítulos vistos`;
      article.append(summary);
      const list = document.createElement("ol");
      list.className = "academy-course-chapters";
      list.setAttribute("aria-label", order.category === "special" ? "Lección del especial" : "Capítulos del curso");
      for (const { id, title, seen } of chapters) {
        const item = document.createElement("li");
        item.append(courseButton(title, () => openLesson(order, id), "academy-text-button"));
        if (seen) {
          const badge = document.createElement("span");
          badge.className = "academy-chapter-seen";
          badge.textContent = order.category === "special" ? "Lección vista" : "Capítulo visto";
          item.append(badge);
        }
        list.append(item);
      }
      article.append(list);
    }
    if (order.completed && !order.reviewStatus) {
      article.append(courseButton("Dejar reseña", () => openLesson(order, undefined, true), "admin-secondary"));
    }
    return article;
  }

  function courseButton(title, action, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = title;
    button.addEventListener("click", () => run(button, action));
    return button;
  }

  function liveClock(start) {
    const clock = document.createElement("div");
    clock.className = "academy-live-clock";
    const leading = document.createElement("p");
    leading.className = "academy-live-clock__label";
    leading.textContent = "Faltan:";
    const countdown = document.createElement("dl");
    countdown.className = "academy-live-timer";
    countdown.setAttribute("role", "timer");
    const fullLabels = ["días", "horas", "minutos", "segundos"];
    const digits = ["Días", "Horas", "Min", "Seg"].map((label) => {
      const tile = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = label;
      const value = document.createElement("dd");
      tile.append(term, value);
      countdown.append(tile);
      return value;
    });
    const caption = document.createElement("p");
    const emphasized = document.createElement("strong");
    emphasized.textContent = "EN VIVO";
    caption.append("para iniciar el curso ", emphasized);
    const elapsed = document.createElement("p");
    elapsed.className = "academy-live-clock__label";
    elapsed.textContent = "Ya llegó la hora de inicio";
    elapsed.hidden = true;
    clock.append(leading, countdown, caption, elapsed);
    liveTimers.push({ start, leading, countdown, caption, elapsed, digits, fullLabels, lastSecond: null });
    return clock;
  }

  function updateLiveTimers() {
    const timestamp = Date.now();
    for (const clock of liveTimers) {
      const seconds = Math.max(0, Math.ceil((clock.start - timestamp) / 1000));
      if (clock.lastSecond === seconds) continue;
      clock.lastSecond = seconds;
      const started = seconds === 0;
      clock.leading.hidden = clock.countdown.hidden = clock.caption.hidden = started;
      clock.elapsed.hidden = !started;
      if (started) continue;
      const parts = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
      parts.forEach((value, index) => { clock.digits[index].textContent = String(value).padStart(2, "0"); });
      clock.countdown.setAttribute("aria-label", parts.map((value, index) => `${value} ${clock.fullLabels[index]}`).join(", "));
    }
  }

  function clearVideo() {
    activePlayback = undefined;
    player.hidden = true;
    startLesson.hidden = true;
    startLesson.removeAttribute("aria-busy");
    playerStatus.textContent = "";
    if (video.hasAttribute("src")) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }

  function showVideo(order, url, refresh, chapter = null) {
    clearVideo();
    if (!url) return;
    activePlayback = { order, chapter, refresh, tried: false, ranges: [] };
    const firstName = studentName?.trim().split(/\s+/)[0];
    $("#lesson-watermark").textContent = `Acceso personal · ${firstName && !firstName.includes("@") ? firstName : "Participante"} · ${order.id.slice(-6).toUpperCase()}`;
    player.hidden = false;
    startLesson.hidden = false;
    video.src = url;
  }

  startLesson.addEventListener("click", async () => {
    const playback = activePlayback;
    if (!playback || startLesson.hasAttribute("aria-busy")) return;
    startLesson.setAttribute("aria-busy", "true");
    playerStatus.textContent = "";
    try {
      await video.play();
    } catch {
      if (activePlayback === playback) playerStatus.textContent = "No se pudo iniciar el video. Toca el botón para reintentar.";
    } finally {
      if (activePlayback === playback) startLesson.removeAttribute("aria-busy");
    }
  });

  video.addEventListener("playing", () => {
    if (startLesson.hidden) return;
    if (document.activeElement === startLesson) video.focus({ preventScroll: true });
    startLesson.hidden = true;
  });

  function watchedRanges(previous) {
    const ranges = [...previous];
    for (let index = 0; index < video.played.length; index += 1) ranges.push([video.played.start(index), video.played.end(index)]);
    const merged = [];
    for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1);
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    return merged;
  }

  video.addEventListener("ended", () => {
    const active = activePlayback;
    if (!video.ended || !active?.chapter || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const { order, chapter } = active;
    const progress = studentOrders.find(({ id }) => id === order.id)?.chapters?.find(({ id }) => id === chapter.id);
    if (progress?.seen) return;
    const watched = watchedRanges(active.ranges).reduce((total, [start, end]) => total + Math.max(0, Math.min(end, video.duration) - start), 0);
    if (video.duration - watched > Math.min(0.15, video.duration * 0.02)) {
      chapterProgressFeedback.textContent = "Reproduce el video completo para que el capítulo se marque como visto.";
      return;
    }
    markChapterSeen(order, chapter);
  });

  video.addEventListener("error", async () => {
    const active = activePlayback;
    if (!active) return;
    if (active.tried) {
      playerStatus.textContent = "No se pudo reproducir el video. Abre la lección de nuevo para reintentar.";
      return;
    }
    active.tried = true;
    active.ranges = watchedRanges(active.ranges);
    const position = video.currentTime;
    try {
      const url = await active.refresh();
      if (active !== activePlayback) return;
      if (!url) throw new Error();
      if (position > 0) video.addEventListener("loadedmetadata", () => { if (active === activePlayback) video.currentTime = Math.min(position, video.duration || position); }, { once: true });
      video.src = url;
    } catch {
      if (active === activePlayback) playerStatus.textContent = "Vuelve a abrir la lección para renovar el acceso al video.";
    }
  });

  player.addEventListener("contextmenu", (event) => event.preventDefault());
  fullscreen.hidden = !player.requestFullscreen;
  fullscreen.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen();
      else await player.requestFullscreen();
    } catch { playerStatus.textContent = "La pantalla completa no está disponible."; }
  });
  document.addEventListener("fullscreenchange", () => { fullscreen.textContent = document.fullscreenElement === player ? "Salir de pantalla completa" : "Pantalla completa"; });

  async function openLesson(order, chosenChapter, openReview = false) {
    const sequence = ++lessonRequest;
    const live = order.category === "live";
    const loadContent = () => request(endpoint(order, live ? "live/player" : "chapters"));
    const course = live && !order.demo ? { title: order.title } : await loadContent();
    if (sequence !== lessonRequest) return;
    if (!live && !course.chapters.length) throw new Error("Este curso todavía no tiene contenido disponible.");
    if (currentLesson !== order.id) {
      reviewForm.reset();
      participation = "comments";
    }
    if (openReview) participation = "review";
    currentLesson = order.id;
    currentChapter = undefined;
    nextChapter = undefined;
    const title = $("#lesson-title");
    title.textContent = course.title;
    discussion.open(order);
    chapterTitle.hidden = live;
    if (live) {
      chapterNav.hidden = true;
      $("#lesson-text").hidden = true;
      showVideo(order, course.videoUrl, async () => (await loadContent()).videoUrl);
      $("#student-lesson").hidden = false;
      renderCompletion();
      title.focus();
      return;
    }
    chapterNav.hidden = course.chapters.length < 2;
    const chapterList = chapterNav.querySelector("ol");
    chapterList.replaceChildren(...course.chapters.map((chapter, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-secondary";
      button.textContent = `${index + 1}. ${chapter.title}`;
      button.dataset.progressChapter = chapter.id;
      button.dataset.label = button.textContent;
      button.addEventListener("click", () => {
        if (button.hasAttribute("aria-current")) return;
        showChapter(index);
        chapterTitle.focus();
      });
      item.append(button);
      return item;
    }));

    function showChapter(index) {
      const chapter = course.chapters[index];
      currentChapter = chapter;
      const following = course.chapters[index + 1];
      nextChapter = following ? {
        title: following.title,
        open: () => { showChapter(index + 1); chapterTitle.focus(); },
      } : undefined;
      chapterProgressFeedback.textContent = "";
      retryChapterProgress.hidden = true;
      retryChapterSave = undefined;
      for (const [position, item] of [...chapterList.children].entries()) {
        const button = item.firstElementChild;
        if (position === index) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      }
      chapterTitle.textContent = chapter.title;
      const text = $("#lesson-text");
      text.textContent = chapter.text;
      text.hidden = !chapter.text;
      showVideo(order, chapter.videoUrl, async () => (await loadContent()).chapters.find(({ id, version }) => id === chapter.id && version === chapter.version)?.videoUrl, chapter);
      renderCompletion();
    }

    showChapter(Math.max(0, course.chapters.findIndex(({ id }) => id === chosenChapter)));
    $("#student-lesson").hidden = false;
    (openReview && !reviewForm.hidden ? $("#review-form-title") : title).focus();
    notice.textContent = "Tu curso está habilitado.";
  }

  function renderCompletion() {
    const order = studentOrders.find(({ id, status, category }) => id === currentLesson && status === "approved" && category !== "live");
    $("#lesson-completion").hidden = !order;
    const chapter = order?.chapters?.find(({ id }) => id === currentChapter?.id);
    for (const button of chapterNav.querySelectorAll("[data-progress-chapter]")) {
      const viewed = order?.chapters?.some(({ id, seen }) => seen && id === button.dataset.progressChapter);
      button.textContent = `${button.dataset.label}${viewed ? " · Visto" : ""}`;
    }
    const chapterCompleted = $("#chapter-completed");
    chapterCompleted.textContent = order?.category === "special" ? "Lección vista" : "Capítulo visto";
    chapterCompleted.hidden = !chapter?.seen;
    completeReading.hidden = !chapter || chapter.seen || currentChapter.hasVideo;
    completeReading.disabled = Boolean(chapter && savingChapters.has(`${order.id}/${chapter.id}`));
    $("#course-completed").hidden = !order?.completed;
    reviewForm.hidden = !order?.completed || Boolean(order.reviewStatus);
    reviewToggle.hidden = !order?.completed;
    if (reviewToggle.hidden && participation === "review") participation = "comments";
    renderParticipation();
    const status = { pending: "Tu reseña está pendiente de aprobación.", approved: "Tu reseña ya está publicada en la portada." };
    reviewFeedback.textContent = status[order?.reviewStatus] || "";
  }

  function renderParticipation() {
    const showComments = Boolean(currentLesson && participation === "comments");
    const showReview = Boolean(currentLesson && participation === "review" && !reviewToggle.hidden);
    commentsToggle.setAttribute("aria-expanded", String(showComments));
    reviewToggle.setAttribute("aria-expanded", String(showReview));
    commentsPanel.hidden = !showComments;
    reviewPanel.hidden = !showReview;
  }

  for (const [section, button] of [["comments", commentsToggle], ["review", reviewToggle]]) {
    button.addEventListener("click", () => {
      participation = participation === section ? null : section;
      renderParticipation();
    });
  }

  async function markChapterSeen(order, chapter) {
    const key = `${order.id}/${chapter.id}`;
    if (savingChapters.has(key)) return;
    const owner = studentEmail;
    const isCurrent = () => currentLesson === order.id && currentChapter === chapter;
    savingChapters.add(key);
    if (isCurrent()) {
      retryChapterProgress.hidden = true;
      completeReading.disabled = true;
      chapterProgressFeedback.textContent = "Guardando avance…";
    }
    try {
      const data = await request(endpoint(order, `chapters/${chapter.id}/seen`), { version: chapter.version });
      if (studentEmail !== owner) return;
      render(data);
      if (isCurrent()) {
        chapterProgressFeedback.textContent = "";
        if (nextChapter) {
          if (document.fullscreenElement === player) await document.exitFullscreen().catch(() => {});
          if (isCurrent() && nextChapter && !nextChapterDialog.open) {
            $("#next-chapter-name").textContent = nextChapter.title;
            nextChapterDialog.showModal();
          }
        }
      }
    } catch (error) {
      if (studentEmail === owner && isCurrent()) {
        chapterProgressFeedback.textContent = error.message;
        retryChapterSave = () => markChapterSeen(order, chapter);
        retryChapterProgress.hidden = false;
      }
    } finally {
      savingChapters.delete(key);
      if (isCurrent()) completeReading.disabled = false;
    }
  }

  async function submitReview(button, payload) {
    const order = studentOrders.find(({ id }) => id === currentLesson);
    if (!order || button.disabled) return;
    const owner = studentEmail;
    button.disabled = true;
    reviewFeedback.textContent = "Guardando…";
    try {
      const data = await request(endpoint(order, "review"), payload);
      if (studentEmail !== owner) return;
      render(data);
      if (currentLesson === order.id) reviewForm.reset();
    } catch (error) {
      if (currentLesson === order.id && studentEmail === owner) reviewFeedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function run(control, action) {
    if (control.disabled) return;
    control.disabled = true;
    notice.textContent = "Procesando…";
    try {
      await action();
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      control.disabled = false;
    }
  }

  auth.addEventListener("submit", (event) => {
    event.preventDefault();
    run($("#student-submit"), async () => {
      const result = await request("/login", Object.fromEntries(new FormData(auth)));
      auth.reset();
      render(result);
    });
  });
  $("#student-logout").addEventListener("click", (event) => run(event.currentTarget, async () => render(await request("/logout", {}), "Sesión cerrada.")));
  completeReading.addEventListener("click", () => {
    const order = studentOrders.find(({ id }) => id === currentLesson);
    if (order && currentChapter && !currentChapter.hasVideo) markChapterSeen(order, currentChapter);
  });
  retryChapterProgress.addEventListener("click", () => retryChapterSave?.());
  $("#open-next-chapter").addEventListener("click", () => {
    const target = nextChapter;
    nextChapterDialog.close();
    target?.open();
  });
  reviewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = new FormData(reviewForm);
    submitReview(reviewForm.querySelector("button"), { rating: Number(fields.get("rating")), comment: fields.get("comment") });
  });
  request("").then((data) => render(data)).catch((error) => {
    notice.textContent = error.message;
  });
  window.setInterval(updateLiveTimers, 1000);
  window.setInterval(async () => {
    const owner = studentEmail;
    if (!owner || savingChapters.size) return;
    try {
      const data = await request("");
      if (studentEmail === owner && !savingChapters.size &&
          (data.student?.email !== owner || data.student?.name !== studentName ||
            JSON.stringify(data.orders) !== JSON.stringify(studentOrders) || JSON.stringify(data.referrals) !== JSON.stringify(studentReferrals))) render(data);
    } catch { /* El botón Actualizar estado permite reintentar. */ }
  }, 15000);
})();
