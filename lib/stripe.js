// Stripe over plain fetch (no SDK). TEST MODE ONLY: the server refuses to start a payment
// with a live key, so no real money can ever move.
// The key comes from STRIPE_SECRET_KEY in the environment (Render / .env), never from the code.
const BASE = (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, "");
const key = () => process.env.STRIPE_SECRET_KEY || "";

export const stripeConfigured = () => key().startsWith("sk_test_");
export const stripeMode = () => (key().startsWith("sk_test_") ? "test" : key().startsWith("sk_live_") ? "live (refused)" : "not set");

// Stripe wants form encoding with brackets for nested fields: line_items[0][price_data][currency]=usd
function encode(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") encode(v, name, out);
    else out.append(name, String(v));
  }
  return out;
}

async function stripe(method, path, params, idempotencyKey) {
  if (!stripeConfigured()) {
    throw Object.assign(new Error("Payments aren't set up: the server needs a Stripe TEST key (sk_test_...)."), { status: 503 });
  }
  const headers = { Authorization: `Bearer ${key()}`, "Stripe-Version": "2024-06-20" };
  let url = `${BASE}/v1/${path}`;
  let body;
  if (method === "GET" && params) url += `?${encode(params)}`;
  else if (params) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = encode(params);
  }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(json?.error?.message || `Stripe error ${res.status}`), { status: res.status >= 500 ? 502 : 400 });
  }
  return json;
}

export function createCheckoutSession({ amountCents, userId, email, successUrl, cancelUrl }) {
  return stripe(
    "POST",
    "checkout/sessions",
    {
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email || undefined,
      client_reference_id: String(userId),
      payment_method_types: { 0: "card" },
      line_items: {
        0: {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: { name: "Storybook credit", description: "Each storybook PDF costs $0.99." },
          },
        },
      },
      metadata: { app: "beanstalk-storybook", user_id: String(userId) },
      payment_intent_data: { metadata: { app: "beanstalk-storybook", user_id: String(userId) } },
    },
    `checkout-${userId}-${Date.now()}`
  );
}

export function getCheckoutSession(id) {
  return stripe("GET", `checkout/sessions/${encodeURIComponent(id)}`, { expand: { 0: "payment_intent.latest_charge" } });
}

export function createRefund({ paymentIntent, amountCents, refundId, userId }) {
  return stripe(
    "POST",
    "refunds",
    {
      payment_intent: paymentIntent,
      amount: amountCents,
      reason: "requested_by_customer",
      metadata: { app: "beanstalk-storybook", user_id: String(userId), refund_request: String(refundId) },
    },
    `refund-${refundId}` // a retried request can never refund twice
  );
}
