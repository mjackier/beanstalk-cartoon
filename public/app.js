// Beanstalk Storybook: one small single-page app, no framework.
const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (c) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;
const when = (d) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = { me: null, config: null, timers: [] };

// ------------------------------------------------------------------ api
const PW_KEY = "storybook-password";
const pw = () => {
  try {
    return sessionStorage.getItem(PW_KEY) || "";
  } catch {
    return "";
  }
};

async function api(method, url, { json, body, headers = {}, retryPassword = true } = {}) {
  const h = { ...headers };
  if (pw()) h["x-app-password"] = pw();
  if (json !== undefined) h["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (res.status === 401 && data?.needPassword && retryPassword) {
    if (await askPassword(pw() ? "That password didn't work." : "")) return api(method, url, { json, body, headers, retryPassword: true });
    throw Object.assign(new Error("A password is needed to draw pictures."), { cancelled: true });
  }
  if (res.status === 401 && data?.needLogin) {
    location.hash = "#/";
    await boot();
    throw new Error("Please sign in again.");
  }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

function askPassword(message) {
  const d = $("#pwDialog");
  $("#pwError").textContent = message || "";
  $("#pwInput").value = "";
  d.showModal();
  return new Promise((resolve) => {
    const done = (ok) => {
      d.close();
      $("#pwForm").onsubmit = null;
      resolve(ok);
    };
    $("#pwCancel").onclick = () => done(false);
    $("#pwForm").onsubmit = (e) => {
      e.preventDefault();
      try {
        sessionStorage.setItem(PW_KEY, $("#pwInput").value);
      } catch {}
      done(true);
    };
  });
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

function stopTimers() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
}

async function refreshMe() {
  const me = await api("GET", "/api/me");
  state.me = me.user;
  $("#balanceChip").textContent = money(state.me?.balance || 0);
}

// ------------------------------------------------------------------ router
const routes = [
  [/^#?\/?$/, books],
  [/^#\/new(?:\/(\d+))?$/, newBook],
  [/^#\/book\/(\d+)$/, bookPage],
  [/^#\/account(\?.*)?$/, account],
  [/^#\/admin$/, admin],
];

async function route() {
  stopTimers();
  if (!state.me) return landing();
  const hash = location.hash || "#/";
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      document.querySelectorAll("nav a").forEach((a) => a.removeAttribute("aria-current"));
      const key = hash.startsWith("#/account") ? "account" : hash.startsWith("#/admin") ? "admin" : "books";
      document.querySelector(`nav a[data-nav="${key}"]`)?.setAttribute("aria-current", "page");
      try {
        await fn(...m.slice(1));
      } catch (err) {
        if (!err.cancelled) view.innerHTML = `<p class="error">${esc(err.message)}</p>`;
      }
      view.focus({ preventScroll: true });
      return;
    }
  }
  location.hash = "#/";
}
addEventListener("hashchange", route);

// ------------------------------------------------------------------ landing (signed out)
function landing() {
  $("#nav").hidden = true;
  const covers = (state.config?.stories || []).filter((s) => s.cover);
  view.innerHTML = `
    <section class="landing">
      <div>
        <h1>A 20-page picture book with your child as the hero</h1>
        <p class="lede">Choose Jack and the Beanstalk or Little Red Riding Hood, add one photo, and your child appears on every page. The finished book is a PDF you can print, ready in under a minute.</p>
        <div class="row">
          ${
            state.config?.loginConfigured
              ? `<a class="button google big" href="/auth/google?next=/"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.9-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Sign in with Google</a>`
              : `<p class="error">Sign-in isn't set up on this server.</p>`
          }
        </div>
        <div class="facts">
          <span><b>20 pages</b>plus an About Me page</span>
          <span><b>$0.99</b>per book</span>
          <span><b>Saved</b>to your account</span>
        </div>
      </div>
      <div class="covers">${covers.map((s) => `<img src="${s.cover}" alt="A page from ${esc(s.title)}" />`).join("")}</div>
    </section>`;
}

// ------------------------------------------------------------------ library
async function books() {
  const list = await api("GET", "/api/books");
  const current = list.filter((b) => !b.legacy);
  const old = list.filter((b) => b.legacy);
  const card = (b) => `
    <article class="book ${b.legacy ? "legacy" : ""}">
      <a class="art" href="${b.legacy ? "#/" : `#/book/${b.id}`}">${b.thumb ? `<img src="${b.thumb}" alt="" loading="lazy" />` : ""}</a>
      <div class="body">
        <h3>${esc(b.child_name || "Untitled")}</h3>
        <span class="muted small">${esc(b.storyTitle)}</span>
        <span class="status ${esc(b.status)}">${statusWords(b)}</span>
        <div class="actions">
          ${b.document ? `<a class="button primary" href="${b.document}">Download PDF</a>` : b.legacy ? "" : `<a class="button" href="#/book/${b.id}">${b.status === "generating" ? "Watch" : "Continue"}</a>`}
          <span class="spacer"></span>
          <button class="danger" data-del="${b.id}" aria-label="Delete this book">Delete</button>
        </div>
      </div>
    </article>`;
  view.innerHTML = `
    <div class="lib-head"><h1>My books</h1><span class="spacer"></span><a class="button primary big" href="#/new">New book</a></div>
    ${
      current.length
        ? `<div class="books">${current.map(card).join("")}</div>`
        : `<div class="sheet empty"><h2>No books yet</h2><p class="muted">Pick a story, add a photo, and the book is ready in about a minute.</p><a class="button primary" href="#/new">Make the first book</a></div>`
    }
    ${old.length ? `<h2 style="margin-top:36px">Earlier 3-page books</h2><div class="books">${old.map(card).join("")}</div>` : ""}`;
  view.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (btn.dataset.armed !== "1") {
        btn.dataset.armed = "1";
        btn.textContent = "Delete for good?";
        return;
      }
      await api("DELETE", `/api/books/${btn.dataset.del}`);
      books();
    })
  );
}

function statusWords(b) {
  if (b.legacy) return "Made with the earlier 3-page version";
  return { ready: "Ready", generating: "Being made now…", failed: "Didn't finish (refunded)", draft: "Not made yet" }[b.status] || b.status;
}

// ------------------------------------------------------------------ new book
async function newBook(resumeId) {
  const stories = state.config.stories;
  const draft = { id: null, story: stories.find((s) => s.ready)?.id || "jack", pronouns: "he" };
  let existing = null;
  if (resumeId) {
    existing = await api("GET", `/api/books/${resumeId}`).catch(() => null);
    if (existing && !existing.legacy && existing.status !== "ready" && existing.status !== "generating") {
      Object.assign(draft, { id: existing.id, story: existing.story, pronouns: existing.pronouns });
    } else existing = null;
  }
  view.innerHTML = `
    <h1>New book</h1>
    <div class="new">
      <div class="stack">
        <section class="sheet">
          <h2>Choose the story</h2>
          <div class="stories">
            ${stories
              .map(
                (s) => `
              <button class="story" data-story="${s.id}" aria-pressed="${s.id === draft.story}" ${s.ready ? "" : "disabled"}>
                ${s.cover ? `<img src="${s.cover}" alt="" />` : `<div class="noart"></div>`}
                <span><strong>${esc(s.title)}</strong><span class="muted small" style="padding:0">${s.ready ? esc(s.blurb) : "Being prepared…"}</span></span>
              </button>`
              )
              .join("")}
          </div>
        </section>
        <section class="sheet">
          <h2>About the child</h2>
          <div class="fields">
            <label>Name <input id="f-name" maxlength="40" required autocomplete="off" placeholder="Avi" /></label>
            <label>Age <input id="f-age" maxlength="10" autocomplete="off" placeholder="7" /></label>
            <div class="wide"><label>In the story, call them<span class="hint">Used in sentences like “she ran home”.</span></label>
              <div class="pronouns" role="group" aria-label="Pronouns">
                <button type="button" data-p="he" aria-pressed="true">he</button>
                <button type="button" data-p="she" aria-pressed="false">she</button>
                <button type="button" data-p="they" aria-pressed="false">they</button>
              </div>
            </div>
            <label class="wide">Favourite things <input id="f-fav" maxlength="120" autocomplete="off" placeholder="soccer, pancakes, dinosaurs" /></label>
            <label class="wide">About me <span class="hint">A few sentences for the last page.</span><textarea id="f-about" maxlength="400"></textarea></label>
          </div>
        </section>
      </div>
      <aside class="side sheet">
        <h2>The photo</h2>
        <label class="photo" id="drop">
          <input type="file" id="f-photo" accept="image/jpeg,image/png,image/webp" />
          <span id="dropText">Choose a clear, front-facing photo<br /><span class="muted small">Only the cartoon is kept, never the photo.</span></span>
        </label>
        <div class="row" style="margin-top:10px"><button type="button" id="camBtn">Use the camera</button></div>
        <div class="camera" id="camera" hidden><video id="video" autoplay playsinline muted></video><div class="row" style="margin-top:8px"><button type="button" class="primary" id="snap">Take photo</button><button type="button" class="ghost" id="camStop">Cancel</button></div></div>
        <p class="error" id="photoError"></p>
        <div class="cost"><span>Book price</span><strong>${money(state.config.priceCents)}</strong></div>
        <div class="cost"><span>Your balance</span><strong id="bal">${money(state.me.balance)}</strong></div>
        <button class="primary big" id="make" style="width:100%;justify-content:center" disabled>Make the book</button>
        <p class="muted small" id="makeHint" style="margin-top:10px">Add a name and a photo to start.</p>
        <p class="error" id="makeError"></p>
      </aside>
    </div>`;

  const fields = { child_name: "#f-name", child_age: "#f-age", child_favorites: "#f-fav", child_about: "#f-about" };
  const values = () => Object.fromEntries(Object.entries(fields).map(([k, sel]) => [k, $(sel).value.trim()]));
  let hero = null; // heroJob
  let saveTimer;

  async function ensureBook() {
    if (draft.id) return draft.id;
    const b = await api("POST", "/api/books", { json: { story: draft.story, pronouns: draft.pronouns, ...values() } });
    draft.id = b.id;
    history.replaceState(null, "", `#/new/${b.id}`);
    return b.id;
  }
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => draft.id && api("PATCH", `/api/books/${draft.id}`, { json: { story: draft.story, pronouns: draft.pronouns, ...values() } }).catch(() => {}), 400);
  };

  view.querySelectorAll("[data-story]").forEach((b) =>
    b.addEventListener("click", () => {
      draft.story = b.dataset.story;
      view.querySelectorAll("[data-story]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      save();
    })
  );
  view.querySelectorAll("[data-p]").forEach((b) =>
    b.addEventListener("click", () => {
      draft.pronouns = b.dataset.p;
      view.querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      save();
    })
  );
  Object.values(fields).forEach((sel) => $(sel).addEventListener("input", () => (save(), ready())));

  function ready() {
    const okName = Boolean($("#f-name").value.trim());
    const heroOk = hero && hero.status !== "failed";
    $("#make").disabled = !(okName && heroOk);
    const broke = state.me.balance < state.config.priceCents;
    $("#make").textContent = broke ? "Add funds, then make the book" : "Make the book";
    $("#makeHint").innerHTML = !heroOk
      ? hero?.status === "failed"
        ? "That photo didn't work. Try another one."
        : "Add a name and a photo to start."
      : !okName
      ? "Add the child's name."
      : broke
      ? `A book costs ${money(state.config.priceCents)}; your balance is ${money(state.me.balance)}. Payments are in Stripe test mode.`
      : hero.status === "done"
      ? "Ready. The book takes about a minute."
      : "The hero is being drawn now; you can start already.";
  }

  async function sendPhoto(blob) {
    $("#photoError").textContent = "";
    const url = URL.createObjectURL(blob);
    $("#drop").querySelector("img")?.remove();
    $("#drop").insertAdjacentHTML("afterbegin", `<img src="${url}" alt="Chosen photo" />`);
    $("#dropText").hidden = true;
    setBadge("Drawing the hero from this photo…");
    try {
      const id = await ensureBook();
      const out = await api("POST", `/api/books/${id}/photo`, { body: blob, headers: { "Content-Type": blob.type || "image/jpeg" } });
      hero = out.heroJob;
      ready();
      pollHero(id);
    } catch (err) {
      if (!err.cancelled) $("#photoError").textContent = err.message;
      setBadge("");
    }
  }
  function setBadge(text) {
    $("#drop .badge")?.remove();
    if (text) $("#drop").insertAdjacentHTML("beforeend", `<span class="badge">${esc(text)}</span>`);
  }
  async function pollHero(id) {
    const p = await api("GET", `/api/books/${id}/progress`);
    hero = p.heroJob;
    ready();
    if (hero?.status === "done") {
      const b = await api("GET", `/api/books/${id}`);
      $("#drop").querySelector("img").src = b.hero.url;
      setBadge(`This is ${$("#f-name").value.trim() || "your hero"} in the book`);
      return;
    }
    if (hero?.status === "failed") return setBadge(""), ($("#photoError").textContent = hero.error);
    setBadge(hero?.status === "checking" ? "Checking the likeness…" : hero?.attempt > 1 ? `Redrawing (try ${hero.attempt} of 3)…` : "Drawing the hero from this photo…");
    state.timers.push(setTimeout(() => pollHero(id), 1200));
  }

  if (existing) {
    $("#f-name").value = existing.child_name || "";
    $("#f-age").value = existing.child_age || "";
    $("#f-fav").value = existing.child_favorites || "";
    $("#f-about").value = existing.child_about || "";
    view.querySelectorAll("[data-story]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.story === draft.story));
    view.querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.p === draft.pronouns));
    if (existing.hero || existing.heroJob) {
      hero = existing.heroJob || { status: "done" };
      $("#dropText").hidden = true;
      if (existing.hero) $("#drop").insertAdjacentHTML("afterbegin", `<img src="${existing.hero.url}" alt="The hero" />`);
      else $("#drop").insertAdjacentHTML("afterbegin", `<img alt="" />`);
      if (hero.status !== "done") pollHero(existing.id);
      else setBadge(`This is ${existing.child_name || "your hero"} in the book`);
    }
  }

  $("#f-photo").addEventListener("change", (e) => e.target.files[0] && sendPhoto(e.target.files[0]));
  let stream;
  $("#camBtn").addEventListener("click", async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      $("#video").srcObject = stream;
      $("#camera").hidden = false;
      $("#drop").hidden = true;
    } catch {
      $("#photoError").textContent = "The camera isn't available here. Choose a photo instead.";
    }
  });
  const stopCam = () => {
    stream?.getTracks().forEach((t) => t.stop());
    $("#camera").hidden = true;
    $("#drop").hidden = false;
  };
  $("#camStop").addEventListener("click", stopCam);
  $("#snap").addEventListener("click", () => {
    const v = $("#video");
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    stopCam();
    c.toBlob((b) => sendPhoto(b), "image/jpeg", 0.92);
  });

  $("#make").addEventListener("click", async () => {
    $("#makeError").textContent = "";
    if (state.me.balance < state.config.priceCents) {
      const id = await ensureBook();
      await api("PATCH", `/api/books/${id}`, { json: { story: draft.story, pronouns: draft.pronouns, ...values() } });
      location.hash = `#/account?then=${id}`;
      return;
    }
    $("#make").disabled = true;
    try {
      const id = await ensureBook();
      await api("PATCH", `/api/books/${id}`, { json: { story: draft.story, pronouns: draft.pronouns, ...values() } });
      const out = await api("POST", `/api/books/${id}/generate`);
      state.me.balance = out.balance;
      $("#balanceChip").textContent = money(out.balance);
      location.hash = `#/book/${id}`;
    } catch (err) {
      if (err.data?.needFunds) $("#makeError").innerHTML = `${esc(err.message)} <a href="#/account">Add funds</a>`;
      else if (!err.cancelled) $("#makeError").textContent = err.message;
      ready();
    }
  });
  ready();
}

// The attempt count on every image (max 3 generations per image).
function attemptLabel({ status, attempt, generations, pass, hero }) {
  if (status === "done" || status === undefined) {
    if (!hero) return "pre-drawn scene ✓";
    if (!generations) return "✓";
    return pass === false ? `best of ${generations} (none perfect)` : `✓ try ${generations} of 3`;
  }
  if (status === "drawing") return `try ${attempt} of 3 · drawing`;
  if (status === "checking") return `try ${attempt} of 3 · checking`;
  if (status === "redrawing") return `try ${attempt} of 3 · redrawing`;
  return "";
}

// ------------------------------------------------------------------ one book: progress, then the result
const STAGE_KEYS = ["hero", "pages", "check", "layout", "pdf"];
async function bookPage(id) {
  const book = await api("GET", `/api/books/${id}`);
  if (book.legacy) return (location.hash = "#/");
  if (book.job?.status === "running" || (book.status === "generating" && book.job)) return progressView(book);
  if (book.status === "ready") return finishedView(book);
  if (book.status === "draft") return (location.hash = `#/new/${book.id}`);
  if (book.status === "failed") {
    view.innerHTML = `<div class="sheet"><h1>This book didn't finish</h1><p>${esc(book.error)}</p><p class="muted">Your $0.99 was refunded to your balance automatically.</p><a class="button primary" href="#/new">Try again</a></div>`;
    return;
  }
  location.hash = `#/new/${book.id}`;
}

function progressView(book) {
  view.innerHTML = `
    <h1>Making ${esc(book.child_name)}'s book</h1>
    <p class="muted">${esc(book.storyTitle)} · 20 pages · every picture is checked, and redrawn if it fails</p>
    <section class="sheet progress">
      <ol class="stages" id="stages"></ol>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" id="bar"><div></div></div>
      <p class="nowline"><span id="nowText">Starting…</span><span class="clock" id="clock">0 s</span></p>
    </section>
    <div class="grid" id="tiles">${Array.from({ length: 20 }, (_, i) => `<div class="tile waiting" data-n="${i + 1}"><span class="n">${i + 1}</span></div>`).join("")}</div>`;
  const shown = new Set();
  const tick = async () => {
    let p;
    try {
      p = await api("GET", `/api/books/${book.id}/progress`);
    } catch {
      state.timers.push(setTimeout(tick, 1500));
      return;
    }
    const job = p.job;
    if (!job) {
      if (p.status === "ready" || p.status === "failed") return bookPage(book.id);
      state.timers.push(setTimeout(tick, 1000));
      return;
    }
    renderProgress(job, shown);
    if (job.status === "done") {
      await refreshMe();
      return setTimeout(() => bookPage(book.id), 600);
    }
    if (job.status === "failed") return bookPage(book.id);
    state.timers.push(setTimeout(tick, 700));
  };
  tick();
}

function renderProgress(job, shown) {
  const idx = job.stage === "done" ? 5 : STAGE_KEYS.indexOf(job.stage);
  $("#stages").innerHTML = job.stages
    .map((s, i) => `<li class="${i < idx ? "done" : i === idx ? "now" : ""}">${i < idx ? "✓ " : ""}${esc(s.label)}</li>`)
    .join("");
  const heroPages = job.pages.filter((p) => p.hero);
  const done = job.pages.filter((p) => p.status === "done").length;
  const partial = job.pages.reduce((s, p) => s + (p.status === "done" ? 1 : p.status === "checking" ? 0.7 : p.status === "redrawing" ? 0.4 : p.status === "drawing" ? 0.15 : 0), 0);
  const pct = idx === 0 ? 4 : idx <= 2 ? 8 + (partial / 20) * 80 : idx === 3 ? 90 : idx === 4 ? 95 : 100;
  $("#bar > div").style.width = `${pct}%`;
  $("#bar").setAttribute("aria-valuenow", Math.round(pct));
  const redrawing = job.pages.filter((p) => p.status === "redrawing").length;
  const checking = job.pages.filter((p) => p.status === "checking").length;
  const stage = job.stages[Math.min(idx, 4)]?.label || "Done";
  $("#nowText").textContent =
    job.stage === "done"
      ? "Done. Opening your book…"
      : `Step ${Math.min(idx, 4) + 1} of 5: ${stage}` +
        (idx >= 1 && idx <= 2 ? ` · ${done} of 20 done${checking ? ` · ${checking} being checked` : ""}${redrawing ? ` · ${redrawing} being redrawn` : ""}` : "");
  $("#clock").textContent = `${Math.round(job.elapsedMs / 1000)} s`;
  for (const p of job.pages) {
    const tile = $(`.tile[data-n="${p.n}"]`);
    tile.className = `tile ${p.status}`;
    const label = attemptLabel(p);
    if (p.url && !shown.has(p.n)) {
      shown.add(p.n);
      tile.innerHTML = `<img src="${p.url}" alt="Page ${p.n}" /><span class="n">${p.n}</span><span class="s"></span>`;
    } else if (!tile.querySelector(".s")) tile.insertAdjacentHTML("beforeend", `<span class="s"></span>`);
    const s = tile.querySelector(".s");
    s.textContent = label;
    s.hidden = !label;
  }
  void heroPages;
}

function finishedView(book) {
  const doc = book.documents[0];
  const st = book.stats || {};
  const redrawn = book.pages.filter((p) => p.checked?.generations > 1).length;
  view.innerHTML = `
    <div class="done-head">
      <div>
        <h1>${esc(book.child_name)} in ${esc(book.storyTitle)}</h1>
        <div class="stat">
          ${st.ms ? `<span>Made in ${Math.round(st.ms / 1000)} seconds</span>` : ""}
          <span>${redrawn ? `${redrawn} picture${redrawn > 1 ? "s" : ""} redrawn after a failed check` : "Every picture passed its check"}</span>
          ${st.layoutFallbacks ? `<span>${st.layoutFallbacks} page${st.layoutFallbacks > 1 ? "s" : ""} moved the text below the picture to keep faces clear</span>` : ""}
        </div>
      </div>
      <span class="spacer"></span>
      ${doc ? `<a class="button primary big" href="${doc.url}">Download PDF</a>` : ""}
    </div>
    ${doc ? `<iframe class="viewer" src="${doc.url}?inline=1#view=Fit" title="The finished book"></iframe>` : ""}
    <h2 style="margin-top:28px">The pictures</h2>
    <p class="muted small">Every picture is checked by a vision model and redrawn if it fails, at most 3 times; if none is perfect, the best is kept. The label on each picture shows its tries.</p>
    <div class="grid">${book.pages
      .map((p) => {
        const c = p.checked || {};
        const label = attemptLabel({ status: "done", generations: c.generations, pass: c.pass, hero: !c.fromScene });
        const why = (c.attempts || []).map((a, i) => `Try ${i + 1}: ${a.pass ? "passed" : "failed: " + a.fails.join("; ")}`).join("\n");
        return `<a class="tile" href="${p.url}" target="_blank" rel="noopener" title="${esc(why || label)}"><img src="${p.thumb}" alt="Page ${p.n}" loading="lazy" /><span class="n">${p.n}</span><span class="s">${esc(label)}</span></a>`;
      })
      .join("")}</div>
    ${
      book.cost?.usd
        ? `<section class="sheet" style="margin-top:22px"><h3>What this book cost to make</h3>
            <p><strong>$${book.cost.usd.toFixed(2)}</strong> in API calls, against the ${money(book.priceCents)} price:
            ${book.cost.imageCalls} image calls ($${book.cost.imageUsd.toFixed(2)}, of which ${book.cost.retryImageCalls} redraw${book.cost.retryImageCalls === 1 ? "" : "s"})
            and ${book.cost.checkCalls} vision checks ($${book.cost.checkUsd.toFixed(2)}). Hero portrait: ${book.heroAttempts || 1} tr${(book.heroAttempts || 1) === 1 ? "y" : "ies"}.</p></section>`
        : ""
    }
    <p class="muted small" style="margin-top:16px">Made ${when(book.updated_at)}. This book stays in your account: sign in any time to download it again.</p>`;
}

// ------------------------------------------------------------------ account
async function account(query = "") {
  const params = new URLSearchParams(query.replace(/^\?/, ""));
  const a = await api("GET", "/api/account");
  state.me.balance = a.balance;
  $("#balanceChip").textContent = money(a.balance);
  const store = (k, v) => {
    try {
      v === undefined ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v);
    } catch {}
  };
  const read = (k) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  };
  if (params.get("then")) store("resume-book", params.get("then"));
  if (params.get("funded") > 0) toast(`${money(Number(params.get("funded")))} added to your balance`);
  if (params.has("funded") || params.has("then")) history.replaceState(null, "", "#/account");
  const resume = read("resume-book");
  const kindWords = { topup: "Funds added", document: "Book made", refund: "Refund", auto_refund: "Returned to balance" };
  view.innerHTML = `
    <h1>Account</h1>
    ${
      resume
        ? `<div class="sheet row" style="margin-bottom:18px"><span>${a.balance >= a.priceCents ? "You have enough for your book now." : `Add at least ${money(a.priceCents - a.balance)} to make your book.`}</span><span class="spacer"></span><a class="button ${a.balance >= a.priceCents ? "primary" : ""}" id="resumeBtn" href="#/new/${esc(resume)}">Back to my book</a></div>`
        : ""
    }
    <div class="account">
      <div class="stack">
        <section class="sheet">
          <p class="muted" style="margin:0">Balance</p>
          <p class="balance">${money(a.balance)}</p>
          <p class="muted small">Each book costs ${money(a.priceCents)}. That's ${Math.floor(a.balance / a.priceCents)} book${Math.floor(a.balance / a.priceCents) === 1 ? "" : "s"}.</p>
          ${a.payments.some((p) => p.refundable > 0) ? `<a class="button" href="#refunds" id="toRefunds">Request a refund</a>` : ""}
          <h3 style="margin-top:18px">Add funds</h3>
          <div class="amounts">${a.topupChoices.map((c) => `<button class="${c === 500 ? "primary" : ""}" data-topup="${c}">${money(c)}</button>`).join("")}</div>
          <p class="testcard">Stripe test mode: pay with card <code>4242 4242 4242 4242</code>, any future date, any CVC. No real money moves.</p>
          <p class="error" id="topupError"></p>
        </section>
        <section class="sheet">
          <h3>What a book costs to make</h3>
          ${
            a.costs.books
              ? `<p class="balance" style="font-size:34px">$${a.costs.avg.toFixed(2)}</p>
                 <p class="small">Average API cost per book over ${a.costs.books} book${a.costs.books === 1 ? "" : "s"} (image calls, redraws and vision checks), against the <strong>${money(a.priceCents)}</strong> price: about $${(a.priceCents / 100 - a.costs.avg).toFixed(2)} margin per book.</p>
                 <p class="muted small">Cheapest $${a.costs.min.toFixed(2)}, most expensive $${a.costs.max.toFixed(2)}. Not included: the one-off $${a.costs.setupUsd.toFixed(2)} spent drawing the character bible and the 40 shared scenes.</p>`
              : `<p class="muted">No books made since cost tracking started.</p>`
          }
        </section>
        <section class="sheet">
          <h3 id="refunds">Request a refund</h3>
          <p class="muted small">Get unspent money back on the card you paid with.</p>
          ${
            a.payments.length
              ? a.payments
                  .map(
                    (p) => `
            <div class="pay">
              <span>${money(p.amount)} on ${when(p.paid_at)}${p.card ? ` · card ${esc(p.card)}` : ""}${p.refunded ? `<br /><span class="muted small">${money(p.refunded)} refunded</span>` : ""}</span>
              <span class="spacer"></span>
              ${
                p.refundable > 0
                  ? `<input type="number" min="0.01" step="0.01" max="${(p.refundable / 100).toFixed(2)}" placeholder="0.00" aria-label="Amount to refund, up to ${money(p.refundable)}" data-amt="${p.id}" data-max="${p.refundable}" data-card="${esc(p.card)}" />
                     <button data-refund="${p.id}">Request refund</button>
                     <span class="muted small" style="flex-basis:100%">You can get back up to ${money(p.refundable)}.</span>`
                  : `<span class="muted small">Nothing left to refund</span>`
              }
            </div>`
                  )
                  .join("")
              : `<p class="muted">Add funds first; unspent money can be refunded to the card.</p>`
          }
          <p class="muted small" style="margin-top:10px">Only unspent balance can be refunded. Requests are processed by Stripe right away.</p>
          ${
            a.refunds.length
              ? `<h3 style="margin-top:16px">Refund requests</h3>
                 <table><tbody>${a.refunds
                   .map(
                     (r) => `<tr><td>${money(r.amount_cents)}</td><td class="small">Requested ${when(r.created_at)}<br />${
                       r.status === "succeeded"
                         ? `Processed by Stripe ${when(r.processed_at)} · ${esc(r.stripe_refund_id)}`
                         : r.status === "failed"
                         ? `<span class="error">Declined: ${esc(r.error)}</span>`
                         : "Processing…"
                     }</td></tr>`
                   )
                   .join("")}</tbody></table>`
              : ""
          }
          <p class="error" id="refundError"></p>
        </section>
      </div>
      <section class="sheet">
        <h2>History</h2>
        ${
          a.ledger.length
            ? `<table>
          <thead><tr><th>When</th><th>What happened</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead>
          <tbody>${a.ledger
            .map(
              (l) => `<tr>
              <td class="small muted">${when(l.created_at)}</td>
              <td><strong>${kindWords[l.kind] || esc(l.kind)}</strong><br /><span class="small">${esc(l.description)}</span>${l.book_id ? ` <a class="small" href="#/book/${l.book_id}">open book</a>` : ""}</td>
              <td class="num ${l.amount_cents > 0 ? "plus" : "minus"}">${l.amount_cents > 0 ? "+" : ""}${money(l.amount_cents)}</td>
              <td class="num">${money(l.balance_after)}</td></tr>`
            )
            .join("")}</tbody></table>`
            : `<p class="muted">Every credit and charge will be listed here, with what caused it.</p>`
        }
      </section>
    </div>`;
  $("#resumeBtn")?.addEventListener("click", () => store("resume-book"));
  $("#toRefunds")?.addEventListener("click", (e) => {
    e.preventDefault(); // the router owns the hash, so scroll instead of navigating
    $("#refunds").scrollIntoView({ behavior: "smooth", block: "start" });
    view.querySelector("[data-amt]")?.focus({ preventScroll: true });
  });
  view.querySelectorAll("[data-topup]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const { url } = await api("POST", "/api/account/topup", { json: { amount: Number(b.dataset.topup) } });
        location.href = url;
      } catch (err) {
        $("#topupError").textContent = err.message;
        b.disabled = false;
      }
    })
  );
  view.querySelectorAll("[data-refund]").forEach((b) =>
    b.addEventListener("click", async () => {
      const input = view.querySelector(`[data-amt="${b.dataset.refund}"]`);
      const amt = Math.round(Number(input.value) * 100);
      const max = Number(input.dataset.max);
      if (!amt || amt <= 0 || amt > max) {
        $("#refundError").textContent = `Enter an amount between $0.01 and ${money(max)}.`;
        input.focus();
        return;
      }
      $("#refundError").textContent = "";
      // Two steps: say exactly what will happen, then do it.
      if (b.dataset.confirm !== String(amt)) {
        b.dataset.confirm = String(amt);
        b.classList.add("primary");
        b.textContent = `Send ${money(amt)} back to card ${input.dataset.card || ""}`.trim();
        $("#refundError").innerHTML = `<span class="muted" style="font-weight:400">Your balance will go from ${money(state.me.balance)} to ${money(state.me.balance - amt)}. Click again to confirm.</span>`;
        return;
      }
      b.disabled = true;
      b.textContent = "Processing…";
      try {
        await api("POST", "/api/account/refunds", { json: { paymentId: Number(b.dataset.refund), amount: amt } });
        toast(`${money(amt)} refunded to the card`);
      } catch (err) {
        toast(err.message);
      }
      account();
    })
  );
}

// ------------------------------------------------------------------ admin: bible + scenes
async function admin() {
  if (!state.me.admin) return (location.hash = "#/");
  const s = await api("GET", "/api/admin/state");
  view.innerHTML = `
    <h1>Character bible and scenes</h1>
    <p class="muted">Drawn once and stored in the database. Every book edits its hero into these scenes.</p>
    <div class="row" style="margin:10px 0 18px">
      <button class="primary" data-run='{"what":"bible"}'>Draw missing bible images</button>
      <button data-run='{"what":"scenes"}'>Draw missing scenes</button>
      <button data-run='{"what":"panels"}'>Re-verify caption spots</button>
      <button id="testJack">Test book: Jack</button>
      <button id="testRed">Test book: Red</button>
      <span class="muted">${s.running ? "Running…" : ""}</span>
    </div>
    ${s.stories
      .map(
        (st) => `
      <section class="sheet" style="margin-bottom:22px">
        <h2>${esc(st.title)}</h2>
        <h3>Character bible</h3>
        <div class="admin-grid">${st.characters
          .map(
            (c) => `<figure>${c.image ? `<img src="${c.image}" alt="" loading="lazy" />` : `<div class="noart" style="aspect-ratio:2/3;background:var(--sky)"></div>`}
            <figcaption><strong>${esc(c.name)}</strong>${c.hero ? " (stand-in hero)" : ""}<br /><span class="muted">${esc(c.description)}</span>
            <br /><button class="ghost small" data-run='${JSON.stringify({ what: "bible", story: st.id, only: [c.key] })}'>Redraw</button></figcaption></figure>`
          )
          .join("")}</div>
        <h3 style="margin-top:18px">Scenes</h3>
        <div class="admin-grid">${st.scenes
          .map(
            (sc) => `<figure>${sc.image ? `<a href="${sc.image.replace("?", "?full=1&")}" target="_blank" rel="noopener"><img src="${sc.image}" alt="" loading="lazy" /></a>` : `<div style="aspect-ratio:3/2;background:var(--sky)"></div>`}
            <figcaption><strong>${sc.n}</strong> · ${sc.layout}${
              sc.meta
                ? ` · score ${sc.meta.check?.score ?? "?"} · ${sc.meta.attempts?.length || 1} tr${(sc.meta.attempts?.length || 1) > 1 ? "ies" : "y"} ${sc.meta.pass ? "✓" : `<span class="fail">✗ ${esc((sc.meta.fails || []).join("; "))}</span>`}`
                : ""
            }
            ${sc.layout === "full" ? `<br />caption: ${sc.meta?.panel ? `${sc.meta.panel.zone}-${sc.meta.panel.align} ✓ verified` : sc.meta?.panel === null ? "none clear → text below picture" : "not checked"}` : ""}
            <br /><span class="muted">${esc(sc.text)}</span>
            <br /><button class="ghost small" data-run='${JSON.stringify({ what: "scenes", story: st.id, only: [sc.n] })}'>Redraw</button></figcaption></figure>`
          )
          .join("")}</div>
      </section>`
      )
      .join("")}
    <h3>Log</h3><div class="log">${s.log
      .slice()
      .reverse()
      .map((l) => `<div>${esc(l.t.slice(11, 19))} ${esc(l.msg)} ${esc(JSON.stringify({ ...l, t: undefined, msg: undefined }))}</div>`)
      .join("")}</div>`;
  view.querySelectorAll("[data-run]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api("POST", "/api/admin/pregen", { json: JSON.parse(b.dataset.run) });
        toast("Started");
      } catch (err) {
        toast(err.message);
      }
      setTimeout(admin, 800);
    })
  );
  for (const [id, story] of [["#testJack", "jack"], ["#testRed", "red"]])
    $(id).addEventListener("click", async () => {
      toast("Drawing the hero, then the book…");
      const { id: bookId } = await api("POST", "/api/admin/test-book", { json: { story } });
      location.hash = `#/book/${bookId}`;
    });
  if (s.running) state.timers.push(setTimeout(admin, 4000));
}

// ------------------------------------------------------------------ boot
async function boot() {
  const [me, config] = await Promise.all([api("GET", "/api/me"), api("GET", "/api/config")]);
  state.me = me.user;
  state.config = config;
  if (state.me) {
    $("#nav").hidden = false;
    $("#balanceChip").textContent = money(state.me.balance || 0);
    $("#adminLink").hidden = !state.me.admin;
    $("#avatarImg").src = state.me.picture || "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    $("#userEmail").textContent = state.me.email;
  }
  route();
}
$("#avatarBtn").addEventListener("click", () => {
  const m = $("#userMenu");
  m.hidden = !m.hidden;
  $("#avatarBtn").setAttribute("aria-expanded", String(!m.hidden));
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#avatarBtn, #userMenu")) $("#userMenu").hidden = true;
});
const p = new URLSearchParams(location.search);
if (p.get("login") === "failed") toast("Sign-in didn't work. Try again.");
boot();
