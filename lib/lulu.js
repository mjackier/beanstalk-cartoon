// Lulu Print API (https://api.lulu.com/docs), over fetch. SANDBOX ONLY in this project:
// the base URL defaults to the sandbox, and the server refuses to start an order against
// production unless LULU_ALLOW_PRODUCTION=1 is set on purpose (it never is here).
//
// Env: LULU_CLIENT_KEY, LULU_CLIENT_SECRET (from developers.sandbox.lulu.com → API Keys),
//      LULU_API_BASE (default https://api.sandbox.lulu.com), LULU_POD_PACKAGE_ID.
import { logger } from "./log.js";

const BASE = () => (process.env.LULU_API_BASE || "https://api.sandbox.lulu.com").replace(/\/$/, "");
const KEY = () => process.env.LULU_CLIENT_KEY || "";
const SECRET = () => process.env.LULU_CLIENT_SECRET || "";

// 11 x 8.5 in landscape, full colour, premium paper, hardcover casewrap, 80# coated white, gloss.
// Casewrap needs at least 24 pages; our interior is exactly 24.
export const POD_PACKAGE_ID = () => process.env.LULU_POD_PACKAGE_ID || "1100X0850FCPRECW080CW444GXX";
export const isSandbox = () => /sandbox/.test(BASE()) || /localhost|127\.0\.0\.1/.test(BASE());
export const configured = () => Boolean(KEY() && SECRET());

export const SHIPPING_LEVELS = ["MAIL", "PRIORITY_MAIL", "GROUND", "EXPEDITED", "EXPRESS"];

function guard() {
  if (!configured()) throw Object.assign(new Error("Printing isn't set up on the server yet (no Lulu keys)."), { status: 503 });
  if (!isSandbox() && process.env.LULU_ALLOW_PRODUCTION !== "1")
    throw Object.assign(new Error("Refusing to talk to Lulu production: this project only places sandbox orders."), { status: 503 });
}

let token = null; // { value, exp }
async function accessToken() {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  const res = await fetch(`${BASE()}/auth/realms/glasstree/protocol/openid-connect/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${KEY()}:${SECRET()}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw Object.assign(new Error(`Lulu sign-in failed (${res.status}): ${json.error_description || json.error || "no token"}`), { status: 502 });
  }
  token = { value: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return token.value;
}

// Lulu's errors come back as { field: ["message"] } or { detail: "..." }; flatten them.
function luluMessage(json, status) {
  if (!json || typeof json !== "object") return `Lulu error ${status}`;
  if (json.detail) return String(json.detail);
  const parts = [];
  const walk = (v, path) => {
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) parts.push(`${path}: ${v.join(" ")}`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    else if (v != null) parts.push(`${path}: ${v}`);
  };
  walk(json, "");
  return parts.join("; ").slice(0, 600) || `Lulu error ${status}`;
}

async function call(method, path, body) {
  guard();
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    }).catch((err) => ({ ok: false, status: 0, json: async () => ({ detail: err.message }) }));
    if (res.status === 401 && attempt === 1) {
      token = null;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      logger.warn("lulu error", { path, status: res.status, json });
      throw Object.assign(new Error(luluMessage(json, res.status)), { status: res.status === 400 ? 400 : 502, lulu: json });
    }
    return json;
  }
}

// Our address form -> Lulu's shipping_address.
export function luluAddress(a) {
  return {
    name: a.name,
    street1: a.street1,
    street2: a.street2 || undefined,
    city: a.city,
    state_code: a.state_code,
    postcode: a.postcode,
    country_code: a.country_code || "US",
    phone_number: a.phone_number,
    email: a.email || undefined,
  };
}

// What Lulu charges us for one book shipped to this address. Returns cents and the raw answer.
export async function quote({ address, shippingLevel = "MAIL", pageCount = 24 }) {
  const json = await call("POST", "/print-job-cost-calculations/", {
    line_items: [{ pod_package_id: POD_PACKAGE_ID(), page_count: pageCount, quantity: 1 }],
    shipping_address: luluAddress(address),
    shipping_option: shippingLevel,
  });
  const c = (v) => Math.round(Number(v || 0) * 100);
  const li = json.line_item_costs?.[0] || {};
  return {
    currency: json.currency || "USD",
    printCents: c(li.total_cost_excl_tax),
    shippingCents: c(json.shipping_cost?.total_cost_excl_tax),
    fulfillmentCents: c(json.fulfillment_cost?.total_cost_excl_tax),
    feesCents: (json.fees || []).reduce((s, f) => s + c(f.total_cost_excl_tax), 0),
    taxCents: c(json.total_tax),
    totalCents: c(json.total_cost_incl_tax),
    raw: json,
  };
}

// Cover spread size for this package and page count, in points.
export async function coverDimensions(pageCount = 24) {
  const json = await call("POST", "/cover-dimensions/", { pod_package_id: POD_PACKAGE_ID(), interior_page_count: pageCount, unit: "pt" });
  return { width: Number(json.width), height: Number(json.height) };
}

export async function createPrintJob({ externalId, title, interiorUrl, coverUrl, address, shippingLevel, contactEmail }) {
  return call("POST", "/print-jobs/", {
    external_id: externalId,
    contact_email: contactEmail,
    shipping_level: shippingLevel,
    shipping_address: luluAddress(address),
    line_items: [
      {
        external_id: externalId,
        title: title.slice(0, 255),
        quantity: 1,
        printable_normalization: {
          pod_package_id: POD_PACKAGE_ID(),
          interior: { source_url: interiorUrl },
          cover: { source_url: coverUrl },
        },
      },
    ],
  });
}

export const getPrintJob = (id) => call("GET", `/print-jobs/${encodeURIComponent(id)}/`);

// File checks (admin tool): Lulu validates our PDFs against the package before any order.
export const validateInterior = (url) => call("POST", "/validate-interior/", { source_url: url, pod_package_id: POD_PACKAGE_ID() });
export const getInteriorValidation = (id) => call("GET", `/validate-interior/${id}/`);
export const validateCover = (url, pageCount = 24) =>
  call("POST", "/validate-cover/", { source_url: url, pod_package_id: POD_PACKAGE_ID(), interior_page_count: pageCount });
export const getCoverValidation = (id) => call("GET", `/validate-cover/${id}/`);
