// Storage for users, books, generated images, and the event log.
//
// - With DATABASE_URL set (Render Postgres): everything is saved in Postgres
//   and survives restarts, redeploys, and the free tier's spin-down.
// - Without it (local testing): an in-memory store with the same interface.
//   Data is lost when the server stops.
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

-- kind = 'reference' (the one Jack image, page_id '') or 'page' (page_id = story page id)
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

const BOOK_FIELDS = ["child_name", "child_age", "child_favorites", "child_about"];

function cleanDetails(details = {}) {
  const limits = { child_name: 40, child_age: 10, child_favorites: 120, child_about: 400 };
  const out = {};
  for (const f of BOOK_FIELDS) {
    if (details[f] !== undefined) out[f] = String(details[f]).slice(0, limits[f]);
  }
  return out;
}

// ------------------------------------------------------------------ Postgres
class PgStore {
  constructor(url) {
    this.url = url;
    this.kind = "postgres";
  }

  async init() {
    const { default: pg } = await import("pg");
    // Render's *internal* URL needs no SSL; its *external* URL (…render.com) does.
    const ssl = process.env.DATABASE_SSL === "1" || /\.render\.com/.test(this.url) ? { rejectUnauthorized: false } : false;
    this.pool = new pg.Pool({ connectionString: this.url, ssl, max: 5 });
    this.pool.on("error", (err) => logger.error("postgres pool error", { error: err.message }));
    await this.pool.query(SCHEMA);
    logger.info("database ready", { store: "postgres" });
  }

  q(text, params) {
    return this.pool.query(text, params);
  }

  async health() {
    await this.q("SELECT 1");
    return true;
  }

  async upsertUser({ sub, email, name, picture }) {
    const { rows } = await this.q(
      `INSERT INTO users (google_sub, email, name, picture) VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_sub) DO UPDATE
         SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture, last_login = now()
       RETURNING id, email, name, picture`,
      [sub, email, name, picture]
    );
    return rows[0];
  }

  async getUser(id) {
    const { rows } = await this.q("SELECT id, email, name, picture FROM users WHERE id = $1", [id]);
    return rows[0] || null;
  }

  async listBooks(userId) {
    const { rows } = await this.q(
      `SELECT b.id, b.child_name, b.created_at, b.updated_at,
              (SELECT count(*)::int FROM images i WHERE i.book_id = b.id AND i.kind = 'page') AS page_count,
              (SELECT i.id FROM images i WHERE i.book_id = b.id AND i.kind = 'reference') AS reference_image_id,
              (SELECT extract(epoch FROM i.created_at)::bigint FROM images i WHERE i.book_id = b.id AND i.kind = 'reference') AS reference_v
         FROM books b WHERE b.user_id = $1 ORDER BY b.updated_at DESC`,
      [userId]
    );
    return rows;
  }

  async createBook(userId, details) {
    const d = cleanDetails(details);
    const { rows } = await this.q(
      `INSERT INTO books (user_id, child_name, child_age, child_favorites, child_about)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, d.child_name ?? "", d.child_age ?? "", d.child_favorites ?? "", d.child_about ?? ""]
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

  async deleteBook(userId, bookId) {
    const { rowCount } = await this.q("DELETE FROM books WHERE id = $1 AND user_id = $2", [bookId, userId]);
    return rowCount > 0;
  }

  async saveImage(bookId, kind, pageId, data, mime, prompt) {
    const { rows } = await this.q(
      `INSERT INTO images (book_id, kind, page_id, mime, data, prompt) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (book_id, kind, page_id) DO UPDATE
         SET mime = EXCLUDED.mime, data = EXCLUDED.data, prompt = EXCLUDED.prompt, created_at = now()
       RETURNING id, extract(epoch FROM created_at)::bigint AS v`,
      [bookId, kind, pageId || "", mime, data, prompt || ""]
    );
    await this.q("UPDATE books SET updated_at = now() WHERE id = $1", [bookId]);
    return rows[0];
  }

  async listImages(bookId) {
    const { rows } = await this.q(
      `SELECT id, kind, page_id, prompt, extract(epoch FROM created_at)::bigint AS v
         FROM images WHERE book_id = $1`,
      [bookId]
    );
    return rows;
  }

  async getImageData(bookId, kind, pageId) {
    const { rows } = await this.q(
      "SELECT data, mime FROM images WHERE book_id = $1 AND kind = $2 AND page_id = $3",
      [bookId, kind, pageId || ""]
    );
    return rows[0] || null;
  }

  async getImageForUser(userId, imageId) {
    const { rows } = await this.q(
      `SELECT i.data, i.mime FROM images i JOIN books b ON b.id = i.book_id
        WHERE i.id = $1 AND b.user_id = $2`,
      [imageId, userId]
    );
    return rows[0] || null;
  }

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

// ------------------------------------------------------------------ Memory
class MemoryStore {
  constructor() {
    this.kind = "memory";
    this.users = [];
    this.books = [];
    this.images = [];
    this.events = [];
    this.seq = { users: 0, books: 0, images: 0, events: 0 };
  }
  async init() {
    logger.warn("DATABASE_URL is not set: using in-memory storage. Data is lost on restart.");
  }
  async health() {
    return true;
  }
  now() {
    return new Date();
  }
  epoch(d) {
    return Math.floor(d.getTime() / 1000);
  }
  async upsertUser({ sub, email, name, picture }) {
    let u = this.users.find((x) => x.google_sub === sub);
    if (!u) {
      u = { id: ++this.seq.users, google_sub: sub, created_at: this.now() };
      this.users.push(u);
    }
    Object.assign(u, { email, name, picture, last_login: this.now() });
    return { id: u.id, email, name, picture };
  }
  async getUser(id) {
    const u = this.users.find((x) => x.id === Number(id));
    return u ? { id: u.id, email: u.email, name: u.name, picture: u.picture } : null;
  }
  async listBooks(userId) {
    return this.books
      .filter((b) => b.user_id === Number(userId))
      .sort((a, b) => b.updated_at - a.updated_at)
      .map((b) => {
        const imgs = this.images.filter((i) => i.book_id === b.id);
        const ref = imgs.find((i) => i.kind === "reference");
        return {
          id: b.id,
          child_name: b.child_name,
          created_at: b.created_at,
          updated_at: b.updated_at,
          page_count: imgs.filter((i) => i.kind === "page").length,
          reference_image_id: ref?.id ?? null,
          reference_v: ref ? this.epoch(ref.created_at) : null,
        };
      });
  }
  async createBook(userId, details) {
    const b = {
      id: ++this.seq.books,
      user_id: Number(userId),
      child_name: "",
      child_age: "",
      child_favorites: "",
      child_about: "",
      ...cleanDetails(details),
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.books.push(b);
    return { ...b };
  }
  async getBook(userId, bookId) {
    const b = this.books.find((x) => x.id === Number(bookId) && x.user_id === Number(userId));
    return b ? { ...b } : null;
  }
  async updateBook(userId, bookId, details) {
    const b = this.books.find((x) => x.id === Number(bookId) && x.user_id === Number(userId));
    if (!b) return null;
    Object.assign(b, cleanDetails(details), { updated_at: this.now() });
    return { ...b };
  }
  async deleteBook(userId, bookId) {
    const before = this.books.length;
    this.books = this.books.filter((x) => !(x.id === Number(bookId) && x.user_id === Number(userId)));
    if (this.books.length === before) return false;
    this.images = this.images.filter((i) => i.book_id !== Number(bookId));
    return true;
  }
  async saveImage(bookId, kind, pageId, data, mime, prompt) {
    let img = this.images.find((i) => i.book_id === Number(bookId) && i.kind === kind && i.page_id === (pageId || ""));
    if (!img) {
      img = { id: ++this.seq.images, book_id: Number(bookId), kind, page_id: pageId || "" };
      this.images.push(img);
    }
    Object.assign(img, { data, mime, prompt: prompt || "", created_at: this.now() });
    const b = this.books.find((x) => x.id === Number(bookId));
    if (b) b.updated_at = this.now();
    return { id: img.id, v: this.epoch(img.created_at) };
  }
  async listImages(bookId) {
    return this.images
      .filter((i) => i.book_id === Number(bookId))
      .map((i) => ({ id: i.id, kind: i.kind, page_id: i.page_id, prompt: i.prompt, v: this.epoch(i.created_at) }));
  }
  async getImageData(bookId, kind, pageId) {
    const i = this.images.find((x) => x.book_id === Number(bookId) && x.kind === kind && x.page_id === (pageId || ""));
    return i ? { data: i.data, mime: i.mime } : null;
  }
  async getImageForUser(userId, imageId) {
    const i = this.images.find((x) => x.id === Number(imageId));
    if (!i) return null;
    const b = this.books.find((x) => x.id === i.book_id && x.user_id === Number(userId));
    return b ? { data: i.data, mime: i.mime } : null;
  }
  async logEvent({ userId = null, bookId = null, type, detail = {} }) {
    this.events.push({ id: ++this.seq.events, user_id: userId, book_id: bookId, type, detail, created_at: this.now() });
  }
  async recentEvents(userId, limit = 50) {
    return this.events
      .filter((e) => e.user_id === Number(userId))
      .slice(-limit)
      .reverse();
  }
}

export async function createStore() {
  const url = process.env.DATABASE_URL;
  const store = url ? new PgStore(url) : new MemoryStore();
  await store.init();
  return store;
}

export { MemoryStore };
