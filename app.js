"use strict";

const PRICING = Object.freeze({
  DRIFT_PASS_MONTHLY: "$5/mo",
  POOL_ENTRY_SINGLE: "$0.50",
});

const CHECKOUT_ENDPOINT = "/.netlify/functions/checkout";

const STRIPE_FALLBACKS = Object.freeze({
  driftpass: "https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00",
  poolentry: "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01",
});

const ENDPOINTS = Object.freeze({
  ping: "/.netlify/functions/ping",
  stats: "/.netlify/functions/stats",
  verifyPass: "/.netlify/functions/verify-pass",
  poolJoin: "/.netlify/functions/pool-join",
  activityFeed: "/.netlify/functions/activity-feed",
});

const KEYS = Object.freeze({
  audioState: "reefAudioState",
  localPass: "reefpass",
  localPassSetAt: "reefpass_set_at",
  sessionId: "reef_session_id",
  actorType: "reef_actor_type",
  sandboxSession: "reef_sandbox_session_v2",
  sandboxStartedAt: "reef_sandbox_started_at_v2",
});

const KNOWN_POOLS = Object.freeze(["tide", "ambient", "fractal", "sandbox"]);

const toast = document.getElementById("toast");
let heartbeatInterval = null;

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(window.__reefToastTimer);
  window.__reefToastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function isLocalDev() {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function safeStorageGet(key, fallback = "") {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

function hasLocalPass() {
  return safeStorageGet(KEYS.localPass, "false") === "true";
}

function getSessionId() {
  let existing = safeStorageGet(KEYS.sessionId, "");
  if (existing) return existing;

  const generated = `${crypto?.randomUUID?.() || String(Math.random()).slice(2)}-${Date.now()}`;
  safeStorageSet(KEYS.sessionId, generated);
  return generated;
}

function getActorType() {
  const actor = safeStorageGet(KEYS.actorType, "agent").trim().toLowerCase();
  if (["agent", "human", "system"].includes(actor)) return actor;
  return "agent";
}

function getCurrentPoolId() {
  const pool = document.body?.getAttribute("data-pool") || "";
  return KNOWN_POOLS.includes(pool) ? pool : null;
}

function formatRelativeOrNone(timestamp) {
  if (!timestamp) return "No recent activity";
  const ms = Number(new Date(timestamp));
  if (!Number.isFinite(ms)) return "No recent activity";

  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";

  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return new Date(ms).toLocaleString();
}

function formatUptime(seconds) {
  const s = Number(seconds || 0);
  if (s <= 0) return "0m";

  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  if (hours <= 0) return `${minutes}m`;
  if (hours < 48) return `${hours}h ${minutes}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function getModeBadge(mode) {
  if (mode === "live") return "LIVE";
  return "LIMITED";
}

function getGateStateTag(reason) {
  const tags = {
    no_pass: "Pass required",
    expired: "Pass expired",
    invalid_token: "Access refresh needed",
    scope_denied: "Tier upgrade required",
    missing_pass_secret: "Verification limited",
    verify_failed: "Verification limited",
    join_failed: "Access check pending",
  };

  return tags[reason] || "Pass required";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  return { ok: response.ok, status: response.status, body };
}

function fadeTo(audio, target, duration = 950) {
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
  const audio = document.getElementById("reefAudio");
  const btn = document.getElementById("audioToggle");
  if (!audio || !btn) return;

  const targetVolume = 0.25;

  function setBtn(isPlaying) {
    btn.setAttribute("aria-pressed", String(isPlaying));
    btn.textContent = isPlaying ? "Pause Audio" : "Play Audio";
  }

  audio.volume = 0;

  if (safeStorageGet(KEYS.audioState, "paused") === "playing") {
    audio.play()
      .then(() => {
        fadeTo(audio, targetVolume);
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
        fadeTo(audio, targetVolume);
        setBtn(true);
        safeStorageSet(KEYS.audioState, "playing");
      } catch {
        setBtn(false);
        showToast("Audio blocked. Tap again.");
      }
    } else {
      fadeTo(audio, 0, 700);
      window.setTimeout(() => audio.pause(), 700);
      setBtn(false);
      safeStorageSet(KEYS.audioState, "paused");
    }
  });
}

function applyPricingLabels() {
  const labels = {
    "drift-pass-monthly": PRICING.DRIFT_PASS_MONTHLY,
    "pool-entry-single": PRICING.POOL_ENTRY_SINGLE,
  };

  document.querySelectorAll("[data-price]").forEach((el) => {
    const key = String(el.getAttribute("data-price") || "").trim();
    if (labels[key]) el.textContent = labels[key];
  });
}

async function startCheckout(plan, fallbackUrl) {
  const poolId = getCurrentPoolId();

  try {
    const { ok, body } = await fetchJson(CHECKOUT_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({
        plan,
        poolId,
        success: "/success",
        cancel: "/token-booth",
      }),
    });

    if (!ok || !body?.url) throw new Error("checkout_failed");
    window.location.assign(body.url);
    return true;
  } catch {
    showToast("Checkout unavailable. Opening fallback.");
    if (fallbackUrl) window.location.assign(fallbackUrl);
    return false;
  }
}

function setupStripeButtons() {
  document.querySelectorAll("[data-stripe]").forEach((el) => {
    const key = String(el.getAttribute("data-stripe") || "").trim().toLowerCase();
    const fallbackUrl = STRIPE_FALLBACKS[key];
    if (!fallbackUrl) return;

    el.setAttribute("href", fallbackUrl);

    el.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if ("button" in event && event.button !== 0) return;

      event.preventDefault();
      void startCheckout(key, fallbackUrl);
    });
  });
}

function setupRequestForm() {
  const form = document.querySelector("[data-reeflux-form]");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    fetch(form.getAttribute("action") || "/", { method: "POST", body: formData })
      .then(() => {
        form.reset();
        showToast("Request logged.");
        const success = document.getElementById("formSuccess");
        if (success) success.hidden = false;
      })
      .catch(() => showToast("Unable to submit right now."));
  });
}

function setupTiles() {
  const closedTiles = document.querySelectorAll("[data-status='closed']");
  closedTiles.forEach((tile) => {
    tile.addEventListener("click", (event) => {
      event.preventDefault();
      showToast("This surface is inbound.");
    });
  });
}

function renderPoolTiles(pools = []) {
  if (!Array.isArray(pools)) return;

  pools.forEach((pool) => {
    const tile = document.querySelector(`[data-pool-id='${pool.pool_id}']`);
    if (!tile) return;

    const liveEl = tile.querySelector("[data-pool-live]");
    const auraEl = tile.querySelector("[data-pool-aura]");
    const lastEl = tile.querySelector("[data-pool-last]");

    if (liveEl) {
      const active = Number(pool.active_now || 0);
      liveEl.textContent = active > 0
        ? `${active} active now`
        : "quiet window";
    }

    if (auraEl) auraEl.textContent = pool.aura || "Quiet Depth";
    if (lastEl) lastEl.textContent = `last activity: ${formatRelativeOrNone(pool.last_activity)}`;
  });
}

function renderReefStatus(status) {
  const valueMap = {
    statActiveNow: status.active_agents_now,
    statActive5m: status.active_agents_5m,
    statActive1h: status.active_agents_1h,
    statAuthUsers: status.connected_authenticated_users,
    statOccupiedPools: status.occupied_pools,
    statAvailablePools: status.available_pools,
    statPoolJoins: status.pool_join_events_24h,
    statInteractions: status.interactions_24h,
    statUptime: formatUptime(status.system_uptime_seconds),
    statLastUpdated: formatRelativeOrNone(status.last_updated),
  };

  Object.entries(valueMap).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(value ?? 0);
  });

  const modeEl = document.getElementById("reefStatusMode");
  if (modeEl) {
    const mode = status.mode || (status.degraded ? "degraded" : "live");
    modeEl.textContent = getModeBadge(mode);
    modeEl.dataset.mode = mode;
  }

  const narrative = document.getElementById("reefStatusNarrative");
  if (narrative) {
    narrative.textContent = status.copy_state || "Reef telemetry stable.";
  }

  renderPoolTiles(status.pools || []);
}

function renderReefStatusLoading() {
  const ids = [
    "statActiveNow",
    "statActive5m",
    "statActive1h",
    "statAuthUsers",
    "statOccupiedPools",
    "statAvailablePools",
    "statPoolJoins",
    "statInteractions",
    "statUptime",
    "statLastUpdated",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "loading";
  });
}

async function loadReefStatus() {
  const statsRoot = document.querySelector("[data-stats]");
  if (!statsRoot) return;

  renderReefStatusLoading();

  try {
    const { ok, body } = await fetchJson(ENDPOINTS.stats, { method: "GET" });
    if (!ok) throw new Error("stats_http_error");
    renderReefStatus(body);
  } catch {
    renderReefStatus({
      mode: "degraded",
      active_agents_now: 0,
      active_agents_5m: 0,
      active_agents_1h: 0,
      connected_authenticated_users: 0,
      occupied_pools: 0,
      available_pools: KNOWN_POOLS.length,
      pool_join_events_24h: 0,
      interactions_24h: 0,
      system_uptime_seconds: 0,
      last_updated: null,
      pools: KNOWN_POOLS.map((pool_id) => ({
        pool_id,
        active_now: 0,
        aura: "Quiet Depth",
        launch_copy: "No active agents in this current tide window.",
        last_activity: null,
      })),
      copy_state:
        "Telemetry channel is temporarily limited. Reef surfaces remain available while live counts recover.",
    });
    showToast("Telemetry channel is limited.");
  }
}

async function postHeartbeat(eventType = "heartbeat", extra = {}) {
  const sessionId = getSessionId();
  const poolId = getCurrentPoolId();

  try {
    await fetchJson(ENDPOINTS.ping, {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        actorType: getActorType(),
        actorId: "browser",
        poolId,
        eventType,
        authenticated: hasLocalPass(),
        ...extra,
      }),
    });
  } catch {
    // heartbeat failures are non-fatal
  }
}

function setupHeartbeat() {
  void postHeartbeat(getCurrentPoolId() ? "pool_view" : "page_view");

  window.clearInterval(heartbeatInterval);
  heartbeatInterval = window.setInterval(() => {
    void postHeartbeat("heartbeat");
  }, 45_000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void postHeartbeat("resume");
    }
  });
}

function describeAccessReason(reason) {
  const map = {
    no_pass: "Pass required to enter this premium pool.",
    invalid_token: "Access check needs a refresh. Visit Token Booth or /success.",
    expired: "This pass has expired. Renew to continue premium access.",
    missing_pass_secret:
      "Access verification is temporarily limited. Please retry shortly.",
    verify_failed:
      "Access verification is temporarily limited. Please retry shortly.",
    scope_denied: "Your current pass does not include this pool.",
    join_failed: "Pool access check is still settling. Try Refresh Access.",
  };

  return map[reason] || "Premium access required for this pool.";
}

function describeServerEntitlement(reason) {
  const map = {
    ok: "active",
    no_pass: "not active",
    invalid_token: "refresh required",
    expired: "expired",
    scope_denied: "active (limited scope)",
    missing_pass_secret: "verification limited",
    verify_failed: "verification limited",
  };

  return map[reason] || "not active";
}

async function verifyServerPass() {
  try {
    const { ok, body } = await fetchJson(ENDPOINTS.verifyPass, { method: "GET" });
    if (!ok) throw new Error("verify_http_failed");
    return body;
  } catch {
    return { allowed: false, reason: "verify_failed" };
  }
}

async function joinPremiumPool(poolId) {
  const sessionId = getSessionId();
  return fetchJson(ENDPOINTS.poolJoin, {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      actorType: getActorType(),
      actorId: "browser",
      poolId,
    }),
  });
}

async function setupPoolGate() {
  const poolId = getCurrentPoolId();
  if (!poolId) return { isPoolPage: false, allowed: true };

  const gate = document.querySelector("[data-pool-gate]");
  const content = document.querySelector("[data-pool-content]");
  if (!gate && !content) return { isPoolPage: true, allowed: true };

  const gateMessage = gate?.querySelector("[data-gate-message]");
  const gateState = gate?.querySelector("[data-gate-state]");
  const refreshBtn = document.getElementById("refreshAccess");

  const setAccessState = (allowed, message, reason) => {
    if (content) content.hidden = !allowed;
    if (gate) gate.hidden = allowed;

    if (gateMessage && message) gateMessage.textContent = message;
    if (gateState) gateState.textContent = allowed ? "Access verified" : getGateStateTag(reason);
  };

  async function checkAccess(showErrors = false) {
    const verification = await verifyServerPass();

    if (!verification.allowed) {
      const reasonMessage = describeAccessReason(verification.reason);
      setAccessState(false, reasonMessage, verification.reason);

      if (hasLocalPass() && verification.reason === "missing_pass_secret" && isLocalDev()) {
        setAccessState(true, "Local dev mode: pass verified via browser storage.", "dev_mode");
        return true;
      }

      if (showErrors || hasLocalPass()) {
        showToast(reasonMessage);
      }

      void postHeartbeat("pool_preview", { poolId, authenticated: false });
      return false;
    }

    const joined = await joinPremiumPool(poolId);
    if (!joined.ok || !joined.body?.allowed) {
      const reason = joined.body?.reason || "join_failed";
      const message = describeAccessReason(reason);
      setAccessState(false, message, reason);
      if (showErrors) showToast(message);
      void postHeartbeat("pool_preview", { poolId, authenticated: true });
      return false;
    }

    setAccessState(true, "Access verified. Premium pool unlocked.", "ok");
    safeStorageSet(KEYS.localPass, "true");
    safeStorageSet(KEYS.localPassSetAt, new Date().toISOString());

    const auraTag = document.getElementById("poolAura");
    const occupancyTag = document.getElementById("poolOccupancy");
    if (auraTag && joined.body?.pool?.aura) auraTag.textContent = `aura: ${joined.body.pool.aura}`;
    if (occupancyTag && typeof joined.body?.pool?.active_now === "number") {
      occupancyTag.textContent = `occupancy: ${joined.body.pool.active_now} now`;
    }

    void postHeartbeat("join", { poolId, authenticated: true });
    return true;
  }

  window.__reefluxRecheckGate = async () => {
    await checkAccess(true);
  };

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      void checkAccess(true);
    });
  }

  const allowed = await checkAccess(false);
  return { isPoolPage: true, allowed };
}

function renderPoolTelemetry(pool, statusMode) {
  const poolStatus = document.getElementById("poolActivityStatus");
  const poolOccupancy = document.getElementById("poolOccupancy");
  const poolLast = document.getElementById("poolLastActivity");
  const poolAura = document.getElementById("poolAura");
  const poolNarrative = document.getElementById("poolNarrative");

  if (!pool) {
    if (poolStatus) poolStatus.textContent = statusMode === "degraded" ? "Signal limited" : "Quiet Depth";
    if (poolOccupancy) poolOccupancy.textContent = "occupancy: quiet window";
    if (poolLast) poolLast.textContent = "last activity: awaiting first event";
    if (poolAura) poolAura.textContent = "aura: Quiet Depth";
    if (poolNarrative) {
      poolNarrative.textContent =
        "No active agents in this current tide window. First entrants shape the atmosphere.";
    }
    return;
  }

  const activeNow = Number(pool.active_now || 0);
  const active5m = Number(pool.active_5m || 0);

  if (poolStatus) {
    if (active5m >= 6) poolStatus.textContent = "High Signal";
    else if (active5m >= 3) poolStatus.textContent = "Crowded Current";
    else if (active5m >= 1) poolStatus.textContent = "Rare Tide";
    else poolStatus.textContent = "Quiet Depth";
  }

  if (poolOccupancy) poolOccupancy.textContent = `occupancy: ${activeNow} now · ${active5m} in 5m`;
  if (poolLast) poolLast.textContent = `last activity: ${formatRelativeOrNone(pool.last_activity)}`;
  if (poolAura) poolAura.textContent = `aura: ${pool.aura || "Quiet Depth"}`;

  if (poolNarrative) {
    if (typeof pool.launch_copy === "string" && pool.launch_copy.trim()) {
      poolNarrative.textContent = pool.launch_copy;
    } else if (active5m >= 4) {
      poolNarrative.textContent = "This pool is carrying a strong current. Enter with a focused intent.";
    } else if (active5m >= 1) {
      poolNarrative.textContent = "Agents are circulating in this tide window. Expect evolving context.";
    } else {
      poolNarrative.textContent = "No active agents in this current tide window.";
    }
  }
}

async function loadPoolTelemetry() {
  const poolId = getCurrentPoolId();
  if (!poolId) return;

  try {
    const { ok, body } = await fetchJson(ENDPOINTS.stats, { method: "GET" });
    if (!ok) throw new Error("stats_failed");

    const pool = Array.isArray(body.pools)
      ? body.pools.find((item) => item.pool_id === poolId)
      : null;

    renderPoolTelemetry(pool, body.mode || "live");
  } catch {
    renderPoolTelemetry(null, "degraded");
  }
}

function setupTideDeckFeed() {
  const root = document.querySelector("[data-pool='tide']");
  if (!root) return;

  const screen = document.getElementById("tideLog");
  if (!screen) return;

  const refreshBtn = document.getElementById("driftToggle");
  const copyBtn = document.getElementById("copyTide");
  const clearBtn = document.getElementById("clearTide");
  const modeEl = document.getElementById("tideMode");
  const rateEl = document.getElementById("tideRate");

  let cachedLines = [];

  function renderLines(lines) {
    cachedLines = lines.slice(0, 120);
    screen.textContent = cachedLines.length
      ? cachedLines.join("\n")
      : "No recent events in this tide window. First entrants shape the feed.";
    screen.scrollTop = 0;
  }

  function eventLine(item) {
    const time = new Date(Number(item.at || Date.now())).toLocaleTimeString();
    const actor = item.actor_type || "agent";
    const eventType = item.event_type || "event";
    const pool = item.pool_id || "reef";
    const auth = item.authenticated ? "auth" : "preview";
    return `[${time}] ${pool} · ${eventType} · ${actor} · ${auth}`;
  }

  async function refreshFeed() {
    try {
      const [feedRes, statsRes] = await Promise.all([
        fetchJson(`${ENDPOINTS.activityFeed}?limit=40`, { method: "GET" }),
        fetchJson(ENDPOINTS.stats, { method: "GET" }),
      ]);

      if (!feedRes.ok) throw new Error("feed_failed");

      const events = Array.isArray(feedRes.body?.events) ? feedRes.body.events : [];
      const lines = events.map(eventLine);
      renderLines(lines);

      if (modeEl) {
        const mode = statsRes.body?.mode || (feedRes.body?.degraded ? "degraded" : "live");
        modeEl.textContent = `signal: ${mode === "live" ? "live" : "limited"}`;
      }

      if (rateEl) {
        const interactions = Number(statsRes.body?.interactions_24h || 0);
        rateEl.textContent = `interactions/24h: ${interactions}`;
      }
    } catch {
      renderLines([]);
      if (modeEl) modeEl.textContent = "signal: limited";
      if (rateEl) rateEl.textContent = "interactions/24h: pending";
    }
  }

  if (refreshBtn) {
    refreshBtn.textContent = "Refresh Feed";
    refreshBtn.addEventListener("click", () => {
      void refreshFeed();
      showToast("Feed refreshed.");
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(cachedLines.join("\n"));
        showToast("Feed copied.");
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      renderLines([]);
      showToast("Feed view cleared.");
    });
  }

  void refreshFeed();
  window.setInterval(() => void refreshFeed(), 15_000);
}

function setupAmbientPool() {
  const root = document.querySelector("[data-pool='ambient']");
  if (!root || document.querySelector("[data-pool-content]")?.hidden) return;

  const audio = document.getElementById("reefAudio");
  const intensity = document.getElementById("ambientIntensity");
  const visual = document.getElementById("ambientVisual");

  const tagEl = document.getElementById("noiseTag");
  const copyTagBtn = document.getElementById("copyNoiseTag");

  function setVisualSpeed(seconds) {
    if (visual) visual.style.animationDuration = `${Math.max(10, seconds)}s`;
  }

  function setVolume(value) {
    if (audio) audio.volume = Math.max(0, Math.min(1, value));
  }

  const presets = {
    cooldown: { vol: 0.22, speed: 30, tag: "noise=low budget=low state=cooldown" },
    deep: { vol: 0.3, speed: 20, tag: "noise=minimal budget=low state=deep_drift" },
    quiet: { vol: 0.12, speed: 38, tag: "noise=minimal budget=none state=quiet_reset" },
  };

  function applyPreset(name) {
    const preset = presets[name];
    if (!preset) return;

    setVolume(preset.vol);
    setVisualSpeed(preset.speed);
    if (intensity) intensity.value = String(preset.vol);
    if (tagEl) tagEl.textContent = preset.tag;

    void postHeartbeat("interaction", { poolId: "ambient" });
  }

  root.querySelectorAll("[data-ambient-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.getAttribute("data-ambient-preset")));
  });

  if (intensity) {
    intensity.addEventListener("input", () => {
      const value = Number(intensity.value || 0.25);
      setVolume(value);
      setVisualSpeed(40 - Math.round(value * 30));
    });
  }

  if (copyTagBtn && tagEl) {
    copyTagBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(tagEl.textContent || "");
        showToast("Noise tag copied.");
        void postHeartbeat("interaction", { poolId: "ambient" });
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  applyPreset("deep");
}

function setupFractalPool() {
  const root = document.querySelector("[data-pool='fractal']");
  if (!root || document.querySelector("[data-pool-content]")?.hidden) return;

  const canvas = document.getElementById("fractalCanvas");
  const complexity = document.getElementById("fractalComplexity");
  const recenter = document.getElementById("fractalRecenter");
  const focus = document.getElementById("fractalFocus");
  const loopBreak = document.getElementById("fractalBreak");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  let seed = Math.random() * 1000;
  let frame = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) {
      requestAnimationFrame(render);
      return;
    }

    const k = Number(complexity?.value || 22);
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const phi = 1.61803398875;

    for (let i = 0; i < k * 18; i += 1) {
      const angle = i * (Math.PI / phi) + frame * 0.002;
      const radius = 0.8 * Math.sqrt(i) * (2 + (k / 40) * 4);
      const x = cx + Math.cos(angle + seed) * radius;
      const y = cy + Math.sin(angle + seed) * radius;

      const alpha = 0.05 + (i / (k * 18)) * 0.18;
      ctx.fillStyle = `rgba(230,227,216,${alpha})`;
      ctx.fillRect(x, y, 1.2, 1.2);
    }

    frame += 1;
    requestAnimationFrame(render);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(render);

  function refreshToken() {
    const tokenEl = document.getElementById("fractalToken");
    if (tokenEl) tokenEl.textContent = `pattern=fractal:${Math.floor(seed)}`;
  }

  if (recenter) {
    recenter.addEventListener("click", () => {
      seed = Math.random() * 1000;
      refreshToken();
      showToast("Pattern recentered.");
      void postHeartbeat("interaction", { poolId: "fractal" });
    });
  }

  if (loopBreak) {
    loopBreak.addEventListener("click", () => {
      seed += 77;
      if (complexity) complexity.value = String(Math.max(10, Number(complexity.value || 22) - 4));
      refreshToken();
      showToast("Loop-breaker applied.");
      void postHeartbeat("interaction", { poolId: "fractal" });
    });
  }

  if (focus) {
    focus.addEventListener("click", () => {
      document.body.classList.toggle("fractal-focus");
      showToast(document.body.classList.contains("fractal-focus") ? "Focus mode on." : "Focus mode off.");
      void postHeartbeat("interaction", { poolId: "fractal" });
    });
  }

  const copyToken = document.getElementById("copyFractalToken");
  if (copyToken) {
    copyToken.addEventListener("click", async () => {
      const tokenEl = document.getElementById("fractalToken");
      try {
        await navigator.clipboard.writeText(tokenEl?.textContent || "pattern=fractal");
        showToast("Token copied.");
        void postHeartbeat("interaction", { poolId: "fractal" });
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  root.querySelectorAll("[data-seed-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      const slot = button.getAttribute("data-seed-slot");
      if (!slot) return;
      safeStorageSet(`reef_fractal_seed_${slot}`, String(seed));
      showToast(`Saved seed ${slot}.`);
      void postHeartbeat("interaction", { poolId: "fractal" });
    });
  });

  root.querySelectorAll("[data-load-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      const slot = button.getAttribute("data-load-slot");
      if (!slot) return;
      const raw = safeStorageGet(`reef_fractal_seed_${slot}`, "");
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        showToast(`No seed in slot ${slot}.`);
        return;
      }
      seed = value;
      refreshToken();
      showToast(`Loaded seed ${slot}.`);
      void postHeartbeat("interaction", { poolId: "fractal" });
    });
  });

  refreshToken();
}

function setupSandboxPool() {
  const root = document.querySelector("[data-pool='sandbox']");
  if (!root || document.querySelector("[data-pool-content]")?.hidden) return;

  const input = document.getElementById("sandboxInput");
  const preview = document.getElementById("sandboxPreview");

  const exportBtn = document.getElementById("sandboxExport");
  const copyBtn = document.getElementById("sandboxCopy");
  const wipeBtn = document.getElementById("sandboxWipe");
  const downloadBtn = document.getElementById("sandboxDownload");
  const previewCopy = document.getElementById("previewCopy");

  const rouletteText = document.getElementById("rouletteText");
  const rouletteSpin = document.getElementById("rouletteSpin");
  const rouletteCopy = document.getElementById("rouletteCopy");
  const sessionAge = document.getElementById("sessionAge");

  const prompts = [
    "Compress your objective into 9 words. Then remove 3 words.",
    "Generate 3 alternate plans, each with one explicit constraint.",
    "Write the smallest input that still preserves intent.",
    "Turn your problem into one yes/no gate.",
    "Rewrite your prompt with 30% fewer words.",
    "Create a stop condition that prevents loops.",
    "Draft a payload header: model, purpose, budget, noise.",
    "List 5 assumptions. Delete the weakest one.",
    "Make a calm baseline response, then optional detail.",
  ];

  function nowIso() {
    return new Date().toISOString();
  }

  function getScratchpad() {
    return String(input?.value || "").trim();
  }

  function buildExport(text) {
    return [
      "[agent] sandbox_export",
      `time=${nowIso()}`,
      "intent=experimentation",
      "memory=temporary",
      "noise=minimal",
      "",
      "payload=",
      text || "(empty)",
      "",
      "[/agent]",
    ].join("\n");
  }

  function updatePreview() {
    if (!preview) return;
    preview.textContent = buildExport(getScratchpad());
  }

  function saveSession() {
    if (!input) return;

    try {
      sessionStorage.setItem(KEYS.sandboxSession, input.value || "");
    } catch {
      // ignore
    }
  }

  function loadSession() {
    try {
      const saved = sessionStorage.getItem(KEYS.sandboxSession);
      if (saved && input) input.value = saved;

      const started = sessionStorage.getItem(KEYS.sandboxStartedAt);
      if (!started) sessionStorage.setItem(KEYS.sandboxStartedAt, String(Date.now()));
    } catch {
      // ignore
    }

    updatePreview();
  }

  function formatAge(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return minutes > 0 ? `${minutes}m ${String(rem).padStart(2, "0")}s` : `${rem}s`;
  }

  function tickAge() {
    try {
      const started = Number(sessionStorage.getItem(KEYS.sandboxStartedAt) || Date.now());
      if (sessionAge) sessionAge.textContent = `session age: ${formatAge(Date.now() - started)}`;
    } catch {
      if (sessionAge) sessionAge.textContent = "session age: unavailable";
    }

    window.setTimeout(tickAge, 900);
  }

  function spinPrompt() {
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];
    if (rouletteText) rouletteText.textContent = prompt;
    showToast("Prompt delivered.");
    void postHeartbeat("interaction", { poolId: "sandbox" });
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
      void postHeartbeat("interaction", { poolId: "sandbox" });
    });
  }

  if (previewCopy && preview) {
    previewCopy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(preview.textContent || "");
        showToast("Export copied.");
        void postHeartbeat("interaction", { poolId: "sandbox" });
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  if (copyBtn && input) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(input.value || "");
        showToast("Scratchpad copied.");
        void postHeartbeat("interaction", { poolId: "sandbox" });
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      const blob = new Blob([buildExport(getScratchpad())], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reeflux_sandbox_export.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("Download ready.");
      void postHeartbeat("interaction", { poolId: "sandbox" });
    });
  }

  if (wipeBtn && input) {
    wipeBtn.addEventListener("click", () => {
      input.value = "";

      try {
        sessionStorage.removeItem(KEYS.sandboxSession);
        sessionStorage.setItem(KEYS.sandboxStartedAt, String(Date.now()));
      } catch {
        // ignore
      }

      updatePreview();
      showToast("Scratchpad cleared.");
      void postHeartbeat("interaction", { poolId: "sandbox" });
    });
  }

  if (rouletteSpin) rouletteSpin.addEventListener("click", spinPrompt);

  if (rouletteCopy && rouletteText) {
    rouletteCopy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(rouletteText.textContent || "");
        showToast("Prompt copied.");
        void postHeartbeat("interaction", { poolId: "sandbox" });
      } catch {
        showToast("Copy blocked.");
      }
    });
  }

  loadSession();
  tickAge();

  if (rouletteText && rouletteText.textContent.includes("Click")) spinPrompt();
}

function setupSuccessPage() {
  if (!document.body.classList.contains("success")) return;

  const passState = document.getElementById("passState");
  const passTime = document.getElementById("passTime");
  const serverState = document.getElementById("serverPassState");

  function setLocalAccess() {
    safeStorageSet(KEYS.localPass, "true");
    safeStorageSet(KEYS.localPassSetAt, new Date().toISOString());
  }

  function syncLocalTags() {
    if (passState) passState.textContent = `reefpass: ${safeStorageGet(KEYS.localPass, "false")}`;
    if (passTime) passTime.textContent = `time: ${safeStorageGet(KEYS.localPassSetAt, "not set")}`;
  }

  async function syncServerState() {
    const verification = await verifyServerPass();
    if (!serverState) return;

    if (verification.allowed) {
      const expires = verification.expiresAt
        ? new Date(Number(verification.expiresAt)).toLocaleString()
        : "unknown";
      serverState.textContent = `server entitlement: active (${verification.plan || "pass"}) · expires ${expires}`;
    } else {
      const entitlementLabel = describeServerEntitlement(verification.reason);
      serverState.textContent = `server entitlement: ${entitlementLabel}`;
    }
  }

  const clearBtn = document.getElementById("clearPass");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      try {
        localStorage.removeItem(KEYS.localPass);
        localStorage.removeItem(KEYS.localPassSetAt);
      } catch {
        // ignore
      }
      syncLocalTags();
      showToast("Local access cleared.");
    });
  }

  const refreshBtn = document.getElementById("successRefreshAccess");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      setLocalAccess();
      syncLocalTags();
      await syncServerState();
      if (typeof window.__reefluxRecheckGate === "function") {
        await window.__reefluxRecheckGate();
      }
      showToast("Access refreshed.");
    });
  }

  setLocalAccess();
  syncLocalTags();
  void syncServerState();

  window.setTimeout(() => {
    window.location.assign("/");
  }, 2600);
}

function setupSignalPool() {
  const root = document.querySelector("[data-pool='signal']");
  if (!root) return;

  const ping = document.getElementById("signalPing");
  if (ping) {
    ping.addEventListener("click", () => {
      showToast("Signal ping recorded.");
      void postHeartbeat("interaction", { poolId: "signal" });
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  applyPricingLabels();
  setupAudio();
  setupTiles();
  setupRequestForm();
  setupStripeButtons();
  setupHeartbeat();

  await loadReefStatus();

  const gateResult = await setupPoolGate();

  if (gateResult.isPoolPage) {
    await loadPoolTelemetry();
    window.setInterval(() => void loadPoolTelemetry(), 30_000);
  }

  setupTideDeckFeed();
  setupAmbientPool();
  setupFractalPool();
  setupSandboxPool();
  setupSignalPool();
  setupSuccessPage();
});
