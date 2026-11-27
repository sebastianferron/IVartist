"use strict";

const { lookup } = require("node:dns");
const { request } = require("node:https");
const { BlockList, isIP } = require("node:net");

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]]) {
  blocked.addSubnet(address, prefix, "ipv4");
}
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");

function publicLookup(hostname, options, callback) {
  lookup(hostname, { all: true, family: options.family || 0 }, (error, records) => {
    if (error) return callback(error);
    const publicAddresses = records.filter(({ address, family }) => family === 4
      ? !blocked.check(address, "ipv4")
      : globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6"));
    if (!publicAddresses.length) return callback(new Error("El dominio no apunta a una dirección pública."));
    if (options.all) return callback(null, publicAddresses);
    const { address, family } = publicAddresses[0];
    return callback(null, address, family);
  });
}

function sendHttps(url, { method = "POST", headers, body, timeout = 12_000 }) {
  return new Promise((resolve, reject) => {
    const exchange = request(url, { method, headers, lookup: publicLookup, signal: AbortSignal.timeout(timeout) }, (response) => {
      const chunks = [];
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > 128 * 1024) return response.destroy(new Error("Respuesta demasiado grande."));
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* El llamador comprueba el formato. */ }
        resolve({ status: response.statusCode, result });
      });
    });
    exchange.on("error", reject);
    exchange.end(body);
  });
}

function webUrl(value, label, { requireText, RequestError }) {
  const text = requireText(value ?? "", 400, label);
  if (!text) return "";
  let url;
  try { url = new URL(text); } catch { /* Se devuelve el mismo mensaje de validación. */ }
  const host = url?.hostname || "";
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    !host.includes(".") || isIP(host.replace(/^\[|\]$/g, "")) || /(?:^|\.)(?:localhost|local|internal)\.?$/i.test(host)) {
    throw new RequestError(400, `Usa un dominio HTTPS para «${label}».`);
  }
  return url.href;
}

module.exports = { sendHttps, webUrl };
