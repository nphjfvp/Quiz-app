import { loadQuizzes, loadStats, getStreak, loadProgress, loadMarked, loadErrorDiary } from "../store.js";
import { navigate } from "../router.js";
import { getAccount } from "../firebase-sync.js";

export async function render(root) {
  const [quizzes, stats, progress, account, marked, diary] = await Promise.all([
    loadQuizzes(), loadStats(), loadProgress(), Promise.resolve(getAccount()),
    loadMarked(), loadErrorDiary(),
  ]);
  const { current: streak, max: maxStreak } = getStreak(stats);

  let html = "";

  html += `<div class="welcome">
    <h2>👋 Willkommen zurück!</h2>
    <p>Bereit zum Lernen?</p>
    ${account ? `<small style="opacity:0.8">👤 ${esc(account.email)}</small>` : ""}
  </div>`;

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

  html += `<div class="daily-card" id="daily-btn">
    <span class="daily-icon">📅</span>
    <div class="daily-info">
      <h3>Tägliches Lernen</h3>
      <p>Personalisierte Wiederholung starten</p>
    </div>
    <span style="font-size:1.2rem">›</span>
  </div>`;

  const nq = quizzes.length;
  html += `<div class="grid-2">
    <div class="grid-card" data-nav="my-quizzes">
      <div class="icon">📚</div>
      <div class="title">Meine Quizze</div>
      <div class="desc">${nq} Quizze</div>
    </div>
    <div class="grid-card" data-nav="ai-generate">
      <div class="icon">🤖</div>
      <div class="title">KI-Generator</div>
      <div class="desc">Quiz aus Text</div>
    </div>
    <div class="grid-card" data-nav="editor">
      <div class="icon">✏️</div>
      <div class="title">Quiz erstellen</div>
      <div class="desc">Manuell</div>
    </div>
    <div class="grid-card" data-nav="stats">
      <div class="icon">📊</div>
      <div class="title">Statistik</div>
      <div class="desc">Lernfortschritt</div>
    </div>
  </div>`;

  html += `<div class="more-toggle"><button id="more-btn">▼ Weitere Tools</button></div>`;
  html += `<div class="grid-4 hidden" id="more-grid">
    <div class="grid-card mini-card" data-nav="tutor"><div class="icon">💬</div><div class="title">KI-Tutor</div></div>
    <div class="grid-card mini-card" data-nav="pomodoro"><div class="icon">🍅</div><div class="title">Pomodoro</div></div>
    <div class="grid-card mini-card" data-nav="marked"><div class="icon">⭐</div><div class="title">Markiert</div></div>
    <div class="grid-card mini-card" data-nav="error-diary"><div class="icon">📕</div><div class="title">Fehler</div></div>
  </div>
  <div class="grid-4 hidden" id="more-grid-2" style="margin-top:-6px">
    <div class="grid-card mini-card" data-nav="folders"><div class="icon">📁</div><div class="title">Ordner</div></div>
    <div class="grid-card mini-card" data-nav="sync"><div class="icon">☁️</div><div class="title">Sync</div></div>
    <div class="grid-card mini-card" data-nav="settings"><div class="icon">⚙️</div><div class="title">Settings</div></div>
  </div>`;

  if (marked.length > 0) {
    html += `<div class="quiz-row" data-nav="marked" style="border-left:3px solid var(--warning)">
      <div class="quiz-accent" style="background:var(--warning)"></div>
      <div class="quiz-info"><h4>⭐ ${marked.length} markierte Fragen</h4><small>Zum Wiederholen</small></div>
      <span style="color:var(--text-light)">›</span>
    </div>`;
  }
  if (diary.length > 0) {
    html += `<div class="quiz-row" data-nav="error-diary" style="border-left:3px solid var(--danger)">
      <div class="quiz-accent" style="background:var(--danger)"></div>
      <div class="quiz-info"><h4>📕 ${diary.length} Fehlereinträge</h4><small>Fehler analysieren</small></div>
      <span style="color:var(--text-light)">›</span>
    </div>`;
  }

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
    html += `<div class="empty">Noch keine Quizze.<br>Erstelle eins mit der KI oder manuell!</div>`;
  }

  root.innerHTML = html;

  root.querySelector("#daily-btn")?.addEventListener("click", () => navigate("daily"));
  root.querySelector("#more-btn")?.addEventListener("click", () => {
    const grid = root.querySelector("#more-grid");
    const grid2 = root.querySelector("#more-grid-2");
    const btn = root.querySelector("#more-btn");
    const hidden = grid.classList.contains("hidden");
    grid.classList.toggle("hidden");
    grid2.classList.toggle("hidden");
    btn.textContent = hidden ? "▲ Weniger anzeigen" : "▼ Weitere Tools";
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
