// Pixel work without native packages: JPEG decode/encode (vendored jpeg-js), thumbnails,
// and the measurements the text-layout step uses (how busy and how bright a zone is).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const decodeJpeg = require("../vendor/jpeg-js/decoder.js");
const encodeJpeg = require("../vendor/jpeg-js/encoder.js");

export function decode(buf) {
  return decodeJpeg(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
}

export function sniffMime(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return "application/octet-stream";
}

// Area-average downscale (good quality for big reductions).
export function resize(img, width) {
  const scale = img.width / width;
  const height = Math.max(1, Math.round(img.height / scale));
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

export function encode(img, quality = 80) {
  return Buffer.from(encodeJpeg({ width: img.width, height: img.height, data: img.data }, quality).data);
}

// A small JPEG for the library and the live progress grid (~15 KB instead of ~220 KB).
export function thumbnail(buf, width = 360, quality = 74) {
  try {
    return encode(resize(decode(buf), width), quality);
  } catch {
    return null; // not a JPEG we can read: callers fall back to the full image
  }
}

// How suitable a rectangle (fractions of the image) is for a text panel:
//   busy = average edge strength (0 calm .. 1 very busy), lum = average brightness 0..1.
export function zoneStats(small, rect) {
  const x0 = Math.max(0, Math.floor(rect.x * small.width));
  const y0 = Math.max(0, Math.floor(rect.y * small.height));
  const x1 = Math.min(small.width - 1, Math.ceil((rect.x + rect.w) * small.width));
  const y1 = Math.min(small.height - 1, Math.ceil((rect.y + rect.h) * small.height));
  const L = (x, y) => {
    const i = (y * small.width + x) * 4;
    return (0.299 * small.data[i] + 0.587 * small.data[i + 1] + 0.114 * small.data[i + 2]) / 255;
  };
  let sum = 0, edges = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const l = L(x, y);
      sum += l;
      edges += Math.abs(l - L(x + 1, y)) + Math.abs(l - L(x, y + 1));
      n++;
    }
  }
  return { lum: n ? sum / n : 0.5, busy: n ? Math.min(1, (edges / n) * 6) : 1 };
}
