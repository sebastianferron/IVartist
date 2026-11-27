(() => {
  "use strict";
  const panel = document.querySelector("#finanzas");
  const filters = panel.querySelector("#finance-filters");
  const form = panel.querySelector("#finance-entry");
  const status = panel.querySelector("#finance-status");
  const entryStatus = panel.querySelector("#finance-entry-status");
  const range = [...filters.querySelectorAll("[data-finance-range]")];
  const refundLabel = form.querySelector("[data-refund-order]");
  const categoryLabel = form.querySelector("[data-expense-category]");
  const exportLink = panel.querySelector("#finance-export");
  const printButton = panel.querySelector("#finance-print");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz", dateStyle: "short" }).format(new Date());
  const typeNames = { expense: "Gasto operativo", fee: "Comisión", refund: "Devolución" };
  const categoryNames = { course: "Curso", special: "Especial", live: "En vivo" };
  const amounts = new Map();
  let requestId;
  let loadVersion = 0;
  let applied = "period=month";

  function el(tag, value = "", className = "") {
    const element = document.createElement(tag);
    element.textContent = value;
    element.className = className;
    return element;
  }

  function money(cents, currency = "BOB") {
    if (!amounts.has(currency)) amounts.set(currency, new Intl.NumberFormat("es-BO", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    return amounts.get(currency).format(cents / 100);
  }

  async function request(route = "", method = "GET", body) {
    const response = await fetch(`/api/admin/academy/finance${route}`, { method, body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
    return data;
  }

  function table(columns, rows, empty) {
    if (!rows.length) return el("p", empty, "finance-empty");
    const outer = el("div", "", "finance-table-scroll");
    outer.tabIndex = 0;
    const grid = document.createElement("table");
    const header = grid.createTHead().insertRow();
    for (const column of columns) {
      const label = el("th", column);
      label.scope = "col";
      header.append(label);
    }
    const body = grid.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const value of row) tr.insertCell().append(value);
    }
    outer.append(grid);
    return outer;
  }

  function monetarySummary(total, data) {
    const section = el("section", "", "overview-panel finance-currency");
    section.append(el("h3", total.currency));
    const numbers = el("dl", "", "finance-kpis");
    const entries = [
      ["Importe bruto", total.gross], ["Descuentos", total.discount], ["Cobros por QR", total.collected],
      ["Comisiones", total.fees], ["Devoluciones", total.refunds], ["Ingresos netos", total.net],
      ["Gastos operativos", total.expenses], ["Resultado estimado", total.result],
    ];
    if (total.currency === "BOB") entries.push(["Promedio por venta", data.averageCents]);
    for (const [label, value] of entries) {
      const item = document.createElement("div");
      item.append(el("dt", label), el("dd", money(value, total.currency)));
      numbers.append(item);
    }
    section.append(numbers);
    if (total.currency === "BOB") section.append(el("p", `${data.paid} pagos aprobados · ${data.pending} pendientes de revisión`, "finance-counts"));
    return section;
  }

  function actions(entry) {
    const controls = el("div", "", "finance-entry-actions");
    if (entry.proofUrl) {
      const link = el("a", "Comprobante", "back-link");
      link.href = entry.proofUrl;
      controls.append(link);
    }
    if (!entry.voidedAt) {
      const cancel = el("button", "Anular", "admin-secondary");
      cancel.type = "button";
      cancel.setAttribute("aria-label", `Anular ${entry.concept}`);
      cancel.addEventListener("click", async () => {
        if (!confirm(`¿Anular «${entry.concept}»?`)) return;
        cancel.disabled = true;
        try {
          await request(`/entries/${entry.id}`, "DELETE");
          await load(applied);
        } catch (error) { status.textContent = error.message; }
        finally { cancel.disabled = false; }
      });
      controls.append(cancel);
    }
    return controls;
  }

  function draw(data) {
    const { period, totals, offers, countries, entries, categories } = data;
    panel.querySelector("#finance-period").textContent = period.start ? `${period.start} al ${period.end} · Hora de Bolivia` : "Histórico · Hora de Bolivia";
    panel.querySelector("#finance-totals").replaceChildren(...totals.map((total) => monetarySummary(total, data)));
    panel.querySelector("#finance-offers").replaceChildren(table(["Oferta", "Categoría", "Ventas", "QR cobrado"],
      offers.map(({ title, category, count, cents }) => [title, categoryNames[category], String(count), money(cents)]), "Todavía no hay ventas aprobadas en este período."));
    panel.querySelector("#finance-countries").replaceChildren(table(["País", "Ventas", "QR cobrado"],
      countries.map(({ country, count, cents }) => [country, String(count), money(cents)]), "Todavía no hay ingresos por país en este período."));
    panel.querySelector("#finance-entries").replaceChildren(table(["Fecha", "Movimiento", "Concepto", "Importe", "Estado", "Acciones"],
      entries.map((entry) => {
        const detail = el("div", entry.concept);
        const summary = [entry.category !== typeNames[entry.kind] && entry.category, entry.provider, entry.method, entry.note].filter(Boolean).join(" · ");
        if (summary) detail.append(el("small", summary));
        return [entry.day, typeNames[entry.kind], detail, money(entry.cents, entry.currency), entry.voidedAt ? "Anulado" : "Registrado", actions(entry)];
      }), "Todavía no hay movimientos en este período."));
    panel.querySelector("#finance-categories").replaceChildren(...categories.map((name) => new Option(name)));
  }

  async function load(query) {
    const version = ++loadVersion;
    status.textContent = "Consultando movimientos…";
    try {
      const data = await request(`?${query}`);
      if (version !== loadVersion) return;
      draw(data);
      applied = query;
      exportLink.href = `/api/admin/academy/finance/export?${query}`;
      exportLink.hidden = false;
      printButton.hidden = false;
      status.textContent = "";
    } catch (error) {
      if (version === loadVersion) status.textContent = error.message;
    }
  }

  function showRange() {
    const custom = filters.elements.period.value === "custom";
    for (const label of range) {
      label.hidden = !custom;
      const input = label.querySelector("input");
      input.disabled = !custom;
      input.required = custom;
    }
  }

  async function showEntryFields() {
    const type = form.elements.kind.value;
    const refund = type === "refund";
    const expense = type === "expense";
    refundLabel.hidden = !refund;
    form.elements.orderId.disabled = !refund;
    form.elements.orderId.required = refund;
    categoryLabel.hidden = !expense;
    form.elements.category.disabled = !expense;
    form.elements.category.required = expense;
    form.elements.currency.disabled = refund;
    if (!refund) return;
    form.elements.currency.value = "BOB";
    const select = form.elements.orderId;
    select.replaceChildren(new Option("Consultando compras aprobadas…", ""));
    try {
      const { orders } = await request("/refundable");
      if (form.elements.kind.value !== "refund") return;
      select.replaceChildren(new Option(orders.length ? "Selecciona la compra" : "No hay compras con saldo para devolver", ""),
        ...orders.map(({ id, title, day, student, balance }) => new Option(`${title} · ${student || "Participante"} · ${day} · ${money(balance)}`, id)));
    } catch (error) { entryStatus.textContent = error.message; }
  }

  filters.elements.period.addEventListener("change", showRange);
  filters.addEventListener("submit", (event) => {
    event.preventDefault();
    load(new URLSearchParams(new FormData(filters)).toString());
  });
  form.elements.day.value = today;
  form.elements.day.max = today;
  form.elements.kind.addEventListener("change", showEntryFields);
  form.addEventListener("input", () => { requestId = undefined; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    if (button.disabled) return;
    button.disabled = true;
    requestId ||= crypto.randomUUID();
    const key = requestId;
    const body = new FormData(form);
    body.set("requestId", key);
    body.set("currency", form.elements.currency.value);
    try {
      await request("/entries", "POST", body);
      if (requestId === key) {
        requestId = undefined;
        form.reset();
        form.elements.day.value = today;
        showEntryFields();
      }
      entryStatus.textContent = "Movimiento registrado.";
      await load(applied);
    } catch (error) { entryStatus.textContent = error.message; }
    finally { button.disabled = false; }
  });
  printButton.addEventListener("click", () => window.print());
  document.addEventListener("dashboard:view", ({ detail }) => { if (detail === "finanzas") load(applied); });
  showRange();
})();
