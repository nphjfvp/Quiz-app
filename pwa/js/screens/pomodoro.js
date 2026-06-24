import { navigate } from "../router.js";

const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 500);
  } catch (_) { /* audio not available */ }
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export async function render(root) {
  let phase = "focus"; // "focus" | "break"
  let remaining = FOCUS_SECONDS;
  let running = false;
  let rounds = 0;
  let intervalId = null;

  function totalForPhase() {
    return phase === "focus" ? FOCUS_SECONDS : BREAK_SECONDS;
  }

  function progressPct() {
    const total = totalForPhase();
    return Math.max(0, Math.min(100, ((total - remaining) / total) * 100));
  }

  function renderUI() {
    const phaseLabel = phase === "focus" ? "🎯 Fokus" : "☕ Pause";
    const phaseColor = phase === "focus" ? "var(--primary)" : "var(--success)";

    root.innerHTML = `<button class="back-btn" id="back-btn">‹ Zurück</button>
      <div class="section-title">🍅 Pomodoro-Timer</div>

      <div class="card pomo-card">
        <div class="pomo-phase">${phaseLabel}</div>

        <div class="pomo-ring">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="var(--border)" stroke-width="6"/>
            <circle cx="50" cy="50" r="44" fill="none" stroke="${phaseColor}" stroke-width="6"
              stroke-dasharray="${2 * Math.PI * 44}"
              stroke-dashoffset="${2 * Math.PI * 44 * (1 - progressPct() / 100)}"
              stroke-linecap="round"/>
          </svg>
          <div class="pomo-time">${formatTime(remaining)}</div>
        </div>

        <div class="btn-row mb-row" style="justify-content:center">
          <button class="btn btn-primary btn-sm" id="start-pause">${running ? "Pause" : "Start"}</button>
          <button class="btn btn-ghost btn-sm" id="reset">Reset</button>
        </div>

        <div class="pomo-rounds">Abgeschlossene Runden: <strong>${rounds}</strong></div>
      </div>`;

    root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));

    root.querySelector("#start-pause").addEventListener("click", () => {
      if (running) {
        pause();
      } else {
        start();
      }
    });

    root.querySelector("#reset").addEventListener("click", () => {
      pause();
      phase = "focus";
      remaining = FOCUS_SECONDS;
      renderUI();
    });
  }

  function tick() {
    remaining--;
    if (remaining <= 0) {
      playBeep();
      if (phase === "focus") {
        rounds++;
        phase = "break";
        remaining = BREAK_SECONDS;
      } else {
        phase = "focus";
        remaining = FOCUS_SECONDS;
      }
    }
    renderUI();
  }

  function start() {
    running = true;
    intervalId = setInterval(tick, 1000);
    renderUI();
  }

  function pause() {
    running = false;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    renderUI();
  }

  renderUI();

  return () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}
