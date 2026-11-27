"use strict";

const DAY = 86_400_000;
const currencyCodes = new Set(["BOB", "USD", "EUR", "BRL", "ARS", "CLP", "PEN"]);
const movementTypes = { expense: "Gasto operativo", fee: "Comisión", refund: "Devolución" };
const expenseCategories = ["Producción audiovisual", "Maquillaje y materiales", "Publicidad", "Hosting", "Dominio", "Almacenamiento", "Software", "Comisiones bancarias", "Personal", "Impuestos", "Otros"];
const dateInBolivia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz", dateStyle: "short" });
const calendarDay = (value) => Number.isFinite(Date.parse(value)) ? dateInBolivia.format(new Date(value)) : "";
const isoDay = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
const validDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && isoDay(Date.parse(value)) === value;

function reportPeriod(params, RequestError) {
  const preset = params.get("period") || "month";
  if (preset === "custom") {
    const start = params.get("start");
    const end = params.get("end");
    if (!validDay(start) || !validDay(end) || start > end) throw new RequestError(400, "Elige un rango de fechas válido.");
    return { preset, start, end };
  }
  const today = dateInBolivia.format(new Date());
  const midnight = Date.parse(today);
  const [year, month] = today.split("-").map(Number);
  const previousMonth = Date.UTC(year, month - 2, 1);
  const currentMonth = Date.UTC(year, month - 1, 1);
  const periods = {
    today: [today, today], yesterday: [isoDay(midnight - DAY), isoDay(midnight - DAY)],
    week: [isoDay(midnight - 6 * DAY), today], days30: [isoDay(midnight - 29 * DAY), today],
    month: [isoDay(currentMonth), today], previous: [isoDay(previousMonth), isoDay(currentMonth - DAY)],
    year: [`${year}-01-01`, today], all: [null, null],
  };
  if (!Object.hasOwn(periods, preset)) throw new RequestError(400, "Elige un período válido.");
  const [start, end] = periods[preset];
  return { preset, start, end };
}

function createFinance({ getState, saveEntries, RequestError, readBody, readJsonBody, requireText, json, currentAdmin, storeAsset, discardAsset, sendAsset, orderOffer, offerCategory, communityCountries, id, now }) {
  function approved(order) {
    return order.status === "approved" && !order.demo;
  }

  function refundable(order, entries) {
    return order.cents - entries.filter((entry) => !entry.voidedAt && entry.kind === "refund" && entry.orderId === order.id)
      .reduce((sum, entry) => sum + entry.cents, 0);
  }

  function entryView({ proof, requestId, ...entry }) {
    return { ...entry, ...(proof && { proofUrl: `/api/admin/academy/finance/entries/${entry.id}/proof` }) };
  }

  function report(period) {
    const state = getState();
    const includes = (day) => day && (!period.start || day >= period.start) && (!period.end || day <= period.end);
    const students = new Map(state.students.map((student) => [student.id, student]));
    const sales = state.orders.filter((order) => approved(order) && includes(calendarDay(order.reviewedAt || order.updatedAt)))
      .map((order) => {
        const original = order.baseCents ?? order.cents;
        const country = communityCountries[students.get(order.studentId)?.profile?.country]?.name || "Sin país declarado";
        return {
          day: calendarDay(order.reviewedAt || order.updatedAt), title: order.title, offer: orderOffer(order),
          category: offerCategory(orderOffer(order)) || "course", country, cents: order.cents, original, discount: original - order.cents,
        };
      });
    const entries = state.financeEntries.filter((entry) => includes(entry.day)).sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at));
    const totals = new Map();
    const byOffer = new Map();
    const byCountry = new Map();
    const group = (currency) => {
      if (!totals.has(currency)) totals.set(currency, { currency, gross: 0, discount: 0, collected: 0, fees: 0, refunds: 0, expenses: 0, net: 0, result: 0 });
      return totals.get(currency);
    };
    const bob = group("BOB");
    for (const sale of sales) {
      bob.gross += sale.original;
      bob.discount += sale.discount;
      bob.collected += sale.cents;
      const offer = byOffer.get(sale.offer) || { title: sale.title, category: sale.category, count: 0, cents: 0 };
      offer.count += 1;
      offer.cents += sale.cents;
      byOffer.set(sale.offer, offer);
      const country = byCountry.get(sale.country) || { country: sale.country, count: 0, cents: 0 };
      country.count += 1;
      country.cents += sale.cents;
      byCountry.set(sale.country, country);
    }
    for (const entry of entries) {
      if (entry.voidedAt) continue;
      group(entry.currency)[{ expense: "expenses", fee: "fees", refund: "refunds" }[entry.kind]] += entry.cents;
    }
    for (const total of totals.values()) {
      total.net = total.collected - total.fees - total.refunds;
      total.result = total.net - total.expenses;
    }
    const pending = state.orders.filter((order) => !order.demo && order.status === "submitted" && includes(calendarDay(order.submittedAt))).length;
    return {
      period, totals: [...totals.values()], paid: sales.length, pending, averageCents: sales.length ? Math.round(bob.collected / sales.length) : 0,
      sales, offers: [...byOffer.values()].sort((a, b) => b.cents - a.cents), countries: [...byCountry.values()].sort((a, b) => b.cents - a.cents),
      entries: entries.map(entryView), categories: [...new Set([...expenseCategories, ...state.financeEntries.map(({ category }) => category).filter(Boolean)])],
    };
  }

  function exportReport(res, data) {
    const header = ["Fecha", "Movimiento", "Concepto", "Categoría", "País", "Moneda", "Precio original", "Descuento", "Importe"];
    const categories = { course: "Curso", special: "Especial", live: "En vivo" };
    const money = (cents) => (cents / 100).toFixed(2);
    const rows = [
      ...data.sales.map((sale) => [sale.day, "Pago aprobado por QR", sale.title, categories[sale.category], sale.country, "BOB", money(sale.original), money(sale.discount), money(sale.cents)]),
      ...data.entries.filter((entry) => !entry.voidedAt).map((entry) => [
        entry.day, movementTypes[entry.kind], entry.concept, entry.category, "", entry.currency, "", "", money(-entry.cents),
      ]),
    ].sort((a, b) => b[0].localeCompare(a[0]));
    const cell = (value, index) => {
      const text = String(value ?? "");
      const numeric = index >= 6 && /^-?\d+\.\d{2}$/.test(text);
      const neutral = numeric || !/^\s*[=+\-@\t\r\n]/.test(text) ? text : `'${text}`;
      return `"${neutral.replace(/"/g, '""')}"`;
    };
    const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="finanzas-ivanna.csv"' });
    res.end(csv);
  }

  async function addEntry(req, res) {
    let data;
    let proof;
    const contentType = req.headers["content-type"] || "";
    if (/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) {
      const body = await readBody(req, 8 * 1024 * 1024 + 16 * 1024);
      const fields = await new Response(body, { headers: { "Content-Type": contentType } }).formData().catch(() => null);
      if (!fields) throw new RequestError(400, "Revisa los datos del movimiento.");
      data = Object.fromEntries(fields);
      if (data.proof instanceof Blob && data.proof.size) {
        if (data.proof.size > 8 * 1024 * 1024) throw new RequestError(413, "El comprobante puede pesar hasta 8 MB.");
        proof = Buffer.from(await data.proof.arrayBuffer());
      }
    } else data = await readJsonBody(req, 8192);
    const admin = currentAdmin(req);
    if (!admin) throw new RequestError(401, "La sesión ha terminado.");
    const entries = getState().financeEntries;
    const requestId = data?.requestId;
    if (typeof requestId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId)) throw new RequestError(400, "Vuelve a intentar guardar.");
    const duplicate = entries.find((entry) => entry.requestId === requestId);
    if (duplicate) return json(res, 200, { entry: entryView(duplicate) });
    const kind = data?.kind;
    if (!Object.hasOwn(movementTypes, kind)) throw new RequestError(400, "Elige el tipo de movimiento.");
    const day = data?.day;
    if (!validDay(day) || day > dateInBolivia.format(new Date())) throw new RequestError(400, "Elige una fecha válida hasta hoy.");
    const amount = requireText(data?.amount, 14, "Importe", true).replace(",", ".");
    const cents = Math.round(Number(amount) * 100);
    if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(amount) || cents <= 0) throw new RequestError(400, "Escribe un importe positivo de hasta dos decimales.");
    const currency = data?.currency;
    if (!currencyCodes.has(currency)) throw new RequestError(400, "Elige una moneda disponible.");
    const concept = requireText(data?.concept, 120, "Concepto", true);
    const category = kind === "expense" ? requireText(data?.category, 80, "Categoría", true) : movementTypes[kind];
    const provider = requireText(data?.provider ?? "", 120, "Proveedor");
    const method = requireText(data?.method ?? "", 40, "Método de pago");
    const note = requireText(data?.note ?? "", 600, "Observaciones");
    let orderId;
    if (kind === "refund") {
      const order = getState().orders.find((value) => value.id === data.orderId && approved(value));
      if (!order) throw new RequestError(400, "Selecciona una compra aprobada.");
      if (currency !== "BOB" || refundable(order, entries) < cents || day < calendarDay(order.reviewedAt || order.updatedAt)) {
        throw new RequestError(400, "La devolución debe registrarse en bolivianos, desde la fecha de compra y dentro del saldo disponible.");
      }
      orderId = order.id;
    }
    const entry = { id: id(), requestId, kind, day, currency, cents, concept, category, provider, method, note, ...(orderId && { orderId }), at: now(), author: admin.username };
    if (proof) entry.proof = await storeAsset("receipt", proof);
    try {
      if (!currentAdmin(req)) throw new RequestError(401, "La sesión ha terminado.");
      if (entries !== getState().financeEntries) throw new RequestError(409, "Los movimientos cambiaron. Vuelve a intentar.");
      saveEntries([entry, ...entries]);
    }
    catch (error) {
      if (entry.proof) await discardAsset(entry.proof, "receipt");
      throw error;
    }
    return json(res, 201, { entry: entryView(entry) });
  }

  return async (req, res, route, read) => {
    const params = new URL(req.url, "http://localhost").searchParams;
    if (read && ["/api/admin/academy/finance", "/api/admin/academy/finance/export"].includes(route)) {
      const data = report(reportPeriod(params, RequestError));
      if (route.endsWith("/export")) return exportReport(res, data);
      const { sales, ...publicReport } = data;
      return json(res, 200, publicReport);
    }
    if (read && route === "/api/admin/academy/finance/refundable") {
      const state = getState();
      const students = new Map(state.students.map(({ id, name }) => [id, name]));
      const orders = state.orders.filter(approved).map((order) => ({
        id: order.id, title: order.title, day: calendarDay(order.reviewedAt || order.updatedAt),
        student: students.get(order.studentId), balance: refundable(order, state.financeEntries),
      })).filter(({ balance }) => balance > 0).sort((a, b) => b.day.localeCompare(a.day));
      return json(res, 200, { orders });
    }
    if (req.method === "POST" && route === "/api/admin/academy/finance/entries") return addEntry(req, res);
    const target = /^\/api\/admin\/academy\/finance\/entries\/([a-f0-9]{32})(\/proof)?$/.exec(route);
    if (target) {
      const entries = getState().financeEntries;
      const entry = entries.find((item) => item.id === target[1]);
      if (!entry) throw new RequestError(404, "Movimiento no disponible.");
      if (read && target[2]) return sendAsset(req, res, entry.proof, "receipt");
      if (req.method === "DELETE" && !target[2]) {
        if (entry.voidedAt) return json(res, 200, { entry: entryView(entry) });
        const voided = { ...entry, voidedAt: now(), voidedBy: currentAdmin(req).username };
        saveEntries(entries.map((item) => item === entry ? voided : item));
        return json(res, 200, { entry: entryView(voided) });
      }
    }
    throw new RequestError(404, "Página no encontrada.");
  };
}

module.exports = { createFinance };
