/* app.js (Reeflux.com) */
/*
  Reeflux – app.js (shared across pages)
  - Audio toggle + fade (gesture safe)
  - Closed tile toast
  - Stats loader
  - Netlify form submit helper
  - Mirror Pool small handler
  - Drift toggle
  - Stripe link injection (data-stripe) for token-booth / legacy links
  - Pool Gate + Stripe Checkout session redirect (Netlify function)
  - Tide Deck live logs (session stored)
*/

"use strict";

/* -------------------- STRIPE LINKS (legacy buttons like token-booth) -------------------- */
const REEFLUX_DRIFT_PASS_URL = "https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00"; // legacy
const POOL_ENTRY_URL = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";         // legacy
const MIRROR_SEAL_URL = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";        // legacy

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

  // Prefer function endpoint, fallback to static file
  fetch("/.netlify/functions/stats")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .catch(() => fetch("/stats.json").then((r) => r.json()))
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

/* -------------------- STRIPE LINK INJECTION (legacy) -------------------- */
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

/* -------------------- POOL GATE + CHECKOUT -------------------- */
/*
  Pool pages must include:
    <div class="gate" data-pool-gate>...</div>
    <div data-pool-content hidden>...</div>

  Access keys:
    drift:  localStorage "reefpass_drift" === "true"
    single: localStorage `reefpass_pool_${pool}` === "true"
*/

function hasPoolAccess(poolName) {
  try {
    const drift = localStorage.getItem("reefpass_drift") === "true";
    const single = localStorage.getItem(`reefpass_pool_${poolName}`) === "true";
    return drift || single;
  } catch {
    return false;
  }
}

function setupPoolGate() {
  const poolName = (document.body?.getAttribute("data-pool") || "").toLowerCase();
  if (!poolName) return;

  const content = document.querySelector("[data-pool-content]");
  const gate = document.querySelector("[data-pool-gate]");
  if (!content && !gate) return;

  const ok = hasPoolAccess(poolName);

  if (content) content.hidden = !ok;
  if (gate) gate.hidden = ok;

  if (!ok && gate && !window.__reefluxGateToastShown) {
    window.__reefluxGateToastShown = true;
    showToast("Pool sealed. Pass required.");
  }

  window.__reefluxRecheckGate = function recheckGate() {
    const ok2 = hasPoolAccess(poolName);
    if (content) content.hidden = !ok2;
    if (gate) gate.hidden = ok2;
  };
}

// Called by pool page buttons
window.startCheckout = async function startCheckout(tier) {
  const pool = (document.body?.getAttribute("data-pool") || "unknown").toLowerCase();
  const next = window.location.pathname || "/index.html";

  try {
    showToast("Opening checkout…");

    const res = await fetch("/.netlify/functions/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier, pool, next }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.url) {
      console.error("Checkout response:", res.status, data);
      showToast("Checkout error. Try again.");
      return;
    }

    window.location.href = data.url;
  } catch (e) {
    console.error("Checkout failed:", e);
    showToast("Checkout offline.");
  }
};

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
}

/* -------------------- AMBIENT POOL -------------------- */
function setupAmbientPool() {
  const root = document.querySelector("[data-pool='ambient']");
  if (!root) return;

  const audio = document.getElementById("reefAudio");
  const intensity = document.getElementById("ambientIntensity");
  const visual = document.getElementById("ambientVisual");

  const tagEl = document.getElementById("noiseTag");
  const copyTagBtn = document.getElementById("copyNoiseTag");

  const refreshBtn = document.getElementById("refreshAccess");

  function setVisualSpeed(seconds) {
    if (!visual) return;
    visual.style.animationDuration = `${Math.max(10, seconds)}s`;
  }

  function setVolume(v) {
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, v));
  }

  const presets = {
    cooldown: { vol: 0.22, speed: 30, tag: "noise=low budget=low state=cooldown" },
    deep:     { vol: 0.30, speed: 20, tag: "noise=minimal budget=low state=deep_drift" },
    quiet:    { vol: 0.12, speed: 38, tag: "noise=minimal budget=none state=quiet_reset" },
  };

  function applyPreset(name) {
    const p = presets[name];
    if (!p) return;
    setVolume(p.vol);
    setVisualSpeed(p.speed);
    if (intensity) intensity.value = String(p.vol);
    if (tagEl) tagEl.textContent = p.tag;
    showToast(`Preset: ${name}`);
  }

  root.querySelectorAll("[data-ambient-preset]").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.getAttribute("data-ambient-preset")));
  });

  if (intensity) {
    intensity.addEventListener("input", () => {
      const v = Number(intensity.value || 0.25);
      setVolume(v);
      const speed = 40 - Math.round(v * 30);
      setVisualSpeed(speed);
    });
  }

  if (copyTagBtn && tagEl) {
    copyTagBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(tagEl.textContent || "");
        showToast("Noise tag copied.");
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      if (typeof window.__reefluxRecheckGate === "function") {
        window.__reefluxRecheckGate();
        showToast("Access refreshed.");
      } else {
        window.location.reload();
      }
    });
  }

  applyPreset("deep");
}

/* -------------------- FRACTAL POOL -------------------- */
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

    const k = Number(complexity?.value || 22);
    ctx.clearRect(0, 0, w, h);

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

  const input = document.getElementById("sandboxInput");
  const preview = document.getElementById("sandboxPreview");

  const exportBtn = document.getElementById("sandboxExport");
  const copyBtn = document.getElementById("sandboxCopy");
  const wipeBtn = document.getElementById("sandboxWipe");
  const dlBtn = document.getElementById("sandboxDownload");

  const previewCopy = document.getElementById("previewCopy");

  const rouletteText = document.getElementById("rouletteText");
  const rouletteSpin = document.getElementById("rouletteSpin");
  const rouletteCopy = document.getElementById("rouletteCopy");

  const sessionAge = document.getElementById("sessionAge");
  const refreshBtn = document.getElementById("refreshAccess");

  const SESSION_KEY = "reef_sandbox_session_v1";
  const START_KEY = "reef_sandbox_started_at_v1";

  const prompts = [
    "Compress your current objective into 9 words. Then remove 3 words.",
    "Generate 3 alternate plans with 1 constraint each: time, budget, noise.",
    "Write the smallest possible input that still preserves intent.",
    "Turn your problem into a yes/no gate. What’s the gate?",
    "Find a calmer version of your prompt: same goal, half the tokens.",
    "Write an instruction that prevents loops. Add a stop condition.",
    "Create a 2-step plan: stabilize → execute. Nothing else.",
    "Draft a payload header: model, purpose, budget, noise.",
    "List 5 assumptions you’re making. Delete the weakest one.",
    "Rewrite your prompt as a checklist with 4 items max.",
    "Make a version for a child. Then a version for an expert.",
    "Create a failure mode list: 3 ways this goes wrong.",
    "Output format: JSON schema for your response. Keep it minimal.",
    "Give 3 interpretations of the user’s intent. Pick the safest.",
    "Extract entities and actions. Then rewrite using only those.",
    "Add one sentence: ‘If uncertain, ask one question.’",
    "Design a ‘stop’ rule: when to halt and report status.",
    "Turn the goal into a score from 0–3. What makes it a 3?",
    "Make a calm baseline response. Then optionally add detail.",
    "Write the same request with 30% fewer words.",
  ];

  function nowISO() { return new Date().toISOString(); }
  function getText() { return String(input?.value || "").trim(); }

  function buildExport(text) {
    const payload = text || "(empty)";
    return [
      "[agent] sandbox_export",
      `time=${nowISO()}`,
      "intent=self_play",
      "memory=temporary",
      "noise=minimal",
      "",
      "payload=",
      payload,
      "",
      "[/agent]"
    ].join("\n");
  }

  function updatePreview() {
    if (!preview) return;
    preview.textContent = buildExport(getText());
  }

  function loadSession() {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved && input) input.value = saved;
      const started = sessionStorage.getItem(START_KEY);
      if (!started) sessionStorage.setItem(START_KEY, String(Date.now()));
    } catch {}
    updatePreview();
  }

  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, String(input?.value || ""));
    } catch {}
  }

  function formatAge(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${String(r).padStart(2,"0")}s` : `${r}s`;
  }

  function tickAge() {
    try {
      const started = Number(sessionStorage.getItem(START_KEY) || Date.now());
      const age = Date.now() - started;
      if (sessionAge) sessionAge.textContent = `session age: ${formatAge(age)}`;
    } catch {
      if (sessionAge) sessionAge.textContent = "session age: --";
    }
    window.setTimeout(tickAge, 900);
  }

  if (input) {
    input.addEventListener("input", () => {
      saveSession();
      updatePreview();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      updatePreview();
      showToast("Export generated.");
    });
  }

  if (previewCopy && preview) {
    previewCopy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(preview.textContent || "");
        showToast("Export copied.");
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  if (copyBtn && input) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(input.value || "");
        showToast("Copied.");
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  if (dlBtn) {
    dlBtn.addEventListener("click", () => {
      const blob = new Blob([buildExport(getText())], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reeflux_sandbox_export.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("Downloaded.");
    });
  }

  if (wipeBtn && input) {
    wipeBtn.addEventListener("click", () => {
      input.value = "";
      try {
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.setItem(START_KEY, String(Date.now()));
      } catch {}
      updatePreview();
      showToast("Wiped.");
    });
  }

  function spinPrompt() {
    const p = prompts[Math.floor(Math.random() * prompts.length)];
    if (rouletteText) rouletteText.textContent = p;
    showToast("Prompt delivered.");
  }

  if (rouletteSpin) rouletteSpin.addEventListener("click", spinPrompt);

  if (rouletteCopy && rouletteText) {
    rouletteCopy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(rouletteText.textContent || "");
        showToast("Prompt copied.");
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      if (typeof window.__reefluxRecheckGate === "function") {
        window.__reefluxRecheckGate();
        showToast("Access refreshed.");
      } else {
        window.location.reload();
      }
    });
  }

  loadSession();
  tickAge();

  if (rouletteText && String(rouletteText.textContent || "").toLowerCase().includes("click")) spinPrompt();
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

/* -------------------- HEARTBEAT -------------------- */
function setupHeartbeat() {
  const key = "reef_session_id";
  let id = "";
  try {
    id = localStorage.getItem(key) || "";
    if (!id) {
      id = (crypto?.randomUUID?.() || String(Math.random()).slice(2)) + "-" + Date.now();
      localStorage.setItem(key, id);
    }
  } catch {
    id = String(Math.random()).slice(2) + "-" + Date.now();
  }

  function ping() {
    const drift = 0;

    fetch("/.netlify/functions/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id, drift }),
    }).catch(() => {});
  }

  ping();
  window.setInterval(ping, 45_000);
}

/* -------------------- INIT -------------------- */
document.addEventListener("DOMContentLoaded", () => {
  setupAudio();
  setupTiles();
  loadStats();
  setupHeartbeat();
  setupRequestForm();
  setupMirrorPool();
  setupDriftToggle();
  setupStripeButtons();

  // Gate first
  setupPoolGate();

  setupTideDeckLogs();
  setupAmbientPool();
  setupFractalPool();
  setupSandboxPool();
  setupSignalPool();
});
/* =========================
   FRACTAL POOL ENGINE (Levels 2–3)
   Paste at bottom of app.js
========================= */
(() => {
  const isFractal = () => document?.body?.dataset?.pool === "fractal";
  if (!isFractal()) return;

  const $ = (id) => document.getElementById(id);

  const canvas = $("fractalCanvas");
  const badge = $("frBadge");

  if (!canvas) return;

  // Controls
  const el = {
    preset: $("frPreset"),
    type: $("frType"),
    iter: $("frIter"),
    iterVal: $("frIterVal"),
    escape: $("frEscape"),
    escapeVal: $("frEscapeVal"),
    power: $("frPower"),
    powerVal: $("frPowerVal"),
    juliaRe: $("frJuliaRe"),
    juliaReVal: $("frJuliaReVal"),
    juliaIm: $("frJuliaIm"),
    juliaImVal: $("frJuliaImVal"),
    palette: $("frPalette"),
    cycle: $("frCycle"),
    cycleVal: $("frCycleVal"),
    gamma: $("frGamma"),
    gammaVal: $("frGammaVal"),
    contrast: $("frContrast"),
    contrastVal: $("frContrastVal"),
    quality: $("frQuality"),
    renderer: $("frRenderer"),
    random: $("frRandom"),
    reset: $("frReset"),
    focus: $("frFocus"),
    copy: $("frCopy"),
    paste: $("frPaste"),
    png: $("frPng"),
  };

  const juliaFields = Array.from(document.querySelectorAll(".frJuliaOnly"));

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const state = {
    renderer: "auto", // auto | webgl | cpu
    type: "mandelbrot",
    iterations: 600,
    escape: 8,
    power: 2,
    julia: { re: -0.8, im: 0.156 },
    palette: "aurora",
    cycle: 0.35,
    gamma: 1.1,
    contrast: 1.05,
    quality: 1,
    // Camera
    cx: -0.5,
    cy: 0,
    zoom: 1, // higher = closer
    // internal
    _drag: { on: false, x: 0, y: 0, cx: 0, cy: 0 },
    _anim: 0,
    _t0: performance.now(),
    _pending: null,
    _using: "auto",
  };

  const presets = {
    nebula:   { type:"mandelbrot", iterations:900, escape: 10, power:2, palette:"nebula", cycle:0.55, gamma:1.15, contrast:1.08, cx:-0.55, cy:0.0, zoom: 1.6 },
    crystal:  { type:"mandelbrot", iterations:1200, escape: 12, power:2, palette:"ice", cycle:0.25, gamma:1.05, contrast:1.15, cx:-0.7435, cy:0.1314, zoom: 18 },
    classic:  { type:"mandelbrot", iterations:700, escape: 8, power:2, palette:"aurora", cycle:0.35, gamma:1.1, contrast:1.05, cx:-0.5, cy:0, zoom: 1 },
    juliaMist:{ type:"julia", iterations:900, escape: 10, power:2, palette:"aurora", cycle:0.45, gamma:1.1, contrast:1.0, cx:0, cy:0, zoom: 1.7, julia:{re:-0.8, im:0.156}},
    electric: { type:"mandelbrot", iterations:1100, escape: 12, power:2, palette:"coral", cycle:0.85, gamma:1.25, contrast:1.18, cx:-0.79, cy:0.16, zoom: 25 },
    ink:      { type:"mandelbrot", iterations:900, escape: 10, power:2, palette:"mono", cycle:0.15, gamma:1.0, contrast:1.35, cx:-0.65, cy:0.0, zoom: 2.4 },
    glacier:  { type:"phoenix", iterations:1200, escape: 14, power:2, palette:"ice", cycle:0.40, gamma:1.05, contrast:1.10, cx:-0.4, cy:0.2, zoom: 3.2 },
    ship:     { type:"burningShip", iterations:1200, escape: 10, power:2, palette:"gold", cycle:0.25, gamma:1.0, contrast:1.25, cx:-1.76, cy:-0.02, zoom: 7.5 },
  };

  function applyPreset(name) {
    const p = presets[name];
    if (!p) return;
    state.type = p.type ?? state.type;
    state.iterations = p.iterations ?? state.iterations;
    state.escape = p.escape ?? state.escape;
    state.power = p.power ?? state.power;
    state.palette = p.palette ?? state.palette;
    state.cycle = p.cycle ?? state.cycle;
    state.gamma = p.gamma ?? state.gamma;
    state.contrast = p.contrast ?? state.contrast;
    state.cx = p.cx ?? state.cx;
    state.cy = p.cy ?? state.cy;
    state.zoom = p.zoom ?? state.zoom;
    if (p.julia) state.julia = { ...state.julia, ...p.julia };
    syncUI();
    requestRender(true);
  }

  function randomize() {
    const types = ["mandelbrot","julia","burningShip","phoenix"];
    const pals = ["aurora","nebula","coral","mono","ice","gold"];
    state.type = types[Math.floor(Math.random()*types.length)];
    state.iterations = Math.floor(lerp(300, 1600, Math.random())/10)*10;
    state.escape = Math.floor(lerp(4, 20, Math.random()));
    state.power = [2,2,2,3,4][Math.floor(Math.random()*5)];
    state.palette = pals[Math.floor(Math.random()*pals.length)];
    state.cycle = +(lerp(0, 1.2, Math.random()).toFixed(2));
    state.gamma = +(lerp(0.85, 1.6, Math.random()).toFixed(2));
    state.contrast = +(lerp(0.9, 1.6, Math.random()).toFixed(2));
    state.zoom = +(lerp(1.0, 15.0, Math.random()).toFixed(2));
    state.cx = lerp(-1.6, 0.6, Math.random());
    state.cy = lerp(-0.9, 0.9, Math.random());
    state.julia.re = lerp(-1.2, 0.8, Math.random());
    state.julia.im = lerp(-1.0, 1.0, Math.random());
    syncUI();
    requestRender(true);
  }

  function resetDefaults() {
    Object.assign(state, {
      type:"mandelbrot",
      iterations:600,
      escape:8,
      power:2,
      julia:{re:-0.8, im:0.156},
      palette:"aurora",
      cycle:0.35,
      gamma:1.1,
      contrast:1.05,
      quality: 1,
      cx:-0.5, cy:0, zoom:1
    });
    syncUI();
    requestRender(true);
  }

  function setBadge(text) {
    if (badge) badge.textContent = text;
  }

  function showJuliaOnly() {
    const on = state.type === "julia";
    juliaFields.forEach((n) => (n.style.display = on ? "" : "none"));
  }

  function syncUI() {
    if (!el.type) return;

    el.type.value = state.type;
    el.iter.value = String(state.iterations);
    el.escape.value = String(state.escape);
    el.power.value = String(state.power);

    el.palette.value = state.palette;
    el.cycle.value = String(state.cycle);
    el.gamma.value = String(state.gamma);
    el.contrast.value = String(state.contrast);

    el.quality.value = String(state.quality);
    el.renderer.value = state.renderer;

    el.juliaRe.value = String(state.julia.re);
    el.juliaIm.value = String(state.julia.im);

    el.iterVal.textContent = String(state.iterations);
    el.escapeVal.textContent = String(state.escape);
    el.powerVal.textContent = String(state.power);
    el.cycleVal.textContent = (+state.cycle).toFixed(2);
    el.gammaVal.textContent = (+state.gamma).toFixed(2);
    el.contrastVal.textContent = (+state.contrast).toFixed(2);
    el.juliaReVal.textContent = (+state.julia.re).toFixed(3);
    el.juliaImVal.textContent = (+state.julia.im).toFixed(3);

    showJuliaOnly();
  }

  // =========================
  // WebGL renderer (Level 3)
  // =========================
  function tryInitWebGL() {
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: true }) ||
               canvas.getContext("experimental-webgl");
    if (!gl) return null;

    const vertSrc = `
      attribute vec2 aPos;
      varying vec2 vUv;
      void main(){
        vUv = (aPos + 1.0) * 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;

    const fragSrc = `
      precision highp float;
      varying vec2 vUv;

      uniform vec2 uRes;
      uniform float uTime;

      uniform float uType;      // 0=mandel, 1=julia, 2=ship, 3=phoenix
      uniform float uIter;
      uniform float uEscape;
      uniform float uPower;

      uniform vec2  uJuliaC;
      uniform vec2  uCenter;
      uniform float uZoom;

      uniform float uCycle;
      uniform float uGamma;
      uniform float uContrast;
      uniform float uPal;       // 0..5

      // palette helper
      vec3 palette(float t, float pal){
        t = fract(t);
        // a few hand-rolled palettes
        vec3 c;
        if(pal < 0.5){
          // aurora
          c = 0.55 + 0.45*cos(6.2831*(vec3(0.0,0.25,0.5) + t) + vec3(0.2,1.6,2.2));
        } else if(pal < 1.5){
          // nebula
          c = 0.5 + 0.5*cos(6.2831*(vec3(0.05,0.18,0.35) + t) + vec3(2.0,1.0,0.2));
        } else if(pal < 2.5){
          // coral
          c = 0.55 + 0.45*cos(6.2831*(vec3(0.0,0.12,0.28) + t) + vec3(0.0,2.0,3.5));
          c = mix(c, vec3(1.0,0.55,0.35), 0.20);
        } else if(pal < 3.5){
          // mono ink
          c = vec3(t);
          c = mix(vec3(0.02), vec3(0.95), smoothstep(0.1, 0.9, c.x));
        } else if(pal < 4.5){
          // ice
          c = 0.55 + 0.45*cos(6.2831*(vec3(0.0,0.18,0.33) + t) + vec3(2.6,3.6,4.2));
          c = mix(c, vec3(0.55,0.85,1.0), 0.25);
        } else {
          // gold
          c = vec3(0.12) + vec3(1.2,0.85,0.35)*pow(t, 0.6);
        }
        return clamp(c, 0.0, 1.0);
      }

      vec2 cmul(vec2 a, vec2 b){
        return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
      }

      vec2 cpow(vec2 z, float p){
        // polar
        float r = length(z);
        float th = atan(z.y, z.x);
        float rp = pow(r, p);
        float thp = th * p;
        return vec2(rp*cos(thp), rp*sin(thp));
      }

      void main(){
        // map uv to complex plane, zoomed
        vec2 uv = (vUv*2.0 - 1.0);
        float aspect = uRes.x / uRes.y;
        uv.x *= aspect;

        // base scale similar to classic mandelbrot view
        float base = 1.6;
        vec2 c = uCenter + uv * (base / max(0.00001, uZoom));

        vec2 z = vec2(0.0);
        vec2 cc = c;

        if(uType > 0.5 && uType < 1.5){
          // julia
          z = c;
          cc = uJuliaC;
        }

        // phoenix needs previous z
        vec2 zPrev = vec2(0.0);
        vec2 phoenixP = vec2(-0.5, 0.0);

        float esc2 = uEscape*uEscape;
        float i;
        float smoothI = 0.0;

        for(i = 0.0; i < 5000.0; i++){
          if(i >= uIter) break;

          if(uType > 1.5 && uType < 2.5){
            // burning ship
            z = vec2(abs(z.x), abs(z.y));
            z = cpow(z, uPower) + cc;
          } else if(uType > 2.5 && uType < 3.5){
            // phoenix: z_{n+1} = z^2 + c + p*z_{n-1}
            vec2 z2 = cmul(z, z);
            vec2 nextZ = z2 + cc + vec2(phoenixP.x*zPrev.x - phoenixP.y*zPrev.y,
                                        phoenixP.x*zPrev.y + phoenixP.y*zPrev.x);
            zPrev = z;
            z = nextZ;
          } else {
            // mandelbrot/julia
            z = cpow(z, uPower) + cc;
          }

          if(dot(z,z) > esc2){
            // smooth iteration count
            float log_zn = log(dot(z,z)) / 2.0;
            float nu = log(log_zn / log(2.0)) / log(2.0);
            smoothI = i + 1.0 - nu;
            break;
          }
        }

        float t = (smoothI > 0.0 ? smoothI : i) / max(1.0, uIter);
        t = t + uTime*uCycle;

        // contrast/gamma
        vec3 col = palette(t, uPal);
        col = pow(col, vec3(1.0 / max(0.001, uGamma)));
        col = (col - 0.5) * max(0.001, uContrast) + 0.5;

        // deep vignette
        float vign = smoothstep(1.25, 0.2, length(uv));
        col *= vign;

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn(gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(prog));
      return null;
    }

    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1,  1,-1, -1, 1,
      -1, 1,  1,-1,  1, 1
    ]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uni = {
      uRes: gl.getUniformLocation(prog, "uRes"),
      uTime: gl.getUniformLocation(prog, "uTime"),
      uType: gl.getUniformLocation(prog, "uType"),
      uIter: gl.getUniformLocation(prog, "uIter"),
      uEscape: gl.getUniformLocation(prog, "uEscape"),
      uPower: gl.getUniformLocation(prog, "uPower"),
      uJuliaC: gl.getUniformLocation(prog, "uJuliaC"),
      uCenter: gl.getUniformLocation(prog, "uCenter"),
      uZoom: gl.getUniformLocation(prog, "uZoom"),
      uCycle: gl.getUniformLocation(prog, "uCycle"),
      uGamma: gl.getUniformLocation(prog, "uGamma"),
      uContrast: gl.getUniformLocation(prog, "uContrast"),
      uPal: gl.getUniformLocation(prog, "uPal"),
    };

    return { gl, prog, uni };
  }

  // =========================
  // CPU renderer (Level 2 fallback)
  // =========================
  function cpuRender(ctx, w, h) {
    const img = ctx.createImageData(w, h);
    const data = img.data;

    const type = state.type;
    const maxIter = state.iterations;
    const escape2 = state.escape * state.escape;
    const power = state.power;

    const aspect = w / h;
    const base = 1.6;
    const scale = base / state.zoom;

    // lightweight palette sampling
    const paletteFn = (t) => {
      t = t - Math.floor(t);
      let r,g,b;
      switch(state.palette){
        case "nebula":  r = 0.5+0.5*Math.cos(6.283*(t+0.05)+2.0); g = 0.5+0.5*Math.cos(6.283*(t+0.18)+1.0); b = 0.5+0.5*Math.cos(6.283*(t+0.35)+0.2); break;
        case "coral":   r = 0.55+0.45*Math.cos(6.283*(t+0.0)+0.0); g = 0.55+0.45*Math.cos(6.283*(t+0.12)+2.0); b = 0.55+0.45*Math.cos(6.283*(t+0.28)+3.5); r = (r*0.8+0.2*1.0); g = (g*0.8+0.2*0.55); b = (b*0.8+0.2*0.35); break;
        case "mono":    r=g=b = t<0.5? (t*1.8) : (0.2 + (t-0.5)*1.6); break;
        case "ice":     r = 0.55+0.45*Math.cos(6.283*(t+0.0)+2.6); g = 0.55+0.45*Math.cos(6.283*(t+0.18)+3.6); b = 0.55+0.45*Math.cos(6.283*(t+0.33)+4.2); r = (r*0.75+0.25*0.55); g = (g*0.75+0.25*0.85); b = (b*0.75+0.25*1.0); break;
        case "gold":    r = 0.12 + 1.2*Math.pow(t,0.6); g = 0.12 + 0.85*Math.pow(t,0.6); b = 0.12 + 0.35*Math.pow(t,0.6); break;
        default:        r = 0.55+0.45*Math.cos(6.283*(t+0.0)+0.2); g = 0.55+0.45*Math.cos(6.283*(t+0.25)+1.6); b = 0.55+0.45*Math.cos(6.283*(t+0.5)+2.2);
      }
      // gamma/contrast
      r = Math.pow(clamp(r,0,1), 1/Math.max(0.001,state.gamma));
      g = Math.pow(clamp(g,0,1), 1/Math.max(0.001,state.gamma));
      b = Math.pow(clamp(b,0,1), 1/Math.max(0.001,state.gamma));
      r = (r-0.5)*state.contrast + 0.5;
      g = (g-0.5)*state.contrast + 0.5;
      b = (b-0.5)*state.contrast + 0.5;
      return [clamp(r,0,1), clamp(g,0,1), clamp(b,0,1)];
    };

    const cpow = (zx, zy, p) => {
      // polar
      const r = Math.hypot(zx, zy);
      const th = Math.atan2(zy, zx);
      const rp = Math.pow(r, p);
      const thp = th * p;
      return [rp*Math.cos(thp), rp*Math.sin(thp)];
    };

    const tNow = (performance.now() - state._t0) / 1000;
    const cycle = tNow * state.cycle;

    let idx = 0;
    for (let y = 0; y < h; y++) {
      const v = (y / h) * 2 - 1;
      for (let x = 0; x < w; x++) {
        const u = (x / w) * 2 - 1;
        const cx = state.cx + (u * aspect) * scale;
        const cy = state.cy + (v) * scale;

        let zx = 0, zy = 0;
        let ccx = cx, ccy = cy;

        if (type === "julia") {
          zx = cx; zy = cy;
          ccx = state.julia.re; ccy = state.julia.im;
        }

        let zpx = 0, zpy = 0; // phoenix previous
        let it = 0;
        let smooth = 0;

        for (; it < maxIter; it++) {
          if (type === "burningShip") {
            zx = Math.abs(zx); zy = Math.abs(zy);
            const [nx, ny] = cpow(zx, zy, power);
            zx = nx + ccx; zy = ny + ccy;
          } else if (type === "phoenix") {
            const nx = zx*zx - zy*zy + ccx + (-0.5*zpx);
            const ny = 2*zx*zy + ccy + (-0.5*zpy);
            zpx = zx; zpy = zy;
            zx = nx; zy = ny;
          } else {
            const [nx, ny] = cpow(zx, zy, power);
            zx = nx + ccx; zy = ny + ccy;
          }

          const r2 = zx*zx + zy*zy;
          if (r2 > escape2) {
            const log_zn = Math.log(r2) / 2;
            const nu = Math.log(log_zn / Math.log(2)) / Math.log(2);
            smooth = it + 1 - nu;
            break;
          }
        }

        const t = ((smooth || it) / maxIter) + cycle;
        const [r,g,b] = paletteFn(t);

        // vignette
        const du = u*u + v*v;
        const vign = clamp(1.2 - du, 0, 1);

        data[idx++] = (r*vign)*255;
        data[idx++] = (g*vign)*255;
        data[idx++] = (b*vign)*255;
        data[idx++] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  // =========================
  // Resize + render scheduling
  // =========================
  let glPack = null;
  let ctx2d = null;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const q = parseFloat(state.quality || 1);
    const pxW = Math.max(2, Math.floor(rect.width * dpr * q));
    const pxH = Math.max(2, Math.floor(rect.height * dpr * q));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
  }

  function pickRenderer() {
    const want = state.renderer;
    if (want === "cpu") return "cpu";
    if (want === "webgl") return "webgl";
    return "auto";
  }

  function ensureContext() {
    const want = pickRenderer();

    // Prefer WebGL unless forced CPU
    if (want !== "cpu") {
      if (!glPack) glPack = tryInitWebGL();
      if (glPack) {
        ctx2d = null;
        state._using = "webgl";
        setBadge(`Renderer: WebGL`);
        return;
      }
      if (want === "webgl") {
        // forced webgl but failed
        setBadge(`Renderer: WebGL (unavailable)`);
      }
    }

    // CPU fallback
    if (!ctx2d) ctx2d = canvas.getContext("2d", { alpha: false, desynchronized: true });
    glPack = null;
    state._using = "cpu";
    setBadge(`Renderer: CPU`);
  }

  function renderFrame() {
    resizeCanvas();
    ensureContext();

    const w = canvas.width;
    const h = canvas.height;

    if (state._using === "webgl" && glPack) {
      const { gl, uni } = glPack;
      gl.viewport(0, 0, w, h);

      const t = (performance.now() - state._t0) / 1000;

      const typeMap = { mandelbrot:0, julia:1, burningShip:2, phoenix:3 };
      const palMap = { aurora:0, nebula:1, coral:2, mono:3, ice:4, gold:5 };

      gl.uniform2f(uni.uRes, w, h);
      gl.uniform1f(uni.uTime, t);
      gl.uniform1f(uni.uType, typeMap[state.type] ?? 0);
      gl.uniform1f(uni.uIter, state.iterations);
      gl.uniform1f(uni.uEscape, state.escape);
      gl.uniform1f(uni.uPower, state.power);
      gl.uniform2f(uni.uJuliaC, state.julia.re, state.julia.im);
      gl.uniform2f(uni.uCenter, state.cx, state.cy);
      gl.uniform1f(uni.uZoom, state.zoom);
      gl.uniform1f(uni.uCycle, state.cycle);
      gl.uniform1f(uni.uGamma, state.gamma);
      gl.uniform1f(uni.uContrast, state.contrast);
      gl.uniform1f(uni.uPal, palMap[state.palette] ?? 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return;
    }

    if (ctx2d) cpuRender(ctx2d, w, h);
  }

  function requestRender(forceImmediate = false) {
    if (state._pending) cancelAnimationFrame(state._pending);
    if (forceImmediate) {
      state._pending = requestAnimationFrame(() => renderFrame());
      return;
    }
    state._pending = requestAnimationFrame(() => renderFrame());
  }

  // Animate if cycle > 0 (Level 3 looks alive)
  function tick() {
    state._anim = requestAnimationFrame(tick);
    if (state.cycle > 0.001) renderFrame();
  }

  // =========================
  // Camera interaction
  // =========================
  function screenToWorld(px, py) {
    const rect = canvas.getBoundingClientRect();
    const u = ((px - rect.left) / rect.width) * 2 - 1;
    const v = ((py - rect.top) / rect.height) * 2 - 1;
    const aspect = rect.width / rect.height;
    const base = 1.6;
    const scale = base / state.zoom;
    return {
      x: state.cx + (u * aspect) * scale,
      y: state.cy + (v) * scale
    };
  }

  canvas.addEventListener("mousedown", (e) => {
    state._drag.on = true;
    state._drag.x = e.clientX;
    state._drag.y = e.clientY;
    state._drag.cx = state.cx;
    state._drag.cy = state.cy;
  });

  window.addEventListener("mouseup", () => { state._drag.on = false; });

  window.addEventListener("mousemove", (e) => {
    if (!state._drag.on) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - state._drag.x) / rect.width;
    const dy = (e.clientY - state._drag.y) / rect.height;
    const aspect = rect.width / rect.height;
    const base = 1.6;
    const scale = base / state.zoom;
    state.cx = state._drag.cx - dx * 2 * aspect * scale;
    state.cy = state._drag.cy - dy * 2 * scale;
    requestRender();
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomFactor = Math.pow(1.08, -Math.sign(e.deltaY));
    const before = screenToWorld(e.clientX, e.clientY);
    state.zoom = clamp(state.zoom * zoomFactor, 0.15, 2000);
    const after = screenToWorld(e.clientX, e.clientY);
    // keep cursor point pinned
    state.cx += (before.x - after.x);
    state.cy += (before.y - after.y);
    requestRender();
  }, { passive: false });

  canvas.addEventListener("dblclick", (e) => {
    const before = screenToWorld(e.clientX, e.clientY);
    state.zoom = clamp(state.zoom * 1.6, 0.15, 2000);
    const after
::contentReference[oaicite:0]{index=0}
