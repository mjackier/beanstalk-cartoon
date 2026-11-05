// "Sign in with Google" using the standard OAuth 2.0 authorization-code flow.
// No extra packages: Node's built-in fetch talks to Google directly.
//
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (from Google Cloud Console),
// and each site address registered there as an Authorized redirect URI:
//   https://<your-site>/auth/google/callback
import crypto from "node:crypto";
import { sign, verify, parseCookies, setCookie, clearCookie } from "./session.js";
import { logger } from "./log.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
export const loginConfigured = Boolean(CLIENT_ID && CLIENT_SECRET);

const SESSION_COOKIE = "sid";
const STATE_COOKIE = "oauth_state";
const SESSION_DAYS = 30;

function redirectUri(req) {
  // "trust proxy" is on, so req.protocol is https on Render.
  return `${req.protocol}://${req.get("host")}/auth/google/callback`;
}

// Only allow redirects back into this site (no open redirects).
function safeNext(next) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function registerAuth(app, store) {
  // Reads the session cookie on every request and sets req.user.
  app.use(async (req, _res, next) => {
    const session = verify(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (session?.uid) {
      try {
        req.user = await store.getUser(session.uid);
      } catch (err) {
        logger.error("session user lookup failed", { error: err.message });
      }
    }
    next();
  });

  app.get("/auth/google", (req, res) => {
    if (!loginConfigured) return res.status(503).send("Google sign-in isn't set up on this server yet.");
    const state = crypto.randomBytes(16).toString("hex");
    const next = safeNext(req.query.next);
    setCookie(req, res, STATE_COOKIE, sign({ state, next, exp: Date.now() + 10 * 60 * 1000 }), 600);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(req),
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get("/auth/google/callback", async (req, res) => {
    const saved = verify(parseCookies(req.headers.cookie)[STATE_COOKIE]);
    clearCookie(req, res, STATE_COOKIE);
    const next = safeNext(saved?.next);

    if (req.query.error) {
      logger.warn("google sign-in cancelled", { error: String(req.query.error) });
      return res.redirect(`${next}${next.includes("?") ? "&" : "?"}login=cancelled`);
    }
    // The state check stops other sites from forging a sign-in.
    if (!saved || !req.query.state || saved.state !== req.query.state || !req.query.code) {
      logger.warn("google sign-in rejected: bad state");
      return res.redirect(`${next}${next.includes("?") ? "&" : "?"}login=failed`);
    }

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: String(req.query.code),
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: redirectUri(req),
          grant_type: "authorization_code",
        }),
      });
      const tokens = await tokenRes.json();
      if (!tokenRes.ok || !tokens.access_token) {
        throw new Error(tokens.error_description || tokens.error || `token exchange failed (${tokenRes.status})`);
      }

      const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const info = await infoRes.json();
      if (!infoRes.ok || !info.sub) throw new Error("couldn't read the Google profile");

      const user = await store.upsertUser({
        sub: info.sub,
        email: info.email || "",
        name: info.name || info.email || "Reader",
        picture: info.picture || "",
      });
      setCookie(
        req,
        res,
        SESSION_COOKIE,
        sign({ uid: user.id, exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000 }),
        SESSION_DAYS * 24 * 3600
      );
      logger.info("signed in", { userId: user.id });
      await store.logEvent({ userId: user.id, type: "login" }).catch(() => {});
      res.redirect(next);
    } catch (err) {
      logger.error("google sign-in failed", { error: err.message });
      res.redirect(`${next}${next.includes("?") ? "&" : "?"}login=failed`);
    }
  });

  app.get("/auth/logout", (req, res) => {
    clearCookie(req, res, SESSION_COOKIE);
    if (req.user) logger.info("signed out", { userId: req.user.id });
    res.redirect(safeNext(req.query.next));
  });

  // Local testing only: sign in without Google. Needs DEV_LOGIN=1 AND a localhost request,
  // so it can never work on the live site.
  app.get("/auth/dev", async (req, res) => {
    const local = ["localhost", "127.0.0.1"].includes(String(req.get("host") || "").split(":")[0]);
    if (process.env.DEV_LOGIN !== "1" || !local || req.get("x-forwarded-for")) return res.status(404).end();
    const email = String(req.query.email || "tester@example.com");
    const user = await store.upsertUser({ sub: `dev:${email}`, email, name: email.split("@")[0], picture: "" });
    setCookie(req, res, SESSION_COOKIE, sign({ uid: user.id, exp: Date.now() + 3600 * 1000 }), 3600);
    res.redirect(safeNext(req.query.next));
  });

  app.get("/api/me", (req, res) => {
    const u = req.user;
    const admins = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
    res.json({
      user: u
        ? { name: u.name, email: u.email, picture: u.picture, balance: u.balance_cents, admin: u.id === 1 || admins.includes(u.email) }
        : null,
      loginConfigured,
    });
  });
}

export function requireUser(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: "Please sign in with Google first.", needLogin: true });
}
