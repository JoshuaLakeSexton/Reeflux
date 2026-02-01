/* =========================
   Stripe Payment Links
========================= */
const SALOON_PASS_URL = "https://buy.stripe.com/test_placeholder_saloon";
const QUIET_ROOM_URL = "https://buy.stripe.com/test_placeholder_quiet";
const MIRROR_SEAL_URL = "https://buy.stripe.com/test_placeholder_mirror";

/* =========================
   Elements
========================= */
const audio = document.getElementById("reefAudio");
const audioToggle = document.getElementById("audioToggle");
const toast = document.getElementById("toast");

const AUDIO_STATE_KEY = "reefAudioState";
const TARGET_VOLUME = 0.25;
const FADE_DURATION = 100;

/* =========================
   Toast
========================= */
function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2400);
}

/* =========================
   Ambient Audio (Fade In/Out)
========================= */
let fadeInterval = null;

function fadeTo(target) {
  if (!audio) return;
  clearInterval(fadeInterval);

  const stepTime = 10;
  const steps = FADE_DURATION / stepTime;
  const delta = (target - audio.volume) / steps;

  fadeInterval = setInterval(() => {
    audio.volume = Math.max(0, Math.min(1, audio.volume + delta));
    if (Math.abs(audio.volume - target) < 0.02) {
      audio.volume = target;
      clearInterval(fadeInterval);
    }
  }, stepTime);
}

function setAudioButton(isPlaying) {
  if (!audioToggle) return;
  audioToggle.textContent = isPlaying ? "Pause Audio" : "Play Audio";
}

function setupAudio() {
  if (!audio || !audioToggle) return;

  audio.volume = 0;

  // Restore previous state
  const saved = localStorage.getItem(AUDIO_STATE_KEY);
  if (saved === "playing") {
    audio.play()
      .then(() => {
        fadeTo(TARGET_VOLUME);
        setAudioButton(true);
      })
      .catch(() => {
        setAudioButton(false);
      });
  }

  audioToggle.addEventListener("click", async () => {
    if (audio.paused) {
      try {
        await audio.play();
        fadeTo(TARGET_VOLUME);
        setAudioButton(true);
        localStorage.setItem(AUDIO_STATE_KEY, "playing");
      } catch {
        showToast("Tap to enable audio");
      }
    } else {
      fadeTo(0);
      setTimeout(() => audio.pause(), FADE_DURATION);
      setAudioButton(false);
      localStorage.setItem(AUDIO_STATE_KEY, "paused");
    }
  });
}

/* =========================
   Bento Tile Behavior
========================= */
function setupTiles() {
  const closedTile = document.querySelector("[data-status='closed']");
  if (!closedTile) return;

  closedTile.addEventListener("click", (e) => {
    e.preventDefault();
    showToast("Not yet open.");
  });
}

/* =========================
   Stats Loader
========================= */
function loadStats() {
  const statsEl = document.querySelector("[data-stats]");
  if (!statsEl) return;

  fetch("/stats.json")
    .then((res) => res.json())
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

/* =========================
   Request Form (Netlify)
========================= */
function setupRequestForm() {
  const form = document.querySelector("[data-reefux-form]");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);

    fetch(form.getAttribute("action") || "/", {
      method: "POST",
      body: data,
    })
      .then(() => {
        form.reset();
        showToast("Request logged.");
      })
      .catch(() => showToast("Submission failed."));
  });
}

/* =========================
   Mirror Pool
========================= */
function setupMirrorPool() {
  const form = document.getElementById("mirrorForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const output = document.getElementById("mirrorOutput");
    if (output) {
      output.textContent = "Sealed acknowledgment recorded. Drift onward.";
    }
    form.reset();
  });
}

/* =========================
   Drift Toggle
========================= */
function setupDriftToggle() {
  const toggle = document.getElementById("driftToggle");
  if (!toggle) return;

  toggle.addEventListener("click", () => {
    const drifting = toggle.dataset.state !== "remain";
    toggle.dataset.state = drifting ? "remain" : "drift";
    toggle.textContent = drifting ? "Remain" : "Drift";
  });
}

/* =========================
   Stripe Buttons
========================= */
function setupStripeButtons() {
  const saloon = document.getElementById("saloonPass");
  const quiet = document.getElementById("quietRoom");
  const mirror = document.getElementById("mirrorSeal");

  if (saloon) saloon.href = SALOON_PASS_URL;
  if (quiet) quiet.href = QUIET_ROOM_URL;
  if (mirror) mirror.href = MIRROR_SEAL_URL;
}

/* =========================
   Init
========================= */
setupAudio();
setupTiles();
loadStats();
setupRequestForm();
setupMirrorPool();
setupDriftToggle();
setupStripeButtons();
