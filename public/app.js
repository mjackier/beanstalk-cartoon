const photoInput = document.getElementById("photo");
const preview = document.getElementById("preview");
const dropText = document.getElementById("dropText");
const scenesEl = document.getElementById("scenes");

let photoFile = null;

photoInput.addEventListener("change", () => {
  photoFile = photoInput.files[0] || null;
  if (photoFile) {
    preview.src = URL.createObjectURL(photoFile);
    preview.hidden = false;
    dropText.hidden = true;
  }
  updateButtons();
});

function getSettings() {
  return {
    style: document.getElementById("style").value,
    exaggeration: document.getElementById("exaggeration").value,
    outline: document.getElementById("outline").value,
    palette: document.getElementById("palette").value,
  };
}

function updateButtons() {
  document.querySelectorAll(".scene button").forEach((b) => {
    if (!b.dataset.busy) b.disabled = !photoFile;
  });
}

// One click = one request = one API call. No loops, no retries.
async function generate(sceneId, card) {
  const button = card.querySelector("button");
  const frame = card.querySelector(".frame");
  const caption = card.querySelector("figcaption");
  const errorEl = card.querySelector(".error");
  const promptEl = card.querySelector("pre");

  button.disabled = true;
  button.dataset.busy = "1";
  errorEl.textContent = "";
  frame.innerHTML = '<div><div class="spinner"></div>Drawing… this can take up to a minute</div>';

  const form = new FormData();
  form.append("photo", photoFile);
  form.append("scene", sceneId);
  for (const [k, v] of Object.entries(getSettings())) form.append(k, v);

  try {
    const res = await fetch("/api/generate", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Generation failed.");

    frame.innerHTML = "";
    const img = document.createElement("img");
    img.src = data.image;
    img.alt = data.caption;
    frame.appendChild(img);
    caption.textContent = data.caption;
    promptEl.textContent = data.prompt;
  } catch (err) {
    frame.textContent = "No image yet";
    errorEl.textContent = err.message;
  } finally {
    delete button.dataset.busy;
    button.disabled = !photoFile;
  }
}

async function init() {
  const [scenes, status] = await Promise.all([
    fetch("/api/scenes").then((r) => r.json()),
    fetch("/api/status").then((r) => r.json()),
  ]);

  if (!status.keyConfigured) document.getElementById("keyWarning").hidden = false;

  for (const [id, scene] of Object.entries(scenes)) {
    const card = document.createElement("figure");
    card.className = "scene";
    card.style.margin = "0";
    card.innerHTML = `
      <div class="label">${scene.title}</div>
      <div class="frame">No image yet</div>
      <figcaption>${scene.spec}</figcaption>
      <button disabled>Generate this scene</button>
      <div class="error"></div>
      <details><summary>Full prompt sent</summary><pre>(generate to see it)</pre></details>
    `;
    card.querySelector("button").addEventListener("click", () => generate(id, card));
    scenesEl.appendChild(card);
  }
  updateButtons();
}

init();
