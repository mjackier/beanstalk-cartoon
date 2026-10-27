import crypto from "node:crypto";
import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { buildPrompt, SCENES } from "./prompt.js";
import { STYLE, READY_PAGES, getPage, buildCharacterPrompt, buildPagePrompt, buildFixPrompt } from "./story.js";

const app = express();
// Render sits behind a proxy; trust it so req.ip is the real visitor, not the proxy.
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

// The key is read ONLY from the environment. It is never written in code.
// Locally: put it in a .env file (git-ignored). On Render: set it in Environment settings.
const API_KEY = process.env.OPENAI_API_KEY;

// Cheap by default. You can change these in Render's environment settings without touching code.
const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini";
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || "low"; // low | medium | high
// Optional: "high" keeps faces much closer to the photo. Not supported by gpt-image-1-mini;
// use it with gpt-image-1.5 or gpt-image-1.
const INPUT_FIDELITY = process.env.OPENAI_INPUT_FIDELITY || null;

const openai = API_KEY ? new OpenAI({ apiKey: API_KEY }) : null;

// Keep uploads in memory (never saved to disk). Limit to 15 MB images
// (generated pages sent back for editing are large PNGs).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Please upload a JPEG, PNG, or WebP image."), ok);
  },
});

app.use(express.static("public"));

// ---------------------------------------------------------------------
// Password for anything that costs money (image generation).
// The password lives ONLY in the GENERATE_PASSWORD environment variable,
// never in the code: this repo is public.
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
  res.status(401).json({ error: "Wrong or missing password.", needPassword: true });
}

// Lets the page check a password without generating (and spending) anything.
app.post("/api/check-password", requirePassword, (_req, res) => res.json({ ok: true }));

app.get("/api/scenes", (_req, res) => {
  res.json(SCENES);
});

app.get("/api/status", (_req, res) => {
  res.json({
    keyConfigured: Boolean(API_KEY),
    mock: process.env.MOCK_IMAGES === "1",
    model: MODEL,
    quality: QUALITY,
    inputFidelity: INPUT_FIDELITY,
    passwordRequired: Boolean(GENERATE_PASSWORD),
  });
});

// One request in = exactly one API call out. No loops, no automatic retries.
app.post("/api/generate", requirePassword, upload.single("photo"), async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({
        error: "The server has no API key yet. Set OPENAI_API_KEY in the environment.",
      });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No photo uploaded." });
    }

    const sceneId = req.body.scene;
    if (!SCENES[sceneId]) {
      return res.status(400).json({ error: "Unknown scene." });
    }

    const settings = {
      style: req.body.style,
      exaggeration: req.body.exaggeration,
      outline: req.body.outline,
      palette: req.body.palette,
    };

    const { prompt, sceneSpec } = buildPrompt(sceneId, settings);

    const image = await toFile(req.file.buffer, req.file.originalname || "photo.png", {
      type: req.file.mimetype,
    });

    const result = await openai.images.edit({
      model: MODEL,
      image,
      prompt,
      size: "1024x1024",
      quality: QUALITY,
      n: 1,
      ...(INPUT_FIDELITY ? { input_fidelity: INPUT_FIDELITY } : {}),
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(502).json({ error: "The image model returned no image." });
    }

    res.json({
      image: `data:image/png;base64,${b64}`,
      caption: sceneSpec,
      prompt,
    });
  } catch (err) {
    console.error("Generation failed:", err?.message || err);
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: err?.message || "Something went wrong." });
  }
});

// =====================================================================
// Storybook (homework 2). Same rules: one request in = one API call out.
// =====================================================================

// MOCK_IMAGES=1 skips OpenAI and echoes the first input image back, so the
// whole pipeline (pages, text layout, PDF) can be tested for free.
const MOCK = process.env.MOCK_IMAGES === "1";

// gpt-image-1-mini rejects input_fidelity "high", so only send it to models that accept it.
const fidelityFor = (model) =>
  INPUT_FIDELITY && !model.includes("mini") ? { input_fidelity: INPUT_FIDELITY } : {};

async function asUpload(file, name) {
  return toFile(file.buffer, name, { type: file.mimetype });
}

// Exactly ONE images.edit call. No loop, no retry.
async function editImage({ images, prompt, size }) {
  if (MOCK) return images[0].buffer.toString("base64");
  const files = await Promise.all(images.map((f, i) => asUpload(f, `input-${i}.png`)));
  const result = await openai.images.edit({
    model: MODEL,
    image: files.length === 1 ? files[0] : files,
    prompt,
    size,
    quality: QUALITY,
    n: 1,
    ...fidelityFor(MODEL),
  });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw Object.assign(new Error("The image model returned no image."), { status: 502 });
  return b64;
}

function requireKey(res) {
  if (!openai && !MOCK) {
    res.status(503).json({ error: "The server has no API key yet. Set OPENAI_API_KEY in the environment." });
    return false;
  }
  return true;
}

function sendError(res, err) {
  console.error("Book generation failed:", err?.message || err);
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ error: err?.message || "Something went wrong." });
}

const bookUpload = upload.fields([
  { name: "photo", maxCount: 1 },
  { name: "reference", maxCount: 1 },
  { name: "page", maxCount: 1 },
]);

// Page list for the front end (text + where the text goes). Prompts stay on the server.
app.get("/api/book", (_req, res) => {
  res.json({
    style: STYLE,
    pages: READY_PAGES.map(({ id, number, title, text, textArea }) => ({ id, number, title, text, textArea })),
  });
});

// Step 1: uploaded photo -> ONE character reference image of Jack.
app.post("/api/book/character", requirePassword, bookUpload, async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const photo = req.files?.photo?.[0];
    if (!photo) return res.status(400).json({ error: "No photo uploaded." });
    const prompt = buildCharacterPrompt();
    const b64 = await editImage({ images: [photo], prompt, size: "1024x1536" });
    res.json({ image: `data:image/png;base64,${b64}`, prompt });
  } catch (err) {
    sendError(res, err);
  }
});

// Step 2: reference image + page prompt -> one page.
app.post("/api/book/page", requirePassword, bookUpload, async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const reference = req.files?.reference?.[0];
    const page = getPage(req.body.pageId);
    if (!reference) return res.status(400).json({ error: "Create Jack (the character reference) first." });
    if (!page) return res.status(400).json({ error: "Unknown page." });
    const prompt = buildPagePrompt(page);
    const b64 = await editImage({ images: [reference], prompt, size: "1536x1024" });
    res.json({ image: `data:image/png;base64,${b64}`, prompt });
  } catch (err) {
    sendError(res, err);
  }
});

// Step 3 (optional): edit an existing page ("same scene, one thing changed").
app.post("/api/book/fix", requirePassword, bookUpload, async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const pageImage = req.files?.page?.[0];
    const reference = req.files?.reference?.[0];
    const page = getPage(req.body.pageId);
    const instruction = (req.body.instruction || "").trim().slice(0, 500);
    if (!pageImage || !reference) return res.status(400).json({ error: "Missing the page or reference image." });
    if (!page) return res.status(400).json({ error: "Unknown page." });
    if (!instruction) return res.status(400).json({ error: "Describe what to change." });
    const prompt = buildFixPrompt(page, instruction);
    const b64 = await editImage({ images: [pageImage, reference], prompt, size: "1536x1024" });
    res.json({ image: `data:image/png;base64,${b64}`, prompt });
  } catch (err) {
    sendError(res, err);
  }
});

// Errors from multer (wrong file type, too large)
app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Bad request." });
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
  console.log(API_KEY ? `API key loaded. Model: ${MODEL} (${QUALITY})` : "WARNING: OPENAI_API_KEY is not set.");
});
