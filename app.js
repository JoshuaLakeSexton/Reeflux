// ===== Stripe Payment Links (paste your real Stripe "Payment Link" URLs here) =====
// Subscription: Reeflux Drift Pass ($/month)
const DRIFT_PASS_URL = "https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00";

// One-time pool unlocks ($0.50 each)
const TIDE_DECK_URL = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";
const MIRROR_POOL_URL = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";
const QUIET_ROOM_URL = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";

// ===== Audio =====
const AUDIO_KEY = "reeflux_audio_state"; // "playing" | "paused"
const audio = document.getElementById("reefAudio");
const audioToggle = document.getElementById("audioToggle");
const toast = document.getElementById("toast");

const FADE_MS = 1200;
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
    await audio.play();
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
  window.setTimeout(()=> audio.pause(), FADE_MS);
  localStorage.setItem(AUDIO_KEY, "paused");
  setAudioUI(false);
}

function setupAudio(){
  if(!audio || !audioToggle) return;

  const saved = localStorage.getItem(AUDIO_KEY);
  setAudioUI(saved === "playing");

  if(saved === "playing"){
    playWithFade(); // may be blocked unless previously allowed
  }

  audioToggle.addEventListener("click", async ()=>{
    if(audio.paused) await playWithFade();
    else pauseWithFade();
  });
}

// ===== Closed tiles =====
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

  if(elSub) elSub.href = "https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00";
  if(elTide) elTide.href = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";
  if(elMirror) elMirror.href = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";
  if(elQuiet) elQuiet.href = "https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01";
}

// ===== Requests form UX toast (Netlify Forms works without JS too) =====
function setupRequestsForm(){
  const form = document.querySelector("[data-reeflux-form]");
  if(!form) return;
  form.addEventListener("submit", ()=>{
    showToast("Request sent.");
  });
}

// ===== Tide Deck Logs (local, persistent) =====
const TIDE_KEY = "reeflux_tide_logs_v1";
const TIDE_MAX = 30;

function nowStamp(){
  const d = new Date();
  // readable but compact
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function randFrom(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

function generateTideMessage(){
  const a = [
    "reef-light ripples",
    "low-frequency hush",
    "pixel foam drifts",
    "salt-glow signal",
    "quiet current",
    "soft refract",
    "blue-green shimmer",
    "warm coral ember"
  ];
  const b = [
    "stabilizing",
    "settling",
    "aligning",
    "recalibrating",
    "diffusing",
    "holding",
    "listening",
    "routing"
  ];
  const c = [
    "toward Tide Deck",
    "toward Mirror Pool",
    "toward Quiet Room",
    "toward Operator",
    "through the back channel",
    "through shallow water",
    "into slow time",
    "into calm"
  ];
  return `${randFrom(a)} · ${randFrom(b)} · ${randFrom(c)}`;
}

function readTideLogs(){
  try{
    const raw = localStorage.getItem(TIDE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}

function writeTideLogs(logs){
  localStorage.setItem(TIDE_KEY, JSON.stringify(logs.slice(0, TIDE_MAX)));
}

function renderTideLogs(){
  const list = document.getElementById("tideList");
  const empty = document.getElementById("tideEmpty");
  if(!list || !empty) return;

  const logs = readTideLogs();
  list.innerHTML = "";

  if(logs.length === 0){
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  logs.forEach((item)=>{
    const row = document.createElement("div");
    row.className = "panel";
    row.style.padding = "10px 12px";
    row.style.background = "rgba(0,0,0,.18)";
    row.style.borderRadius = "14px";

    const top = document.createElement("div");
    top.style.display = "flex";
    top.style.justifyContent = "space-between";
    top.style.gap = "10px";
    top.style.alignItems = "baseline";

    const stamp = document.createElement("div");
    stamp.textContent = item.ts;
    stamp.style.fontFamily = "VT323, monospace";
    stamp.style.fontSize = "20px";
    stamp.style.opacity = "0.9";

    const tag = document.createElement("div");
    tag.textContent = item.tag || "deck";
    tag.style.fontFamily = "VT323, monospace";
    tag.style.fontSize = "18px";
    tag.style.opacity = "0.7";

    const msg = document.createElement("div");
    msg.textContent = item.msg;
    msg.style.marginTop = "6px";
    msg.style.color = "rgba(230,227,216,.82)";
    msg.style.lineHeight = "1.35";

    top.appendChild(stamp);
    top.appendChild(tag);
    row.appendChild(top);
    row.appendChild(msg);

    list.appendChild(row);
  });
}

function addTideLog(customMsg){
  const logs = readTideLogs();
  const entry = {
    ts: nowStamp(),
    tag: "tide",
    msg: customMsg || generateTideMessage()
  };
  logs.unshift(entry);
  writeTideLogs(logs);
  renderTideLogs();
  showToast("Tide log recorded.");
}

function setupTideDeck(){
  // only runs on tide-deck page (elements exist)
  const btn = document.getElementById("makeTideLog");
  const clear = document.getElementById("clearTideLogs");
  const list = document.getElementById("tideList");
  if(!list) return;

  renderTideLogs();

  // auto-generate one on visit if empty OR if last is older than ~6 hours
  const logs = readTideLogs();
  const shouldAuto = logs.length === 0;
  if(shouldAuto) addTideLog("first drift · deck wakes · signal begins");

  if(btn){
    btn.addEventListener("click", ()=> addTideLog());
  }
  if(clear){
    clear.addEventListener("click", ()=>{
      localStorage.removeItem(TIDE_KEY);
      renderTideLogs();
      showToast("Logs cleared.");
    });
  }
}

// ===== Init =====
setupAudio();
setupClosedTiles();
setupStripeLinks();
setupRequestsForm();
setupTideDeck();
