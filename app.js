const audio = document.getElementById("reefAudio");
const audioToggle = document.getElementById("audioToggle");

let isPlaying = false;
const TARGET_VOLUME = 0.25;
const FADE_TIME = 1200;

audio.volume = 0;

function fadeTo(target) {
  const step = 50;
  const delta = (target - audio.volume) / (FADE_TIME / step);
  const interval = setInterval(() => {
    audio.volume = Math.max(0, Math.min(1, audio.volume + delta));
    if (Math.abs(audio.volume - target) < 0.02) {
      audio.volume = target;
      clearInterval(interval);
    }
  }, step);
}

audioToggle.addEventListener("click", async () => {
  if (!isPlaying) {
    try {
      await audio.play();
      fadeTo(TARGET_VOLUME);
      audioToggle.textContent = "Pause Audio";
      isPlaying = true;
      localStorage.setItem("reefAudio", "on");
    } catch {}
  } else {
    fadeTo(0);
    setTimeout(() => audio.pause(), FADE_TIME);
    audioToggle.textContent = "Play Audio";
    isPlaying = false;
    localStorage.setItem("reefAudio", "off");
  }
});

if (localStorage.getItem("reefAudio") === "on") {
  audioToggle.click();
}
const DRIFT_PASS_URL = https://buy.stripe.com/aFacN75Kj64hbSR3DL6wE00;
const POOL_KEY_URL  = https://buy.stripe.com/eVq8wR4Gf1O14qp0rz6wE01;

