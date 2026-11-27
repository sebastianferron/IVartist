"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

function decodeTotpSecret(secret) {
  if (!secret) return null;
  if (typeof secret !== "string") throw new Error("La clave de autenticación administrativa no es válida.");
  const value = secret.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  if (!/^[A-Z2-7]{32,128}$/.test(value)) throw new Error("Configura la clave TOTP administrativa en Base32, con al menos 32 caracteres.");
  const bits = Array.from(value, (char) => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  const bytes = bits.match(/.{8}/g).map((byte) => parseInt(byte, 2));
  return Buffer.from(bytes);
}

function acceptedTotp(secret, value, afterStep, time = Date.now()) {
  if (typeof value !== "string" || !/^\d{6}$/.test(value.trim())) return null;
  const candidate = Buffer.from(value.trim());
  const window = Math.floor(time / 30_000);
  for (const step of [window, window - 1, window + 1]) {
    if (step <= afterStep) continue;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac("sha1", secret).update(counter).digest();
    const offset = digest.at(-1) & 15;
    const expected = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
    if (timingSafeEqual(candidate, Buffer.from(expected))) return step;
  }
  return null;
}

module.exports = { decodeTotpSecret, acceptedTotp };
