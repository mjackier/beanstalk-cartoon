// Beanstalk Storybook server. No framework: lib/http.js is a ~200-line router on node:http.
// Secrets (OpenAI, Stripe, Google, session, database) come only from environment variables.
import crypto from "node:crypto";
import { createApp, jsonBody, readBody, HttpError } from "./lib/http.js";
import { logger, requestLogger } from "./lib/log.js";
import { createStore, InsufficientFunds } from "./lib/store.js";
import { registerAuth, requireUser, loginConfigured } from "./lib/auth.js";
import { hasKey, setUsageRecorder } from "./lib/openai.js";
import { sniffMime } from "./lib/images.js";
import * as stripe from "./lib/stripe.js";
import { validateDetails, detailsHash } from "./lib/validate.js";
import * as lulu from "./lib/lulu.js";
import { priceFor, SHIPPING, PRINT_PRICE_CENTS } from "./lib/pricing.js";
import { sign, verify } from "./lib/session.js";
import { rebuildReadingPdf, buildPrintFiles, READING_PAGES } from "./book/print.js";
import { STORIES, STORY_IDS } from "./book/stories.js";
import { TEMPLATE, LAYOUTS } from "./book/template.js";
import { createPipeline, PRICE_CENTS } from "./book/pipeline.js";

const PORT = process.env.PORT || 3000;
// A stray promise must never take the whole site down.
process.on("unhandledRejection", (err) => logger.error("unhandled rejection", { error: err?.stack || String(err) }));
const app = createApp({ trustProxy: true });
const store = await createStore();
const pipeline = createPipeline(store);
setUsageRecorder((c) => store.recordCall(c)); // every OpenAI call's cost goes into api_calls
await pipeline.seedBible();

app.use(requestLogger);
// Old addresses from earlier homework go to the new app.
app.use((req, res, next) => (["/book.html", "/index.html"].includes(req.path) ? res.redirect("/", 301) : next()));
app.static("public", { maxAge: 3600 });
registerAuth(app, store);

const money = (c) => `$${(c / 100).toFixed(2)}`;
const isAdmin = (u) =>
  Boolean(u) && (u.id === 1 || (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean).includes(u.email));

// ------------------------------------------------------------------ generate password
// Anything that spends real OpenAI money needs this password (it lives only in GENERATE_PASSWORD).
const GENERATE_PASSWORD = process.env.GENERATE_PASSWORD || "";
const failed = new Map();
function requirePassword(req, res, next) {
  if (!GENERATE_PASSWORD) return next();
  const now = Date.now();
  const rec = failed.get(req.ip);
  if (rec && now - rec.since > 15 * 60 * 1000) failed.delete(req.ip);
  if ((failed.get(req.ip)?.count || 0) >= 10) throw new HttpError(429, "Too many wrong passwords. Try again in 15 minutes.", { extra: { needPassword: true } });
  const a = Buffer.from(String(req.get("x-app-password") || ""));
  const b = Buffer.from(GENERATE_PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    failed.delete(req.ip);
    return next();
  }
  const r = failed.get(req.ip) || { count: 0, since: now };
  r.count++;
  failed.set(req.ip, r);
  logger.warn("wrong generate password", { ip: req.ip, attempts: r.count });
  throw new HttpError(401, "Wrong or missing password.", { extra: { needPassword: true } });
}
app.post("/api/check-password", requirePassword, (_req, res) => res.json({ ok: true }));

// ------------------------------------------------------------------ status
app.get("/api/health", async (_req, res) => {
  await store.health();
  res.json({ ok: true, storage: store.kind, login: loginConfigured, key: hasKey(), stripe: stripe.stripeMode() });
});

app.get("/api/config", async (_req, res) => {
  const scenes = await store.listScenes(null);
  res.set("Cache-Control", "public, max-age=30");
  res.json({
    loginConfigured,
    passwordRequired: Boolean(GENERATE_PASSWORD),
    stripe: stripe.stripeMode(),
    priceCents: PRICE_CENTS,
    stories: STORY_IDS.map((id) => ({
      id,
      title: STORIES[id].title,
      heroName: STORIES[id].heroName,
      blurb: STORIES[id].blurb,
      ready: scenes.filter((s) => s.story === id).length === TEMPLATE.length,
      cover: scenes.find((s) => s.story === id && s.page_no === 1) ? `/api/stories/${id}/cover` : null,
    })),
  });
});

// A story's first scene (with the stand-in hero) as its picture on the "choose a story" cards.
app.get("/api/stories/:id/cover", async (req, res) => {
  const scene = STORIES[req.params.id] && (await store.getScene(req.params.id, 1, true));
  if (!scene) return res.status(404).end();
  res.set("Content-Type", "image/jpeg").set("Cache-Control", "public, max-age=3600").send(scene.data);
});

// ------------------------------------------------------------------ books
function img(row, thumb = true) {
  return row ? `/api/images/${row.id}?v=${row.v}${thumb ? "&thumb=1" : ""}` : null;
}

async function bookJson(book, user) {
  const userId = user.id;
  const images = await store.listImages(book.id);
  const docs = await store.listDocuments(userId, book.id);
  const hero = images.find((i) => i.kind === "hero" || i.kind === "reference");
  const story = STORIES[book.story];
  const pages = story
    ? story.pages.map((p, i) => {
        const row = images.find((x) => x.kind === "page" && x.page_id === `p${String(i + 1).padStart(2, "0")}`);
        return {
          n: i + 1,
          layout: TEMPLATE[i].layout,
          url: img(row, false),
          thumb: img(row),
          checked: row
            ? {
                pass: row.meta?.pass ?? true,
                generations: (row.meta?.attempts || []).filter((a) => !a.error).length,
                fromScene: Boolean(row.meta?.fromScene),
                attempts: (row.meta?.attempts || []).map((a) => ({ pass: a.pass, fails: a.fails || [] })),
              }
            : null,
        };
      })
    : [];
  return {
    id: book.id,
    story: book.story,
    storyTitle: story?.title || "Jack and the Beanstalk (3-page version)",
    legacy: !story,
    child_name: book.child_name,
    child_age: book.child_age,
    child_favorites: book.child_favorites,
    child_about: book.child_about,
    pronouns: book.pronouns,
    status: book.status,
    error: book.error,
    stats: book.stats,
    created_at: book.created_at,
    updated_at: book.updated_at,
    hero: hero ? { url: img(hero, false) } : null,
    pages,
    documents: docs.map((d) => ({ id: d.id, url: `/api/documents/${d.id}`, pages: d.pages, bytes: d.bytes, created_at: d.created_at })),
    heroJob: pipeline.heroJob(book.id),
    heroAttempts: hero?.meta?.attempts?.length || 0,
    cost: story && isAdmin(user) ? await store.bookCost(book.id) : null, // admins only
    priceCents: PRICE_CENTS,
    job: pipeline.bookJob(book.id),
  };
}

async function loadBook(req) {
  const book = await store.getBook(req.user.id, Number(req.params.id));
  if (!book) throw new HttpError(404, "Book not found.");
  return book;
}

app.get("/api/books", requireUser, async (req, res) => {
  const books = await store.listBooks(req.user.id);
  res.json(
    books.map((b) => ({
      id: b.id,
      child_name: b.child_name,
      story: b.story,
      storyTitle: STORIES[b.story]?.title || "Jack and the Beanstalk (3-page version)",
      legacy: !STORIES[b.story],
      status: b.status,
      page_count: b.page_count,
      updated_at: b.updated_at,
      thumb: b.cover_id ? `/api/images/${b.cover_id}?thumb=1` : b.hero_id ? `/api/images/${b.hero_id}?thumb=1` : null,
      document: b.document_id ? `/api/documents/${b.document_id}` : null,
    }))
  );
});

app.post("/api/books", requireUser, async (req, res) => {
  const body = await jsonBody(req);
  if (!STORIES[body.story]) throw new HttpError(400, "Choose a story.");
  const book = await store.createBook(req.user.id, body);
  await store.logEvent({ userId: req.user.id, bookId: book.id, type: "book_created", detail: { story: book.story } });
  res.status(201).json(await bookJson(book, req.user));
});

app.get("/api/books/:id", requireUser, async (req, res) => {
  res.json(await bookJson(await loadBook(req), req.user));
});

// Light polling endpoint for the progress view.
app.get("/api/books/:id/progress", requireUser, async (req, res) => {
  const book = await loadBook(req);
  res.json({ status: book.status, heroJob: pipeline.heroJob(book.id), job: pipeline.bookJob(book.id) });
});

app.patch("/api/books/:id", requireUser, async (req, res) => {
  const body = await jsonBody(req);
  if (body.story && !STORIES[body.story]) throw new HttpError(400, "Unknown story.");
  const book = await store.updateBook(req.user.id, Number(req.params.id), body);
  if (!book) throw new HttpError(404, "Book not found.");
  res.json({ ok: true });
});

app.delete("/api/books/:id", requireUser, async (req, res) => {
  if (pipeline.isRunning(Number(req.params.id))) throw new HttpError(409, "This book is still being made.");
  if (!(await store.deleteBook(req.user.id, Number(req.params.id)))) throw new HttpError(404, "Book not found.");
  await store.logEvent({ userId: req.user.id, bookId: Number(req.params.id), type: "book_deleted" });
  res.json({ ok: true });
});

// The photo is sent as the raw request body (image/jpeg, png or webp). It is NOT stored:
// only the cartoon portrait made from it is.
app.post("/api/books/:id/photo", requireUser, requirePassword, async (req, res) => {
  const book = await loadBook(req);
  if (pipeline.isRunning(book.id)) throw new HttpError(409, "This book is being made right now.");
  const buffer = await readBody(req, { limit: 12 * 1024 * 1024 });
  const mime = sniffMime(buffer);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new HttpError(400, "Please use a JPEG, PNG or WebP photo.");
  pipeline.startHero(book, { buffer, mime }, req.user.id);
  await store.logEvent({ userId: req.user.id, bookId: book.id, type: "photo_added" });
  res.json({ heroJob: pipeline.heroJob(book.id) });
});

// The About Me details are checked (rules, moderation, a name check) before anything is drawn,
// charged or printed. A passing check is remembered by a hash of the details, so editing them re-checks.
async function requireCleanDetails(book, user) {
  const hash = detailsHash(book);
  if (book.details_ok === hash) return;
  const result = await validateDetails(book, { bookId: book.id, userId: user.id });
  await store.logEvent({ userId: user.id, bookId: book.id, type: result.ok ? "details_ok" : "details_rejected", detail: { by: result.by, problems: result.problems } });
  if (!result.ok) {
    throw new HttpError(422, result.problems.map((p) => p.message).join(" "), { extra: { problems: result.problems } });
  }
  await store.setDetailsOk(book.id, hash);
  book.details_ok = hash;
}

app.post("/api/books/:id/check-details", requireUser, async (req, res) => {
  const book = await loadBook(req);
  try {
    await requireCleanDetails(book, req.user);
    res.json({ ok: true });
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ ok: false, error: err.message, problems: err.extra.problems });
    throw err;
  }
});

// Make the book: charge $0.99, then run the pipeline. Progress via /progress.
app.post("/api/books/:id/generate", requireUser, requirePassword, async (req, res) => {
  const book = await loadBook(req);
  const story = STORIES[book.story];
  if (!story) throw new HttpError(400, "This is an older book; start a new one.");
  if (pipeline.isRunning(book.id)) throw new HttpError(409, "This book is already being made.");
  if (!book.child_name) throw new HttpError(400, "Enter the child's name first.");
  await requireCleanDetails(book, req.user);
  if (!(await pipeline.storyReady(book.story))) throw new HttpError(503, "This story's scenes are still being prepared. Try again soon.");
  const hj = pipeline.heroJob(book.id);
  const hasHero = await store.getImageData(book.id, "hero", "");
  if (!hasHero && (!hj || hj.status === "failed")) throw new HttpError(400, hj?.error ? `The photo didn't work: ${hj.error}` : "Add a photo first.");
  let charge;
  try {
    charge = await store.charge(req.user.id, PRICE_CENTS, {
      kind: "document",
      description: `Storybook PDF: "${story.title}" starring ${book.child_name}`,
      book_id: book.id,
    });
  } catch (err) {
    if (err instanceof InsufficientFunds) {
      throw new HttpError(402, `A book costs ${money(PRICE_CENTS)} and your balance is ${money(err.balance)}. Add funds first.`, {
        extra: { needFunds: true, balance: err.balance },
      });
    }
    throw err;
  }
  pipeline.startBook({ book, user: req.user, charge });
  res.json({ ok: true, balance: charge.balance_after, job: pipeline.bookJob(book.id) });
});

app.get("/api/images/:id", requireUser, async (req, res) => {
  const row = await store.getImageForUser(req.user.id, Number(req.params.id), req.query.thumb === "1");
  if (!row) return res.status(404).end();
  res.set("Content-Type", row.mime).set("Cache-Control", "private, max-age=31536000, immutable").send(row.data);
});

app.get("/api/documents/:id", requireUser, async (req, res) => {
  const doc = await store.getDocument(req.user.id, Number(req.params.id));
  if (!doc) throw new HttpError(404, "Document not found.");
  const name = doc.title.replace(/[^A-Za-z0-9 ,'-]/g, "").replace(/\s+/g, "-").slice(0, 80) || "storybook";
  res
    .set("Content-Type", "application/pdf")
    .set("Content-Disposition", `${req.query.inline ? "inline" : "attachment"}; filename="${name}.pdf"`)
    .set("Cache-Control", "private, max-age=86400")
    .send(doc.data);
  store.logEvent({ userId: req.user.id, bookId: null, type: "pdf_downloaded", detail: { documentId: doc.id } }).catch(() => {});
});

// ------------------------------------------------------------------ print and ship (Lulu SANDBOX)
// 1. The parent reads the PDF and approves it (nothing can be ordered before that).
// 2. They type the delivery address and pick shipping; we ask Lulu what it costs and show our price.
// 3. They place the order: we build the print files (interior + cover spread), take the price from
//    their balance, and create the print job in Lulu's sandbox. If Lulu says no, the money goes back.

const latestBookDoc = async (user, book) => (await store.listDocuments(user.id, book.id))[0] || null;

async function printState(user, book) {
  const doc = await latestBookDoc(user, book);
  const approval = book.approval || null;
  const approvedOk =
    approval && doc && approval.documentId === doc.id && approval.details === detailsHash(book) && book.details_ok === approval.details;
  const orders = await store.listOrders(user.id, book.id);
  return {
    available: lulu.configured(),
    sandbox: lulu.isSandbox(),
    printLayout: Boolean(doc && doc.pages === READING_PAGES),
    document: doc ? { id: doc.id, url: `/api/documents/${doc.id}`, pages: doc.pages } : null,
    approved: approvedOk ? { at: approval.at } : null,
    detailsChanged: Boolean(approval && approval.details !== detailsHash(book)),
    priceCents: PRINT_PRICE_CENTS,
    shipping: Object.entries(SHIPPING).map(([id, s]) => ({ id, ...s })),
    orders: orders.map((o) => orderJson(o, user)),
  };
}

function orderJson(o, user) {
  return {
    id: o.id,
    status: o.status,
    luluStatus: o.lulu_status,
    luluJobId: o.lulu_job_id,
    shippingLevel: o.shipping_level,
    shipTo: { name: o.address.name, city: o.address.city, state_code: o.address.state_code, postcode: o.address.postcode },
    priceCents: o.price_cents,
    error: o.error,
    tracking: (o.lulu?.line_items || []).flatMap((li) => li.tracking_urls || li.tracking_id || []).filter(Boolean),
    created_at: o.created_at,
    cost: isAdmin(user) ? o.cost : undefined, // our cost and margin: admins only
  };
}

const readyBook = async (req) => {
  const book = await loadBook(req);
  if (book.status !== "ready") throw new HttpError(400, "Finish the book first.");
  return book;
};

app.get("/api/books/:id/print", requireUser, async (req, res) => {
  const book = await loadBook(req);
  const state = await printState(req.user, book);
  // Lulu status changes slowly; check open orders at most once a minute.
  for (const o of await store.listOrders(req.user.id, book.id)) {
    const done = ["SHIPPED", "REJECTED", "CANCELED"].includes(o.lulu_status);
    if (o.lulu_job_id && !done && (!o.checked_at || Date.now() - new Date(o.checked_at) > 60_000)) {
      try {
        const job = await lulu.getPrintJob(o.lulu_job_id);
        await store.updateOrder(o.id, { lulu_status: job.status?.name || o.lulu_status, lulu: job, checked_at: new Date() });
      } catch (err) {
        logger.warn("lulu status failed", { order: o.id, error: err.message });
        await store.updateOrder(o.id, { checked_at: new Date() });
      }
    }
  }
  state.orders = (await store.listOrders(req.user.id, book.id)).map((o) => orderJson(o, req.user));
  res.json(state);
});

// A book made before printing existed gets the print layout (copyright page etc.) without redrawing.
app.post("/api/books/:id/print-layout", requireUser, async (req, res) => {
  const book = await readyBook(req);
  const doc = await rebuildReadingPdf(store, book);
  await store.setApproval(book.id, null);
  await store.logEvent({ userId: req.user.id, bookId: book.id, type: "pdf_rebuilt", detail: { documentId: doc.id } });
  res.json(await printState(req.user, await loadBook(req)));
});

app.post("/api/books/:id/approve", requireUser, async (req, res) => {
  const book = await readyBook(req);
  const body = await jsonBody(req);
  const doc = await latestBookDoc(req.user, book);
  if (!doc || doc.pages !== READING_PAGES) throw new HttpError(400, "Update this book to the print layout first.");
  if (body.approve !== true) {
    await store.setApproval(book.id, null);
    return res.json(await printState(req.user, book));
  }
  if (Number(body.documentId) !== doc.id) throw new HttpError(409, "There's a newer PDF of this book. Look through that one first.");
  // The details on the covers are checked again (rules, moderation, real name) before approval.
  await requireCleanDetails(book, req.user);
  await store.setApproval(book.id, { at: new Date().toISOString(), documentId: doc.id, details: detailsHash(book) });
  await store.logEvent({ userId: req.user.id, bookId: book.id, type: "print_approved", detail: { documentId: doc.id } });
  res.json(await printState(req.user, await loadBook(req)));
});

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));

function cleanAddress(a = {}, user) {
  const t = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const out = {
    name: t(a.name, 80),
    street1: t(a.street1, 100),
    street2: t(a.street2, 100),
    city: t(a.city, 60),
    state_code: t(a.state_code, 2).toUpperCase(),
    postcode: t(a.postcode, 10),
    country_code: "US",
    phone_number: t(a.phone_number, 20),
    email: user.email,
  };
  const problems = [];
  if (out.name.length < 2) problems.push({ field: "name", message: "Enter who the book is going to." });
  if (out.street1.length < 3) problems.push({ field: "street1", message: "Enter the street address." });
  if (out.city.length < 2) problems.push({ field: "city", message: "Enter the city." });
  if (!US_STATES.has(out.state_code)) problems.push({ field: "state_code", message: "Choose the state." });
  if (!/^\d{5}(-\d{4})?$/.test(out.postcode)) problems.push({ field: "postcode", message: "Enter a 5-digit ZIP code." });
  if (out.phone_number.replace(/\D/g, "").length < 10) problems.push({ field: "phone_number", message: "Enter a phone number for the delivery company." });
  if (problems.length) throw new HttpError(400, problems.map((p) => p.message).join(" "), { extra: { problems } });
  return out;
}

async function quoteFor(address, level) {
  if (!SHIPPING[level]) throw new HttpError(400, "Choose a shipping speed.");
  const standard = await lulu.quote({ address, shippingLevel: "MAIL" });
  const chosen = level === "MAIL" ? standard : await lulu.quote({ address, shippingLevel: level });
  return { ...priceFor({ standard, chosen, level }), lulu: chosen };
}

app.post("/api/books/:id/print-quote", requireUser, async (req, res) => {
  const book = await readyBook(req);
  const body = await jsonBody(req);
  const address = cleanAddress(body.address, req.user);
  const q = await quoteFor(address, body.shippingLevel || "MAIL");
  const admin = isAdmin(req.user);
  res.json({
    priceCents: q.priceCents,
    extraShippingCents: q.extraShippingCents,
    // our cost and margin are for admins only
    cost: admin ? { luluCents: q.luluCents, stripeCents: q.stripeCents, marginCents: q.marginCents, lulu: q.lulu } : undefined,
    book: book.id,
  });
});

const printUrl = (req, docId) => {
  const token = sign({ purpose: "print", doc: docId, exp: Date.now() + 7 * 24 * 3600 * 1000 });
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  return `${base}/print-files/${token}.pdf`;
};

// Lulu downloads the print files from here: a signed link that expires in a week, no sign-in.
app.get("/print-files/:token", async (req, res) => {
  const payload = verify(String(req.params.token).replace(/\.pdf$/, ""));
  if (!payload || payload.purpose !== "print") return res.status(404).end();
  const doc = await store.getDocumentById(payload.doc);
  if (!doc || !doc.kind.startsWith("print_")) return res.status(404).end();
  res.set("Content-Type", "application/pdf").set("Cache-Control", "private, max-age=3600").send(doc.data);
});

app.post("/api/books/:id/print-order", requireUser, async (req, res) => {
  const book = await readyBook(req);
  const body = await jsonBody(req);
  const state = await printState(req.user, book);
  if (!state.approved) throw new HttpError(400, "Look through the PDF and approve it first. Nothing is printed before that.");
  if (!lulu.isSandbox()) throw new HttpError(503, "Printing runs in Lulu's sandbox only.");
  const level = body.shippingLevel || "MAIL";
  const address = cleanAddress(body.address, req.user);
  const q = await quoteFor(address, level);
  if (Number(body.expectedPriceCents) !== q.priceCents) {
    throw new HttpError(409, `The price for this address is now ${money(q.priceCents)}. Check it and place the order again.`, {
      extra: { priceCents: q.priceCents },
    });
  }
  const dims = await lulu.coverDimensions(24);
  const files = await buildPrintFiles(store, book, dims);
  let charge;
  try {
    charge = await store.charge(req.user.id, q.priceCents, {
      kind: "print_order",
      description: `Printed hardcover: "${files.title}", shipped to ${address.city}, ${address.state_code}`,
      book_id: book.id,
    });
  } catch (err) {
    if (err instanceof InsufficientFunds) {
      throw new HttpError(402, `The printed book is ${money(q.priceCents)} and your balance is ${money(err.balance)}. Add funds first.`, {
        extra: { needFunds: true, balance: err.balance },
      });
    }
    throw err;
  }
  const order = await store.createOrder({
    userId: req.user.id,
    bookId: book.id,
    shippingLevel: level,
    address,
    priceCents: q.priceCents,
    cost: { luluCents: q.luluCents, stripeCents: q.stripeCents, marginCents: q.marginCents, dims, lulu: q.lulu.raw },
    ledgerId: charge.id,
    interiorDocId: files.interiorId,
    coverDocId: files.coverId,
  });
  try {
    const job = await lulu.createPrintJob({
      externalId: `beanstalk-order-${order.id}`,
      title: files.title,
      interiorUrl: printUrl(req, files.interiorId),
      coverUrl: printUrl(req, files.coverId),
      address,
      shippingLevel: level,
      contactEmail: process.env.LULU_CONTACT_EMAIL || req.user.email,
    });
    await store.updateOrder(order.id, { status: "placed", lulu_job_id: String(job.id), lulu_status: job.status?.name || "CREATED", lulu: job, checked_at: new Date() });
    await store.logEvent({ userId: req.user.id, bookId: book.id, type: "print_ordered", detail: { order: order.id, luluJob: job.id, priceCents: q.priceCents } });
  } catch (err) {
    // Lulu said no: nothing will be printed, so the money goes straight back.
    await store.credit(req.user.id, q.priceCents, {
      kind: "auto_refund",
      description: `Print order didn't go through, refunded: "${files.title}"`,
      book_id: book.id,
      ref: `print-order-${order.id}`,
    });
    await store.updateOrder(order.id, { status: "failed", error: err.message });
    logger.error("print order failed", { order: order.id, error: err.message });
    throw new HttpError(502, `The printer didn't accept the order, so the money is back in your balance: ${err.message}`);
  }
  const me = await store.getUser(req.user.id);
  res.json({ ...(await printState(req.user, await loadBook(req))), balance: me.balance_cents });
});

// Admin: check our print files with Lulu's own validators, and see a quote with our cost.
app.post("/api/admin/print-check/:id", requireUser, requireAdmin, async (req, res) => {
  const { rows } = await store.q("SELECT * FROM books WHERE id = $1", [Number(req.params.id)]);
  const book = rows[0];
  if (!book) throw new HttpError(404, "No such book.");
  const dims = await lulu.coverDimensions(24);
  const files = await buildPrintFiles(store, book, dims);
  const interior = await lulu.validateInterior(printUrl(req, files.interiorId));
  const cover = await lulu.validateCover(printUrl(req, files.coverId), 24);
  res.json({ dims, layout: files.layout, interior, cover, interiorUrl: printUrl(req, files.interiorId), coverUrl: printUrl(req, files.coverId) });
});

app.get("/api/admin/print-check/:kind/:vid", requireUser, requireAdmin, async (req, res) => {
  const id = Number(req.params.vid);
  res.json(req.params.kind === "cover" ? await lulu.getCoverValidation(id) : await lulu.getInteriorValidation(id));
});

app.post("/api/admin/print-quote", requireUser, requireAdmin, async (req, res) => {
  const body = await jsonBody(req);
  const address = cleanAddress(
    body.address || { name: "Test Parent", street1: "1600 Pennsylvania Ave NW", city: "Washington", state_code: "DC", postcode: "20500", phone_number: "2025550123" },
    req.user
  );
  const out = {};
  for (const level of Object.keys(SHIPPING)) out[level] = await quoteFor(address, level).catch((e) => ({ error: e.message }));
  res.json({ podPackageId: lulu.POD_PACKAGE_ID(), sandbox: lulu.isSandbox(), quotes: out });
});

app.get("/api/activity", requireUser, async (req, res) => res.json(await store.recentEvents(req.user.id, 60)));

// ------------------------------------------------------------------ money (Stripe test mode)
const TOPUP_CHOICES = [500, 1000, 2000];

// If someone paid but closed the tab before coming back, catch up on the next visit.
async function syncPending(user) {
  for (const t of await store.pendingTopups(user.id)) {
    try {
      const s = await stripe.getCheckoutSession(t.checkout_session);
      if (s.payment_status === "paid") await creditSession(user, s);
      else if (s.status === "expired") await store.markTopupExpired(t.id);
    } catch (err) {
      logger.warn("topup sync failed", { topupId: t.id, error: err.message });
    }
  }
}

async function creditSession(user, s) {
  const pi = typeof s.payment_intent === "object" ? s.payment_intent : null;
  const card = pi?.latest_charge?.payment_method_details?.card?.last4 || "";
  const out = await store.markTopupPaid(user.id, s.id, {
    paymentIntent: pi?.id || s.payment_intent,
    amountCents: s.amount_total,
    card,
  });
  if (out?.entry) {
    logger.info("topup credited", { userId: user.id, cents: s.amount_total });
    await store.logEvent({ userId: user.id, type: "funds_added", detail: { cents: s.amount_total } });
  }
  return out;
}

app.get("/api/account", requireUser, async (req, res) => {
  if (stripe.stripeConfigured()) await syncPending(req.user);
  const [user, ledger, topups, refunds] = await Promise.all([
    store.getUser(req.user.id),
    store.ledger(req.user.id),
    store.listTopups(req.user.id),
    store.listRefunds(req.user.id),
  ]);
  const open = (t) => refunds.filter((r) => r.topup_id === t.id && ["requested", "processing"].includes(r.status)).reduce((s, r) => s + r.amount_cents, 0);
  const admin = isAdmin(req.user);
  const costs = admin ? await store.costSummary() : null; // business numbers: admins only
  res.json({
    costs,
    balance: user.balance_cents,
    priceCents: PRICE_CENTS,
    stripe: stripe.stripeMode(),
    topupChoices: TOPUP_CHOICES,
    ledger,
    payments: topups.map((t) => ({
      id: t.id,
      amount: t.amount_cents,
      refunded: t.refunded_cents,
      refundable: Math.min(t.amount_cents - t.refunded_cents - open(t), user.balance_cents),
      card: t.card,
      paid_at: t.paid_at,
    })),
    refunds,
  });
});

app.post("/api/account/topup", requireUser, async (req, res) => {
  const body = await jsonBody(req);
  const cents = Number(body.amount);
  if (!TOPUP_CHOICES.includes(cents)) throw new HttpError(400, "Choose an amount.");
  const origin = `${req.protocol}://${req.get("host")}`;
  const session = await stripe.createCheckoutSession({
    amountCents: cents,
    userId: req.user.id,
    email: req.user.email,
    successUrl: `${origin}/pay/return?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/#/account`,
  });
  await store.createTopup(req.user.id, session.id, cents);
  await store.logEvent({ userId: req.user.id, type: "checkout_started", detail: { cents } });
  res.json({ url: session.url });
});

// Stripe sends the browser back here. We ask Stripe directly whether it was paid (never trust the URL).
app.get("/pay/return", requireUser, async (req, res) => {
  const id = String(req.query.session_id || "");
  const t = id && (await store.getTopupBySession(req.user.id, id));
  if (!t) return res.redirect("/#/account");
  const s = await stripe.getCheckoutSession(id);
  if (s.payment_status === "paid") {
    await creditSession(req.user, s);
    return res.redirect(`/#/account?funded=${s.amount_total}`);
  }
  res.redirect("/#/account?funded=0");
});

// A refund is requested (money reserved at once), then processed with Stripe straight away.
// Refunds are a support/admin tool, not a customer button (so test-card funds can't be cashed out).
app.post("/api/account/refunds", requireUser, (req, _res, next) => {
  if (!isAdmin(req.user)) throw new HttpError(403, "Refunds are handled by support. Contact us if you need one.");
  return next();
}, async (req, res) => {
  const body = await jsonBody(req);
  const cents = Math.round(Number(body.amount) * 1) || 0;
  if (cents <= 0) throw new HttpError(400, "Enter an amount to refund.");
  const user = await store.getUser(req.user.id);
  if (cents > user.balance_cents) throw new HttpError(400, `You can refund at most your unspent balance (${money(user.balance_cents)}).`);
  const { refund, topup } = await store.requestRefund(req.user.id, Number(body.paymentId), cents, String(body.reason || "").slice(0, 200));
  await store.logEvent({ userId: req.user.id, type: "refund_requested", detail: { refundId: refund.id, cents } });
  logger.info("refund requested", { userId: req.user.id, refundId: refund.id, cents });

  await store.setRefund(refund.id, { status: "processing" });
  try {
    const r = await stripe.createRefund({ paymentIntent: topup.payment_intent, amountCents: cents, refundId: refund.id, userId: req.user.id });
    if (r.status === "failed" || r.status === "canceled") throw new Error(`Stripe marked the refund ${r.status}`);
    await store.refundSucceeded(refund, r.id);
    await store.logEvent({ userId: req.user.id, type: "refund_processed", detail: { refundId: refund.id, stripe: r.id, status: r.status } });
    logger.info("refund processed", { userId: req.user.id, refundId: refund.id, stripeStatus: r.status });
    res.json({ ok: true, status: "succeeded", stripeRefund: r.id, stripeStatus: r.status });
  } catch (err) {
    await store.refundFailed(refund, err.message);
    logger.error("refund failed", { refundId: refund.id, error: err.message });
    throw new HttpError(502, `Stripe couldn't process the refund: ${err.message}. The money is back in your balance.`);
  }
});

// ------------------------------------------------------------------ admin (bible + scenes)
function requireAdmin(req, _res, next) {
  if (!isAdmin(req.user)) throw new HttpError(403, "Admins only.");
  return next();
}

app.get("/api/admin/state", requireUser, requireAdmin, async (_req, res) => {
  const [chars, scenes] = await Promise.all([store.listCharacters(null), store.listScenes(null)]);
  res.json({
    running: pipeline.admin.running,
    log: pipeline.admin.log.slice(-80),
    stories: STORY_IDS.map((id) => ({
      id,
      title: STORIES[id].title,
      characters: chars
        .filter((c) => c.story === id)
        .map((c) => ({
          key: c.key,
          name: c.name,
          description: c.description,
          hero: c.is_hero,
          image: c.has_image ? `/api/admin/characters/${id}/${c.key}?v=${c.v}` : null,
          bytes: c.bytes,
          hash: c.hash,
          meta: c.meta,
        })),
      scenes: TEMPLATE.map((slot, i) => {
        const s = scenes.find((x) => x.story === id && x.page_no === slot.n);
        return {
          n: slot.n,
          layout: slot.layout,
          text: STORIES[id].pages[i].text,
          image: s ? `/api/admin/scenes/${id}/${slot.n}?v=${s.v}` : null,
          meta: s?.meta || null,
        };
      }),
    })),
  });
});

app.post("/api/admin/pregen", requireUser, requireAdmin, async (req, res) => {
  const body = await jsonBody(req);
  await pipeline.pregen({ story: body.story || null, what: body.what || "all", only: body.only || null, force: Boolean(body.force) });
  res.json({ ok: true });
});

app.get("/api/admin/characters/:story/:key", requireUser, requireAdmin, async (req, res) => {
  const c = await store.getCharacterImage(req.params.story, req.params.key, req.query.full !== "1");
  if (!c) return res.status(404).end();
  res.set("Content-Type", "image/jpeg").set("Cache-Control", "private, max-age=86400").send(c.data);
});

app.get("/api/admin/scenes/:story/:n", requireUser, requireAdmin, async (req, res) => {
  const s = await store.getScene(req.params.story, Number(req.params.n), req.query.full !== "1");
  if (!s) return res.status(404).end();
  res.set("Content-Type", "image/jpeg").set("Cache-Control", "private, max-age=86400").send(s.data);
});

// Admin test book: same pipeline, made from the survey photo, not charged (it costs only OpenAI money).
app.post("/api/admin/test-book", requireUser, requireAdmin, async (req, res) => {
  const body = await jsonBody(req);
  const story = STORIES[body.story] ? body.story : "jack";
  const fs = await import("node:fs/promises");
  const photo = await fs.readFile("public/survey/photo.jpg");
  const book = await store.createBook(req.user.id, {
    story,
    child_name: body.name || "Mattan",
    child_age: "8",
    child_favorites: "soccer, pancakes",
    child_about: "Admin test book.",
    pronouns: "he",
  });
  const hero = pipeline.startHero(book, { buffer: photo, mime: "image/jpeg" }, req.user.id);
  await hero.promise;
  pipeline.startBook({ book, user: req.user, charge: null });
  res.json({ id: book.id });
});

// Admin: what the checker and the layout decided for every page of any book.
app.get("/api/admin/books/:id", requireUser, requireAdmin, async (req, res) => {
  const imgs = await store.listImages(Number(req.params.id));
  const { rows } = await store.q("SELECT id, user_id, story, child_name, status, stats FROM books WHERE id = $1", [Number(req.params.id)]);
  res.json({ book: rows[0], job: pipeline.bookJob(Number(req.params.id)), images: imgs.map((i) => ({ kind: i.kind, page: i.page_id, meta: i.meta })) });
});
// Admin experiment: one page edited with different input settings, to compare cost and picture.
const experiments = [];
app.post("/api/admin/experiment", requireUser, requireAdmin, async (req, res) => {
  const body = await jsonBody(req);
  const { editImage } = await import("./lib/openai.js");
  const { heroSwapPrompt } = await import("./book/prompts.js");
  const { resize, decode, encode } = await import("./lib/images.js");
  const story = STORIES[body.story || "jack"];
  const n = Number(body.page || 2);
  const scene = await store.getScene(story.id, n);
  const hero = await store.getImageData(Number(body.book), "hero", "");
  const chars = await pipeline.bible(story.id);
  const small = (buf, w) => (w ? encode(resize(decode(buf), w), 88) : buf);
  const runId = experiments.length;
  experiments.push({ started: Date.now(), variants: [] });
  res.json({ runId });
  await Promise.all(
    (body.variants || []).map(async (v, i) => {
      const t0 = Date.now();
      try {
        const out = await editImage({
          images: [
            { buffer: small(scene.data, v.sceneWidth), mime: "image/jpeg" },
            { buffer: small(hero.data, v.portraitWidth), mime: "image/jpeg" },
          ],
          prompt: heroSwapPrompt(story, story.pages[n - 1], chars[story.heroKey].description),
          size: "1536x1024",
          quality: v.quality || "low",
          fidelity: v.fidelity,
          meter: { purpose: "experiment" },
        });
        experiments[runId].variants[i] = { ...v, ms: Date.now() - t0, image: out.buffer, usd: null };
      } catch (err) {
        experiments[runId].variants[i] = { ...v, error: err.message };
      }
    })
  );
});
app.get("/api/admin/experiment/:run", requireUser, requireAdmin, async (req, res) => {
  const e = experiments[Number(req.params.run)];
  if (!e) return res.status(404).end();
  const { rows } = await store.q(
    "SELECT usage, usd::float AS usd FROM api_calls WHERE purpose = 'experiment' AND created_at >= to_timestamp($1 / 1000.0) ORDER BY id",
    [e.started]
  );
  res.json({ variants: e.variants.map((v, i) => v && { ...v, image: v.image ? `/api/admin/experiment/${req.params.run}/${i}` : null }), calls: rows });
});
app.get("/api/admin/experiment/:run/:i", requireUser, requireAdmin, (req, res) => {
  const v = experiments[Number(req.params.run)]?.variants[Number(req.params.i)];
  if (!v?.image) return res.status(404).end();
  res.set("Content-Type", "image/jpeg").send(v.image);
});

// Admin: the most recent OpenAI calls with their token usage and cost.
app.get("/api/admin/calls", requireUser, requireAdmin, async (req, res) => {
  const { rows } = await store.q(
    `SELECT book_id, purpose, kind, model, page, attempt, usage, usd::float AS usd, estimated, ms, created_at
       FROM api_calls WHERE ($1::int IS NULL OR book_id = $1) ORDER BY id DESC LIMIT 200`,
    [req.query.book ? Number(req.query.book) : null]
  );
  res.json(rows);
});

app.get("/api/admin/books", requireUser, requireAdmin, async (_req, res) => {
  const { rows } = await store.q("SELECT id, user_id, story, child_name, status, stats, updated_at FROM books ORDER BY id DESC LIMIT 30");
  res.json(rows);
});

// The template as JSON (the admin page draws it; handy for review too).
app.get("/api/template", (_req, res) => res.json({ layouts: LAYOUTS, slots: TEMPLATE }));

// ------------------------------------------------------------------ start
// Books interrupted by a restart: mark failed and refund their $0.99.
for (const b of await store.takeInterruptedBooks()) {
  const { rows } = await store.q("SELECT id FROM ledger WHERE book_id = $1 AND kind = 'document' ORDER BY id DESC LIMIT 1", [b.id]);
  if (rows[0]) {
    await store.credit(b.user_id, PRICE_CENTS, {
      kind: "auto_refund",
      description: "Refund: the server restarted while your book was being made",
      book_id: b.id,
      ref: `autorefund:${rows[0].id}`,
    });
  }
}

// Render's free plan sleeps after 15 idle minutes, and waking up takes 30-60 s, which would break
// "page load near-instant". A request to our own public address every 10 minutes counts as
// traffic and keeps the site awake (one always-on service fits in the free 750 hours/month).
const SELF_URL = process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL;
if (SELF_URL && process.env.KEEP_AWAKE !== "0") {
  setInterval(() => {
    fetch(`${SELF_URL.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(15000) }).catch(() => {});
  }, 10 * 60 * 1000).unref();
}

app.listen(PORT, () => {
  logger.info("server started", { port: PORT, login: loginConfigured, key: hasKey(), stripe: stripe.stripeMode(), mock: process.env.MOCK_IMAGES === "1" });
});
