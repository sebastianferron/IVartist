"use strict";

const { sendHttps, webUrl } = require("./academy-provider-https");
const { normalizeWhatsAppNumber } = require("./home-config");

const defaults = { enabled: false, address: "", apiKey: "", session: "default", recipient: "", siteUrl: "", attachReceipt: false };
const deliverAttachments = (config) => config.attachReceipt === true && config.attachmentsConfirmed === true;
const currency = new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB" });
const attachmentUnavailable = new Set([404, 405, 413, 415, 422, 501]);

function createWaha({ getSettings, RequestError, requireText, id, publicOrigin, transport = sendHttps }) {
  const settings = () => getSettings() || defaults;

  function view() {
    const config = settings();
    const { apiKey, destinationId, attachmentsConfirmed, ...fields } = config;
    return { ...fields, siteUrl: publicOrigin || fields.siteUrl || "", keySaved: Boolean(apiKey), attachReceipt: deliverAttachments(config) };
  }

  function validate(input) {
    if (typeof input?.enabled !== "boolean" || typeof input.attachReceipt !== "boolean") {
      throw new RequestError(400, "Revisa las opciones de la integración con WhatsApp.");
    }
    const previous = settings();
    const address = webUrl(input.address, "URL de WAHA", { requireText, RequestError }).replace(/\/api\/?$/i, "").replace(/\/+$/, "");
    const cleanSite = webUrl(input.siteUrl || publicOrigin, "URL pública del sitio", { requireText, RequestError });
    if (cleanSite && new URL(cleanSite).pathname !== "/") throw new RequestError(400, "Indica la URL pública del sitio sin rutas.");
    const siteUrl = cleanSite ? new URL(cleanSite).origin : "";
    if (publicOrigin && siteUrl !== publicOrigin) {
      throw new RequestError(400, "El enlace de revisión debe usar el origen público configurado para el sitio.");
    }
    const session = requireText(input.session ?? defaults.session, 64, "Sesión", true);
    if (!/^[a-z0-9_-]+$/i.test(session)) throw new RequestError(400, "Usa letras, números, guiones o guiones bajos en la sesión.");
    const phone = requireText(input.recipient ?? "", 35, "WhatsApp de revisión");
    const number = normalizeWhatsAppNumber(phone);
    if (phone && (!phone.startsWith("+") || !number)) throw new RequestError(400, "Escribe el WhatsApp de revisión con su código de país, por ejemplo +591 70000000.");
    const recipient = number ? `+${number}` : "";
    const key = requireText(input.apiKey ?? "", 500, "API key de WAHA");
    if (key && !/^[!-~]+$/.test(key)) throw new RequestError(400, "La API key contiene caracteres no admitidos.");
    if (address !== previous.address && previous.apiKey && !key) throw new RequestError(400, "Vuelve a escribir la API key al cambiar la URL de WAHA.");
    const apiKey = key || previous.apiKey;
    if (input.enabled && (!address || !apiKey || !recipient || !siteUrl)) {
      throw new RequestError(400, "Completa la URL de WAHA, la API key, el WhatsApp de revisión y la URL pública del sitio.");
    }
    const sameDestination = address === previous.address && session === previous.session &&
      recipient === previous.recipient && siteUrl === previous.siteUrl && apiKey === previous.apiKey;
    const attachmentsEnabled = deliverAttachments(previous);
    if (((input.enabled && (!previous.enabled || !sameDestination)) ||
        (input.attachReceipt && !attachmentsEnabled)) && input.confirmDelivery !== true) {
      throw new RequestError(400, "Confirma el destino de los avisos y si se enviarán copias de los comprobantes.");
    }
    const unchangedDelivery = sameDestination && input.attachReceipt === attachmentsEnabled;
    return {
      enabled: input.enabled, address, apiKey, session, recipient, siteUrl, attachReceipt: input.attachReceipt,
      attachmentsConfirmed: input.attachReceipt && (attachmentsEnabled || input.confirmDelivery === true),
      destinationId: unchangedDelivery && previous.destinationId || id(),
    };
  }

  async function api(config, route, payload) {
    const headers = { "X-Api-Key": config.apiKey, Accept: "application/json" };
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    try {
      return await transport(new URL(`${config.address}/api/${route}`), { headers, body, method: body === undefined ? "GET" : "POST", timeout: 25_000 });
    } catch {
      throw new RequestError(502, "No se pudo contactar con WAHA.");
    }
  }

  async function testConnection() {
    const config = settings();
    if (!config.address || !config.apiKey) throw new RequestError(409, "Guarda primero la URL y la API key de WAHA.");
    const { status, result } = await api(config, `sessions/${encodeURIComponent(config.session)}`);
    if ([401, 403].includes(status)) throw new RequestError(502, "WAHA rechazó la clave o el acceso desde este servidor.");
    if (status === 404) throw new RequestError(502, "Crea la sesión de WhatsApp en WAHA y vuelve a probar.");
    if (status !== 200 || result?.name !== config.session) throw new RequestError(502, "WAHA no devolvió el estado de la sesión.");
    if (settings() !== config) throw new RequestError(409, "La conexión cambió. Vuelve a probar.");
    const states = { WORKING: "Conectada", STARTING: "Iniciando", SCAN_QR_CODE: "Escanea el QR desde WAHA", STOPPED: "Detenida", FAILED: "Con error" };
    return { connected: result.status === "WORKING", status: states[result.status] || "Sin conexión" };
  }

  async function notify(config, order, file) {
    function rejected(status, message) {
      const error = new RequestError(502, message);
      error.deliveryRejected = [400, 401, 403, 404, 405, 413, 415, 422, 429, 501].includes(status);
      return error;
    }
    const destination = { session: config.session, chatId: `${config.recipient.slice(1)}@c.us` };
    const link = new URL("/admin/dashboard", publicOrigin || config.siteUrl);
    link.searchParams.set("payment", order.id);
    link.hash = "academy-payments";
    const safeLine = (value) => (value || "").replace(/\s+/g, " ").trim();
    const text = [
      "Pago pendiente de revisión",
      `Curso: ${safeLine(order.title)}`,
      `Monto a verificar: ${currency.format(order.cents / 100)}`,
      `Revisar pago: ${link}`,
    ].join("\n");
    if (deliverAttachments(config) && file) {
      const { status } = await api(config, "sendFile", { ...destination, caption: text, file });
      if (status >= 200 && status < 300) return "attached";
      if (!attachmentUnavailable.has(status)) throw rejected(status, "WAHA no pudo enviar el comprobante.");
      if (settings() !== config) throw new RequestError(409, "La conexión cambió durante el envío.");
    }
    const { status } = await api(config, "sendText", { ...destination, text });
    if (status < 200 || status >= 300) throw rejected(status, "WAHA no pudo enviar el aviso de pago.");
    return "link";
  }

  return { settings, view, validate, testConnection, notify, deliverAttachments };
}

module.exports = { createWaha };
