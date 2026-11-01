// Structured logging: one JSON object per line on stdout.
// Render shows these in the service's "Logs" tab, and they're easy to search.
import crypto from "node:crypto";

export function log(level, msg, fields = {}) {
  const line = { t: new Date().toISOString(), level, msg, ...fields };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else console.log(out);
}

export const logger = {
  info: (msg, fields) => log("info", msg, fields),
  warn: (msg, fields) => log("warn", msg, fields),
  error: (msg, fields) => log("error", msg, fields),
};

// Logs every API / auth request when it finishes: method, path, status, time, user.
// Static files (HTML, CSS, images) are skipped to keep the log readable.
export function requestLogger(req, res, next) {
  if (!req.path.startsWith("/api") && !req.path.startsWith("/auth")) return next();
  const start = process.hrtime.bigint();
  req.id = crypto.randomBytes(4).toString("hex");
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    log(res.statusCode >= 500 ? "error" : "info", "request", {
      reqId: req.id,
      method: req.method,
      path: req.path, // no query string: never log codes or tokens
      status: res.statusCode,
      ms: Math.round(ms),
      userId: req.user?.id ?? null,
    });
  });
  next();
}
