// Storybook front end: Google sign-in, a library of saved books, and an editor.
// Every image is ONE request = ONE image call on the server. "Generate the whole
// book" makes Jack first, then sends every page request at the same time, so
// pages are drawn in parallel, each with its own progress bar. Nothing retries
// automatically.

const $ = (id) => document.getElementById(id);

const state = {
  me: null,
  status: {},
  story: [], // [{ id, number, title, text, textArea }]
  book: null, // { id, child_*, reference: {url,prompt}|null, pages: { pageId: {url,prompt} } }
  photo: null, // File chosen in this session (never uploaded except to draw Jack)
  photoIsNew: false, // a new photo was chosen since Jack was last drawn
  jobs: new Map(), // key -> job (see progress section)
  durations: { reference: [], page: [] }, // seconds, to estimate progress
};

// ================================================================ API helper
async function api(method, url, { json, form } = {}) {
  const headers = { ...window.appAuth.headers() };
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const res = await fetch(url, { method, headers, body });
  let data = {};
  try {
    data = await res.json();
  } catch {
    if (!res.ok) data = { error: `Server error (${res.status}).` };
  }
  if (!res.ok) {
    window.appAuth.handleError(data);
    if (data.needLogin) showSignedOut();
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

// ================================================================ views
function show(view) {
  for (const id of ["signedOut", "library", "editor"]) $(id).hidden = id !== view;
}

function renderUserBar() {
  const bar = $("userBar");
  if (!state.me) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = `
    <img class="avatar" alt="" referrerpolicy="no-referrer" />
    <span class="who"><strong class="name"></strong> <span class="email"></span></span>
    <button type="button" class="link" id="libLink">My books</button>
    <a class="signout" href="/auth/logout?next=/book.html">Sign out</a>`;
  const img = bar.querySelector(".avatar");
  if (state.me.picture) img.src = state.me.picture;
  else img.remove();
  bar.querySelector(".name").textContent = state.me.name || "";
  bar.querySelector(".email").textContent = state.me.email || "";
  bar.querySelector("#libLink").addEventListener("click", openLibrary);
}

function showSignedOut() {
  state.me = null;
  renderUserBar();
  $("loginUnavailable").hidden = state.status.loginConfigured !== false;
  $("googleBtn").hidden = state.status.loginConfigured === false;
  const next = location.pathname + location.search;
  $("googleBtn").href = `/auth/google?next=${encodeURIComponent(next)}`;
  show("signedOut");
}

// ================================================================ library
const fmtDate = (d) =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

async function openLibrary() {
  history.replaceState(null, "", "/book.html");
  state.book = null;
  show("library");
  const list = $("bookList");
  list.innerHTML = '<p class="hint">Loading your books…</p>';
  try {
    const books = await api("GET", "/api/books");
    list.innerHTML = "";
    $("noBooks").hidden = books.length > 0;
    for (const b of books) list.appendChild(bookCard(b));
  } catch (err) {
    list.innerHTML = "";
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = err.message;
    list.appendChild(p);
  }
  loadActivity();
}

function bookCard(b) {
  const card = document.createElement("article");
  card.className = "book-card";
  card.innerHTML = `
    <div class="thumb"></div>
    <div class="meta">
      <strong class="title"></strong>
      <span class="sub"></span>
    </div>
    <div class="card-actions">
      <button type="button" class="open">Open</button>
      <button type="button" class="secondary del">Delete</button>
    </div>`;
  if (b.thumbnail) {
    const img = document.createElement("img");
    img.src = b.thumbnail;
    img.alt = "";
    card.querySelector(".thumb").appendChild(img);
  } else {
    card.querySelector(".thumb").textContent = "No Jack yet";
  }
  card.querySelector(".title").textContent = b.child_name ? `Starring ${b.child_name}` : "Untitled book";
  card.querySelector(".sub").textContent = `${b.page_count} of ${b.total_pages} pages · ${fmtDate(b.updated_at)}`;
  card.querySelector(".open").addEventListener("click", () => openBook(b.id));
  const del = card.querySelector(".del");
  // Two clicks to delete (no browser confirm dialog).
  del.addEventListener("click", async () => {
    if (!del.dataset.armed) {
      del.dataset.armed = "1";
      del.textContent = "Click again to delete";
      setTimeout(() => {
        delete del.dataset.armed;
        del.textContent = "Delete";
      }, 4000);
      return;
    }
    try {
      await api("DELETE", `/api/books/${b.id}`);
      card.remove();
      $("noBooks").hidden = $("bookList").children.length > 0;
    } catch (err) {
      del.textContent = err.message;
    }
  });
  return card;
}

const EVENT_LABELS = {
  login: "Signed in",
  book_created: "Started a book",
  book_deleted: "Deleted a book",
  image_generated: "Drew an image",
  image_failed: "Image failed",
  pdf_downloaded: "Downloaded the PDF",
};

async function loadActivity() {
  const ul = $("activityList");
  ul.innerHTML = "";
  try {
    const events = await api("GET", "/api/activity");
    if (!events.length) ul.innerHTML = '<li class="hint">Nothing yet.</li>';
    for (const e of events) {
      const li = document.createElement("li");
      const d = e.detail || {};
      let what = EVENT_LABELS[e.type] || e.type;
      if (d.kind) what += `: ${d.kind === "reference" ? "Jack" : d.kind}${d.pageId ? ` (${d.pageId})` : ""}`;
      if (d.ms) what += ` in ${(d.ms / 1000).toFixed(1)}s`;
      if (d.error) what += `: ${d.error}`;
      li.textContent = `${new Date(e.created_at).toLocaleString()} · ${what}${e.book_id ? ` · book #${e.book_id}` : ""}`;
      ul.appendChild(li);
    }
  } catch {
    ul.innerHTML = '<li class="hint">Couldn\'t load the log.</li>';
  }
}

$("newBook").addEventListener("click", async () => {
  const btn = $("newBook");
  btn.disabled = true;
  try {
    const book = await api("POST", "/api/books", { json: {} });
    await openBook(book.id);
  } catch (err) {
    alertInline($("bookList"), err.message);
  } finally {
    btn.disabled = false;
  }
});

function alertInline(container, msg) {
  const p = document.createElement("p");
  p.className = "error";
  p.textContent = msg;
  container.prepend(p);
}

$("backToLibrary").addEventListener("click", openLibrary);

// ================================================================ editor
async function openBook(id) {
  const book = await api("GET", `/api/books/${id}`);
  state.book = book;
  state.photo = null;
  state.photoIsNew = false;
  history.replaceState(null, "", `/book.html?book=${book.id}`);

  $("childName").value = book.child_name || "";
  $("childAge").value = book.child_age || "";
  $("childFavorites").value = book.child_favorites || "";
  $("childAbout").value = book.child_about || "";
  $("preview").hidden = true;
  $("dropText").hidden = false;
  $("savedNote").textContent = "";
  $("jackError").textContent = "";
  $("jackPrompt").textContent = book.reference?.prompt || "(not sent yet)";
  $("progressPanel").hidden = true;
  $("jobs").innerHTML = "";
  state.jobs.clear();

  renderReference();
  renderPages();
  show("editor");
  window.scrollTo(0, 0);
}

function renderReference() {
  const frame = $("refFrame");
  frame.innerHTML = "";
  if (state.book?.reference) {
    const img = document.createElement("img");
    img.src = state.book.reference.url;
    img.alt = "Character reference: the child as Jack";
    frame.appendChild(img);
  } else {
    frame.textContent = "No Jack yet";
  }
}

// ---------- About Me: autosave
let saveTimer = null;
function scheduleSave() {
  if (!state.book) return;
  $("savedNote").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await api("PATCH", `/api/books/${state.book.id}`, {
        json: {
          child_name: $("childName").value.trim(),
          child_age: $("childAge").value.trim(),
          child_favorites: $("childFavorites").value.trim(),
          child_about: $("childAbout").value.trim(),
        },
      });
      $("savedNote").textContent = "All changes saved";
    } catch (err) {
      $("savedNote").textContent = `Not saved: ${err.message}`;
    }
  }, 700);
}
["childName", "childAge", "childFavorites", "childAbout"].forEach((id) =>
  $(id).addEventListener("input", () => {
    scheduleSave();
    refresh();
  })
);

// ---------- photo (upload or camera)
function setPhoto(file) {
  if (!file) return;
  state.photo = file;
  state.photoIsNew = true;
  $("preview").src = URL.createObjectURL(file);
  $("preview").hidden = false;
  $("dropText").hidden = true;
  refresh();
}
$("photo").addEventListener("change", () => setPhoto($("photo").files[0]));
$("cameraFallback").addEventListener("change", () => setPhoto($("cameraFallback").files[0]));

let stream = null;
function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $("video").srcObject = null;
  $("camera").hidden = true;
  $("drop").hidden = false;
  $("takePhoto").hidden = false;
}
$("takePhoto").addEventListener("click", async () => {
  $("cameraError").textContent = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    $("cameraFallback").click();
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    $("video").srcObject = stream;
    $("camera").hidden = false;
    $("drop").hidden = true;
    $("takePhoto").hidden = true;
  } catch (err) {
    stopCamera();
    $("cameraError").textContent =
      err.name === "NotAllowedError"
        ? "Camera access was blocked. Allow the camera in your browser settings, or upload a photo instead."
        : "Couldn't open a camera on this device. You can upload a photo instead.";
  }
});
$("snap").addEventListener("click", () => {
  const video = $("video");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob(
    (blob) => {
      stopCamera();
      if (blob) setPhoto(new File([blob], "camera-photo.jpg", { type: "image/jpeg" }));
    },
    "image/jpeg",
    0.92
  );
});
$("cancelCam").addEventListener("click", stopCamera);

// ================================================================ progress
// One row per image. The model doesn't report progress, so each bar moves on an
// estimate (based on how long earlier images took) and jumps to 100% when its
// image actually arrives. The overall bar counts finished images.
const DEFAULT_SECONDS = { reference: 45, page: 55 };

function expectedSeconds(kind) {
  if (state.status.mock) return 4;
  const past = state.durations[kind];
  return past.length ? past.reduce((a, b) => a + b, 0) / past.length : DEFAULT_SECONDS[kind];
}

function addJob(key, label, kind) {
  $("progressPanel").hidden = false;
  let job = state.jobs.get(key);
  if (!job) {
    const li = document.createElement("li");
    li.className = "job";
    li.innerHTML = `
      <div class="job-label"><span class="name"></span><span class="state"></span></div>
      <div class="bar"><div class="fill"></div></div>`;
    li.querySelector(".name").textContent = label;
    $("jobs").appendChild(li);
    job = { key, label, kind, el: li };
    state.jobs.set(key, job);
  }
  Object.assign(job, { status: "queued", start: null, end: null, error: null });
  updateJobEl(job);
  updateOverall();
  return job;
}

function startJob(job) {
  job.status = "running";
  job.start = performance.now();
  job.expected = expectedSeconds(job.kind);
  updateJobEl(job);
  tick();
}

function endJob(job, error) {
  job.end = performance.now();
  job.status = error ? "failed" : "done";
  job.error = error ? error.message : null;
  if (!error) state.durations[job.kind].push((job.end - job.start) / 1000);
  updateJobEl(job);
  updateOverall();
}

function updateJobEl(job) {
  const fill = job.el.querySelector(".fill");
  const st = job.el.querySelector(".state");
  job.el.dataset.status = job.status;
  if (job.status === "queued") {
    fill.style.width = "0%";
    st.textContent = "Waiting";
  } else if (job.status === "running") {
    const secs = (performance.now() - job.start) / 1000;
    const pct = 95 * (1 - Math.exp(-secs / (job.expected * 0.6)));
    fill.style.width = `${pct.toFixed(1)}%`;
    st.textContent = `Drawing… ${Math.round(secs)}s`;
  } else if (job.status === "done") {
    fill.style.width = "100%";
    st.textContent = `Done in ${Math.round((job.end - job.start) / 1000)}s`;
  } else if (job.status === "failed") {
    fill.style.width = "100%";
    st.textContent = `Failed: ${job.error}`;
  } else if (job.status === "skipped") {
    fill.style.width = "0%";
    st.textContent = "Not started (Jack failed)";
  }
}

function updateOverall() {
  const jobs = [...state.jobs.values()];
  const done = jobs.filter((j) => j.status === "done").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  $("overallText").textContent =
    `${done} of ${jobs.length} images done` + (failed ? ` · ${failed} failed` : "");
  $("overallFill").style.width = jobs.length ? `${(done / jobs.length) * 100}%` : "0%";
  const starts = jobs.filter((j) => j.start).map((j) => j.start);
  if (starts.length) {
    const running = jobs.some((j) => j.status === "running");
    const endT = running ? performance.now() : Math.max(...jobs.map((j) => j.end || 0));
    $("overallTime").textContent = `${Math.round((endT - Math.min(...starts)) / 1000)}s`;
  }
}

let ticking = false;
function tick() {
  if (ticking) return;
  ticking = true;
  const loop = () => {
    const running = [...state.jobs.values()].filter((j) => j.status === "running");
    running.forEach(updateJobEl);
    updateOverall();
    if (running.length) requestAnimationFrame(loop);
    else ticking = false;
  };
  requestAnimationFrame(loop);
}

const isBusy = () => [...state.jobs.values()].some((j) => j.status === "running" || j.status === "queued");

// ================================================================ image requests
// Each of these sends exactly one request (= one image call).

async function drawJack() {
  const job = state.jobs.get("reference") || addJob("reference", "Jack (reference image)", "reference");
  startJob(job);
  refresh();
  try {
    const form = new FormData();
    form.append("photo", state.photo);
    const data = await api("POST", `/api/books/${state.book.id}/character`, { form });
    state.book.reference = { url: data.url, prompt: data.prompt };
    state.photoIsNew = false;
    $("jackPrompt").textContent = data.prompt;
    renderReference();
    endJob(job);
    return true;
  } catch (err) {
    endJob(job, err);
    $("jackError").textContent = err.message;
    return false;
  } finally {
    refresh();
  }
}

async function drawPage(page, { fix } = {}) {
  const key = `page-${page.id}`;
  const label = `Page ${page.number} · ${page.title}${fix ? " (edit)" : ""}`;
  const job = state.jobs.get(key) || addJob(key, label, "page");
  job.el.querySelector(".name").textContent = label;
  startJob(job);
  const card = document.querySelector(`.page-card[data-id="${page.id}"]`);
  card?.classList.add("drawing");
  card && (card.querySelector(".error").textContent = "");
  refresh();
  try {
    const url = fix
      ? `/api/books/${state.book.id}/pages/${page.id}/fix`
      : `/api/books/${state.book.id}/pages/${page.id}`;
    const data = await api("POST", url, fix ? { json: { instruction: fix } } : {});
    state.book.pages[page.id] = { url: data.url, prompt: data.prompt };
    endJob(job);
    if (card) {
      showPageImage(card, page);
      card.querySelector("pre").textContent = data.prompt;
      if (fix) card.querySelector(".fix-text").value = "";
    }
    return true;
  } catch (err) {
    endJob(job, err);
    if (card) card.querySelector(".error").textContent = err.message;
    return false;
  } finally {
    card?.classList.remove("drawing");
    refresh();
  }
}

// The whole book: Jack first (pages need him), then ALL pages in parallel.
$("generateBook").addEventListener("click", async () => {
  if (isBusy()) return;
  $("jackError").textContent = "";
  $("jobs").innerHTML = "";
  state.jobs.clear();

  const needJack = !state.book.reference || (state.photo && state.photoIsNew);
  if (needJack) addJob("reference", "Jack (reference image)", "reference");
  for (const p of state.story) addJob(`page-${p.id}`, `Page ${p.number} · ${p.title}`, "page");
  refresh();
  $("progressPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });

  if (needJack && !(await drawJack())) {
    for (const p of state.story) {
      const job = state.jobs.get(`page-${p.id}`);
      job.status = "skipped";
      updateJobEl(job);
    }
    updateOverall();
    refresh();
    return;
  }
  // Parallel: every page request goes out at once.
  await Promise.allSettled(state.story.map((p) => drawPage(p)));
});

$("makeJack").addEventListener("click", async () => {
  if (isBusy()) return;
  $("jackError").textContent = "";
  $("jobs").innerHTML = "";
  state.jobs.clear();
  addJob("reference", "Jack (reference image)", "reference");
  await drawJack();
});

// ================================================================ page cards
function showPageImage(card, page) {
  const frame = card.querySelector(".page-frame");
  frame.querySelector("img")?.remove();
  frame.querySelector(".placeholder")?.remove();
  const saved = state.book?.pages?.[page.id];
  if (saved) {
    const img = document.createElement("img");
    img.src = saved.url;
    img.alt = `Page ${page.number}: ${page.title}`;
    frame.prepend(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "placeholder";
    ph.textContent = "No picture yet";
    frame.prepend(ph);
  }
}

function renderPages() {
  const wrap = $("pages");
  wrap.innerHTML = "";
  for (const page of state.story) {
    const card = document.createElement("article");
    card.className = "page-card";
    card.dataset.id = page.id;
    const ta = page.textArea;
    card.innerHTML = `
      <h3>Page ${page.number} · ${page.title}</h3>
      <div class="page-frame">
        <div class="text-zone ${ta.position} ${ta.tone}" style="height:${ta.size * 100}%"><span></span></div>
        <div class="drawing-badge">Drawing…</div>
      </div>
      <div class="page-actions">
        <button class="gen secondary" disabled>Regenerate page ${page.number}</button>
      </div>
      <div class="fix-row">
        <input class="fix-text" maxlength="500" placeholder="Edit this page, e.g. “make the cow more visible in the doorway”" disabled />
        <button class="fix secondary" disabled>Edit this page</button>
      </div>
      <p class="error"></p>
      <details><summary>Prompt sent</summary><pre></pre></details>`;
    card.querySelector(".text-zone span").textContent = page.text;
    card.querySelector("pre").textContent = state.book?.pages?.[page.id]?.prompt || "(not sent yet)";
    card.querySelector(".gen").addEventListener("click", () => !isBusy() && drawPage(page));
    card.querySelector(".fix").addEventListener("click", () => {
      const text = card.querySelector(".fix-text").value.trim();
      if (text && !isBusy()) drawPage(page, { fix: text });
    });
    card.querySelector(".fix-text").addEventListener("input", refresh);
    showPageImage(card, page);
    wrap.appendChild(card);
  }
  refresh();
}

// ================================================================ enable/disable
function refresh() {
  if (!state.book) return;
  const busy = isBusy();
  const hasJack = Boolean(state.book.reference);

  const gen = $("generateBook");
  gen.disabled = busy || !(hasJack || state.photo);
  gen.textContent = busy
    ? "Drawing…"
    : hasJack && !state.photoIsNew
    ? "Generate the whole book (all pages)"
    : "Generate the whole book";
  $("makeJack").disabled = busy || !state.photo;

  document.querySelectorAll(".page-card").forEach((card) => {
    const id = card.dataset.id;
    const has = Boolean(state.book.pages[id]);
    const g = card.querySelector(".gen");
    g.disabled = busy || !hasJack;
    g.textContent = `${has ? "Regenerate" : "Generate"} page ${state.story.find((p) => p.id === id)?.number}`;
    const fixText = card.querySelector(".fix-text");
    fixText.disabled = busy || !has;
    card.querySelector(".fix").disabled = fixText.disabled || !fixText.value.trim();
  });

  const missing = state.story.filter((p) => !state.book.pages[p.id]).map((p) => p.number);
  const name = $("childName").value.trim();
  const dl = $("downloadPdf");
  if (!dl.dataset.busy) dl.disabled = busy || missing.length > 0 || !name || !hasJack;
  $("bookStatus").textContent = missing.length
    ? `Still to generate: page ${missing.join(", ")}.`
    : !name
    ? "Enter the child's name (step 1) for the About Me page."
    : `Ready: ${state.story.length} pages + About Me.`;
}

// ================================================================ PDF
// The image model never draws text. The story text is drawn HERE, in the PDF layer.
const PAGE_W = 792; // points (11 in): 3:2 landscape, matches the 1536x1024 art
const PAGE_H = 528; // points (7.33 in)

function toJpeg(src, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("couldn't load an image"));
    img.src = src;
  });
}

function drawStoryText(doc, page) {
  const { position, tone } = page.textArea;

  doc.setFont("times", "bold");
  let fontSize = 30;
  doc.setFontSize(fontSize);
  let lines = doc.splitTextToSize(page.text, PAGE_W - 110);
  if (lines.length > 2) {
    fontSize = 24;
    doc.setFontSize(fontSize);
    lines = doc.splitTextToSize(page.text, PAGE_W - 160);
  }
  const lineH = fontSize * 1.25;
  const textH = lines.length * lineH;
  const panelW = Math.min(PAGE_W - 80, Math.max(...lines.map((l) => doc.getTextWidth(l))) + 60);
  const panelH = textH + 26;
  const panelX = (PAGE_W - panelW) / 2;
  // Hug the page edge (top or bottom) so the panel covers as little art as possible.
  const EDGE = 18;
  const panelY = position === "top" ? EDGE : PAGE_H - EDGE - panelH;

  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: tone === "dark" ? 0.5 : 0.72 }));
  if (tone === "dark") doc.setFillColor(10, 12, 30);
  else doc.setFillColor(255, 250, 240);
  doc.roundedRect(panelX, panelY, panelW, panelH, 14, 14, "F");
  doc.restoreGraphicsState();

  if (tone === "dark") doc.setTextColor(255, 246, 224);
  else doc.setTextColor(43, 35, 24);
  const firstBaseline = panelY + 13 + fontSize * 0.95;
  lines.forEach((line, i) => doc.text(line, PAGE_W / 2, firstBaseline + i * lineH, { align: "center" }));

  doc.setFont("times", "normal");
  doc.setFontSize(11);
  const corner = position === "bottom" ? 18 : PAGE_H - 12;
  doc.text(String(page.number), PAGE_W - 22, corner, { align: "right" });
}

async function drawAboutMe(doc) {
  const name = $("childName").value.trim();
  const age = $("childAge").value.trim();
  const favorites = $("childFavorites").value.trim();
  const about = $("childAbout").value.trim();

  doc.setFillColor(246, 241, 228);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  const imgH = PAGE_H - 80;
  const imgW = (imgH * 2) / 3;
  doc.addImage(await toJpeg(state.book.reference.url), "JPEG", 40, 40, imgW, imgH);

  const x = 40 + imgW + 40;
  const maxW = PAGE_W - x - 40;
  let y = 90;

  doc.setTextColor(63, 125, 58);
  doc.setFont("times", "bold");
  doc.setFontSize(40);
  doc.text("About Me", x, y);
  y += 50;

  doc.setTextColor(43, 42, 34);
  doc.setFontSize(28);
  doc.splitTextToSize(name, maxW).forEach((l) => {
    doc.text(l, x, y);
    y += 32;
  });
  y += 10;

  const field = (label, value) => {
    if (!value) return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(109, 106, 92);
    doc.text(label.toUpperCase(), x, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.setTextColor(43, 42, 34);
    doc.splitTextToSize(value, maxW).forEach((l) => {
      doc.text(l, x, y);
      y += 19;
    });
    y += 14;
  };
  field("Age", age);
  field("Favorite things", favorites);
  field("About me", about);

  doc.setFont("times", "italic");
  doc.setFontSize(12);
  doc.setTextColor(109, 106, 92);
  doc.text(`Starring ${name} as Jack`, x, PAGE_H - 40);
}

$("downloadPdf").addEventListener("click", async () => {
  const btn = $("downloadPdf");
  btn.dataset.busy = "1";
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Building PDF…";
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [PAGE_W, PAGE_H] });
    doc.setProperties({ title: "Jack and the Beanstalk", subject: `Starring ${$("childName").value.trim()}` });
    for (const [i, page] of state.story.entries()) {
      if (i > 0) doc.addPage([PAGE_W, PAGE_H], "landscape");
      doc.addImage(await toJpeg(state.book.pages[page.id].url), "JPEG", 0, 0, PAGE_W, PAGE_H); // full bleed
      drawStoryText(doc, page);
    }
    doc.addPage([PAGE_W, PAGE_H], "landscape");
    await drawAboutMe(doc);
    doc.save("JackAndTheBeanstalk.pdf");
    api("POST", `/api/books/${state.book.id}/events`, { json: { type: "pdf_downloaded" } }).catch(() => {});
  } catch (err) {
    $("bookStatus").textContent = `Couldn't build the PDF: ${err.message}`;
  } finally {
    delete btn.dataset.busy;
    btn.textContent = label;
    refresh();
  }
});

// ================================================================ start
async function init() {
  const params = new URLSearchParams(location.search);
  const login = params.get("login");
  if (login) {
    $("loginNotice").hidden = false;
    $("loginNotice").textContent =
      login === "cancelled" ? "Sign-in was cancelled." : "Sign-in didn't work. Please try again.";
    params.delete("login");
    history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : ""));
  }

  const [story, status, me] = await Promise.all([
    fetch("/api/book").then((r) => r.json()),
    fetch("/api/status").then((r) => r.json()),
    fetch("/api/me").then((r) => r.json()),
  ]);
  state.story = story.pages;
  state.status = { ...status, loginConfigured: me.loginConfigured };
  if (!status.keyConfigured && !status.mock) $("keyWarning").hidden = false;
  if (status.mock) $("mockWarning").hidden = false;

  if (!me.user) return showSignedOut();
  state.me = me.user;
  renderUserBar();

  const bookId = Number(params.get("book"));
  if (bookId) {
    try {
      await openBook(bookId);
      return;
    } catch {
      /* fall through to the library */
    }
  }
  openLibrary();
}
init();
