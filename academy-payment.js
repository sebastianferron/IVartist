(() => {
  "use strict";

  const price = new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB" });
  const files = "image/jpeg,image/png,image/webp,application/pdf";
  const endpoint = (order, action) => `/orders/${order.id}/${action}`;
  const orderLink = (order) => `/mi-espacio#inscripcion-${order.id}`;
  const seenApprovals = new Set();
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };

  async function request(route, payload, method = payload === undefined ? "GET" : "POST") {
    const options = { method };
    if (payload !== undefined) {
      if (payload instanceof Blob || payload instanceof FormData) options.body = payload;
      else {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(payload);
      }
    }
    const response = await fetch(`/api/academy${route}`, options);
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error(result?.error || "No se pudo completar la operación. Intenta nuevamente.");
    return result;
  }

  function paymentMessage(order) {
    if (order.status === "submitted") return { title: "Verificando comprobante", detail: "Te avisaremos cuando tu curso esté listo." };
    if (order.status === "approved") {
      const live = order.category === "live";
      return {
        title: live ? "Tu acceso al vivo está listo" : "Tu curso está listo para ver",
        detail: order.demo ? "Prueba aprobada. Ya puedes abrir el contenido en Mi espacio." : "Pago confirmado. Tu acceso ya está disponible en Mi espacio.",
      };
    }
    if (order.status === "rejected") return { title: "Corrige el comprobante", detail: order.note || "Adjunta un comprobante nuevo para volver a enviar el pago a revisión." };
    return null;
  }

  function showApprovalAlerts(orders, announce) {
    for (const order of orders) {
      const age = Date.now() - Date.parse(order.updatedAt);
      if (order.status !== "approved" || !Number.isFinite(age) || age > 2 * 24 * 60 * 60_000 || seenApprovals.has(order.id)) continue;
      seenApprovals.add(order.id);
      try {
        const seen = JSON.parse(localStorage.getItem("ivanna.paymentApprovals") || "[]");
        if (Array.isArray(seen) && seen.includes(order.id)) continue;
        const recent = Array.isArray(seen) ? seen.slice(-99) : [];
        localStorage.setItem("ivanna.paymentApprovals", JSON.stringify([...recent, order.id]));
      } catch { /* Los avisos de esta pestaña funcionan sin almacenamiento local. */ }
      announce(order);
    }
  }

  function discountChoices(order, referrals, onUpdate) {
    const hasReward = !order.demo && referrals?.nextRewardPercent && order.discount?.kind !== "reward";
    const hasWelcome = !order.demo && referrals?.welcomePercent && order.discount?.kind !== "invite";
    if (order.status !== "awaiting_receipt" || (!referrals?.promoEnabled && !order.discount && !hasReward && !hasWelcome)) return null;
    const panel = node("div", "", "payment-discounts");
    const message = node("p", "", "payment-feedback");
    message.role = "status";
    const controls = node("div", "", "payment-discount-actions");
    let busy = false;

    async function apply(kind, code) {
      if (busy) return;
      busy = true;
      panel.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      message.textContent = "Actualizando el total…";
      try {
        onUpdate(await request(endpoint(order, "discount"), { kind, code }, "PUT"));
      } catch (error) { message.textContent = error.message; }
      finally {
        busy = false;
        panel.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      }
    }

    if (referrals?.promoEnabled) {
      const form = node("form", "", "payment-code-form");
      const label = node("label", "Código promocional");
      const input = node("input");
      input.type = "text";
      input.maxLength = 24;
      input.autocapitalize = "characters";
      input.spellcheck = false;
      input.required = true;
      input.value = order.discount?.code || "";
      const submit = node("button", "Aplicar código", "admin-secondary");
      submit.type = "submit";
      label.append(input);
      form.append(label, submit);
      form.addEventListener("submit", (event) => { event.preventDefault(); apply("promo", input.value); });
      panel.append(form);
    }
    for (const [kind, text, show] of [
      ["invite", `Aplicar ${referrals?.welcomePercent} % por invitación`, hasWelcome],
      ["reward", `Usar mi descuento del ${referrals?.nextRewardPercent} %`, hasReward],
      ["remove", "Quitar descuento", order.discount],
    ]) {
      if (!show) continue;
      const button = node("button", text, "admin-secondary");
      button.type = "button";
      button.addEventListener("click", () => apply(kind));
      controls.append(button);
    }
    if (controls.childElementCount) panel.append(controls);
    panel.append(message);
    return panel;
  }

  function render(container, order, onUpdate, { statusInHeading = false, referrals, onCancel } = {}) {
    const amount = node("p", `${price.format(order.cents / 100)}${order.demo ? " · Monto de prueba" : ""}`, "payment-amount");
    container.replaceChildren(amount);
    if (order.discount) {
      const labels = { promo: "Código promocional", invite: "Descuento de bienvenida", reward: "Premio por invitación" };
      const details = node("div", "", "payment-savings");
      details.append(node("s", price.format(order.baseCents / 100)),
        node("strong", `${order.discount.code || labels[order.discount.kind]} · −${order.discount.percent} %`),
        node("span", `Ahorras ${price.format(order.discount.savedCents / 100)}`));
      container.append(details);
    }
    const message = paymentMessage(order);
    if (message) {
      const status = node("div", "", "payment-state");
      status.dataset.state = order.status;
      status.setAttribute("role", "status");
      if (!statusInHeading) status.append(node("strong", message.title));
      status.append(node("p", message.detail, "payment-status"));
      container.append(status);
      if (order.status !== "rejected") return;
    }
    const discounts = discountChoices(order, referrals, onUpdate);
    if (discounts) container.append(discounts);

    const pair = node("div", "", "payment-qr-layout");
    const image = node("img", "", "payment-qr-image");
    image.src = `/api/academy${endpoint(order, "qr")}`;
    image.alt = order.demo ? "Código QR de demostración sin valor de pago" : "Código QR bancario de la inscripción";
    const info = node("div", "", "payment-qr-info");
    const download = node("a", "Descargar QR", "payment-download");
    download.href = `${image.src}?download=1`;
    download.download = "";
    info.append(node("p", order.instructions, "payment-instructions"), download);
    if (order.discount && !order.demo) info.prepend(node("p", `Ingresa el total de ${price.format(order.cents / 100)} al pagar con el QR.`, "payment-discount-total"));
    pair.append(image, info);

    const form = node("form", "", "payment-report");
    const label = node("label", order.demo ? "Adjuntar comprobante de prueba (obligatorio)" : "Adjuntar comprobante (obligatorio)");
    const receipt = node("input");
    receipt.type = "file";
    receipt.accept = files;
    receipt.required = true;
    form.noValidate = true;
    const button = node("button", order.demo ? "Simular aviso de pago" : "¡Ya pagué!", "community__submit payment-submit");
    button.type = "submit";
    button.setAttribute("aria-disabled", "true");
    const feedback = node("p", "", "payment-feedback");
    const explanation = order.demo
      ? "Adjunta un archivo de prueba y espera la aprobación para abrir el contenido de la demo."
      : "Debes pagar el curso, adjuntar el comprobante y esperar la aprobación para poder ingresar.";
    const help = node("p", explanation, "payment-help");
    help.id = `payment-help-${order.id}`;
    const alert = node("p", "", "payment-feedback payment-error");
    alert.id = `payment-error-${order.id}`;
    alert.setAttribute("role", "alert");
    feedback.setAttribute("role", "status");
    receipt.setAttribute("aria-describedby", `${help.id} ${alert.id}`);
    label.append(receipt);
    form.append(label, alert, button, feedback, help);

    function validateFile(announce) {
      const file = receipt.files[0];
      let error = "";
      if (!file) error = explanation;
      else if (!file.size) error = "El archivo está vacío. Adjunta un comprobante válido.";
      else if (file.size > 8 * 1024 * 1024) error = "El comprobante supera el límite de 8 MB.";
      else if (!/\.(?:jpe?g|png|webp|pdf)$/i.test(file.name)) error = "Adjunta el comprobante en JPG, PNG, WebP o PDF.";
      button.setAttribute("aria-disabled", String(Boolean(error)));
      receipt.setAttribute("aria-invalid", String(Boolean(error && (announce || file))));
      alert.textContent = announce || file ? error : "";
      return !error;
    }

    receipt.addEventListener("change", () => validateFile(false));
    let cancel;
    if (order.status === "awaiting_receipt" && onCancel) {
      cancel = node("button", "Cancelar inscripción sin pagar", "admin-secondary");
      cancel.type = "button";
      cancel.addEventListener("click", async () => {
        if (!confirm("Confirma solo si todavía no realizaste la transferencia. La inscripción dejará de estar disponible y se liberará el descuento reservado.")) return;
        cancel.disabled = button.disabled = receipt.disabled = true;
        feedback.textContent = "Cancelando inscripción…";
        try {
          await request(endpoint(order, "cancel"), undefined, "POST");
          onCancel();
        } catch (error) {
          alert.textContent = error.message;
        } finally {
          feedback.textContent = "";
          cancel.disabled = button.disabled = receipt.disabled = false;
        }
      });
      form.append(cancel);
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      if (!validateFile(true)) {
        receipt.focus();
        return;
      }
      button.disabled = true;
      receipt.disabled = true;
      if (cancel) cancel.disabled = true;
      feedback.textContent = "Enviando comprobante…";
      try {
        const data = await request(`${endpoint(order, "receipt")}?cents=${order.cents}`, receipt.files[0]);
        onUpdate(data);
      } catch (error) {
        alert.textContent = error.message;
      } finally {
        feedback.textContent = "";
        button.disabled = false;
        receipt.disabled = false;
        if (cancel) cancel.disabled = false;
      }
    });
    container.append(pair, form);
  }

  window.academyPayment = { request, render, endpoint, price, paymentMessage, orderLink, showApprovalAlerts };
})();
