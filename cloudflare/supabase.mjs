import { Buffer } from "node:buffer";
import { basename } from "node:path";

const protectedDocuments = new Set(["academy.waha", "academy.plugNmeet", "push-keys.json"]);
const text = new TextEncoder();
const decoder = new TextDecoder();

async function secretEncoder(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret || "")) throw new Error("Falta IVANNA_STATE_KEY.");
  const key = await crypto.subtle.importKey("raw", Buffer.from(secret, "hex"), "AES-GCM", false, ["encrypt", "decrypt"]);
  const cipher = (name, iv) => ({ name: "AES-GCM", iv, additionalData: text.encode(name) });
  return {
    async lock(name, value) {
      if (!protectedDocuments.has(name)) return value;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(cipher(name, iv), key, text.encode(JSON.stringify(value)));
      return { iv: Buffer.from(iv).toString("base64url"), encrypted: Buffer.from(encrypted).toString("base64url") };
    },
    async unlock(name, value) {
      if (!protectedDocuments.has(name)) return value;
      const bytes = await crypto.subtle.decrypt(
        cipher(name, Buffer.from(value.iv, "base64url")), key, Buffer.from(value.encrypted, "base64url"),
      );
      return JSON.parse(decoder.decode(bytes));
    },
  };
}

export function supabaseClient(env, send = fetch) {
  const endpoint = new URL(env.SUPABASE_URL);
  const secret = env.SUPABASE_SECRET_KEY;
  if (endpoint.protocol !== "https:" || endpoint.href !== `${endpoint.origin}/` || !secret?.startsWith("sb_secret_")) {
    throw new Error("Configura SUPABASE_URL y SUPABASE_SECRET_KEY.");
  }
  async function rpc(name, data) {
    const response = await send(new URL(`/rest/v1/rpc/${name}`, endpoint), {
      method: "POST",
      headers: { apikey: secret, "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(12_000),
      redirect: "manual",
    });
    if (!response.ok) throw Object.assign(new Error(`Supabase devolvió HTTP ${response.status}.`), { status: response.status });
    return response.json();
  }
  return { rpc };
}

export async function openDocuments(env, send) {
  const client = supabaseClient(env, send);
  const encoder = await secretEncoder(env.IVANNA_STATE_KEY);
  const snapshot = await client.rpc("ivartist_read_state", {});
  let revision = snapshot.revision;
  if (!Number.isSafeInteger(revision)) throw new Error("La revisión de Supabase no es válida.");
  const documents = new Map(await Promise.all(Object.entries(snapshot.documents).map(async ([name, value]) => [name, await encoder.unlock(name, value)])));
  const changes = new Map();
  const removed = new Set();
  const write = (name, value) => {
    if (Object.is(documents.get(name), value) || JSON.stringify(documents.get(name)) === JSON.stringify(value)) return;
    documents.set(name, value);
    changes.set(name, value);
    removed.delete(name);
  };

  return {
    read(file, fallback) {
      const name = basename(file);
      if (name === "admin.json") return JSON.parse(env.IVANNA_ADMIN_ACCOUNT || "null") || fallback;
      if (name !== "academy.json") return documents.get(name) ?? fallback;
      const state = Object.fromEntries([...documents].filter(([key]) => key.startsWith("academy.")).map(([key, value]) => [key.slice(8), value]));
      return Object.keys(state).length ? state : fallback;
    },
    write(file, value) {
      const name = basename(file);
      if (name !== "academy.json") return write(name, value);
      for (const [key, field] of Object.entries(value)) if (field !== undefined) write(`academy.${key}`, field);
      for (const key of documents.keys()) {
        if (key.startsWith("academy.") && !Object.hasOwn(value, key.slice(8))) {
          changes.delete(key);
          documents.delete(key);
          removed.add(key);
        }
      }
    },
    async commit() {
      if (!changes.size && !removed.size) return;
      const encoded = Object.fromEntries(await Promise.all([...changes].map(async ([name, value]) => [name, await encoder.lock(name, value)])));
      revision = await client.rpc("ivartist_commit_state", { expected_revision: revision, changes: encoded, removed: [...removed] });
      changes.clear();
      removed.clear();
    },
  };
}
