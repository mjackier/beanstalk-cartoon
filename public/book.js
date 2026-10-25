// Storybook front end. Every button press makes at most ONE request, and each
// request makes ONE image call on the server. Nothing here loops or retries.

const $ = (id) => document.getElementById(id);

const state = {
  photo: null, // File: the uploaded or captured photo
  reference: null, // data URL: the ONE character image reused on every page
  pages: [], // [{ id, number, title, text, textArea }] from the server
  images: {}, // pageId -> data URL
};

// ---------------------------------------------------------------- photo
function setPhoto(file) {
  if (!file) return;
  state.photo = file;
  $("preview").src = URL.createObjectURL(file);
  $("preview").hidden = false;
  $("dropText").hidden = true;
  // A new child means a new Jack: old reference and pages no longer match.
  if (state.reference) {
    state.reference = null;
    state.images = {};
    $("refFrame").textContent = "New photo: create Jack again";
    renderPages();
  }
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

// ---------------------------------------------------------------- helpers
async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

async function post(url, form) {
  const res = await fetch(url, { method: "POST", body: form });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server error (${res.status}).`);
  }
  if (!res.ok) throw new Error(data.error || "Generation failed.");
  return data;
}

function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label;
    button.dataset.busy = "1";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    delete button.dataset.busy;
  }
}

// ---------------------------------------------------------------- step 2: Jack
$("makeJack").addEventListener("click", async () => {
  const btn = $("makeJack");
  $("jackError").textContent = "";
  setBusy(btn, true, "Drawing Jack… (up to a minute)");
  $("refFrame").innerHTML = '<div><div class="spinner"></div>Drawing Jack…</div>';
  try {
    const form = new FormData();
    form.append("photo", state.photo);
    const data = await post("/api/book/character", form);
    state.reference = data.image;
    $("refFrame").innerHTML = "";
    const img = document.createElement("img");
    img.src = data.image;
    img.alt = "Character reference: the child as Jack";
    $("refFrame").appendChild(img);
    $("jackPrompt").textContent = data.prompt;
    btn.dataset.label = "Create Jack again";
  } catch (err) {
    $("refFrame").textContent = "No Jack yet";
    $("jackError").textContent = err.message;
  } finally {
    setBusy(btn, false);
    refresh();
  }
});

// ---------------------------------------------------------------- step 3: pages
function showPageImage(card, page) {
  const frame = card.querySelector(".page-frame");
  frame.querySelector("img")?.remove();
  frame.querySelector(".placeholder")?.remove();
  if (state.images[page.id]) {
    const img = document.createElement("img");
    img.src = state.images[page.id];
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
  for (const page of state.pages) {
    const card = document.createElement("article");
    card.className = "page-card";
    card.dataset.id = page.id;
    const ta = page.textArea;
    card.innerHTML = `
      <h3>Page ${page.number} · ${page.title}</h3>
      <div class="page-frame">
        <div class="text-zone ${ta.position} ${ta.tone}" style="height:${ta.size * 100}%"><span></span></div>
      </div>
      <div class="page-actions">
        <button class="gen" disabled>Generate page ${page.number}</button>
      </div>
      <div class="fix-row">
        <input class="fix-text" maxlength="500" placeholder="Edit this page, e.g. “make the cow more visible in the doorway”" disabled />
        <button class="fix secondary" disabled>Edit this page</button>
      </div>
      <p class="error"></p>
      <details><summary>Prompt sent</summary><pre>(not sent yet)</pre></details>`;
    card.querySelector(".text-zone span").textContent = page.text; // textContent: no HTML injection
    card.querySelector(".gen").addEventListener("click", () => generatePage(page, card));
    card.querySelector(".fix").addEventListener("click", () => fixPage(page, card));
    card.querySelector(".fix-text").addEventListener("input", refresh);
    showPageImage(card, page);
    wrap.appendChild(card);
  }
  refresh();
}

async function generatePage(page, card) {
  const btn = card.querySelector(".gen");
  const errorEl = card.querySelector(".error");
  errorEl.textContent = "";
  setBusy(btn, true, "Drawing… (up to a minute)");
  try {
    const form = new FormData();
    form.append("pageId", page.id);
    form.append("reference", await dataUrlToBlob(state.reference), "reference.png");
    const data = await post("/api/book/page", form);
    state.images[page.id] = data.image;
    showPageImage(card, page);
    card.querySelector("pre").textContent = data.prompt;
    btn.dataset.label = `Regenerate page ${page.number}`;
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    setBusy(btn, false);
    refresh();
  }
}

// Image EDIT endpoint: same picture, one thing changed.
async function fixPage(page, card) {
  const btn = card.querySelector(".fix");
  const input = card.querySelector(".fix-text");
  const errorEl = card.querySelector(".error");
  errorEl.textContent = "";
  setBusy(btn, true, "Editing…");
  try {
    const form = new FormData();
    form.append("pageId", page.id);
    form.append("instruction", input.value.trim());
    form.append("page", await dataUrlToBlob(state.images[page.id]), "page.png");
    form.append("reference", await dataUrlToBlob(state.reference), "reference.png");
    const data = await post("/api/book/fix", form);
    state.images[page.id] = data.image;
    showPageImage(card, page);
    card.querySelector("pre").textContent = data.prompt;
    input.value = "";
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    setBusy(btn, false);
    refresh();
  }
}

// ---------------------------------------------------------------- enable/disable
function refresh() {
  const makeJack = $("makeJack");
  if (!makeJack.dataset.busy) makeJack.disabled = !state.photo;

  document.querySelectorAll(".page-card").forEach((card) => {
    const id = card.dataset.id;
    const gen = card.querySelector(".gen");
    const fix = card.querySelector(".fix");
    const fixText = card.querySelector(".fix-text");
    if (!gen.dataset.busy) gen.disabled = !state.reference;
    fixText.disabled = !state.images[id] || !state.reference;
    if (!fix.dataset.busy) fix.disabled = fixText.disabled || !fixText.value.trim();
  });

  const missing = state.pages.filter((p) => !state.images[p.id]).map((p) => p.number);
  const name = $("childName").value.trim();
  const dl = $("downloadPdf");
  if (!dl.dataset.busy) dl.disabled = missing.length > 0 || !name;
  $("bookStatus").textContent = missing.length
    ? `Still to generate: page ${missing.join(", ")}.`
    : !name
    ? "Enter the child's name (step 1) for the About Me page."
    : `Ready: ${state.pages.length} pages + About Me.`;
}
["childName", "childAge", "childFavorites", "childAbout"].forEach((id) => $(id).addEventListener("input", refresh));

// ---------------------------------------------------------------- PDF
// The image model never draws text. The story text is drawn HERE, in the PDF layer.
const PAGE_W = 792; // points (11 in) — 3:2 landscape, matches the 1536x1024 art
const PAGE_H = 528; // points (7.33 in)

// Big PNGs -> JPEG keeps the PDF small enough to download and share.
function toJpeg(dataUrl, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function drawStoryText(doc, page) {
  const { position, size, tone } = page.textArea;
  const zoneH = PAGE_H * size;
  const zoneTop = position === "top" ? 0 : PAGE_H - zoneH;

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
  const panelY = zoneTop + (zoneH - panelH) / 2;

  // Soft panel behind the text so it reads on any art.
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

  // Page number
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

  // The child as Jack (the reference image), 2:3 portrait
  const imgH = PAGE_H - 80;
  const imgW = (imgH * 2) / 3;
  doc.addImage(await toJpeg(state.reference), "JPEG", 40, 40, imgW, imgH);

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
  setBusy(btn, true, "Building PDF…");
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [PAGE_W, PAGE_H] });
    doc.setProperties({ title: "Jack and the Beanstalk", subject: `Starring ${$("childName").value.trim()}` });
    for (const [i, page] of state.pages.entries()) {
      if (i > 0) doc.addPage([PAGE_W, PAGE_H], "landscape");
      doc.addImage(await toJpeg(state.images[page.id]), "JPEG", 0, 0, PAGE_W, PAGE_H); // full bleed
      drawStoryText(doc, page);
    }
    doc.addPage([PAGE_W, PAGE_H], "landscape");
    await drawAboutMe(doc);
    doc.save("JackAndTheBeanstalk.pdf");
  } catch (err) {
    $("bookStatus").textContent = `Couldn't build the PDF: ${err.message}`;
  } finally {
    setBusy(btn, false);
    refresh();
  }
});

// ---------------------------------------------------------------- start
async function init() {
  const [book, status] = await Promise.all([
    fetch("/api/book").then((r) => r.json()),
    fetch("/api/status").then((r) => r.json()),
  ]);
  if (!status.keyConfigured && !status.mock) $("keyWarning").hidden = false;
  if (status.mock) $("mockWarning").hidden = false;
  state.pages = book.pages;
  renderPages();
}
init();
