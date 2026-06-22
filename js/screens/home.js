import { loadQuizzes, loadStats, getStreak, loadProgress } from "../store.js";
import { navigate } from "../router.js";
import { getAccount } from "../firebase-sync.js";

export async function render(root) {
  const quizzes = await loadQuizzes();
  const stats = await loadStats();
  const { current: streak, max: maxStreak } = getStreak(stats);
  const progress = await loadProgress();
  const account = getAccount();

  let html = "";

  // Welcome
  html += `<div class="welcome">
    <h2>👋 Willkommen zurück!</h2>
    <p>Bereit zum Lernen?</p>
    ${account ? `<small style="opacity:0.8">👤 ${account.email}</small>` : ""}
  </div>`;

  // Streak
  if (streak > 0 || maxStreak > 0) {
    const fire = streak >= 3 ? "🔥" : "⚡";
    html += `<div class="streak-bar">
      <span class="streak-fire">${fire}</span>
      <div class="streak-info">
        <strong>${streak} Tage Streak</strong>
        <small>Bester: ${maxStreak} Tage</small>
      </div>
    </div>`;
  }

  // Daily
  html += `<div class="daily-card" id="daily-btn">
    <span class="daily-icon">📅</span>
    <div class="daily-info">
      <h3>Tägliches Lernen</h3>
      <p>Personalisierte Wiederholung starten</p>
    </div>
    <span style="font-size:1.2rem">›</span>
  </div>`;

  // Main grid 2×2
  const nq = quizzes.length;
  html += `<div class="grid-2">
    <div class="grid-card" data-nav="my-quizzes">
      <div class="icon">📚</div>
      <div class="title">Meine Quizze</div>
      <div class="desc">${nq} Quizze</div>
    </div>
    <div class="grid-card" data-nav="editor">
      <div class="icon">➕</div>
      <div class="title">Quiz erstellen</div>
      <div class="desc">Eigenes Quiz</div>
    </div>
    <div class="grid-card" data-nav="stats">
      <div class="icon">📊</div>
      <div class="title">Statistik</div>
      <div class="desc">Lernfortschritt</div>
    </div>
    <div class="grid-card" data-nav="settings">
      <div class="icon">⚙️</div>
      <div class="title">Einstellungen</div>
      <div class="desc">Konto & Theme</div>
    </div>
  </div>`;

  // More tools
  html += `<div class="more-toggle"><button id="more-btn">▼ Weitere Tools</button></div>`;
  html += `<div class="grid-4 hidden" id="more-grid">
    <div class="grid-card mini-card" data-nav="my-quizzes"><div class="icon">✏️</div><div class="title">Quizze</div></div>
    <div class="grid-card mini-card" data-nav="stats"><div class="icon">📊</div><div class="title">Stats</div></div>
    <div class="grid-card mini-card" data-nav="settings"><div class="icon">⚙️</div><div class="title">Settings</div></div>
    <div class="grid-card mini-card" data-nav="sync"><div class="icon">☁️</div><div class="title">Sync</div></div>
  </div>`;

  // Recent quizzes preview
  if (quizzes.length > 0) {
    html += `<div class="section-title">Zuletzt</div>`;
    for (const quiz of quizzes.slice(0, 3)) {
      const n = quiz.questions?.length ?? 0;
      const boxCounts = getBoxCounts(quiz, progress);
      html += `<div class="quiz-row" data-quiz-id="${quiz.id}">
        <div class="quiz-accent"></div>
        <div class="quiz-info">
          <h4>${esc(quiz.name)}</h4>
          <small>${n} Fragen</small>
        </div>
        <div class="quiz-boxes">
          ${[1,2,3,4,5].map(b => `<span class="quiz-box box-${b}">${boxCounts[b]||0}</span>`).join("")}
        </div>
        <span style="color:var(--text-light)">›</span>
      </div>`;
    }
  } else {
    html += `<div class="empty">Noch keine Quizze.<br>Synchronisiere oder importiere welche!</div>`;
  }

  root.innerHTML = html;

  // Events
  root.querySelector("#daily-btn")?.addEventListener("click", () => navigate("daily"));
  root.querySelector("#more-btn")?.addEventListener("click", () => {
    const grid = root.querySelector("#more-grid");
    const btn = root.querySelector("#more-btn");
    grid.classList.toggle("hidden");
    btn.textContent = grid.classList.contains("hidden") ? "▼ Weitere Tools" : "▲ Weniger anzeigen";
  });

  root.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.nav));
  });
  root.querySelectorAll("[data-quiz-id]").forEach((el) => {
    el.addEventListener("click", () => navigate("quiz-modes", { quizId: el.dataset.quizId }));
  });
}

function getBoxCounts(quiz, progress) {
  const counts = {};
  for (const q of (quiz.questions || [])) {
    const b = progress[q.id]?.box ?? 1;
    counts[b] = (counts[b] || 0) + 1;
  }
  return counts;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
