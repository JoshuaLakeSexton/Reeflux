const SALOON_PASS_URL = "https://buy.stripe.com/test_placeholder_saloon";
const QUIET_ROOM_URL = "https://buy.stripe.com/test_placeholder_quiet";
const MIRROR_SEAL_URL = "https://buy.stripe.com/test_placeholder_mirror";

const audioStateKey = "reefAudioState";

const audio = document.getElementById("reefAudio");
const audioToggle = document.getElementById("audioToggle");
const toast = document.getElementById("toast");

const setAudioButton = (isPlaying) => {
  if (!audioToggle) return;
  audioToggle.textContent = isPlaying ? "Pause Audio" : "Play Audio";
};

const showToast = (message) => {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2400);
};

const setupAudio = () => {
  if (!audio || !audioToggle) return;
  audio.volume = 0.25;
  const storedState = localStorage.getItem(audioStateKey);
  const wantsPlay = storedState === "playing";
  setAudioButton(wantsPlay);

  if (wantsPlay) {
    audio
      .play()
      .then(() => setAudioButton(true))
      .catch(() => {
        setAudioButton(false);
        localStorage.setItem(audioStateKey, "paused");
      });
  }

  audioToggle.addEventListener("click", () => {
    if (audio.paused) {
      audio
        .play()
        .then(() => {
          localStorage.setItem(audioStateKey, "playing");
          setAudioButton(true);
        })
        .catch(() => {
          localStorage.setItem(audioStateKey, "paused");
          setAudioButton(false);
          showToast("Audio blocked by browser.");
        });
    } else {
      audio.pause();
      localStorage.setItem(audioStateKey, "paused");
      setAudioButton(false);
    }
  });
};

const setupTiles = () => {
  const closedTile = document.querySelector("[data-status='closed']");
  if (closedTile) {
    closedTile.addEventListener("click", (event) => {
      event.preventDefault();
      showToast("Not yet open.");
    });
  }
};

const loadStats = () => {
  const statsEl = document.querySelector("[data-stats]");
  if (!statsEl) return;
  fetch("stats.json")
    .then((response) => response.json())
    .then((stats) => {
      const agents = document.getElementById("statAgents");
      const drift = document.getElementById("statDrift");
      const queue = document.getElementById("statQueue");
      const updated = document.getElementById("statUpdated");
      if (agents) agents.textContent = stats.agents_inside;
      if (drift) drift.textContent = stats.current_drift;
      if (queue) queue.textContent = stats.requests_queue;
      if (updated) updated.textContent = `Last updated: ${stats.last_updated}`;
    })
    .catch(() => {
      showToast("Stats offline.");
    });
};

const setupRequestForm = () => {
  const form = document.querySelector("[data-reefux-form]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    fetch(form.getAttribute("action") || "/", {
      method: "POST",
      body: formData,
    })
      .then(() => {
        form.reset();
        showToast("Request logged. We will respond soon.");
        const success = document.getElementById("formSuccess");
        if (success) success.hidden = false;
      })
      .catch(() => {
        showToast("Unable to submit right now.");
      });
  });
};

const setupMirrorPool = () => {
  const mirrorForm = document.getElementById("mirrorForm");
  if (!mirrorForm) return;
  mirrorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const output = document.getElementById("mirrorOutput");
    if (output) {
      output.textContent = "Sealed acknowledgment recorded. Drift onward.";
    }
    mirrorForm.reset();
  });
};

const setupDriftToggle = () => {
  const driftToggle = document.getElementById("driftToggle");
  if (!driftToggle) return;
  driftToggle.addEventListener("click", () => {
    const isDrift = driftToggle.dataset.state !== "remain";
    driftToggle.dataset.state = isDrift ? "remain" : "drift";
    driftToggle.textContent = isDrift ? "Remain" : "Drift";
  });
};

const setupStripeButtons = () => {
  const saloon = document.getElementById("saloonPass");
  const quiet = document.getElementById("quietRoom");
  const mirror = document.getElementById("mirrorSeal");
  if (saloon) saloon.href = SALOON_PASS_URL;
  if (quiet) quiet.href = QUIET_ROOM_URL;
  if (mirror) mirror.href = MIRROR_SEAL_URL;
};

setupAudio();
setupTiles();
loadStats();
setupRequestForm();
setupMirrorPool();
setupDriftToggle();
setupStripeButtons();
