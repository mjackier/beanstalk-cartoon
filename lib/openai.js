// OpenAI over plain fetch (no SDK), so the whole server runs with no packages
// except pg. OPENAI_BASE_URL lets local tests point at a fake server.
import { logger } from "./log.js";
import { imageCallCost, chatCallCost } from "./costs.js";

// Every call reports what it cost to whoever registered a recorder (the server saves it in the DB).
let recorder = null;
export const setUsageRecorder = (fn) => (recorder = fn);
function record(meter, entry) {
  if (!recorder) return;
  Promise.resolve(recorder({ ...(meter || {}), ...entry })).catch((err) => logger.warn("usage record failed", { error: err.message }));
}

const BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const KEY = () => process.env.OPENAI_API_KEY || "";
export const hasKey = () => Boolean(KEY());

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// A small gate so a burst of pages can't exceed what the account allows at once.
let active = 0;
const waiting = [];
const MAX = () => Number(process.env.OPENAI_MAX_CONCURRENCY || 24);
async function slot() {
  if (active < MAX()) {
    active++;
    return;
  }
  await new Promise((r) => waiting.push(r));
  active++;
}
function release() {
  active--;
  const next = waiting.shift();
  if (next) next();
}

function rateHeaders(res) {
  const out = {};
  for (const [k, v] of res.headers) if (k.startsWith("x-ratelimit")) out[k] = v;
  return out;
}

// One HTTP call, retried only on 429 / 5xx transport problems (not a new "generation").
async function call(path, init, label) {
  for (let attempt = 1; ; attempt++) {
    await slot();
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${KEY()}`, ...(init.headers || {}) },
        signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS || 120000)),
      });
    } catch (err) {
      release();
      if (attempt < 3) continue;
      throw Object.assign(new Error(`OpenAI unreachable: ${err.message}`), { status: 502 });
    }
    release();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = Math.min(20000, Number(res.headers.get("retry-after") || 0) * 1000 || 1500 * attempt);
      logger.warn("openai retry", { label, status: res.status, attempt, wait });
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || `OpenAI error ${res.status}`;
      throw Object.assign(new Error(msg), { status: res.status >= 500 ? 502 : res.status, rate: rateHeaders(res) });
    }
    return { json, rate: rateHeaders(res) };
  }
}

// images: [{ buffer, mime }], returns { buffer, mime, rate }
export async function editImage({ images, prompt, size = "1536x1024", quality, model, fidelity, mask, meter }) {
  if (!hasKey()) throw Object.assign(new Error("The server has no OpenAI key yet."), { status: 503 });
  model = model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5";
  quality = quality || process.env.OPENAI_IMAGE_QUALITY || "low";
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("n", "1");
  form.append("output_format", "jpeg");
  form.append("output_compression", "85");
  const fid = fidelity ?? process.env.OPENAI_INPUT_FIDELITY;
  if (fid && !model.includes("mini")) form.append("input_fidelity", fid);
  images.forEach((img, i) =>
    form.append(images.length > 1 ? "image[]" : "image", new Blob([img.buffer], { type: img.mime }), `in-${i}.${EXT[img.mime] || "png"}`)
  );
  if (mask) form.append("mask", new Blob([mask], { type: "image/png" }), "mask.png");
  const t0 = Date.now();
  const { json, rate } = await call("/images/edits", { method: "POST", body: form }, "edit");
  const cost = imageCallCost(model, json?.usage, quality);
  record(meter, { kind: "image", model, usage: json?.usage || null, usd: cost.usd, estimated: cost.estimated, ms: Date.now() - t0 });
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw Object.assign(new Error("The image model returned no image."), { status: 502 });
  return { buffer: Buffer.from(b64, "base64"), mime: "image/jpeg", rate };
}

export async function generateImage({ prompt, size = "1536x1024", quality, model, meter }) {
  if (!hasKey()) throw Object.assign(new Error("The server has no OpenAI key yet."), { status: 503 });
  model = model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5";
  const t0 = Date.now();
  quality = quality || process.env.OPENAI_IMAGE_QUALITY || "low";
  const { json, rate } = await call(
    "/images/generations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        size,
        quality: quality || process.env.OPENAI_IMAGE_QUALITY || "low",
        n: 1,
        output_format: "jpeg",
        output_compression: 85,
      }),
    },
    "generate"
  );
  const cost = imageCallCost(model, json?.usage, quality);
  record(meter, { kind: "image", model, usage: json?.usage || null, usd: cost.usd, estimated: cost.estimated, ms: Date.now() - t0 });
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw Object.assign(new Error("The image model returned no image."), { status: 502 });
  return { buffer: Buffer.from(b64, "base64"), mime: "image/jpeg", rate };
}

// Vision check with a JSON schema answer. images: [{ buffer, mime, detail? }]
export async function lookAt({ instructions, images, schema, name = "check", model, meter }) {
  if (!hasKey()) throw Object.assign(new Error("The server has no OpenAI key yet."), { status: 503 });
  model = model || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const content = [{ type: "text", text: instructions }];
  for (const img of images) {
    if (img.label) content.push({ type: "text", text: img.label });
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.buffer.toString("base64")}`, detail: img.detail || "high" },
    });
  }
  const t0 = Date.now();
  const { json } = await call(
    "/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: "user", content }],
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      }),
    },
    "vision"
  );
  const cost = chatCallCost(model, json?.usage);
  record(meter, { kind: "vision", model, usage: json?.usage || null, usd: cost.usd, estimated: cost.estimated, ms: Date.now() - t0 });
  const text = json?.choices?.[0]?.message?.content;
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("The vision model returned no JSON."), { status: 502 });
  }
}

// OpenAI's moderation endpoint (free). Returns { flagged, categories: [names] }.
export async function moderate(text, meter) {
  if (!hasKey()) throw Object.assign(new Error("The server has no OpenAI key yet."), { status: 503 });
  const model = "omni-moderation-latest";
  const t0 = Date.now();
  const { json } = await call(
    "/moderations",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, input: text }) },
    "moderation"
  );
  record(meter, { kind: "moderation", model, usage: null, usd: 0, estimated: false, ms: Date.now() - t0 });
  const r = json?.results?.[0];
  if (!r) throw Object.assign(new Error("The moderation check returned nothing."), { status: 502 });
  return { flagged: Boolean(r.flagged), categories: Object.entries(r.categories || {}).filter(([, v]) => v).map(([k]) => k) };
}
