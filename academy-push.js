"use strict";

const path = require("node:path");
const webpush = require("web-push");

function pushEndpoint(value) {
  if (typeof value !== "string" || value.length > 1800) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const { hostname } = url;
  const provider = hostname === "fcm.googleapis.com" || hostname === "updates.push.services.mozilla.com" ||
    hostname === "push.services.mozilla.com" || hostname === "web.push.apple.com" || hostname.endsWith(".push.apple.com") ||
    hostname === "wns.windows.com" || hostname.endsWith(".notify.windows.com") || hostname.endsWith(".wns.windows.com");
  if (!provider || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.pathname === "/") return null;
  return url.href;
}

function subscriptionData(value) {
  const endpoint = pushEndpoint(value?.endpoint);
  const p256dh = value?.keys?.p256dh;
  const auth = value?.keys?.auth;
  if (!endpoint || typeof p256dh !== "string" || !/^B[A-Za-z0-9_-]{86}$/.test(p256dh) ||
      typeof auth !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

function createPush(dataDir, { readJsonFile, writeJsonFile, sendPush = webpush.sendNotification, contact = process.env.IVANNA_PUSH_CONTACT || "mailto:soporte@example.test" }) {
  let keys;
  function configuration() {
    if (keys) return keys;
    const file = path.join(dataDir, "push-keys.json");
    keys = readJsonFile(file, null);
    if (!keys) {
      const generated = webpush.generateVAPIDKeys();
      writeJsonFile(file, generated);
      keys = generated;
    }
    return keys;
  }

  async function send(subscription, message) {
    return sendPush(subscription, JSON.stringify(message), {
      TTL: 24 * 60 * 60, timeout: 9000,
      vapidDetails: { subject: contact, ...configuration() },
    });
  }

  async function deliver(recipients, message, removeExpired) {
    for (let index = 0; index < recipients.length; index += 8) {
      await Promise.all(recipients.slice(index, index + 8).map(async (recipient) => {
        try { await send(recipient.subscription, message); }
        catch (error) {
          if ([404, 410].includes(error.statusCode)) removeExpired(recipient);
          else console.warn("No se pudo entregar un aviso web.", error.statusCode || error.code || "error");
        }
      }));
    }
  }

  return { publicKey: () => configuration().publicKey, deliver };
}

module.exports = { createPush, pushEndpoint, subscriptionData };
