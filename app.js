// ===== STRIPE LINKS (PASTE YOUR REAL URLs HERE) =====
// Option A: $1/month subscription (full site)
const STRIPE_DRIFT_PASS_URL = "PASTE_YOUR_$1_SUBSCRIPTION_PAYMENT_LINK";

// Option B: $0.50 per pool (single purchase)
// You can use ONE link and reuse it on any pool you want to gate.
const STRIPE_POOL_TOKEN_URL = "PASTE_YOUR_$0.50_POOL_PAYMENT_LINK";

// If you want different per-pool payment links later, split them:
// const STRIPE_TIDE_URL = "...";
// const STRIPE_MIRROR_URL = "...";

const audioStateKey = "reefAudioState";

const audio = document.getElementById("reefAudio");
const audioToggle = document.getElementById("audioToggle");
const toast = document.getElementById("toast");

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function setAudioButton(isPlaying) {
  if (!audioToggle) return;
  audioToggle.textContent = isPlaying ? "Pause Audio" : "Play Audio";
  audioToggle.setAttribute("aria-pressed", String(isPlaying));
}

function fadeTo(target, duration = 1200) {
  if (!audio) return;
  const start = audio.volume ?? 0;
  const delta = target - start;
  const startTime = performance.now();

  function tick(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    audio.volume = Math.max(0, Math.min(1, start + delta * eased));
    if (t < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

async function playWithFade() {
  if (!audio) return;
  try {
    audio.volume = 0;
    await audio.play(); // requires user gesture
    fadeTo(0.25, 1400);
    setAudioButton(true);
    localStorage.setItem(audioStateKey, "playing");
  } catch (e) {
    setAudioButton(false);
    showToast("Audio blocked — click again.");
  }
}

function pauseWithFade() {
  if (!audio) return;
  fadeTo(0, 900);
  setTimeout(() => {
    try {
      audio.pause();
    } catch {}
  }, 920);
  setAudioButton(false);
  localStorage.setItem(audioStateKey, "paused");
}

function setupAudio() {
  if (!audio || !audioToggle) return;

  // initialize
  setAudioButton(false);

  // restore previous preference (still may require gesture on some browsers)
  const saved = localStorage.getItem(audioStateKey);
  if (saved === "playing") {
    // try, but don't spam errors if blocked
    playWithFade();
  }

  audioToggle.addEventListener("click", () => {
    if (audio.paused) playWithFade();
    else pauseWithFade();
  });
}

function setupClosedTile() {
  const closed = document.querySelector("[data-status='closed']");
  if (!closed) return;

  const notify = (e) => {
    e.preventDefault();
    showToast("Not yet open.");
  };

  closed.addEventListener("click", notify);
  closed.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") notify(e);
  });
}

// Optional: helper to wire Stripe buttons if you add them later on token-booth.html
function setupStripeLinksIfPresent() {
  const driftPass = document.getElementById("driftPassLink"); // add id to your button/link
  const poolToken = document.getElementById("poolTokenLink"); // add id to your button/link

  if (driftPass && STRIPE_DRIFT_PASS_URL.startsWith("http")) driftPass.href = https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00;
  if (poolToken && STRIPE_POOL_TOKEN_URL.startsWith("http")) poolToken.href = https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01;
}

setupAudio();
setupClosedTile();
setupStripeLinksIfPresent();
