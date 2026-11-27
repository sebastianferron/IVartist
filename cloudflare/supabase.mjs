import { Buffer } from "node:buffer";
import { basename } from "node:path";

const protectedDocuments = new Set(["academy.waha", "academy.plugNmeet", "push-keys.json"]);
const text = new TextEncoder();
const decoder = new TextDecoder();

async function secretEncoder(env) {
  async function importKey(value) {
    if (!/^[a-f0-9]{64}$/i.test(value || "")) throw new Error("La clave de estado debe tener 64 caracteres hexadecimales.");
    return crypto.subtle.importKey("raw", Buffer.from(value, "hex"), "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  const key = await importKey(env.IVANNA_STATE_KEY);
  const previous = env.IVANNA_STATE_PREVIOUS_KEY ? await importKey(env.IVANNA_STATE_PREVIOUS_KEY) : null;
  const version = env.IVANNA_STATE_KEY_VERSION || "1";
  const previousVersion = env.IVANNA_STATE_PREVIOUS_KEY_VERSION || "1";
  if (previous && version === previousVersion) throw new Error("La rotación requiere versiones distintas de clave.");
  const cipher = (name, iv) => ({ name: "AES-GCM", iv, additionalData: text.encode(name) });
  return {
    async lock(name, value) {
      if (!protectedDocuments.has(name)) return value;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(cipher(name, iv), key, text.encode(JSON.stringify(value)));
      return { version, iv: Buffer.from(iv).toString("base64url"), encrypted: Buffer.from(encrypted).toString("base64url") };
    },
    async unlock(name, value) {
      if (!protectedDocuments.has(name)) return value;
      const storedVersion = value.version || "1";
      const decryptionKey = storedVersion === version ? key : storedVersion === previousVersion ? previous : null;
      if (!decryptionKey) throw new Error("Falta la versión de clave para descifrar el estado.");
      const bytes = await crypto.subtle.decrypt(
        cipher(name, Buffer.from(value.iv, "base64url")), decryptionKey, Buffer.from(value.encrypted, "base64url"),
      );
      return JSON.parse(decoder.decode(bytes));
    },
    needsRotation: (name, value) => protectedDocuments.has(name) && (value.version || "1") !== version,
  };
}

export function supabaseClient(env, send = fetch) {
  const endpoint = new URL(env.SUPABASE_URL);
  if (endpoint.protocol !== "https:" || endpoint.href !== `${endpoint.origin}/`) throw new Error("Configura el origen HTTPS de Supabase.");
  const delegated = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_WORKER_JWT;
  if (delegated && (!env.SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_") || !env.SUPABASE_WORKER_JWT)) {
    throw new Error("Completa la credencial de alcance limitado de Supabase.");
  }
  if (!delegated && !env.SUPABASE_SECRET_KEY?.startsWith("sb_secret_")) throw new Error("Configura la credencial privada de Supabase.");
  const headers = delegated
    ? { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${env.SUPABASE_WORKER_JWT}` }
    : { apikey: env.SUPABASE_SECRET_KEY };
  async function rpc(name, data) {
    const response = await send(new URL(`/rest/v1/rpc/${name}`, endpoint), {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(12_000),
      redirect: "manual",
    });
    if (!response.ok) throw Object.assign(new Error(`Supabase devolvió HTTP ${response.status}.`), { status: response.status });
    return response.json();
  }
  return { rpc };
}

export async function openDocuments(env, { names, detached = false, send } = {}) {
  const client = supabaseClient(env, send);
  const encoder = await secretEncoder(env);
  const load = () => names === undefined ? client.rpc("ivartist_read_state", {}) :
    names.length ? client.rpc("ivartist_read_documents", { document_names: names }) : { revision: 0, documents: {} };
  const snapshot = await load();
  let revision = snapshot.revision;
  if (!Number.isSafeInteger(revision)) throw new Error("La revisión de Supabase no es válida.");
  const documents = new Map(await Promise.all(Object.entries(snapshot.documents).map(async ([name, value]) => [name, await encoder.unlock(name, value)])));
  const persisted = new Map(Object.entries(snapshot.documents));
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
      for (const [key, field] of Object.entries(value)) {
        const name = `academy.${key}`;
        if (field !== undefined && (!names || names.includes(name))) write(name, field);
      }
      for (const key of documents.keys()) {
        if (key.startsWith("academy.") && !Object.hasOwn(value, key.slice(8))) {
          changes.delete(key);
          documents.delete(key);
          removed.add(key);
        }
      }
    },
    rotate() {
      for (const [name, value] of persisted) {
        if (encoder.needsRotation(name, value) && !changes.has(name) && !removed.has(name)) changes.set(name, documents.get(name));
      }
    },
    async commit() {
      if (!changes.size && !removed.size) return;
      const encoded = Object.fromEntries(await Promise.all([...changes].map(async ([name, value]) => [name, await encoder.lock(name, value)])));
      if (detached || names) {
        const expected = Object.fromEntries([...changes.keys(), ...removed].filter((name) => persisted.has(name)).map((name) => [name, persisted.get(name)]));
        revision = await client.rpc("ivartist_commit_documents", { expected, changes: encoded, removed: [...removed] });
      } else {
        revision = await client.rpc("ivartist_commit_state", { expected_revision: revision, changes: encoded, removed: [...removed] });
      }
      for (const [name, value] of Object.entries(encoded)) persisted.set(name, value);
      for (const name of removed) persisted.delete(name);
      changes.clear();
      removed.clear();
    },
  };
}
