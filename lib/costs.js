// What each OpenAI call costs, from the token counts the API returns.
// Prices are US dollars per 1M tokens (OpenAI's published prices, November 2026).
// Override with OPENAI_PRICES='{"gpt-image-1.5":{"textIn":5,...}}' if prices change.
const DEFAULT_PRICES = {
  // image models: text input, image input, image output
  "gpt-image-1.5": { textIn: 5, imageIn: 8, imageOut: 32, textOut: 10 },
  "gpt-image-1": { textIn: 5, imageIn: 10, imageOut: 40, textOut: 0 },
  "gpt-image-1-mini": { textIn: 2, imageIn: 2.5, imageOut: 8, textOut: 0 },
  // vision/chat models used for checking
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
};
// If the API ever returns no usage, fall back to the per-image price table.
const PER_IMAGE = { low: 0.013, medium: 0.05, high: 0.2 };

let prices = DEFAULT_PRICES;
try {
  if (process.env.OPENAI_PRICES) prices = { ...DEFAULT_PRICES, ...JSON.parse(process.env.OPENAI_PRICES) };
} catch {}

const M = 1_000_000;

export function imageCallCost(model, usage, quality = "low") {
  const p = prices[model] || prices["gpt-image-1.5"];
  if (!usage) return { usd: PER_IMAGE[quality] ?? PER_IMAGE.low, estimated: true };
  const imgIn = usage.input_tokens_details?.image_tokens ?? 0;
  const txtIn = usage.input_tokens_details?.text_tokens ?? Math.max(0, (usage.input_tokens || 0) - imgIn);
  const imgOut = usage.output_tokens_details?.image_tokens ?? usage.output_tokens ?? 0;
  const txtOut = usage.output_tokens_details?.text_tokens ?? 0;
  return { usd: (txtIn * p.textIn + imgIn * p.imageIn + imgOut * p.imageOut + txtOut * p.textOut) / M, estimated: false };
}

export function chatCallCost(model, usage) {
  const p = prices[model] || prices["gpt-4.1-mini"];
  if (!usage) return { usd: 0, estimated: true };
  return { usd: ((usage.prompt_tokens || 0) * p.in + (usage.completion_tokens || 0) * p.out) / M, estimated: false };
}
