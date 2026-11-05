import crypto from "node:crypto";
import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { buildPrompt, SCENES } from "./prompt.js";
import { STYLE, READY_PAGES, getPage, buildCharacterPrompt, buildPagePrompt, buildFixPrompt } from "./story.js";
import { logger, requestLogger } from "./lib/log.js";
import { createStore } from "./lib/store.js";
import { registerAuth, requireUser, loginConfigured } from "./lib/auth.js";

const app = express();
// Render sits behind a proxy; trust it so req.ip / req.protocol are the visitor's.
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

// The key is read ONLY from the environment. It is never written in code.
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini";
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || "low"; // low | medium | high
const INPUT_FIDELITY = process.env.OPENAI_INPUT_FIDELITY || null; // "high" keeps faces closer (not on mini)
// MOCK_IMAGES=1: don't call OpenAI, echo the input image back. Free testing of the whole pipeline.
const MOCK = process.env.MOCK_IMAGES === "1";

const openai = API_KEY ? new OpenAI({ apiKey: API_KEY }) : null;

// Uploads stay in memory (never written to disk).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Please upload a JPEG, PNG, or WebP image."), ok);
  },
});

app.use(requestLogger);
app.use(express.static("public"));
app.use(express.json({ limit: "100kb" }));

// ---------------------------------------------------------------------
// Password for anything that costs money (image generation).
// Lives ONLY in the GENERATE_PASSWORD environment variable (the repo is public).
// ---------------------------------------------------------------------
const GENERATE_PASSWORD = process.env.GENERATE_PASSWORD || "";
const failedAttempts = new Map(); // ip -> { count, since }
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

function passwordMatches(given) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(GENERATE_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requirePassword(req, res, next) {
  if (!GENERATE_PASSWORD) return next(); // not configured: generation is open

  const ip = req.ip;
  const now = Date.now();
  const record = failedAttempts.get(ip);
  if (record && now - record.since > FAIL_WINDOW_MS) failedAttempts.delete(ip);
  if ((failedAttempts.get(ip)?.count || 0) >= MAX_FAILS) {
    return res.status(429).json({ error: "Too many wrong passwords. Try again in 15 minutes.", needPassword: true });
  }
  if (passwordMatches(req.get("x-app-password") || "")) {
    failedAttempts.delete(ip);
    return next();
  }
  const r = failedAttempts.get(ip) || { count: 0, since: now };
  r.count += 1;
  failedAttempts.set(ip, r);
  logger.warn("wrong generate password", { ip, attempts: r.count });
  res.status(401).json({ error: "Wrong or missing password.", needPassword: true });
}

app.post("/api/check-password", requirePassword, (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------
// Image calls. Each function below makes exactly ONE OpenAI call: no loops,
// no retries. Pages run in parallel because the browser sends one request
// per page at the same time.
// ---------------------------------------------------------------------
const fidelityFor = (model) =>
  INPUT_FIDELITY && !model.includes("mini") ? { input_fidelity: INPUT_FIDELITY } : {};

function sniffMime(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return "application/octet-stream";
}
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// images: [{ buffer, mime }] -> { buffer, mime }
async function editImage({ images, prompt, size }) {
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500)); // feel the progress bars
    return { buffer: images[0].buffer, mime: images[0].mime };
  }
  if (!openai) throw Object.assign(new Error("The server has no API key yet."), { status: 503 });
  const files = await Promise.all(
    images.map((img, i) => toFile(img.buffer, `input-${i}.${EXT[img.mime] || "png"}`, { type: img.mime }))
  );
  const result = await openai.images.edit({
    model: MODEL,
    image: files.length === 1 ? files[0] : files,
    prompt,
    size,
    quality: QUALITY,
    n: 1,
    output_format: "jpeg", // ~10x smaller than PNG: cheaper to store, faster to load
    output_compression: 88,
    ...fidelityFor(MODEL),
  });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw Object.assign(new Error("The image model returned no image."), { status: 502 });
  return { buffer: Buffer.from(b64, "base64"), mime: "image/jpeg" };
}

function sendError(res, err, context = {}) {
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  logger.error("request failed", { ...context, status, error: err?.message });
  res.status(status).json({ error: err?.message || "Something went wrong." });
}

// ---------------------------------------------------------------------
// Homework 1: the two-scene page (unchanged; no login needed, password needed)
// ---------------------------------------------------------------------
app.get("/api/scenes", (_req, res) => res.json(SCENES));

app.post("/api/generate", requirePassword, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No photo uploaded." });
    if (!SCENES[req.body.scene]) return res.status(400).json({ error: "Unknown scene." });
    const { prompt, sceneSpec } = buildPrompt(req.body.scene, {
      style: req.body.style,
      exaggeration: req.body.exaggeration,
      outline: req.body.outline,
      palette: req.body.palette,
    });
    const started = Date.now();
    const out = await editImage({
      images: [{ buffer: req.file.buffer, mime: req.file.mimetype }],
      prompt,
      size: "1024x1024",
    });
    logger.info("image generated", { kind: "scene", scene: req.body.scene, ms: Date.now() - started });
    res.json({ image: `data:${out.mime};base64,${out.buffer.toString("base64")}`, caption: sceneSpec, prompt });
  } catch (err) {
    sendError(res, err, { route: "generate" });
  }
});

// ---------------------------------------------------------------------
// Storybook: signed-in users, books saved in the database
// ---------------------------------------------------------------------
async function main() {
  const store = await createStore();
  registerAuth(app, store);

  app.get("/api/status", (_req, res) => {
    res.json({
      keyConfigured: Boolean(API_KEY),
      mock: MOCK,
      model: MODEL,
      quality: QUALITY,
      inputFidelity: INPUT_FIDELITY,
      passwordRequired: Boolean(GENERATE_PASSWORD),
      loginConfigured,
      storage: store.kind,
    });
  });

  // Quick check after deploying: is the database reachable?
  app.get("/api/health", async (_req, res) => {
    try {
      await store.health();
      res.json({ ok: true, storage: store.kind, login: loginConfigured, key: Boolean(API_KEY) || MOCK });
    } catch (err) {
      res.status(500).json({ ok: false, storage: store.kind, error: err.message });
    }
  });

  // The story's page list (text + where the text goes). Prompts stay on the server.
  app.get("/api/book", (_req, res) => {
    res.json({
      style: STYLE,
      pages: READY_PAGES.map(({ id, number, title, text, textArea }) => ({ id, number, title, text, textArea })),
    });
  });

  const imageUrl = (img) => `/api/images/${img.id}?v=${img.v}`;

  async function bookJson(book) {
    const images = await store.listImages(book.id);
    const ref = images.find((i) => i.kind === "reference");
    const pages = {};
    for (const img of images.filter((i) => i.kind === "page")) {
      pages[img.page_id] = { url: imageUrl(img), prompt: img.prompt };
    }
    return {
      id: book.id,
      child_name: book.child_name,
      child_age: book.child_age,
      child_favorites: book.child_favorites,
      child_about: book.child_about,
      created_at: book.created_at,
      updated_at: book.updated_at,
      reference: ref ? { url: imageUrl(ref), prompt: ref.prompt } : null,
      pages,
    };
  }

  // Loads the book and checks it belongs to the signed-in user.
  async function loadBook(req, res) {
    const book = await store.getBook(req.user.id, Number(req.params.id));
    if (!book) res.status(404).json({ error: "Book not found." });
    return book;
  }

  async function logImage(req, book, kind, pageId, started, error) {
    const detail = { kind, pageId, ms: Date.now() - started, model: MOCK ? "mock" : MODEL, quality: QUALITY };
    if (error) detail.error = error.message;
    logger[error ? "error" : "info"](error ? "image failed" : "image generated", {
      userId: req.user.id,
      bookId: book.id,
      ...detail,
    });
    await store
      .logEvent({ userId: req.user.id, bookId: book.id, type: error ? "image_failed" : "image_generated", detail })
      .catch((e) => logger.error("event log failed", { error: e.message }));
  }

  app.get("/api/books", requireUser, async (req, res) => {
    try {
      const books = await store.listBooks(req.user.id);
      res.json(
        books.map((b) => ({
          id: b.id,
          child_name: b.child_name,
          created_at: b.created_at,
          updated_at: b.updated_at,
          page_count: b.page_count,
          total_pages: READY_PAGES.length,
          thumbnail: b.reference_image_id ? `/api/images/${b.reference_image_id}?v=${b.reference_v}` : null,
        }))
      );
    } catch (err) {
      sendError(res, err, { route: "list books" });
    }
  });

  app.post("/api/books", requireUser, async (req, res) => {
    try {
      const book = await store.createBook(req.user.id, req.body || {});
      await store.logEvent({ userId: req.user.id, bookId: book.id, type: "book_created" });
      logger.info("book created", { userId: req.user.id, bookId: book.id });
      res.status(201).json(await bookJson(book));
    } catch (err) {
      sendError(res, err, { route: "create book" });
    }
  });

  app.get("/api/books/:id", requireUser, async (req, res) => {
    try {
      const book = await loadBook(req, res);
      if (book) res.json(await bookJson(book));
    } catch (err) {
      sendError(res, err, { route: "get book" });
    }
  });

  app.patch("/api/books/:id", requireUser, async (req, res) => {
    try {
      const book = await store.updateBook(req.user.id, Number(req.params.id), req.body || {});
      if (!book) return res.status(404).json({ error: "Book not found." });
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err, { route: "update book" });
    }
  });

  app.delete("/api/books/:id", requireUser, async (req, res) => {
    try {
      const ok = await store.deleteBook(req.user.id, Number(req.params.id));
      if (!ok) return res.status(404).json({ error: "Book not found." });
      await store.logEvent({ userId: req.user.id, bookId: Number(req.params.id), type: "book_deleted" });
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err, { route: "delete book" });
    }
  });

  // Step 1: photo -> ONE reference image of the child as Jack, saved with the book.
  // The photo itself is NOT stored, only the cartoon.
  app.post("/api/books/:id/character", requireUser, requirePassword, upload.single("photo"), async (req, res) => {
    const book = await loadBook(req, res).catch((e) => sendError(res, e));
    if (!book) return;
    if (!req.file) return res.status(400).json({ error: "No photo uploaded." });
    const started = Date.now();
    try {
      const prompt = buildCharacterPrompt();
      const out = await editImage({ images: [{ buffer: req.file.buffer, mime: req.file.mimetype }], prompt, size: "1024x1536" });
      const saved = await store.saveImage(book.id, "reference", "", out.buffer, sniffMime(out.buffer), prompt);
      await logImage(req, book, "reference", null, started);
      res.json({ url: imageUrl(saved), prompt });
    } catch (err) {
      await logImage(req, book, "reference", null, started, err);
      sendError(res, err, { route: "character", bookId: book.id });
    }
  });

  // Step 2: saved reference + page prompt -> one page. The browser calls this for
  // every page at once, so pages generate in parallel.
  app.post("/api/books/:id/pages/:pageId", requireUser, requirePassword, async (req, res) => {
    const book = await loadBook(req, res).catch((e) => sendError(res, e));
    if (!book) return;
    const page = getPage(req.params.pageId);
    if (!page) return res.status(400).json({ error: "Unknown page." });
    const started = Date.now();
    try {
      const reference = await store.getImageData(book.id, "reference", "");
      if (!reference) return res.status(400).json({ error: "Create Jack (the character reference) first." });
      const prompt = buildPagePrompt(page);
      const out = await editImage({ images: [{ buffer: reference.data, mime: reference.mime }], prompt, size: "1536x1024" });
      const saved = await store.saveImage(book.id, "page", page.id, out.buffer, sniffMime(out.buffer), prompt);
      await logImage(req, book, "page", page.id, started);
      res.json({ url: imageUrl(saved), prompt });
    } catch (err) {
      await logImage(req, book, "page", page.id, started, err);
      sendError(res, err, { route: "page", bookId: book.id, pageId: page.id });
    }
  });

  // Step 3 (optional): edit a saved page ("same scene, one thing changed").
  app.post("/api/books/:id/pages/:pageId/fix", requireUser, requirePassword, async (req, res) => {
    const book = await loadBook(req, res).catch((e) => sendError(res, e));
    if (!book) return;
    const page = getPage(req.params.pageId);
    if (!page) return res.status(400).json({ error: "Unknown page." });
    const instruction = String(req.body?.instruction || "").trim().slice(0, 500);
    if (!instruction) return res.status(400).json({ error: "Describe what to change." });
    const started = Date.now();
    try {
      const [current, reference] = await Promise.all([
        store.getImageData(book.id, "page", page.id),
        store.getImageData(book.id, "reference", ""),
      ]);
      if (!current || !reference) return res.status(400).json({ error: "Generate this page first." });
      const prompt = buildFixPrompt(page, instruction);
      const out = await editImage({
        images: [
          { buffer: current.data, mime: current.mime },
          { buffer: reference.data, mime: reference.mime },
        ],
        prompt,
        size: "1536x1024",
      });
      const saved = await store.saveImage(book.id, "page", page.id, out.buffer, sniffMime(out.buffer), prompt);
      await logImage(req, book, "page-edit", page.id, started);
      res.json({ url: imageUrl(saved), prompt });
    } catch (err) {
      await logImage(req, book, "page-edit", page.id, started, err);
      sendError(res, err, { route: "fix", bookId: book.id, pageId: page.id });
    }
  });

  // Small client-side events worth logging (e.g. a PDF was downloaded).
  const CLIENT_EVENTS = new Set(["pdf_downloaded"]);
  app.post("/api/books/:id/events", requireUser, async (req, res) => {
    try {
      const book = await loadBook(req, res);
      if (!book) return;
      const type = String(req.body?.type || "");
      if (!CLIENT_EVENTS.has(type)) return res.status(400).json({ error: "Unknown event." });
      await store.logEvent({ userId: req.user.id, bookId: book.id, type });
      logger.info(type, { userId: req.user.id, bookId: book.id });
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err, { route: "event" });
    }
  });

  // The signed-in user's own activity log.
  app.get("/api/activity", requireUser, async (req, res) => {
    try {
      res.json(await store.recentEvents(req.user.id, 50));
    } catch (err) {
      sendError(res, err, { route: "activity" });
    }
  });

  // Images are only served to the user who owns the book.
  app.get("/api/images/:id", requireUser, async (req, res) => {
    try {
      const img = await store.getImageForUser(req.user.id, Number(req.params.id));
      if (!img) return res.status(404).end();
      res.set("Content-Type", img.mime);
      res.set("Cache-Control", "private, max-age=31536000, immutable"); // URL has ?v=, so it changes when the image does
      res.send(img.data);
    } catch (err) {
      sendError(res, err, { route: "image" });
    }
  });

  // ---- Temporary: measure image speed and rate limits on this account (admin only).
  const isAdmin = (u) =>
    u && (u.id === 1 || (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).includes(u.email));
  const benches = [];
  app.post("/api/admin/bench", requireUser, requirePassword, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: "Admins only." });
    const { n = 4, model, quality = "low", fidelity, size = "1536x1024", vision = false } = req.body || {};
    const fs = await import("node:fs/promises");
    const photo = await fs.readFile("public/survey/photo.jpg");
    const scene = await fs.readFile("public/survey/storybook-page-2.jpg");
    const bench = { started: new Date().toISOString(), params: { n, model, quality, fidelity, size, vision }, calls: [] };
    benches.push(bench);
    res.json({ index: benches.length - 1 });
    const oa = await import("./lib/openai.js");
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: Math.min(Number(n), 30) }, async (_, i) => {
        const s = Date.now();
        try {
          if (vision) {
            const out = await oa.lookAt({
              instructions: "Find every face. Return boxes as fractions of the image.",
              images: [{ buffer: scene, mime: "image/jpeg" }],
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["faces"],
                properties: {
                  faces: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["label", "x", "y", "w", "h"],
                      properties: { label: { type: "string" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
                    },
                  },
                },
              },
              model,
            });
            bench.calls.push({ i, ms: Date.now() - s, out });
          } else {
            const out = await oa.editImage({
              images: [
                { buffer: scene, mime: "image/jpeg" },
                { buffer: photo, mime: "image/jpeg" },
              ],
              prompt:
                "Replace the boy in the first image with the person in the second image, drawn in the same 3D animated style. Keep everything else exactly the same.",
              size,
              quality,
              model,
              fidelity,
            });
            bench.calls.push({ i, ms: Date.now() - s, bytes: out.buffer.length, rate: out.rate });
          }
        } catch (err) {
          bench.calls.push({ i, ms: Date.now() - s, error: err.message, rate: err.rate });
        }
      })
    );
    bench.totalMs = Date.now() - t0;
  });
  app.get("/api/admin/bench", requireUser, (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: "Admins only." });
    res.json(benches);
  });

  // Errors from multer (wrong file type, too large) and bad JSON
  app.use((err, _req, res, _next) => {
    res.status(err.status && err.status < 500 ? err.status : 400).json({ error: err.message || "Bad request." });
  });

  app.listen(PORT, () => {
    logger.info("server started", {
      port: PORT,
      storage: store.kind,
      login: loginConfigured,
      key: Boolean(API_KEY),
      mock: MOCK,
      model: MODEL,
      quality: QUALITY,
    });
  });
}

main().catch((err) => {
  logger.error("startup failed", { error: err.message });
  process.exit(1);
});
