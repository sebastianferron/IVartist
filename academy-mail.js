"use strict";

function createResendSender(env) {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.IVANNA_EMAIL_FROM?.trim();
  let site;
  try { site = new URL(env.IVANNA_SITE_URL || env.IVANNA_PUBLIC_ORIGIN); } catch { return null; }
  const local = site.protocol === "http:" && ["localhost", "127.0.0.1"].includes(site.hostname);
  if (!apiKey || !from || (site.protocol !== "https:" && !local) || site.username || site.password) return null;

  const send = async ({ id, email, subject, text }) => {
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
  return { send, site };
}

function createPaymentMailer(env = process.env) {
  const provider = createResendSender(env);
  if (!provider) return null;
  return ({ id, email, orderId, title, status }) => {
    const approved = status === "approved";
    const link = new URL(`/mi-espacio#inscripcion-${orderId}`, provider.site);
    const subject = approved ? "Pago aprobado. Tu curso está listo" : "Compra recibida. Verificando comprobante";
    const text = approved
      ? `Confirmamos el pago de «${title}». Ya puedes abrir tu inscripción en Mi espacio.\n\n${link}`
      : `Recibimos tu inscripción y el comprobante de «${title}». Estamos verificando el pago. Te avisaremos cuando tu curso esté listo.\n\n${link}`;
    return provider.send({ id, email, subject, text });
  };
}

function createAccountMailer(env = process.env) {
  const provider = createResendSender(env);
  if (!provider) return null;
  return ({ id, email, fragment, kind }) => {
    if (kind === "changed") {
      return provider.send({
        id, email, subject: "Correo de tu cuenta actualizado",
        text: "El correo de tu cuenta de Ivanna Saldaña se actualizó. Si no solicitaste este cambio, contacta con el equipo de soporte del sitio.",
      });
    }
    const link = new URL("/mi-espacio", provider.site);
    link.hash = fragment;
    const signup = kind === "register";
    const subject = signup ? "Confirma tu correo para crear tu cuenta" : "Verifica el correo de tu cuenta";
    const details = signup ? "Abre el enlace e introduce la contraseña que elegiste para completar el registro." : "Inicia sesión en Mi espacio y abre el enlace para confirmar esta dirección.";
    const text = `${details}\n\n${link}\n\nEl enlace vence en 30 minutos. Si no lo solicitaste, ignora este mensaje.`;
    return provider.send({ id, email, subject, text });
  };
}

module.exports = { createPaymentMailer, createAccountMailer };
