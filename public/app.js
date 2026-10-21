const photoInput = document.getElementById("photo");
const preview = document.getElementById("preview");
const dropText = document.getElementById("dropText");
const scenesEl = document.getElementById("scenes");

let photoFile = null;

// Shared by upload and camera: whatever the source, it becomes the photo we send.
function setPhoto(file) {
  if (!file) return;
  photoFile = file;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  dropText.hidden = true;
  updateButtons();
}

photoInput.addEventListener("change", () => setPhoto(photoInput.files[0]));

// ---------- Take a photo with the camera ----------
const drop = document.getElementById("drop");
const cameraBox = document.getElementById("camera");
const video = document.getElementById("video");
const takePhotoBtn = document.getElementById("takePhoto");
const snapBtn = document.getElementById("snap");
const cancelCamBtn = document.getElementById("cancelCam");
const cameraFallback = document.getElementById("cameraFallback");
const cameraError = document.getElementById("cameraError");
let stream = null;

function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  cameraBox.hidden = true;
  drop.hidden = false;
  takePhotoBtn.hidden = false;
}

takePhotoBtn.addEventListener("click", async () => {
  cameraError.textContent = "";
  // Browsers without in-page camera support: let the phone's own camera app take the photo.
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraFallback.click();
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = stream;
    cameraBox.hidden = false;
    drop.hidden = true;
    takePhotoBtn.hidden = true;
  } catch (err) {
    stopCamera();
    cameraError.textContent =
      err.name === "NotAllowedError"
        ? "Camera access was blocked. Allow the camera in your browser settings, or upload a photo instead."
        : "Couldn't open a camera on this device. You can upload a photo instead.";
  }
});

snapBtn.addEventListener("click", () => {
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

cancelCamBtn.addEventListener("click", stopCamera);
cameraFallback.addEventListener("change", () => setPhoto(cameraFallback.files[0]));

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
