// A very small web framework on node:http (routing, JSON, static files with gzip and caching).
// It replaces Express so the server has no dependencies except pg, and runs anywhere Node 20+ runs.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".txt"]);

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function compile(pattern) {
  const keys = [];
  const re = new RegExp(
    "^" +
      pattern.replace(/\/:([A-Za-z_]+)/g, (_, k) => {
        keys.push(k);
        return "/([^/]+)";
      }) +
      "/?$"
  );
  return { re, keys };
}

function decorate(req, res, trustProxy) {
  const url = new URL(req.url, "http://x");
  req.path = decodeURIComponent(url.pathname);
  req.query = Object.fromEntries(url.searchParams);
  req.get = (h) => req.headers[h.toLowerCase()];
  const fwdProto = trustProxy ? String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() : "";
  req.protocol = fwdProto || (req.socket.encrypted ? "https" : "http");
  req.secure = req.protocol === "https";
  const fwdFor = trustProxy ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  req.ip = fwdFor || req.socket.remoteAddress || "";

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.set = (k, v) => {
    res.setHeader(k, v);
    return res;
  };
  res.send = (body) => {
    if (typeof body === "string") body = Buffer.from(body);
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Length", body.length);
    res.end(req.method === "HEAD" ? undefined : body);
    return res;
  };
  res.json = (obj) => {
    const body = Buffer.from(JSON.stringify(obj));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (!res.getHeader("Cache-Control")) res.setHeader("Cache-Control", "no-store");
    return sendMaybeGzip(req, res, body);
  };
  res.redirect = (location, code = 302) => {
    res.statusCode = code;
    res.setHeader("Location", location);
    res.end();
    return res;
  };
}

function sendMaybeGzip(req, res, body, pre) {
  const accepts = String(req.headers["accept-encoding"] || "");
  if (body.length > 1024 && accepts.includes("gzip")) {
    const gz = pre || zlib.gzipSync(body, { level: 6 });
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Length", gz.length);
    return res.end(req.method === "HEAD" ? undefined : gz);
  }
  res.setHeader("Content-Length", body.length);
  return res.end(req.method === "HEAD" ? undefined : body);
}

// Reads the request body. JSON is parsed; images come back as a Buffer.
export async function readBody(req, { limit = 200 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, `That upload is too large (limit ${Math.round(limit / 1024 / 1024) || 1} MB).`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function jsonBody(req) {
  if (req.body !== undefined) return req.body;
  const type = String(req.headers["content-type"] || "");
  if (!type.includes("application/json")) return (req.body = {});
  const buf = await readBody(req);
  try {
    req.body = buf.length ? JSON.parse(buf.toString("utf8")) : {};
  } catch {
    throw new HttpError(400, "Bad JSON.");
  }
  return req.body;
}

export function createApp({ trustProxy = true } = {}) {
  const middleware = [];
  const routes = [];
  const statics = [];
  const staticCache = new Map(); // file -> { body, gz, etag, type, mtime }

  async function serveStatic(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    for (const { dir, maxAge } of statics) {
      let rel = req.path.endsWith("/") ? req.path + "index.html" : req.path;
      const file = path.join(dir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      if (!file.startsWith(dir)) return false;
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const ext = path.extname(file).toLowerCase();
      let entry = staticCache.get(file);
      if (!entry || entry.mtime !== stat.mtimeMs) {
        const body = await fs.readFile(file);
        entry = {
          body,
          gz: COMPRESSIBLE.has(ext) ? zlib.gzipSync(body, { level: 9 }) : null,
          etag: `"${crypto.createHash("sha1").update(body).digest("base64url").slice(0, 16)}"`,
          type: MIME[ext] || "application/octet-stream",
          mtime: stat.mtimeMs,
        };
        staticCache.set(file, entry);
      }
      res.setHeader("Content-Type", entry.type);
      res.setHeader("ETag", entry.etag);
      // HTML is revalidated every time (cheap 304); versioned assets (?v=...) are cached for a year.
      const versioned = "v" in req.query;
      res.setHeader(
        "Cache-Control",
        ext === ".html" ? "no-cache" : versioned ? "public, max-age=31536000, immutable" : `public, max-age=${maxAge}`
      );
      if (req.headers["if-none-match"] === entry.etag) {
        res.statusCode = 304;
        res.end();
        return true;
      }
      if (entry.gz) sendMaybeGzip(req, res, entry.body, entry.gz);
      else {
        res.setHeader("Content-Length", entry.body.length);
        res.end(req.method === "HEAD" ? undefined : entry.body);
      }
      return true;
    }
    return false;
  }

  // Runs handlers in order. Works whether a handler returns next(), awaits it, or just calls it:
  // errors from later handlers always reach the error handler instead of crashing the process.
  async function run(handlers, req, res) {
    const dispatch = async (idx) => {
      const h = handlers[idx];
      if (!h) return;
      let downstream = null;
      const next = (err) => {
        if (err) return Promise.reject(err);
        downstream = dispatch(idx + 1);
        downstream.catch(() => {}); // handled below; stops an "unhandled rejection" crash
        return downstream;
      };
      await h(req, res, next);
      if (downstream) await downstream;
    };
    await dispatch(0);
  }

  const server = http.createServer(async (req, res) => {
    try {
      decorate(req, res, trustProxy);
      await run(
        [
          ...middleware,
          async (req, res) => {
            for (const r of routes) {
              if (r.method !== req.method && !(r.method === "GET" && req.method === "HEAD")) continue;
              const m = r.re.exec(req.path);
              if (!m) continue;
              req.params = Object.fromEntries(r.keys.map((k, j) => [k, m[j + 1]]));
              return run(r.handlers, req, res);
            }
            if (await serveStatic(req, res)) return;
            if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
            res.status(404).set("Content-Type", "text/html; charset=utf-8").send("<h1>Not found</h1><p><a href='/'>Back to the storybook</a></p>");
          },
        ],
        req,
        res
      );
    } catch (err) {
      const status = err?.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", msg: "unhandled", path: req.path, error: err?.stack || String(err) }));
      if (!res.headersSent) res.status(status).json({ error: err?.message || "Something went wrong.", ...(err?.extra || {}) });
      else res.end();
    }
  });
  server.requestTimeout = 0; // long uploads / generation requests are handled by the app

  const add = (method) => (pattern, ...handlers) => {
    routes.push({ method, ...compile(pattern), handlers });
  };

  return {
    server,
    use: (fn) => middleware.push(fn),
    get: add("GET"),
    post: add("POST"),
    patch: add("PATCH"),
    delete: add("DELETE"),
    static: (dir, { maxAge = 300 } = {}) => statics.push({ dir: path.resolve(dir), maxAge }),
    listen: (port, cb) => server.listen(port, cb),
  };
}
