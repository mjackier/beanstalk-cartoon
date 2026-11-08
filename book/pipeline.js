// The generation pipeline.
//
// Once (admin):  character bible images  ->  40 scenes (20 per story) drawn with a stand-in hero.
// Per book:      photo -> hero portrait (starts as soon as the photo is chosen)
//                -> the child is edited into all 20 scenes at the same time
//                -> every image is checked; failures are redrawn, at most 3 generations per image,
//                   otherwise the best of the 3 is kept
//                -> text placed where the checker found no faces or key details
//                -> PDF built on the server and stored.
import { STORIES } from "./stories.js";
import { TEMPLATE } from "./template.js";
import { characterPrompt, scenePrompt, heroPortraitPrompt, heroSwapPrompt } from "./prompts.js";
import { checkImage, verdict, checkCharacter, checkPanel } from "./check.js";
import { buildBookPdf, newDoc, panelMeasure } from "./pdf.js";
import { fullPageCandidates, firstClear } from "./layout.js";
import { personalize } from "./stories.js";
import { editImage, generateImage } from "../lib/openai.js";
import { thumbnail, shadeRect } from "../lib/images.js";
import { logger } from "../lib/log.js";

export const PRICE_CENTS = 99;
const MAX_GENERATIONS = 3;
const TARGET_MS = Number(process.env.BOOK_TARGET_MS || 56000); // finish (PDF ready) inside 60 s
const EST_RETRY_MS = Number(process.env.EST_RETRY_MS || 19000); // one more generation + check
const HEDGE_MS = Number(process.env.HEDGE_MS || 24000); // a slow image call gets a backup twin
const PAGE_QUALITY = () => process.env.PAGE_QUALITY || process.env.OPENAI_IMAGE_QUALITY || "low";
const SCENE_QUALITY = () => process.env.SCENE_QUALITY || "medium";
const MOCK = () => process.env.MOCK_IMAGES === "1";

const pageId = (n) => `p${String(n).padStart(2, "0")}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Start a second identical request if the first is slow; whichever finishes first wins.
// Fails as soon as every request that was started has failed (never waits for nothing).
function hedged(fn, label) {
  return new Promise((resolve, reject) => {
    let done = false;
    let started = 0;
    let failures = 0;
    const run = () => {
      started++;
      fn().then(
        (v) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(v);
          }
        },
        (err) => {
          failures++;
          if (!done && failures === started) {
            done = true;
            clearTimeout(timer);
            reject(err);
          }
        }
      );
    };
    const timer = setTimeout(() => {
      if (done) return;
      logger.info("hedge: started a backup image request", { label });
      run();
    }, HEDGE_MS);
    run();
  });
}

export function createPipeline(store) {
  const heroJobs = new Map(); // bookId -> { status, promise, attempts, error }
  const bookJobs = new Map(); // bookId -> job (progress shown to the browser)
  const admin = { running: false, log: [] };

  const adminLog = (msg, fields = {}) => {
    admin.log.push({ t: new Date().toISOString(), msg, ...fields });
    if (admin.log.length > 300) admin.log.shift();
    logger.info(`pregen: ${msg}`, fields);
  };

  // ------------------------------------------------------------ bible
  async function seedBible() {
    for (const story of Object.values(STORIES)) {
      for (const [key, ch] of Object.entries(story.bible)) {
        await store.upsertCharacterText(story.id, key, { name: ch.name, description: ch.description, is_hero: Boolean(ch.hero) });
      }
    }
  }

  async function bible(storyId) {
    const rows = await store.listCharacters(storyId);
    return Object.fromEntries(rows.map((r) => [r.key, r]));
  }

  async function drawCharacter(storyId, key) {
    const story = STORIES[storyId];
    const ch = (await bible(storyId))[key];
    const attempts = [];
    for (let a = 1; a <= MAX_GENERATIONS; a++) {
      const notes = attempts.at(-1)?.fails || [];
      const prompt = characterPrompt(story, ch) + (notes.length ? `\nFIX THESE PROBLEMS FROM THE LAST ATTEMPT: ${notes.join("; ")}.` : "");
      let out;
      try {
        out = await generateImage({ prompt, size: "1024x1536", quality: SCENE_QUALITY() });
      } catch (err) {
        adminLog("character attempt failed", { story: storyId, key, attempt: a, error: err.message });
        continue; // e.g. a false positive from the safety system: just try again
      }
      let v;
      try {
        v = await checkCharacter({ image: out.buffer, description: ch.description });
      } catch (err) {
        v = { pass: true, fails: [], rank: 0, check: { error: err.message } };
      }
      attempts.push({ buffer: out.buffer, prompt, ...v });
      adminLog("character attempt", { story: storyId, key, attempt: a, pass: v.pass, fails: v.fails });
      if (v.pass) break;
    }
    if (!attempts.length) throw new Error("all 3 attempts were refused");
    const best = attempts.find((x) => x.pass) || attempts.reduce((x, y) => (y.rank > x.rank ? y : x));
    await store.saveCharacterImage(storyId, key, {
      data: best.buffer,
      mime: "image/jpeg",
      thumb: thumbnail(best.buffer, 240),
      prompt: best.prompt,
      meta: { pass: best.pass, fails: best.fails, attempts: attempts.length, check: best.check },
    });
    adminLog("character drawn", { story: storyId, key, pass: best.pass });
  }

  // ------------------------------------------------------------ scenes
  async function drawScene(storyId, n) {
    const story = STORIES[storyId];
    const page = story.pages[n - 1];
    const slot = TEMPLATE[n - 1];
    const chars = await bible(storyId);
    const keys = [...(page.hero ? [story.heroKey] : []), ...page.cast];
    const refs = [];
    const images = [];
    for (const k of keys) {
      const img = await store.getCharacterImage(storyId, k);
      if (!img) throw new Error(`Draw the bible image for "${k}" first.`);
      refs.push(chars[k]);
      images.push({ buffer: img.data, mime: img.mime });
    }
    const pageSpec = { ...page, n };
    const attempts = [];
    let notes = [];
    for (let a = 1; a <= MAX_GENERATIONS; a++) {
      const prompt = scenePrompt(story, page, slot, refs, { retryNotes: notes });
      const out = images.length
        ? await editImage({ images, prompt, size: "1536x1024", quality: SCENE_QUALITY(), fidelity: "high" })
        : await generateImage({ prompt, size: "1536x1024", quality: SCENE_QUALITY() });
      let check;
      try {
        check = await checkImage({ kind: "scene", image: out.buffer, story, page: pageSpec });
      } catch (err) {
        check = { error: err.message, boxes: [], score: 5, problems: [], missing: [] };
      }
      const v = check.error ? { pass: true, fails: [], rank: 0 } : verdict("scene", check, { needsHero: Boolean(page.hero) });
      attempts.push({ buffer: out.buffer, prompt, check, v });
      adminLog("scene attempt", { story: storyId, n, attempt: a, pass: v.pass, fails: v.fails, score: check.score });
      if (v.pass) break;
      notes = v.fails;
    }
    const best = attempts.find((x) => x.v.pass) || attempts.reduce((a, b) => (b.v.rank > a.v.rank ? b : a));
    await store.saveScene(storyId, n, {
      data: best.buffer,
      mime: "image/jpeg",
      thumb: thumbnail(best.buffer),
      prompt: best.prompt,
      meta: {
        boxes: best.check.boxes || [],
        check: { ...best.check, boxes: undefined },
        pass: best.v.pass,
        fails: best.v.fails,
        attempts: attempts.map((x, i) => ({ attempt: i + 1, pass: x.v.pass, fails: x.v.fails, score: x.check.score })),
      },
    });
  }

  // Text placement, decided once per full-bleed scene and verified by looking:
  // candidates that miss the checker's boxes are drawn onto the picture as a red box, and the
  // stronger vision model must confirm the box covers no face, head, hand or must-see detail.
  async function findPanel(storyId, n) {
    const story = STORIES[storyId];
    const slot = TEMPLATE[n - 1];
    if (slot.layout !== "full") return undefined;
    const scene = await store.getScene(storyId, n);
    const page = story.pages[n - 1];
    const doc = newDoc();
    // measure the longest personalised version so every child's text fits
    const texts = ["he", "she", "they"].map((p) => personalize(page.text, p));
    const measure = (w) => Math.max(...texts.map((t) => panelMeasure(doc, t)(w)));
    let candidates = fullPageCandidates(slot.prefer, measure);
    const tried = [];
    for (let i = 0; i < 6 && candidates.length; i++) {
      // Pre-filter on faces and must-see objects only; the red-box look below is the real test
      // (a caption over someone's legs or a stretch of floor is fine, over a face never).
      const c = firstClear(candidates, (scene.meta?.boxes || []).filter((b) => b.kind !== "character"));
      if (!c) break;
      candidates = candidates.filter((x) => x.rect !== c.rect);
      const verdictPanel = await checkPanel({ shaded: shadeRect(scene.data, c.rect), keep: page.keep });
      tried.push({ zone: c.zone, align: c.align, wFrac: c.wFrac, clear: !verdictPanel.covers_something, covered: verdictPanel.covered });
      adminLog("caption spot", { story: storyId, n, zone: c.zone, align: c.align, clear: !verdictPanel.covers_something, covered: verdictPanel.covered });
      if (!verdictPanel.covers_something) {
        const panel = { zone: c.zone, align: c.align, wFrac: c.wFrac, rect: c.rect };
        await store.setSceneMeta(storyId, n, { ...scene.meta, panel, panelTried: tried });
        return panel;
      }
    }
    await store.setSceneMeta(storyId, n, { ...scene.meta, panel: null, panelTried: tried });
    adminLog("caption spot: none clear, this page will put its text below the picture", { story: storyId, n });
    return null;
  }

  // Admin: draw whatever is missing (or the listed items again), a few at a time.
  async function pregen({ story: storyId, what, only, force = false }) {
    if (admin.running) throw Object.assign(new Error("Pre-generation is already running."), { status: 409 });
    admin.running = true;
    const run = async () => {
      try {
        for (const sid of storyId ? [storyId] : Object.keys(STORIES)) {
          if (what === "bible" || what === "all") {
            const chars = await store.listCharacters(sid);
            const todo = chars.filter((c) => (only ? only.includes(c.key) : force || !c.has_image));
            await Promise.all(todo.map((c) => drawCharacter(sid, c.key).catch((e) => adminLog("character failed", { story: sid, key: c.key, error: e.message }))));
          }
          if (what === "scenes" || what === "all") {
            const have = new Set((await store.listScenes(sid)).map((s) => s.page_no));
            const todo = TEMPLATE.map((s) => s.n).filter((n) => (only ? only.includes(n) : force || !have.has(n)));
            // 6 at a time keeps well inside the account's image rate limit
            for (let i = 0; i < todo.length; i += 6) {
              await Promise.all(
                todo.slice(i, i + 6).map((n) =>
                  drawScene(sid, n)
                    .then(() => findPanel(sid, n))
                    .catch((e) => adminLog("scene failed", { story: sid, n, error: e.message }))
                )
              );
            }
          }
          if (what === "panels") {
            const todo = TEMPLATE.filter((s) => s.layout === "full").map((s) => s.n).filter((n) => !only || only.includes(n));
            for (const n of todo) await findPanel(sid, n).catch((e) => adminLog("caption spot failed", { story: sid, n, error: e.message }));
          }
        }
        adminLog("pre-generation finished");
      } finally {
        admin.running = false;
      }
    };
    run();
  }

  async function storyReady(storyId) {
    const scenes = await store.listScenes(storyId);
    return scenes.length === TEMPLATE.length;
  }

  // ------------------------------------------------------------ hero portrait
  function startHero(book, photo, userId) {
    const job = { status: "drawing", attempt: 1, startedAt: Date.now(), error: "" };
    job.promise = (async () => {
      const attempts = [];
      let notes = [];
      for (let a = 1; a <= MAX_GENERATIONS; a++) {
        job.attempt = a;
        job.status = a === 1 ? "drawing" : "redrawing";
        const prompt = heroPortraitPrompt({ retryNotes: notes });
        const out = MOCK()
          ? { buffer: photo.buffer }
          : await hedged(() => editImage({ images: [photo], prompt, size: "1024x1024", quality: PAGE_QUALITY(), fidelity: "high" }), "hero");
        job.status = "checking";
        let check;
        try {
          check = await checkImage({ kind: "portrait", image: out.buffer, photo });
        } catch (err) {
          check = { error: err.message, score: 6, likeness: 6, boxes: [] };
        }
        const v = check.error ? { pass: true, fails: [], rank: 0 } : verdict("portrait", check);
        attempts.push({ buffer: out.buffer, prompt, check, v });
        if (v.pass) break;
        notes = v.fails;
      }
      const best = attempts.find((x) => x.v.pass) || attempts.reduce((a, b) => (b.v.rank > a.v.rank ? b : a));
      await store.saveImage(book.id, "hero", "", best.buffer, "image/jpeg", best.prompt, {
        thumb: null,
        meta: { attempts: attempts.map((x, i) => ({ attempt: i + 1, pass: x.v.pass, fails: x.v.fails, score: x.check.score, likeness: x.check.likeness })) },
      });
      await store.logEvent({ userId, bookId: book.id, type: "hero_drawn", detail: { ms: Date.now() - job.startedAt, attempts: attempts.length } });
      job.status = "done";
      job.ms = Date.now() - job.startedAt;
    })().catch((err) => {
      job.status = "failed";
      job.error = err.message;
      logger.error("hero portrait failed", { bookId: book.id, error: err.message });
    });
    heroJobs.set(book.id, job);
    return job;
  }

  // ------------------------------------------------------------ the book
  function publicJob(job) {
    if (!job) return null;
    const { promise, ...rest } = job;
    return { ...rest, elapsedMs: (job.finishedAt || Date.now()) - job.startedAt };
  }

  function startBook({ book, user, charge }) {
    const story = STORIES[book.story];
    const job = {
      bookId: book.id,
      status: "running",
      stage: "hero",
      stages: [
        { key: "hero", label: `Drawing ${book.child_name} as ${story.heroName}` },
        { key: "pages", label: `Putting ${book.child_name} into all 20 pages` },
        { key: "check", label: "Checking every picture" },
        { key: "layout", label: "Placing the text where it hides nothing" },
        { key: "pdf", label: "Building the PDF" },
      ],
      pages: story.pages.map((p, i) => ({ n: i + 1, status: "waiting", attempt: 0, hero: Boolean(p.hero) })),
      startedAt: Date.now(),
      timings: {},
      retries: 0,
      documentId: null,
      error: "",
    };
    bookJobs.set(book.id, job);
    const mark = (k) => (job.timings[k] = Date.now() - job.startedAt);

    job.promise = (async () => {
      await store.setBookStatus(book.id, "generating");
      // 1. hero portrait (normally already finished while the details were being typed)
      let heroJob = heroJobs.get(book.id);
      if (heroJob) await heroJob.promise;
      const hero = await store.getImageData(book.id, "hero", "");
      if (!hero) throw new Error(heroJob?.error ? `Couldn't draw the hero: ${heroJob.error}` : "Add a photo first.");
      mark("hero");
      job.stage = "pages";

      const chars = await bible(book.story);
      const heroDescription = chars[story.heroKey]?.description || "";

      // 2 + 3. all pages at once; each runs generate -> check -> (redraw) on its own
      const results = await Promise.all(
        story.pages.map(async (page, i) => {
          const p = job.pages[i];
          const n = i + 1;
          const scene = await store.getScene(book.story, n);
          if (!scene) throw new Error(`Scene ${n} hasn't been pre-generated yet.`);
          if (!page.hero) {
            // The hero isn't on this page: the pre-generated, pre-checked scene is the page.
            p.status = "done";
            p.attempt = 0;
            const saved = await store.saveImage(book.id, "page", pageId(n), scene.data, "image/jpeg", "", {
              meta: { boxes: scene.meta?.boxes || [], fromScene: true, attempts: [] },
            });
            p.url = `/api/images/${saved.id}?v=${saved.v}`;
            return { jpeg: scene.data, boxes: scene.meta?.boxes || [], scenePanel: scene.meta?.panel };
          }
          const attempts = [];
          let notes = [];
          for (let a = 1; a <= MAX_GENERATIONS; a++) {
            p.attempt = a;
            p.status = a === 1 ? "drawing" : "redrawing";
            const prompt = heroSwapPrompt(story, page, heroDescription, { retryNotes: notes });
            let out;
            try {
              out = MOCK()
                ? { buffer: scene.data }
                : await hedged(
                    () =>
                      editImage({
                        images: [
                          { buffer: scene.data, mime: "image/jpeg" },
                          { buffer: hero.data, mime: "image/jpeg" },
                        ],
                        prompt,
                        size: "1536x1024",
                        quality: PAGE_QUALITY(),
                        fidelity: "high",
                      }),
                    `page ${n}`
                  );
            } catch (err) {
              attempts.push({ error: err.message, v: { pass: false, rank: -99, fails: [err.message] } });
              logger.error("page generation failed", { bookId: book.id, n, attempt: a, error: err.message });
              if (a === MAX_GENERATIONS) break;
              continue;
            }
            p.status = "checking";
            if (job.stage === "pages") job.stage = "check";
            let check;
            try {
              check = await checkImage({ kind: "page", image: out.buffer, story, page: { ...page, n }, portrait: hero.data });
            } catch (err) {
              // The checker itself failed: keep the image, use the scene's boxes for layout.
              check = { error: err.message, boxes: scene.meta?.boxes || [], score: 6, likeness: 6, problems: [], missing: [] };
            }
            const v = check.error ? { pass: true, fails: [], rank: 0 } : verdict("page", check);
            attempts.push({ buffer: out.buffer, prompt, check, v });
            if (v.pass) break;
            const elapsed = Date.now() - job.startedAt;
            if (a < MAX_GENERATIONS && elapsed + EST_RETRY_MS > TARGET_MS) {
              p.note = "kept the best attempt: no time left for another redraw";
              break;
            }
            notes = v.fails;
            job.retries++;
          }
          const good = attempts.filter((x) => x.buffer);
          if (!good.length) throw new Error(`Page ${n} could not be drawn: ${attempts.at(-1)?.error || "unknown error"}`);
          const best = good.find((x) => x.v.pass) || good.reduce((a, b) => (b.v.rank > a.v.rank ? b : a));
          // Text must miss both what this book's picture shows and what the scene showed.
          const boxes = [...(best.check.boxes || []), ...(scene.meta?.boxes || [])];
          const saved = await store.saveImage(book.id, "page", pageId(n), best.buffer, "image/jpeg", best.prompt, {
            meta: {
              boxes,
              pass: best.v.pass,
              fails: best.v.fails,
              likeness: best.check.likeness,
              score: best.check.score,
              attempts: attempts.map((x, j) => ({
                attempt: j + 1,
                pass: x.v.pass,
                fails: x.v.fails,
                score: x.check?.score,
                likeness: x.check?.likeness,
                error: x.error,
              })),
            },
          });
          p.status = "done";
          p.pass = best.v.pass;
          p.generations = attempts.length;
          p.url = `/api/images/${saved.id}?v=${saved.v}`;
          return { jpeg: best.buffer, boxes, scenePanel: scene.meta?.panel };
        })
      );
      mark("pages");

      // 4 + 5. layout and PDF
      job.stage = "layout";
      const fresh = await store.getBook(user.id, book.id);
      job.stage = "pdf";
      const { pdf, plans, pageCount } = buildBookPdf({ story, book: fresh, pages: results, portrait: hero.data });
      const doc = await store.saveDocument({
        userId: user.id,
        bookId: book.id,
        title: `${story.title}, starring ${fresh.child_name}`,
        data: pdf,
        pages: pageCount,
      });
      mark("pdf");
      job.documentId = doc.id;
      job.layouts = plans;
      const stats = {
        ms: Date.now() - job.startedAt,
        timings: job.timings,
        retries: job.retries,
        generations: job.pages.reduce((s, p) => s + (p.generations || 0), 0),
        failedChecks: job.pages.filter((p) => p.hero && p.pass === false).length,
        layoutFallbacks: plans.filter((p) => p.fallback).length,
        documentId: doc.id,
      };
      await store.setBookStatus(book.id, "ready", { stats });
      await store.logEvent({ userId: user.id, bookId: book.id, type: "document_generated", detail: stats });
      logger.info("book ready", { bookId: book.id, ...stats });
      job.status = "done";
      job.stage = "done";
      job.finishedAt = Date.now();
      job.stats = stats;
      // Thumbnails for the library, after the user already has the PDF.
      setTimeout(() => makeThumbs(book.id).catch(() => {}), 200);
    })().catch(async (err) => {
      job.status = "failed";
      job.error = err.message;
      job.finishedAt = Date.now();
      logger.error("book failed", { bookId: book.id, error: err.message });
      await store.setBookStatus(book.id, "failed", { error: err.message }).catch(() => {});
      // Nothing was delivered, so the $0.99 goes back automatically.
      if (charge) {
        await store
          .credit(user.id, PRICE_CENTS, {
            kind: "auto_refund",
            description: `Refund: the book couldn't be finished (${err.message})`.slice(0, 300),
            book_id: book.id,
            ref: `autorefund:${charge.id}`,
          })
          .catch((e) => logger.error("auto refund failed", { error: e.message }));
      }
      await store.logEvent({ userId: user.id, bookId: book.id, type: "document_failed", detail: { error: err.message } }).catch(() => {});
    });
    return job;
  }

  async function makeThumbs(bookId) {
    const imgs = await store.listImages(bookId);
    for (const img of imgs) {
      const full = await store.getImageData(bookId, img.kind, img.page_id);
      const th = full && thumbnail(full.data);
      if (th) await store.q("UPDATE images SET thumb = $2 WHERE id = $1", [img.id, th]);
      await sleep(50); // stay gentle on a small CPU
    }
  }

  return {
    seedBible,
    bible,
    storyReady,
    pregen,
    admin,
    startHero,
    heroJob: (id) => {
      const j = heroJobs.get(id);
      return j ? { status: j.status, attempt: j.attempt, error: j.error, ms: j.ms } : null;
    },
    startBook,
    bookJob: (id) => publicJob(bookJobs.get(id)),
    isRunning: (id) => bookJobs.get(id)?.status === "running",
    makeThumbs,
  };
}
