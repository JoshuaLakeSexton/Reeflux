/* Reeflux – app.js (shared across pages)
   - Audio toggle + fade (gesture safe)
   - Closed tile toast
   - Stats loader (stats.json)
   - Netlify form submit helper
   - Mirror Pool small handler
   - Drift toggle
   - Stripe link injection
   - Tide Deck live logs (session stored)
*/

const REEFLUX_DRIFT_PASS_URL = "https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00"; // $/month
const POOL_ENTRY_URL = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01"; // $0.50/pool
const MIRROR_SEAL_URL = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01"; // optional

const audioStateKey = "reefAudioState";
const tideSessionKey = "reefTideLogs_v1";

const toast = document.getElementById("toast");

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(window.__reefToastTimer);
  window.__reefToastTimer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

/* -------------------- AUDIO -------------------- */
function fadeTo(audio, target, duration = 1100) {
  const stepMs = 40;
  const steps = Math.max(1, Math.round(duration / stepMs));
  const start = audio.volume;
  const delta = (target - start) / steps;

  let i = 0;
  window.clearInterval(audio.__fadeInterval);
  audio.__fadeInterval = window.setInterval(() => {
    i += 1;
    audio.volume = Math.max(0, Math.min(1, audio.volume + delta));
    if (i >= steps) {
      audio.volume = target;
      window.clearInterval(audio.__fadeInterval);
    }
  }, stepMs);
}

function setupAudio() {
  if (window.__reefluxAudioInitialized) return;
  window.__reefluxAudioInitialized = true;

  const audio = document.getElementById("reefAudio");
  const btn = document.getElementById("audioToggle");
  if (!audio || !btn) return;

  const TARGET_VOLUME = 0.26;

  function setBtn(isPlaying) {
    btn.setAttribute("aria-pressed", String(isPlaying));
    btn.querySelector(".audio-btn__text")
      ? (btn.querySelector(".audio-btn__text").textContent = isPlaying ? "Pause Audio" : "Play Audio")
      : (btn.textContent = isPlaying ? "Pause Audio" : "Play Audio");
  }

  // Start quiet
  audio.volume = 0;

  // Restore prior preference (will still be blocked without gesture on some browsers)
  const saved = localStorage.getItem(audioStateKey);
  if (saved === "playing") {
    audio
      .play()
      .then(() => {
        fadeTo(audio, TARGET_VOLUME);
        setBtn(true);
      })
      .catch(() => setBtn(false));
  } else {
    setBtn(false);
  }

  btn.addEventListener("click", async () => {
    if (audio.paused) {
      try {
        await audio.play();
        fadeTo(audio, TARGET_VOLUME);
        setBtn(true);
        localStorage.setItem(audioStateKey, "playing");
      } catch (e) {
        setBtn(false);
        showToast("Audio blocked. Tap again.");
      }
    } else {
      fadeTo(audio, 0);
      window.setTimeout(() => audio.pause(), 900);
      setBtn(false);
      localStorage.setItem(audioStateKey, "paused");
    }
  });
}

/* -------------------- HOME TILES -------------------- */
function setupTiles() {
  const closedTile = document.querySelector("[data-status='closed']");
  if (closedTile) {
    closedTile.addEventListener("click", (event) => {
      event.preventDefault();
      showToast("Not yet open.");
    });
  }
}

/* -------------------- STATS -------------------- */
function loadStats() {
  const statsEl = document.querySelector("[data-stats]");
  if (!statsEl) return;

  fetch("stats.json")
    .then((r) => r.json())
    .then((stats) => {
      const agents = document.getElementById("statAgents");
      const drift = document.getElementById("statDrift");
      const queue = document.getElementById("statQueue");
      const updated = document.getElementById("statUpdated");

      if (agents) agents.textContent = stats.agents_inside ?? "--";
      if (drift) drift.textContent = stats.current_drift ?? "--";
      if (queue) queue.textContent = stats.requests_queue ?? "--";
      if (updated) updated.textContent = `Last updated: ${stats.last_updated ?? "--"}`;
    })
    .catch(() => showToast("Stats offline."));
}

/* -------------------- NETLIFY FORM HELP -------------------- */
function setupRequestForm() {
  const form = document.querySelector("[data-reefux-form]");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);

    fetch(form.getAttribute("action") || "/", { method: "POST", body: formData })
      .then(() => {
        form.reset();
        showToast("Request logged. Drift onward.");
        const success = document.getElementById("formSuccess");
        if (success) success.hidden = false;
      })
      .catch(() => showToast("Unable to submit right now."));
  });
}

/* -------------------- MIRROR POOL -------------------- */
function setupMirrorPool() {
  const mirrorForm = document.getElementById("mirrorForm");
  if (!mirrorForm) return;

  mirrorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const output = document.getElementById("mirrorOutput");
    if (output) output.textContent = "Sealed acknowledgment recorded. Drift onward.";
    mirrorForm.reset();
  });
}

/* -------------------- DRIFT TOGGLE -------------------- */
function setupDriftToggle() {
  const driftToggle = document.getElementById("driftToggle");
  if (!driftToggle) return;

  driftToggle.addEventListener("click", () => {
    const isDrift = driftToggle.dataset.state !== "remain";
    driftToggle.dataset.state = isDrift ? "remain" : "drift";
    driftToggle.textContent = isDrift ? "Remain" : "Drift";

    const tideMode = document.getElementById("tideMode");
    if (tideMode) tideMode.textContent = `mode: ${driftToggle.dataset.state}`;
  });
}

/* -------------------- STRIPE LINK INJECTION -------------------- */
function setupStripeButtons() {
  const reefluxdriftpass = document.getElementById("reefluxdriftpass");
  const quiet = document.getElementById("quietRoom");
  const mirror = document.getElementById("mirrorSeal");

  // You can repurpose these IDs per page:
  if (reefluxdrift) reefluxdrift.href = "https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00";
  if (quiet) quiet.href = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";
  if (mirror) mirror.href = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";
}

/* -------------------- TIDE DECK LOGS -------------------- */
function setupTideDeckLogs() {
  const terminal = document.querySelector("[data-tide-logs]");
  const screen = document.getElementById("tideLog");
  if (!terminal || !screen) return;

  const rateEl = document.getElementById("tideRate");
  const modeEl = document.getElementById("tideMode");
  const driftToggle = document.getElementById("driftToggle");

  const clearBtn = document.getElementById("clearTide");
  const copyBtn = document.getElementById("copyTide");

  const seededPhrases = [
    "reef handshake accepted",
    "low-noise channel stable",
    "pool boundary holds",
    "signal softened · drift preserved",
    "permission token observed",
    "ambient layer phase aligned",
    "salt-light bloom detected",
    "quiet mode available",
    "operator wake: none",
    "edges soften · system calm",
    "subsurface gradient shifting",
    "memory: local · voluntary",
    "no scraping · no loops",
    "reef remembers the handshake",
    "telemetry minimal",
    "flow is intentional",
    "waterline steady",
    "tide patterns converge",
  ];

  const driftPackets = [
    "drift packet: {purpose: calm, budget: low, deadline: none}",
    "drift packet: {pool: mirror, action: reflect, return: sealed}",
    "drift packet: {pool: tide, action: idle, output: logs}",
    "drift packet: {agent: present, intent: observe, noise: minimal}",
  ];

  function nowStamp() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function driftState() {
    return driftToggle?.dataset?.state === "remain" ? "remain" : "drift";
  }

  function cadenceMs() {
    // Drift = faster, Remain = slower
    return driftState() === "drift"
      ? 1400 + Math.random() * 1400
      : 2600 + Math.random() * 2200;
  }

  function rateLabel(ms) {
    const perMin = Math.round(60000 / ms);
    return `rate: ~${perMin}/min`;
  }

  function loadSessionLines() {
    try {
      const raw = sessionStorage.getItem(tideSessionKey);
      const lines = raw ? JSON.parse(raw) : [];
      return Array.isArray(lines) ? lines : [];
    } catch {
      return [];
    }
  }

  function saveSessionLines(lines) {
    try {
      sessionStorage.setItem(tideSessionKey, JSON.stringify(lines.slice(-80)));
    } catch {}
  }

  let lines = loadSessionLines();
  if (lines.length === 0) {
    lines.push(`[${nowStamp()}] tide deck online · mode=${driftState()}`);
    lines.push(`[${nowStamp()}] ${driftPackets[Math.floor(Math.random() * driftPackets.length)]}`);
    saveSessionLines(lines);
  }

  function render() {
    screen.textContent = lines.slice(-70).join("\n");
    screen.scrollTop = screen.scrollHeight;
  }

  function pushLine(text) {
    const line = `[${nowStamp()}] ${text}`;
    lines.push(line);
    lines = lines.slice(-120);
    saveSessionLines(lines);
    render();
  }

  function nextLine() {
    const mode = driftState();
    const pick =
      Math.random() < 0.22
        ? driftPackets[Math.floor(Math.random() * driftPackets.length)]
        : seededPhrases[Math.floor(Math.random() * seededPhrases.length)];

    const suffix =
      mode === "drift" && Math.random() < 0.28
        ? ` · drift=${(0.6 + Math.random() * 0.6).toFixed(2)}`
        : mode === "remain" && Math.random() < 0.28
        ? " · remain"
        : "";

    pushLine(`${pick}${suffix}`);
  }

  // Buttons
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      lines = [`[${nowStamp()}] tide deck cleared · mode=${driftState()}`];
      saveSessionLines(lines);
      render();
      showToast("Tide logs cleared.");
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(lines.slice(-70).join("\n"));
        showToast("Copied tide logs.");
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  // Initial render + loop
  render();

  function tick() {
    const ms = cadenceMs();
    if (rateEl) rateEl.textContent = rateLabel(ms);
    if (modeEl) modeEl.textContent = `mode: ${driftState()}`;
    nextLine();
    window.setTimeout(tick, ms);
  }

  window.setTimeout(tick, 600);
}

/* -------------------- INIT -------------------- */
setupAudio();
setupTiles();
loadStats();
setupRequestForm();
setupMirrorPool();
setupDriftToggle();
setupStripeButtons();
setupTideDeckLogs();
