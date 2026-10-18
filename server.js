import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { buildPrompt, SCENES } from "./prompt.js";

const app = express();
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

// Keep uploads in memory (never saved to disk). Limit to 8 MB images.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Please upload a JPEG, PNG, or WebP image."), ok);
  },
});

app.use(express.static("public"));

app.get("/api/scenes", (_req, res) => {
  res.json(SCENES);
});

app.get("/api/status", (_req, res) => {
  res.json({ keyConfigured: Boolean(API_KEY), model: MODEL, quality: QUALITY, inputFidelity: INPUT_FIDELITY });
});

// One request in = exactly one API call out. No loops, no automatic retries.
app.post("/api/generate", upload.single("photo"), async (req, res) => {
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

// Errors from multer (wrong file type, too large)
app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Bad request." });
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
  console.log(API_KEY ? `API key loaded. Model: ${MODEL} (${QUALITY})` : "WARNING: OPENAI_API_KEY is not set.");
});
