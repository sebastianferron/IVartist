"use strict";

const fs = require("node:fs");
const path = require("node:path");

function localMedia(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const source = (name) => path.join(directory, name);
  return {
    exists: (name) => fs.existsSync(source(name)),
    size: (name) => fs.statSync(source(name)).size,
    read: (name) => fs.promises.readFile(source(name)),
    stream: (name, range) => fs.createReadStream(source(name), range),
    write: (name, bytes) => fs.writeFileSync(source(name), bytes, { mode: 0o600, flag: "wx" }),
    remove: (name) => fs.unlinkSync(source(name)),
  };
}

module.exports = { localMedia };
