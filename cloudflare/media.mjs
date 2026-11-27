import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

export function bucketMedia(bucket, documents, prefix) {
  const inventory = { ...documents.read(`${prefix}-media.json`, {}) };
  const pendingDeletes = [];
  const key = (name) => `${prefix}/${name}`;
  const track = (name, size) => {
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
      pendingDeletes.push(key(name));
      documents.write(`${prefix}-media.json`, { ...inventory });
    },
    async clean() {
      if (pendingDeletes.length) await bucket.delete(pendingDeletes);
    },
  };
}
