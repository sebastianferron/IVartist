import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

export function bucketMedia(bucket, documents, prefix) {
  const inventory = { ...documents.read(`${prefix}-media.json`, {}) };
  const deletionFile = `${prefix}-media-deletions.json`;
  const pendingDeletes = { ...documents.read(deletionFile, {}) };
  const uploaded = new Set();
  const key = (name) => `${prefix}/${name}`;
  const track = (name, size) => {
    uploaded.add(key(name));
    inventory[name] = size;
    documents.write(`${prefix}-media.json`, { ...inventory });
  };

  return {
    exists: (name) => Object.hasOwn(inventory, name),
    size: (name) => inventory[name],
    async read(name) {
      const object = await bucket.get(key(name));
      return object ? Buffer.from(await object.arrayBuffer()) : null;
    },
    async stream(name, range) {
      const options = range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : {};
      const object = await bucket.get(key(name), options);
      if (!object) throw Object.assign(new Error("Archivo no disponible."), { status: 404 });
      return Readable.fromWeb(object.body);
    },
    async write(name, bytes) {
      await bucket.put(key(name), bytes);
      track(name, bytes.byteLength);
    },
    async writeStream(name, length, parts, source) {
      const input = new ReadableStream({
        async pull(controller) {
          const part = parts.length ? { value: parts.shift(), done: false } : await source.next();
          if (part.done) controller.close();
          else controller.enqueue(part.value);
        },
        cancel: () => source.return?.(),
      });
      const fixed = new FixedLengthStream(length);
      await Promise.all([input.pipeTo(fixed.writable), bucket.put(key(name), fixed.readable)]);
      track(name, length);
    },
    remove(name) {
      delete inventory[name];
      pendingDeletes[name] = Date.now() + 600_000;
      documents.write(`${prefix}-media.json`, { ...inventory });
      documents.write(deletionFile, { ...pendingDeletes });
    },
    async rollback() {
      if (uploaded.size) await bucket.delete([...uploaded]);
    },
    async reconcile(storage) {
      const now = Date.now();
      const scheduled = Object.keys(pendingDeletes).filter((name) => pendingDeletes[name] <= now).slice(0, 50);
      const position = `media-cursor:${prefix}`;
      const cursor = await storage.get(position);
      const page = await bucket.list({ prefix: `${prefix}/`, limit: 100, ...(cursor ? { cursor } : {}) });
      const stale = page.objects
        .filter((object) => Number(object.uploaded) < now - 24 * 60 * 60_000)
        .map((object) => object.key.slice(prefix.length + 1));
      const unreferenced = [...new Set([...scheduled, ...stale])]
        .filter((name) => /^(?:upload|cover|avatar|feed|qr|receipt|video)-[a-f0-9]{32}\.(?:jpg|png|webp|pdf|mp4)$/.test(name) &&
          !Object.hasOwn(inventory, name));
      if (unreferenced.length) await bucket.delete(unreferenced.map(key));
      if (scheduled.length) {
        for (const name of scheduled) delete pendingDeletes[name];
        documents.write(deletionFile, { ...pendingDeletes });
      }
      if (page.truncated) await storage.put(position, page.cursor);
      else if (cursor) await storage.delete(position);
    },
  };
}
