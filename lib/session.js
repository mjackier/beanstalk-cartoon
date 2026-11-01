// Tiny signed-cookie sessions (no extra packages).
// The cookie holds { uid, exp } plus an HMAC signature made with SESSION_SECRET,
// so it can't be forged or edited by the browser.
import crypto from "node:crypto";
import { logger } from "./log.js";

let SECRET = process.env.SESSION_SECRET || "";
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString("hex");
  logger.warn("SESSION_SECRET is not set: using a random one. Everyone is signed out on every restart.");
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (data) => crypto.createHmac("sha256", SECRET).update(data).digest("base64url");

export function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}

export function verify(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = hmac(body);
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function setCookie(req, res, name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (req.secure) parts.push("Secure");
  const prev = res.getHeader("Set-Cookie");
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  res.setHeader("Set-Cookie", [...list, parts.join("; ")]);
}

export function clearCookie(req, res, name) {
  setCookie(req, res, name, "", 0);
}
