// ===== Stripe Payment Links (paste your real Stripe "Payment Link" URLs here) =====
// Subscription: Reeflux Drift Pass ($/month)
const DRIFT_PASS_URL = https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00;

// One-time pool unlocks ($0.50 each)
const TIDE_DECK_URL = https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01;
const MIRROR_POOL_URL = https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01;
const QUIET_ROOM_URL = https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01;

// ===== Audio =====
const AUDIO_KEY = "reeflux_audio_state"; // "playing" | "paused"
const audio = document.getElementById("reefAudio");
const audioToggle = document.getElementById("audioToggle");
const toast = document.getElementById("toast");

const FADE_MS = 200;
const TARGET_VOL = 0.26;

function showToast(msg){
  if(!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(()=>toast.classList.remove("show"), 2200);
}

function setAudioUI(isPlaying){
  if(!audioToggle) return;
  audioToggle.textContent = isPlaying ? "Pause Audio" : "Play Audio";
  audioToggle.setAttribute("aria-pressed", String(isPlaying));
}

function fadeTo(target){
  if(!audio) return;
  const start = audio.volume ?? 0;
  const t0 = performance.now();

  function step(t){
    const p = Math.min(1, (t - t0) / FADE_MS);
    const v = start + (target - start) * p;
    audio.volume = Math.max(0, Math.min(1, v));
    if(p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

async function playWithFade(){
  if(!audio) return;
  audio.volume = 0;
  try{
    await audio.play();               // requires user gesture unless previously allowed
    fadeTo(TARGET_VOL);
    localStorage.setItem(AUDIO_KEY, "playing");
    setAudioUI(true);
  }catch(e){
    setAudioUI(false);
    showToast("Tap Play Audio to start.");
  }
}

function pauseWithFade(){
  if(!audio) return;
  fadeTo(0);
  window.setTimeout(()=>{
    audio.pause();
  }, FADE_MS);
  localStorage.setItem(AUDIO_KEY, "paused");
  setAudioUI(false);
}

function setupAudio(){
  if(!audio || !audioToggle) return;

  // If previously playing, try to resume (may still be blocked by browser)
  const saved = localStorage.getItem(AUDIO_KEY);
  setAudioUI(saved === "playing");

  if(saved === "playing"){
    // attempt (may fail without gesture)
    playWithFade();
  }

  audioToggle.addEventListener("click", async ()=>{
    if(audio.paused) await playWithFade();
    else pauseWithFade();
  });
}

// ===== Tiles / buttons =====
function setupClosedTiles(){
  document.querySelectorAll("[data-status='closed']").forEach((el)=>{
    el.addEventListener("click", (e)=>{
      e.preventDefault();
      showToast("Closed. Drift later.");
    });
  });
}

// ===== Stripe link wiring (Token Booth page) =====
function setupStripeLinks(){
  const elSub = document.getElementById("buyDriftPass");
  const elTide = document.getElementById("buyTideDeck");
  const elMirror = document.getElementById("buyMirrorPool");
  const elQuiet = document.getElementById("buyQuietRoom");

  if(elSub) elSub.href = https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00;
  if(elTide) elTide.href = https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01;
  if(elMirror) elMirror.href = https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01;
  if(elQuiet) elQuiet.href = https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01;
}

// ===== Requests form (Netlify Forms works without JS; this is just UX toast) =====
function setupRequestsForm(){
  const form = document.querySelector("[data-reeflux-form]");
  if(!form) return;
  form.addEventListener("submit", ()=>{
    showToast("Request sent.");
  });
}

// ===== Init =====
setupAudio();
setupClosedTiles();
setupStripeLinks();
setupRequestsForm();
