"use strict";

const EMPTY_SETTINGS = {
  promo: { enabled: false, code: "", percent: 0 },
  invites: { enabled: false, buyerPercent: 0, referrerPercent: 0 },
};
const personalPattern = /^IV-[A-F0-9]{16}$/;
const codePattern = /^[A-Z0-9][A-Z0-9-]{3,23}$/;
const automaticCode = (student) => `IV-${student.id.slice(0, 16).toUpperCase()}`;
const codeFor = (student) => student.referralCode || automaticCode(student);
const normalizeCode = (value) => typeof value === "string" ? value.trim().toUpperCase() : "";

function createReferrals({ getState, RequestError }) {
  function percent(value, label, enabled) {
    if (!Number.isInteger(value) || value < (enabled ? 1 : 0) || value > 99) {
      throw new RequestError(400, `Indica un porcentaje de 1 a 99 para ${label}.`);
    }
    return value;
  }

  function settings() {
    return getState().referralSettings || EMPTY_SETTINGS;
  }

  function codeOwner(code) {
    return getState().students.find((student) =>
      code === codeFor(student) || code === automaticCode(student) || student.referralAliases?.includes(code));
  }

  function checkCode(student, input) {
    const code = normalizeCode(input);
    if (!codePattern.test(code)) throw new RequestError(400, "Usa de 4 a 24 letras, números o guiones. Empieza con una letra o un número.");
    const owner = codeOwner(code);
    const reserved = code === settings().promo.code || (personalPattern.test(code) && code !== automaticCode(student));
    return { code, available: !reserved && (!owner || owner.id === student.id) };
  }

  function updateCode(student, input) {
    const { code, available } = checkCode(student, input);
    if (!available) throw new RequestError(409, "Ese código ya está en uso. Prueba con otro.");
    if (code === codeFor(student)) return student;
    const used = [...(student.referralAliases || []), student.referralCode];
    const referralAliases = [...new Set(used.filter((previous) => previous && previous !== code))];
    return { ...student, referralCode: code, referralAliases };
  }

  function validate(input) {
    const promo = input?.promo;
    const invites = input?.invites;
    if (typeof promo?.enabled !== "boolean" || typeof invites?.enabled !== "boolean") throw new RequestError(400, "Revisa las opciones de referidos.");
    const code = normalizeCode(promo.code);
    if ((promo.enabled || code) && (!codePattern.test(code) || personalPattern.test(code))) {
      throw new RequestError(400, "Usa un código promocional de 4 a 24 letras, números o guiones. El formato de los códigos personales está reservado.");
    }
    if (code && codeOwner(code)) throw new RequestError(409, "Ese código pertenece a una invitación personal. Elige otro código promocional.");
    return {
      promo: { enabled: promo.enabled, code, percent: percent(promo.percent, "el código promocional", promo.enabled) },
      invites: {
        enabled: invites.enabled,
        buyerPercent: percent(invites.buyerPercent, "la persona invitada", invites.enabled),
        referrerPercent: percent(invites.referrerPercent, "quien invita", invites.enabled),
      },
    };
  }

  function invitation(codeInput) {
    if (codeInput === undefined || codeInput === "") return undefined;
    if (typeof codeInput !== "string" || codeInput.length > 40) throw new RequestError(400, "Revisa el código de invitación.");
    const code = normalizeCode(codeInput);
    if (!code) return undefined;
    const { invites } = settings();
    const referrer = codePattern.test(code) && codeOwner(code);
    if (!invites.enabled || !referrer || referrer.demo) throw new RequestError(400, "El código de invitación no está disponible. Revisa el código o deja el campo vacío.");
    return { referrerId: referrer.id, buyerPercent: invites.buyerPercent, referrerPercent: invites.referrerPercent };
  }

  function welcomeDiscount(student, order) {
    if (!student.invitation || student.demo || order?.demo) return null;
    const otherOrders = getState().orders.filter((item) => item.studentId === student.id && item.id !== order?.id && !item.demo);
    if (otherOrders.some((item) => item.status === "approved" || (item.status !== "cancelled" && item.discount?.kind === "invite"))) return null;
    return { kind: "invite", percent: student.invitation.buyerPercent };
  }

  function rewards(studentId) {
    const orders = getState().orders;
    const used = new Set(orders.filter((order) => order.studentId === studentId && order.status !== "cancelled" && order.discount?.kind === "reward")
      .map((order) => order.discount.rewardId));
    return orders.filter((order) => order.referralReward?.studentId === studentId && order.status === "approved" && !used.has(order.id))
      .map((order) => ({ kind: "reward", rewardId: order.id, percent: order.referralReward.percent }))
      .sort((a, b) => b.percent - a.percent);
  }

  function newReward(order) {
    const state = getState();
    const buyer = state.students.find(({ id }) => id === order.studentId);
    if (order.demo || order.status !== "approved" || buyer?.demo || !buyer?.invitation) return null;
    if (state.orders.some((item) => item.id !== order.id && item.studentId === buyer.id && item.status === "approved" && !item.demo)) return null;
    return { studentId: buyer.invitation.referrerId, percent: buyer.invitation.referrerPercent };
  }

  function checkApproval(order) {
    const otherOrders = getState().orders.filter((item) =>
      item.id !== order.id && item.studentId === order.studentId && !item.demo);
    if (order.discount?.kind === "invite") {
      if (otherOrders.some((item) => item.status === "approved")) {
        throw new RequestError(409, "El descuento de bienvenida solo se admite en la primera compra. Concilia el importe con la estudiante antes de continuar.");
      }
    } else if (otherOrders.some((item) => item.status === "submitted" && item.discount?.kind === "invite")) {
      throw new RequestError(409, "Revisa primero el comprobante de la inscripción con descuento de bienvenida.");
    }
  }

  function discountedAmount(cents, discount) {
    return discount ? Math.max(1, Math.round(cents * (100 - discount.percent) / 100)) : cents;
  }

  function apply(order, discount) {
    const baseCents = order.baseCents ?? order.cents;
    const cents = discountedAmount(baseCents, discount);
    if (discount && cents === baseCents) throw new RequestError(400, "El precio no admite este descuento por redondeo.");
    return { ...order, cents, baseCents, discount: discount ? { ...discount, savedCents: baseCents - cents } : null };
  }

  function newQuote(student, order) {
    if (order.demo) return order;
    const discount = welcomeDiscount(student, order) || rewards(student.id)[0];
    return discount && discountedAmount(order.cents, discount) < order.cents ? apply(order, discount) : order;
  }

  function changeDiscount(student, order, input) {
    if (order.status !== "awaiting_receipt") throw new RequestError(409, "El importe queda fijado cuando envías el comprobante.");
    if (input?.kind === "remove") return apply(order, null);
    let selection;
    if (input?.kind === "promo") {
      const promo = settings().promo;
      const code = normalizeCode(input.code);
      if (!promo.enabled || !codePattern.test(code) || code !== promo.code) throw new RequestError(400, "El código promocional no es válido o está inactivo.");
      selection = { kind: "promo", code, percent: promo.percent };
    } else if (input?.kind === "invite") {
      selection = welcomeDiscount(student, order);
    } else if (input?.kind === "reward" && !order.demo) {
      selection = order.discount?.kind === "reward" ? order.discount : rewards(student.id)[0];
    }
    if (!selection) throw new RequestError(409, "Ese descuento ya no está disponible para esta inscripción.");
    return apply(order, selection);
  }

  function member(student) {
    const { promo, invites } = settings();
    const available = student ? rewards(student.id) : [];
    const welcome = student && welcomeDiscount(student);
    const showPlan = student && invites.enabled && !student.demo;
    return {
      promoEnabled: promo.enabled, invitesEnabled: invites.enabled,
      ...(student && {
        code: codeFor(student),
        ...(student.demo && { demo: true }),
        ...(showPlan && { plan: { buyerPercent: invites.buyerPercent, referrerPercent: invites.referrerPercent } }),
        welcomePercent: welcome?.percent || 0,
        rewardCount: available.length,
        nextRewardPercent: available[0]?.percent || 0,
      }),
    };
  }
  return { settings, validate, invitation, newQuote, changeDiscount, checkApproval, newReward, member, checkCode, updateCode };
}

module.exports = { createReferrals };
