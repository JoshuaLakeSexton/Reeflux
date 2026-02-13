/* app.js (Reeflux.com) */
"use strict";

/* -------------------- KEYS -------------------- */
const audioStateKey = "reefAudioState";
const tideSessionKey = "reefTideLogs_v1";

/* -------------------- TOAST -------------------- */
function showToast(message) {
  const toast = document.getElementById("toast");
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

  // Try function first, fallback to stats.json
  fetch("/.netlify/functions/stats")
    .then((r) => {
      if (!r.ok) throw new Error("fn-stats");
      return r.json();
    })
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

/* -------------------- STRIPE CHECKOUT (Netlify Function) -------------------- */
/*
  Uses /.netlify/functions/checkout
  product: "single" (one-time) or "drift" (subscription)
*/
window.startCheckout = async function startCheckout(product) {
  try {
    const poolEl = document.querySelector("[data-pool]");
    const poolName =
      document.body?.getAttribute("data-pool") ||
      poolEl?.getAttribute("data-pool") ||
      "";

    const res = await fetch("/.netlify/functions/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, pool: poolName }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Checkout error:", text);
      showToast("Checkout error.");
      return;
    }

    const data = await res.json();
    if (!data.url) {
      showToast("Checkout error (no url).");
      return;
    }

    window.location.href = data.url;
  } catch (e) {
    console.error(e);
    showToast("Checkout failed.");
  }
};

/* -------------------- POOL GATE -------------------- */
/*
  Requires on each pool page:
    <body data-pool="ambient|fractal|sandbox|signal|tide">
    <div data-pool-gate>...</div>
    <div data-pool-content hidden>...</div>

  MVP gate uses localStorage reefpass=true
*/
function setupPoolGate() {
  const poolEl = document.querySelector("[data-pool]");
  const poolName =
    document.body?.getAttribute("data-pool") ||
    poolEl?.getAttribute("data-pool");

  if (!poolName) return;

  const gate = document.querySelector("[data-pool-gate]");
  const content = document.querySelector("[data-pool-content]");
  if (!gate || !content) return;

  let hasPass = false;
  try {
    hasPass = localStorage.getItem("reefpass") === "true";
  } catch {
    hasPass = false;
  }

  gate.hidden = hasPass;
  content.hidden = !hasPass;

  if (!hasPass && !window.__reefluxGateToastShown) {
    window.__reefluxGateToastShown = true;
    showToast("Pool sealed. Pass required.");
  }

  window.__reefluxRecheckGate = function recheckGate() {
    try {
      const ok = localStorage.getItem("reefpass") === "true";
      gate.hidden = ok;
      content.hidden = !ok;
    } catch {}
  };
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

  if (exportBtn) exportBtn.addEventListener("click", () => { updatePreview(); showToast("Export generated."); });

  if (previewCopy && preview) {
    previewCopy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(preview.textContent || ""); showToast("Export copied."); }
      catch { showToast("Copy blocked."); }
    });
  }

  if (copyBtn && input) {
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(input.value || ""); showToast("Copied."); }
      catch { showToast("Copy blocked."); }
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
      try { await navigator.clipboard.writeText(rouletteText.textContent || ""); showToast("Prompt copied."); }
      catch { showToast("Copy blocked."); }
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
  if (rouletteText && rouletteText.textContent.includes("Click")) spinPrompt();
}

/* -------------------- SIGNAL POOL -------------------- */
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

  // Gate before heavy pool setup
  setupPoolGate();

  setupTideDeckLogs();
  setupAmbientPool();
  setupFractalPool();
  setupSandboxPool();
  setupSignalPool();
});
