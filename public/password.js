// Password bar for image generation. The real check happens on the server;
// this only collects the password and sends it with each generate request.
(function () {
  const KEY = "beanstalk-password";
  let password = "";
  try {
    password = sessionStorage.getItem(KEY) || "";
  } catch {}

  const bar = document.getElementById("pwBar");

  function save(value) {
    password = value;
    try {
      if (value) sessionStorage.setItem(KEY, value);
      else sessionStorage.removeItem(KEY);
    } catch {}
  }

  function renderLocked(message) {
    bar.className = "pw-bar locked";
    bar.innerHTML = `
      <span>🔒 Generating images needs a password.</span>
      <form class="pw-form">
        <input type="password" placeholder="Password" autocomplete="current-password" aria-label="Password" />
        <button type="submit">Unlock</button>
      </form>
      <span class="pw-msg"></span>`;
    bar.querySelector(".pw-msg").textContent = message || "";
    bar.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const value = bar.querySelector("input").value;
      if (!value) return;
      const res = await fetch("/api/check-password", { method: "POST", headers: { "x-app-password": value } });
      if (res.ok) {
        save(value);
        renderUnlocked();
      } else {
        const data = await res.json().catch(() => ({}));
        renderLocked(data.error || "Wrong password.");
      }
    });
  }

  function renderUnlocked() {
    bar.className = "pw-bar unlocked";
    bar.innerHTML = `<span>🔓 Unlocked. You can generate images.</span> <button type="button" class="link">Lock</button>`;
    bar.querySelector("button").addEventListener("click", () => {
      save("");
      renderLocked();
    });
  }

  window.appAuth = {
    headers: () => (password ? { "x-app-password": password } : {}),
    // Call with the server's error JSON. Re-locks the bar if the password was rejected.
    handleError(data) {
      if (data && data.needPassword) {
        save("");
        renderLocked(data.error);
        bar.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
  };

  fetch("/api/status")
    .then((r) => r.json())
    .then((status) => {
      if (!status.passwordRequired) return; // no password set on the server
      bar.hidden = false;
      if (password) renderUnlocked();
      else renderLocked();
    })
    .catch(() => {});
})();
