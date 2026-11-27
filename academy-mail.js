"use strict";

function createPaymentMailer(env = process.env) {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.IVANNA_EMAIL_FROM?.trim();
  let site;
  try { site = new URL(env.IVANNA_SITE_URL || env.IVANNA_PUBLIC_ORIGIN); } catch { return null; }
  const local = site.protocol === "http:" && ["localhost", "127.0.0.1"].includes(site.hostname);
  if (!apiKey || !from || (site.protocol !== "https:" && !local) || site.username || site.password) return null;

  return async ({ id, email, orderId, title, status }) => {
    const approved = status === "approved";
    const link = new URL(`/mi-espacio#inscripcion-${orderId}`, site);
    const subject = approved ? "Pago aprobado. Tu curso está listo" : "Compra recibida. Verificando comprobante";
    const text = approved
      ? `Confirmamos el pago de «${title}». Ya puedes abrir tu inscripción en Mi espacio.\n\n${link}`
      : `Recibimos tu inscripción y el comprobante de «${title}». Estamos verificando el pago. Te avisaremos cuando tu curso esté listo.\n\n${link}`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": id },
      body: JSON.stringify({ from, to: [email], subject, text }),
      signal: AbortSignal.timeout(10000),
      redirect: "manual",
    });
    if (!response.ok) throw new Error(`El proveedor devolvió HTTP ${response.status}.`);
    const result = await response.json();
    if (!result.id) throw new Error("El proveedor no confirmó la recepción del correo.");
  };
}

module.exports = { createPaymentMailer };
