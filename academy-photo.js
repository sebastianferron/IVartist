"use strict";

const allowedPngChunks = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "acTL", "fcTL", "fdAT"]);
const webpFrameChunks = new Set(["VP8 ", "VP8L", "ALPH"]);
const maxChunks = 16_384;

function validDimensions(width, height) {
  return width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 40_000_000;
}

function exifOrientation(data) {
  if (data.length < 14 || data.toString("ascii", 0, 6) !== "Exif\0\0") return null;
  const tiff = data.subarray(6);
  const order = tiff.toString("ascii", 0, 2);
  if (order !== "II" && order !== "MM") return null;
  const read16 = (offset) => order === "II" ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const read32 = (offset) => order === "II" ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  if (read16(2) !== 42) return null;
  const directory = read32(4);
  if (directory < 8 || directory + 2 > tiff.length) return null;
  const entries = read16(directory);
  if (directory + 2 + entries * 12 > tiff.length) return null;
  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12;
    if (read16(entry) !== 0x0112 || read16(entry + 2) !== 3 || read32(entry + 4) !== 1) continue;
    const value = read16(entry + 8);
    return value >= 2 && value <= 8 ? value : null;
  }
  return null;
}

function orientationSegment(value) {
  // This EXIF segment contains a new TIFF directory with only the orientation tag.
  const segment = Buffer.from("ffe100224578696600004d4d002a00000008000101120003000000010000000000000000", "hex");
  segment.writeUInt16BE(value, 28);
  return segment;
}

function nextJpegMarker(bytes, offset) {
  let marker = bytes.indexOf(0xff, offset);
  while (marker >= 0) {
    let codeIndex = marker + 1;
    while (bytes[codeIndex] === 0xff) codeIndex += 1;
    const code = bytes[codeIndex];
    if (code !== 0x00 && !(code >= 0xd0 && code <= 0xd7)) return marker;
    marker = bytes.indexOf(0xff, codeIndex + 1);
  }
  return -1;
}

function stripJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts = [bytes.subarray(0, 2)];
  let dimensions = false;
  let scanned = false;
  let orientation = null;
  let offset = 2;
  for (let count = 0; count < maxChunks && offset < bytes.length; count += 1) {
    const start = offset;
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const code = bytes[offset++];
    if (code === 0xd9 && dimensions && scanned) {
      const metadata = orientation ? [orientationSegment(orientation)] : [];
      return Buffer.concat([parts[0], ...metadata, ...parts.slice(1), Buffer.from([0xff, 0xd9])]);
    }
    if (code >= 0x00 && code <= 0x01 || code >= 0xd0 && code <= 0xd9 || offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) return null;
    const data = bytes.subarray(offset + 2, end);
    if (code >= 0xc0 && code <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(code)) {
      if (data.length < 6 || !validDimensions(data.readUInt16BE(3), data.readUInt16BE(1))) return null;
      dimensions = true;
    }
    if (code === 0xe1) orientation ||= exifOrientation(data);
    if (code === 0xee && data.length === 12 && data.toString("ascii", 0, 5) === "Adobe" && data[11] <= 2) {
      // The Adobe transform describes the color interpretation of CMYK and RGB data.
      const adobe = Buffer.from("ffee000e41646f626500640000000000", "hex");
      adobe[15] = data[11];
      parts.push(adobe);
    }
    if ((code < 0xe0 || code > 0xef) && code !== 0xfe) parts.push(bytes.subarray(start, end));
    offset = end;
    if (code === 0xda) {
      const scanEnd = nextJpegMarker(bytes, end);
      if (scanEnd <= end) return null;
      parts.push(bytes.subarray(end, scanEnd));
      offset = scanEnd;
      scanned = true;
    }
  }
  return null;
}

function stripPng(bytes) {
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  const parts = [bytes.subarray(0, 8)];
  let imageData = false;
  let offset = 8;
  for (let count = 0; count < maxChunks && offset + 12 <= bytes.length; count += 1) {
    const start = offset;
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    offset += 12 + length;
    if (offset > bytes.length || !/^[a-zA-Z]{4}$/.test(type)) return null;
    if (count === 0 && (type !== "IHDR" || length !== 13 ||
      !validDimensions(bytes.readUInt32BE(start + 8), bytes.readUInt32BE(start + 12)))) return null;
    if (count > 0 && type === "IHDR") return null;
    if (allowedPngChunks.has(type)) parts.push(bytes.subarray(start, offset));
    else if (type[0] === type[0].toUpperCase()) return null;
    if (type === "IDAT") imageData = true;
    if (type === "IEND") return imageData && length === 0 ? Buffer.concat(parts) : null;
  }
  return null;
}

function webpChunks(bytes, start, end) {
  const chunks = [];
  while (start < end && chunks.length < maxChunks) {
    if (start + 8 > end) return null;
    const length = bytes.readUInt32LE(start + 4);
    const stop = start + 8 + length;
    const next = stop + (length % 2);
    if (next > end || (length % 2 && bytes[stop] !== 0)) return null;
    chunks.push({ type: bytes.toString("ascii", start, start + 4), start, data: bytes.subarray(start + 8, stop), next });
    start = next;
  }
  return start === end ? chunks : null;
}

function validWebpImage(type, data) {
  if (type === "VP8L") {
    if (data.length < 5 || data[0] !== 0x2f) return false;
    const header = data.readUInt32LE(1);
    return validDimensions((header & 0x3fff) + 1, ((header >>> 14) & 0x3fff) + 1);
  }
  return data.length >= 10 && data.subarray(3, 6).toString("hex") === "9d012a" &&
    validDimensions(data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff);
}

function stripWebp(bytes) {
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const end = bytes.readUInt32LE(4) + 8;
  if (end > bytes.length) return null;
  const chunks = webpChunks(bytes, 12, end);
  if (!chunks) return null;
  const header = Buffer.from(bytes.subarray(0, 12));
  const parts = [header];
  let image = false;
  for (const { type, start, data, next } of chunks) {
    const chunk = bytes.subarray(start, next);
    if (type === "VP8X") {
      if (data.length !== 10 || !validDimensions(data.readUIntLE(4, 3) + 1, data.readUIntLE(7, 3) + 1)) return null;
      const extended = Buffer.from(chunk);
      extended[8] &= 0x12; // Preserve alpha and animation flags only.
      parts.push(extended);
    } else if (type === "ANMF") {
      if (data.length < 24 || !validDimensions(data.readUIntLE(6, 3) + 1, data.readUIntLE(9, 3) + 1)) return null;
      const children = webpChunks(data, 16, data.length);
      if (!children || !children.every(({ type }) => webpFrameChunks.has(type))) return null;
      const frame = children.find(({ type }) => type === "VP8 " || type === "VP8L");
      if (!frame || !validWebpImage(frame.type, frame.data)) return null;
      image = true;
      parts.push(chunk);
    } else if (type === "VP8 " || type === "VP8L") {
      if (!validWebpImage(type, data)) return null;
      image = true;
      parts.push(chunk);
    } else if (type === "ALPH" || type === "ANIM") parts.push(chunk);
  }
  if (!image) return null;
  header.writeUInt32LE(parts.reduce((size, part) => size + part.length, 0) - 8, 4);
  return Buffer.concat(parts);
}

function stripPhotoMetadata(bytes, extension) {
  if (!bytes) return null;
  switch (extension) {
    case "jpg": return stripJpeg(bytes);
    case "png": return stripPng(bytes);
    case "webp": return stripWebp(bytes);
    default: return null;
  }
}

module.exports = { stripPhotoMetadata };
