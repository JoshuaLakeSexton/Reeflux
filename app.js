/* app.js (Reeflux.com) */
/*
  Reeflux – app.js (shared across pages)
  - Audio toggle + fade (gesture safe)
  - Closed tile toast
  - Stats loader (stats.json)
  - Netlify form submit helper
  - Mirror Pool small handler
  - Drift toggle
  - Stripe link injection (data-stripe)
  - Tide Deck live logs (session stored)
*/

"use strict";

/* -------------------- STRIPE LINKS -------------------- */
const REEFLUX_DRIFT_PASS_URL = "https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00"; // $/month
const POOL_ENTRY_URL = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";         // $0.50/pool
const MIRROR_SEAL_URL = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";        // optional

/* -------------------- KEYS -------------------- */
const audioStateKey = "reefAudioState";
const tideSessionKey = "reefTideLogs_v1";

/* -------------------- TOAST -------------------- */
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
    const textEl = btn.querySelector?.(".audio-btn__text");
    const label = isPlaying ? "Pause Audio" : "Play Audio";
    if (textEl) textEl.textContent = label;
    else btn.textContent = label;
  }

  // Start quiet
  audio.volume = 0;

  const saved = localStorage.getItem(audioStateKey);
  if (saved === "playing") {
    audio.play()
      .then(() => { fadeTo(audio, TARGET_VOLUME); setBtn(true); })
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
      } catch {
        setBtn(false);
        showToast("Audio blocked. Tap again.");
      }
    } else {
      const fadeMs = 900;
      fadeTo(audio, 0, fadeMs);
      window.setTimeout(() => audio.pause(), fadeMs);
      setBtn(false);
      localStorage.setItem(audioStateKey, "paused");
    }
  });
}

/* -------------------- HOME TILES -------------------- */
function setupTiles() {
  const closedTiles = document.querySelectorAll("[data-status='closed']");
  if (!closedTiles || closedTiles.length === 0) return;

  closedTiles.forEach((tile) => {
    tile.addEventListener("click", (event) => {
      event.preventDefault();
      showToast("Not yet open.");
    });
  });
}

/* -------------------- STATS -------------------- */
function loadStats() {
  const statsEl = document.querySelector("[data-stats]");
  if (!statsEl) return;

  fetch("/stats.json")
    .then((r) => {
      if (!r.ok) throw new Error("stats");
      return r.json();
    })
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
  const form = document.querySelector("[data-reeflux-form]");
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
    const isCurrentlyDrift = driftToggle.dataset.state !== "remain";
    driftToggle.dataset.state = isCurrentlyDrift ? "remain" : "drift";
    driftToggle.textContent = isCurrentlyDrift ? "Remain" : "Drift";

    const tideMode = document.getElementById("tideMode");
    if (tideMode) tideMode.textContent = `mode: ${driftToggle.dataset.state}`;
  });
}

/* -------------------- STRIPE LINK INJECTION -------------------- */
/*
  Use data-stripe attributes instead of fragile IDs.
  Examples:
    <a data-stripe="driftpass" href="#">Get Drift Pass</a>
    <a data-stripe="poolentry" href="#">Enter Pool</a>
    <a data-stripe="mirror" href="#">Seal Mirror</a>
*/
function setupStripeButtons() {
  const map = {
    driftpass: REEFLUX_DRIFT_PASS_URL,
    poolentry: POOL_ENTRY_URL,
    mirror: MIRROR_SEAL_URL,
  };

  document.querySelectorAll("[data-stripe]").forEach((el) => {
    const key = (el.getAttribute("data-stripe") || "").toLowerCase().trim();
    const url = map[key];
    if (url) el.setAttribute("href", url);
  });
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
    return driftState() === "drift"
      ? 1400 + Math.random() * 1400
      : 2600 + Math.random() * 2200;
  }

  function rateLabel(ms) {
    const perMin = Math.max(1, Math.round(60000 / ms));
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

  render();

  (function tick() {
    const ms = cadenceMs();
    if (rateEl) rateEl.textContent = rateLabel(ms);
    if (modeEl) modeEl.textContent = `mode: ${driftState()}`;
    nextLine();
    window.setTimeout(tick, ms);
  })();
}/* -------------------- AMBIENT POOL -------------------- */
function setupAmbientPool() {
  const root = document.querySelector("[data-pool='ambient']");
  if (!root) return;

  const audio = document.getElementById("reefAudio");
  const intensity = document.getElementById("ambientIntensity");
  const mode = document.getElementById("ambientMode");
  const visual = document.getElementById("ambientVisual");

  if (intensity && audio) {
    intensity.addEventListener("input", () => {
      const v = Number(intensity.value || 0);
      audio.volume = Math.max(0, Math.min(1, v));
    });
  }

  if (mode && audio) {
    mode.addEventListener("change", () => {
      const val = String(mode.value || "reef");
      // NOTE: add these audio files if you want multiple tracks
      const map = {
        reef: "/assets/reeflux.mp3",
        white: "/assets/white-noise.mp3",
        ocean: "/assets/ocean.mp3",
      };
      const src = map[val] || map.reef;
      const source = audio.querySelector("source");
      if (source) source.src = src;
      audio.load();
      audio.play().catch(() => showToast("Audio blocked. Tap Play Audio."));
    });
  }

  if (visual && intensity) {
    intensity.addEventListener("input", () => {
      const v = Number(intensity.value || 0.25);
      const speed = 40 - Math.round(v * 30); // higher intensity = faster
      visual.style.animationDuration = `${Math.max(10, speed)}s`;
    });
  }
}

/* -------------------- FRACTAL POOL (lightweight canvas) -------------------- */
function setupFractalPool() {
  const root = document.querySelector("[data-pool='fractal']");
  if (!root) return;

  const canvas = document.getElementById("fractalCanvas");
  const complexity = document.getElementById("fractalComplexity");
  const recenter = document.getElementById("fractalRecenter");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  let t = 0;
  let seed = Math.random() * 1000;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;

    const k = Number(complexity?.value || 22); // 10..40
    ctx.clearRect(0, 0, w, h);

    // Simple Fibonacci-like spiral points with gentle drift
    const cx = w * 0.5;
    const cy = h * 0.5;
    const phi = 1.61803398875;

    for (let i = 0; i < k * 18; i++) {
      const a = i * (Math.PI / phi) + t * 0.002;
      const r = 0.8 * Math.sqrt(i) * (2 + (k / 40) * 4);
      const x = cx + Math.cos(a + seed) * r;
      const y = cy + Math.sin(a + seed) * r;

      const alpha = 0.06 + (i / (k * 18)) * 0.16;
      ctx.fillStyle = `rgba(230,227,216,${alpha})`;
      ctx.fillRect(x, y, 1.2, 1.2);
    }

    t += 1;
    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(draw);

  if (recenter) {
    recenter.addEventListener("click", () => {
      seed = Math.random() * 1000;
      showToast("Recentered.");
    });
  }
}

/* -------------------- SANDBOX POOL -------------------- */
function setupSandboxPool() {
  const root = document.querySelector("[data-pool='sandbox']");
  if (!root) return;

  const area = document.getElementById("sandboxArea");
  const wipe = document.getElementById("sandboxWipe");
  const copy = document.getElementById("sandboxCopy");

  if (wipe && area) {
    wipe.addEventListener("click", () => {
      area.value = "";
      showToast("Cleared.");
    });
  }
  if (copy && area) {
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(area.value || "");
        showToast("Copied.");
      } catch {
        showToast("Copy blocked.");
      }
    });
  }
}

/* -------------------- SIGNAL POOL (stub) -------------------- */
function setupSignalPool() {
  const root = document.querySelector("[data-pool='signal']");
  if (!root) return;

  const ping = document.getElementById("signalPing");
  if (ping) {
    ping.addEventListener("click", () => {
      showToast("No signal. Not always active.");
    });
  }
}
/* ====== ADD THIS TO app.js ======
   Soft gate: hides pool content unless reefpass=true is present in localStorage.

   How it works:
   - On pool pages, wrap the real pool UI in: <div data-pool-content> ... </div>
   - Include a gate block anywhere: <div data-pool-gate> ... </div>
   - This script will:
       - If reefpass=true: show content, hide gate
       - Else: hide content, show gate
*/

function setupPoolGate() {
  // Only run on pool pages that declare a pool
  const poolName = document.body?.getAttribute("data-pool");
  if (!poolName) return;

  const content = document.querySelector("[data-pool-content]");
  const gate = document.querySelector("[data-pool-gate]");

  // If dev forgot wrappers, do nothing (prevents breaking pages)
  if (!content && !gate) return;

  let hasPass = false;
  try {
    hasPass = localStorage.getItem("reefpass") === "true";
  } catch {
    hasPass = false;
  }

  // Default visibility
  if (content) content.hidden = !hasPass;
  if (gate) gate.hidden = hasPass;

  // Optional: add a helpful toast when blocked
  if (!hasPass && gate) {
    // avoid spamming toast on refresh loops
    if (!window.__reefluxGateToastShown) {
      window.__reefluxGateToastShown = true;
      showToast("Pool sealed. Pass required.");
    }
  }

  // Optional: allow manual re-check (e.g., after returning from Stripe)
  window.__reefluxRecheckGate = function recheckGate() {
    try {
      const ok = localStorage.getItem("reefpass") === "true";
      if (content) content.hidden = !ok;
      if (gate) gate.hidden = ok;
    } catch {}
  };
}
/* ====== THEN CALL IT IN INIT ======
   Inside your DOMContentLoaded init block, add setupPoolGate()
*/

document.addEventListener("DOMContentLoaded", () => {
  setupAudio();
  setupTiles();
  loadStats();
  setupRequestForm();
  setupMirrorPool();
  setupDriftToggle();
  setupStripeButtons();

  // Gate must run BEFORE pool setup so expensive pool rendering doesn't run while locked
  setupPoolGate();

  setupTideDeckLogs();
  setupAmbientPool();
  setupFractalPool();
  setupSandboxPool();
  setupSignalPool();
});
