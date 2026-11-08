// Everything that is saved: users, books, images, the character bible, pre-generated scenes,
// PDFs, the money ledger (Stripe top-ups, $0.99 charges, refunds) and the activity log.
// Postgres only (Render Postgres in production, a local Postgres in tests).
import { logger } from "./log.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  google_sub  TEXT UNIQUE NOT NULL,
  email       TEXT,
  name        TEXT,
  picture     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_cents INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS books (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_name      TEXT NOT NULL DEFAULT '',
  child_age       TEXT NOT NULL DEFAULT '',
  child_favorites TEXT NOT NULL DEFAULT '',
  child_about     TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS books_user_idx ON books(user_id);
-- story IS NULL = a book from the earlier 3-page version (homework 3)
ALTER TABLE books ADD COLUMN IF NOT EXISTS story TEXT;
ALTER TABLE books ADD COLUMN IF NOT EXISTS pronouns TEXT NOT NULL DEFAULT 'he';
ALTER TABLE books ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE books ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN IF NOT EXISTS stats JSONB NOT NULL DEFAULT '{}';

-- kind 'hero' = the child's cartoon portrait (page_id ''), 'page' = page_id 'p01'..'p20'
CREATE TABLE IF NOT EXISTS images (
  id          SERIAL PRIMARY KEY,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  page_id     TEXT NOT NULL DEFAULT '',
  mime        TEXT NOT NULL,
  data        BYTEA NOT NULL,
  prompt      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, kind, page_id)
);
ALTER TABLE images ADD COLUMN IF NOT EXISTS thumb BYTEA;
ALTER TABLE images ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';

-- The character bible: one row per character per story, with its reference image.
CREATE TABLE IF NOT EXISTS characters (
  story       TEXT NOT NULL,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  is_hero     BOOLEAN NOT NULL DEFAULT false,
  mime        TEXT,
  data        BYTEA,
  thumb       BYTEA,
  prompt      TEXT NOT NULL DEFAULT '',
  meta        JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story, key)
);

-- Pre-generated scenes: every page of both stories, drawn once with a stand-in hero.
CREATE TABLE IF NOT EXISTS scenes (
  story       TEXT NOT NULL,
  page_no     INTEGER NOT NULL,
  mime        TEXT NOT NULL,
  data        BYTEA NOT NULL,
  thumb       BYTEA,
  prompt      TEXT NOT NULL DEFAULT '',
  meta        JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story, page_no)
);

-- Generated documents (the PDF), kept so they can be downloaded again later.
CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     INTEGER REFERENCES books(id) ON DELETE SET NULL,
  title       TEXT NOT NULL DEFAULT '',
  mime        TEXT NOT NULL DEFAULT 'application/pdf',
  data        BYTEA NOT NULL,
  pages       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_book_idx ON documents(book_id);

-- Money. Every credit (+) and debit (-) is one row, with what caused it.
CREATE TABLE IF NOT EXISTS ledger (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind          TEXT NOT NULL,          -- topup | document | refund | auto_refund
  description   TEXT NOT NULL,
  book_id       INTEGER,
  document_id   INTEGER,
  topup_id      INTEGER,
  refund_id     INTEGER,
  ref           TEXT UNIQUE,            -- idempotency: the same Stripe payment is never credited twice
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger(user_id, id);

CREATE TABLE IF NOT EXISTS topups (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkout_session TEXT UNIQUE NOT NULL,
  payment_intent   TEXT,
  amount_cents     INTEGER NOT NULL,
  refunded_cents   INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | expired
  card             TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS refunds (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topup_id         INTEGER NOT NULL REFERENCES topups(id),
  amount_cents     INTEGER NOT NULL,
  reason           TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'requested', -- requested | processing | succeeded | failed
  stripe_refund_id TEXT,
  error            TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ
);

-- Every OpenAI call and what it cost (image calls, retries, checks), for cost per book.
CREATE TABLE IF NOT EXISTS api_calls (
  id          SERIAL PRIMARY KEY,
  book_id     INTEGER,
  user_id     INTEGER,
  purpose     TEXT NOT NULL,   -- hero | hero_check | page | page_check | scene | scene_check | caption_check | bible | bible_check
  kind        TEXT NOT NULL,   -- image | vision
  model       TEXT NOT NULL,
  page        INTEGER,
  attempt     INTEGER,
  usage       JSONB,
  usd         NUMERIC(10, 6) NOT NULL DEFAULT 0,
  estimated   BOOLEAN NOT NULL DEFAULT false,
  ms          INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_calls_book_idx ON api_calls(book_id);

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER,
  book_id     INTEGER,
  type        TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_created_idx ON events(created_at);
`;

const BOOK_FIELDS = { child_name: 40, child_age: 10, child_favorites: 120, child_about: 400, story: 10, pronouns: 5 };

function cleanDetails(details = {}) {
  const out = {};
  for (const [f, max] of Object.entries(BOOK_FIELDS)) {
    if (details[f] !== undefined && details[f] !== null) out[f] = String(details[f]).trim().slice(0, max);
  }
  return out;
}

export class InsufficientFunds extends Error {
  constructor(balance, needed) {
    super("Not enough money in your account.");
    this.status = 402;
    this.balance = balance;
    this.needed = needed;
  }
}

class Store {
  constructor(url) {
    this.url = url;
    this.kind = "postgres";
  }

  async init() {
    const { default: pg } = await import("pg");
    // Render's *internal* URL needs no SSL; its *external* URL (…render.com) does.
    const ssl = process.env.DATABASE_SSL === "1" || /\.render\.com/.test(this.url) ? { rejectUnauthorized: false } : false;
    this.pool = new pg.Pool({ connectionString: this.url, ssl, max: Number(process.env.DATABASE_POOL || 10) });
    this.pool.on("error", (err) => logger.error("postgres pool error", { error: err.message }));
    await this.pool.query(SCHEMA);
    // A server restart kills running jobs: mark them failed (their $0.99 is refunded by the server on boot).
    logger.info("database ready", { store: "postgres" });
  }

  q(text, params) {
    return this.pool.query(text, params);
  }

  async tx(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async health() {
    await this.q("SELECT 1");
    return true;
  }

  // ---------------------------------------------------------------- users
  async upsertUser({ sub, email, name, picture }) {
    const { rows } = await this.q(
      `INSERT INTO users (google_sub, email, name, picture) VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_sub) DO UPDATE
         SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture, last_login = now()
       RETURNING id, email, name, picture, balance_cents`,
      [sub, email, name, picture]
    );
    return rows[0];
  }

  async getUser(id) {
    const { rows } = await this.q("SELECT id, email, name, picture, balance_cents FROM users WHERE id = $1", [id]);
    return rows[0] || null;
  }

  // ---------------------------------------------------------------- books
  async listBooks(userId) {
    const { rows } = await this.q(
      `SELECT b.id, b.child_name, b.story, b.status, b.created_at, b.updated_at,
              (SELECT count(*)::int FROM images i WHERE i.book_id = b.id AND i.kind = 'page') AS page_count,
              (SELECT i.id FROM images i WHERE i.book_id = b.id AND i.kind = 'page' AND i.page_id = 'p01') AS cover_id,
              (SELECT i.id FROM images i WHERE i.book_id = b.id AND i.kind IN ('hero', 'reference') ORDER BY i.kind LIMIT 1) AS hero_id,
              (SELECT d.id FROM documents d WHERE d.book_id = b.id ORDER BY d.id DESC LIMIT 1) AS document_id
         FROM books b WHERE b.user_id = $1 ORDER BY b.updated_at DESC`,
      [userId]
    );
    return rows;
  }

  async createBook(userId, details) {
    const d = cleanDetails(details);
    const { rows } = await this.q(
      `INSERT INTO books (user_id, child_name, child_age, child_favorites, child_about, story, pronouns)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, d.child_name ?? "", d.child_age ?? "", d.child_favorites ?? "", d.child_about ?? "", d.story || "jack", d.pronouns || "he"]
    );
    return rows[0];
  }

  async getBook(userId, bookId) {
    const { rows } = await this.q("SELECT * FROM books WHERE id = $1 AND user_id = $2", [bookId, userId]);
    return rows[0] || null;
  }

  async updateBook(userId, bookId, details) {
    const d = cleanDetails(details);
    const keys = Object.keys(d);
    if (!keys.length) return this.getBook(userId, bookId);
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
    const { rows } = await this.q(
      `UPDATE books SET ${sets}, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [bookId, userId, ...keys.map((k) => d[k])]
    );
    return rows[0] || null;
  }

  async setBookStatus(bookId, status, { error = "", stats } = {}) {
    await this.q(
      `UPDATE books SET status = $2, error = $3, stats = COALESCE($4::jsonb, stats), updated_at = now() WHERE id = $1`,
      [bookId, status, error, stats ? JSON.stringify(stats) : null]
    );
  }

  // Books left "generating" by a restart. Returns them so their charge can be refunded.
  async takeInterruptedBooks() {
    const { rows } = await this.q(
      `UPDATE books SET status = 'failed', error = 'The server restarted while this book was being made.'
        WHERE status = 'generating' RETURNING id, user_id`
    );
    return rows;
  }

  async deleteBook(userId, bookId) {
    const { rowCount } = await this.q("DELETE FROM books WHERE id = $1 AND user_id = $2", [bookId, userId]);
    return rowCount > 0;
  }

  // ---------------------------------------------------------------- images
  async saveImage(bookId, kind, pageId, data, mime, prompt, { thumb = null, meta = {} } = {}) {
    const { rows } = await this.q(
      `INSERT INTO images (book_id, kind, page_id, mime, data, prompt, thumb, meta) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (book_id, kind, page_id) DO UPDATE
         SET mime = EXCLUDED.mime, data = EXCLUDED.data, prompt = EXCLUDED.prompt, thumb = EXCLUDED.thumb,
             meta = EXCLUDED.meta, created_at = now()
       RETURNING id, (extract(epoch FROM created_at) * 1000)::bigint AS v`,
      [bookId, kind, pageId || "", mime, data, prompt || "", thumb, JSON.stringify(meta)]
    );
    return rows[0];
  }

  async listImages(bookId) {
    const { rows } = await this.q(
      `SELECT id, kind, page_id, meta, (extract(epoch FROM created_at) * 1000)::bigint AS v
         FROM images WHERE book_id = $1`,
      [bookId]
    );
    return rows;
  }

  async getImageData(bookId, kind, pageId) {
    const { rows } = await this.q(
      "SELECT id, data, mime, meta FROM images WHERE book_id = $1 AND kind = $2 AND page_id = $3",
      [bookId, kind, pageId || ""]
    );
    return rows[0] || null;
  }

  async getImageForUser(userId, imageId, thumb = false) {
    const { rows } = await this.q(
      `SELECT ${thumb ? "COALESCE(i.thumb, i.data)" : "i.data"} AS data, CASE WHEN $3 AND i.thumb IS NOT NULL THEN 'image/jpeg' ELSE i.mime END AS mime
         FROM images i JOIN books b ON b.id = i.book_id WHERE i.id = $1 AND b.user_id = $2`,
      [imageId, userId, thumb]
    );
    return rows[0] || null;
  }

  // ---------------------------------------------------------------- bible + scenes
  async upsertCharacterText(story, key, { name, description, is_hero }) {
    await this.q(
      `INSERT INTO characters (story, key, name, description, is_hero) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (story, key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_hero = EXCLUDED.is_hero`,
      [story, key, name, description, Boolean(is_hero)]
    );
  }

  async saveCharacterImage(story, key, { data, mime, thumb, prompt, meta = {} }) {
    await this.q(
      `UPDATE characters SET data = $3, mime = $4, thumb = $5, prompt = $6, meta = $7, updated_at = now() WHERE story = $1 AND key = $2`,
      [story, key, data, mime, thumb, prompt, JSON.stringify(meta)]
    );
  }

  async listCharacters(story) {
    const { rows } = await this.q(
      `SELECT story, key, name, description, is_hero, mime, (data IS NOT NULL) AS has_image, meta,
              octet_length(data) AS bytes, left(md5(data), 10) AS hash,
              (extract(epoch FROM updated_at) * 1000)::bigint AS v
         FROM characters WHERE ($1::text IS NULL OR story = $1) ORDER BY story, is_hero DESC, key`,
      [story || null]
    );
    return rows;
  }

  async getCharacterImage(story, key, thumb = false) {
    const { rows } = await this.q(
      `SELECT ${thumb ? "COALESCE(thumb, data)" : "data"} AS data, mime FROM characters WHERE story = $1 AND key = $2 AND data IS NOT NULL`,
      [story, key]
    );
    return rows[0] || null;
  }

  async saveScene(story, pageNo, { data, mime, thumb, prompt, meta = {} }) {
    await this.q(
      `INSERT INTO scenes (story, page_no, mime, data, thumb, prompt, meta) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (story, page_no) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, thumb = EXCLUDED.thumb,
         prompt = EXCLUDED.prompt, meta = EXCLUDED.meta, updated_at = now()`,
      [story, pageNo, mime, data, thumb, prompt, JSON.stringify(meta)]
    );
  }

  async setSceneMeta(story, pageNo, meta) {
    await this.q("UPDATE scenes SET meta = $3 WHERE story = $1 AND page_no = $2", [story, pageNo, JSON.stringify(meta)]);
  }

  async listScenes(story) {
    const { rows } = await this.q(
      `SELECT story, page_no, meta, (extract(epoch FROM updated_at) * 1000)::bigint AS v
         FROM scenes WHERE ($1::text IS NULL OR story = $1) ORDER BY story, page_no`,
      [story || null]
    );
    return rows;
  }

  async getScene(story, pageNo, thumb = false) {
    const { rows } = await this.q(
      `SELECT ${thumb ? "COALESCE(thumb, data)" : "data"} AS data, mime, meta FROM scenes WHERE story = $1 AND page_no = $2`,
      [story, pageNo]
    );
    return rows[0] || null;
  }

  // ---------------------------------------------------------------- documents
  async saveDocument({ userId, bookId, title, data, pages }) {
    const { rows } = await this.q(
      `INSERT INTO documents (user_id, book_id, title, data, pages) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [userId, bookId, title, data, pages]
    );
    return rows[0];
  }

  async getDocument(userId, id) {
    const { rows } = await this.q("SELECT id, title, mime, data, created_at FROM documents WHERE id = $1 AND user_id = $2", [id, userId]);
    return rows[0] || null;
  }

  async listDocuments(userId, bookId) {
    const { rows } = await this.q(
      `SELECT id, title, pages, octet_length(data) AS bytes, created_at FROM documents
        WHERE user_id = $1 AND ($2::int IS NULL OR book_id = $2) ORDER BY id DESC`,
      [userId, bookId ?? null]
    );
    return rows;
  }

  // ---------------------------------------------------------------- money
  // Every change to a balance goes through here: one ledger row + the new balance, in one transaction.
  async _post(client, userId, cents, fields) {
    const { rows } = await client.query("SELECT balance_cents FROM users WHERE id = $1 FOR UPDATE", [userId]);
    if (!rows[0]) throw new Error("No such user.");
    const before = rows[0].balance_cents;
    const after = before + cents;
    if (cents < 0 && after < 0) throw new InsufficientFunds(before, -cents);
    await client.query("UPDATE users SET balance_cents = $2 WHERE id = $1", [userId, after]);
    const { rows: led } = await client.query(
      `INSERT INTO ledger (user_id, amount_cents, balance_after, kind, description, book_id, document_id, topup_id, refund_id, ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [userId, cents, after, fields.kind, fields.description, fields.book_id ?? null, fields.document_id ?? null, fields.topup_id ?? null, fields.refund_id ?? null, fields.ref ?? null]
    );
    return led[0];
  }

  // Charge for a document. Throws InsufficientFunds if the balance is too low.
  async charge(userId, cents, fields) {
    return this.tx((c) => this._post(c, userId, -cents, fields));
  }

  // Put a charge back (generation failed). Idempotent through `ref`.
  async credit(userId, cents, fields) {
    return this.tx(async (c) => {
      if (fields.ref) {
        const { rows } = await c.query("SELECT * FROM ledger WHERE ref = $1", [fields.ref]);
        if (rows[0]) return rows[0];
      }
      return this._post(c, userId, cents, fields);
    });
  }

  async ledger(userId, limit = 200) {
    const { rows } = await this.q("SELECT * FROM ledger WHERE user_id = $1 ORDER BY id DESC LIMIT $2", [userId, limit]);
    return rows;
  }

  async createTopup(userId, sessionId, cents) {
    const { rows } = await this.q(
      "INSERT INTO topups (user_id, checkout_session, amount_cents) VALUES ($1, $2, $3) RETURNING *",
      [userId, sessionId, cents]
    );
    return rows[0];
  }

  async getTopupBySession(userId, sessionId) {
    const { rows } = await this.q("SELECT * FROM topups WHERE user_id = $1 AND checkout_session = $2", [userId, sessionId]);
    return rows[0] || null;
  }

  async pendingTopups(userId) {
    const { rows } = await this.q(
      "SELECT * FROM topups WHERE user_id = $1 AND status = 'pending' AND created_at > now() - interval '1 day'",
      [userId]
    );
    return rows;
  }

  async listTopups(userId) {
    const { rows } = await this.q("SELECT * FROM topups WHERE user_id = $1 AND status = 'paid' ORDER BY id DESC", [userId]);
    return rows;
  }

  // Stripe says the Checkout Session is paid: mark the top-up paid and credit it, exactly once.
  async markTopupPaid(userId, sessionId, { paymentIntent, amountCents, card }) {
    return this.tx(async (c) => {
      const { rows } = await c.query("SELECT * FROM topups WHERE user_id = $1 AND checkout_session = $2 FOR UPDATE", [userId, sessionId]);
      const t = rows[0];
      if (!t) return null;
      if (t.status === "paid") return { topup: t, entry: null };
      await c.query(
        "UPDATE topups SET status = 'paid', payment_intent = $2, amount_cents = $3, card = $4, paid_at = now() WHERE id = $1",
        [t.id, paymentIntent, amountCents, card || ""]
      );
      const entry = await this._post(c, userId, amountCents, {
        kind: "topup",
        description: `Added funds with a card${card ? ` ending ${card}` : ""} (Stripe test mode)`,
        topup_id: t.id,
        ref: `topup:${sessionId}`,
      });
      return { topup: { ...t, status: "paid", payment_intent: paymentIntent, amount_cents: amountCents }, entry };
    });
  }

  async markTopupExpired(id) {
    await this.q("UPDATE topups SET status = 'expired' WHERE id = $1 AND status = 'pending'", [id]);
  }

  // Step 1 of a refund: the request. Money is reserved (debited) right away so it can't be spent twice.
  async requestRefund(userId, topupId, cents, reason) {
    return this.tx(async (c) => {
      const { rows } = await c.query("SELECT * FROM topups WHERE id = $1 AND user_id = $2 AND status = 'paid' FOR UPDATE", [topupId, userId]);
      const t = rows[0];
      if (!t) throw Object.assign(new Error("That payment can't be refunded."), { status: 400 });
      const { rows: open } = await c.query(
        "SELECT COALESCE(sum(amount_cents), 0)::int AS s FROM refunds WHERE topup_id = $1 AND status IN ('requested', 'processing')",
        [t.id]
      );
      const refundable = t.amount_cents - t.refunded_cents - open[0].s;
      if (cents > refundable) throw Object.assign(new Error(`At most $${(refundable / 100).toFixed(2)} of that payment can be refunded.`), { status: 400 });
      const { rows: r } = await c.query(
        "INSERT INTO refunds (user_id, topup_id, amount_cents, reason) VALUES ($1, $2, $3, $4) RETURNING *",
        [userId, t.id, cents, reason || ""]
      );
      const entry = await this._post(c, userId, -cents, {
        kind: "refund",
        description: `Refund requested to the card${t.card ? ` ending ${t.card}` : ""}`,
        topup_id: t.id,
        refund_id: r[0].id,
        ref: `refund:${r[0].id}`,
      });
      return { refund: r[0], topup: t, entry };
    });
  }

  async setRefund(id, fields) {
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const { rows } = await this.q(`UPDATE refunds SET ${sets} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => fields[k])]);
    return rows[0];
  }

  // Step 2 finished: Stripe refunded it.
  async refundSucceeded(refund, stripeRefundId) {
    return this.tx(async (c) => {
      await c.query("UPDATE refunds SET status = 'succeeded', stripe_refund_id = $2, processed_at = now() WHERE id = $1", [refund.id, stripeRefundId]);
      await c.query("UPDATE topups SET refunded_cents = refunded_cents + $2 WHERE id = $1", [refund.topup_id, refund.amount_cents]);
      await c.query("UPDATE ledger SET description = $2 WHERE ref = $1", [
        `refund:${refund.id}`,
        `Refunded to your card by Stripe (refund ${stripeRefundId})`,
      ]);
    });
  }

  // Step 2 failed: give the reserved money back.
  async refundFailed(refund, message) {
    return this.tx(async (c) => {
      await c.query("UPDATE refunds SET status = 'failed', error = $2, processed_at = now() WHERE id = $1", [refund.id, message]);
      await c.query("UPDATE ledger SET description = 'Refund requested, but Stripe declined it' WHERE ref = $1", [`refund:${refund.id}`]);
      await this._post(c, refund.user_id, refund.amount_cents, {
        kind: "auto_refund",
        description: `Refund failed at Stripe, money returned to your balance: ${message}`.slice(0, 300),
        refund_id: refund.id,
        topup_id: refund.topup_id,
        ref: `refund-failed:${refund.id}`,
      });
    });
  }

  async listRefunds(userId) {
    const { rows } = await this.q("SELECT * FROM refunds WHERE user_id = $1 ORDER BY id DESC", [userId]);
    return rows;
  }

  // ---------------------------------------------------------------- API spend
  async recordCall(c) {
    await this.q(
      `INSERT INTO api_calls (book_id, user_id, purpose, kind, model, page, attempt, usage, usd, estimated, ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [c.bookId ?? null, c.userId ?? null, c.purpose || "other", c.kind, c.model, c.page ?? null, c.attempt ?? null,
       c.usage ? JSON.stringify(c.usage) : null, c.usd || 0, Boolean(c.estimated), c.ms ?? null]
    );
  }

  // What one book cost to make, broken down.
  async bookCost(bookId) {
    const { rows } = await this.q(
      `SELECT purpose, kind, count(*)::int AS calls, COALESCE(sum(usd), 0)::float AS usd,
              count(*) FILTER (WHERE attempt > 1)::int AS retries
         FROM api_calls WHERE book_id = $1 GROUP BY purpose, kind`,
      [bookId]
    );
    const sum = (f) => rows.filter(f).reduce((a, r) => a + r.usd, 0);
    const count = (f) => rows.filter(f).reduce((a, r) => a + r.calls, 0);
    return {
      usd: Math.round(sum(() => true) * 10000) / 10000,
      imageUsd: Math.round(sum((r) => r.kind === "image") * 10000) / 10000,
      checkUsd: Math.round(sum((r) => r.kind === "vision") * 10000) / 10000,
      imageCalls: count((r) => r.kind === "image"),
      checkCalls: count((r) => r.kind === "vision"),
      retryImageCalls: rows.filter((r) => r.kind === "image").reduce((a, r) => a + r.retries, 0),
    };
  }

  // Average cost per finished book (only books made since cost tracking started), and the one-off cost
  // of the shared bible and scenes.
  async costSummary() {
    const { rows } = await this.q(
      `SELECT count(*)::int AS books, COALESCE(avg(t.usd), 0)::float AS avg, COALESCE(min(t.usd), 0)::float AS min,
              COALESCE(max(t.usd), 0)::float AS max
         FROM (SELECT a.book_id, sum(a.usd) AS usd FROM api_calls a JOIN books b ON b.id = a.book_id
                WHERE b.status = 'ready' GROUP BY a.book_id) t`
    );
    const { rows: pre } = await this.q(`SELECT COALESCE(sum(usd), 0)::float AS usd FROM api_calls WHERE book_id IS NULL`);
    return { ...rows[0], setupUsd: pre[0].usd };
  }

  // ---------------------------------------------------------------- events
  async logEvent({ userId = null, bookId = null, type, detail = {} }) {
    await this.q("INSERT INTO events (user_id, book_id, type, detail) VALUES ($1, $2, $3, $4)", [
      userId,
      bookId,
      type,
      JSON.stringify(detail),
    ]);
  }

  async recentEvents(userId, limit = 50) {
    const { rows } = await this.q(
      "SELECT id, book_id, type, detail, created_at FROM events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
      [userId, limit]
    );
    return rows;
  }
}

export async function createStore() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. This app stores everything in Postgres.");
  const store = new Store(url);
  await store.init();
  return store;
}
