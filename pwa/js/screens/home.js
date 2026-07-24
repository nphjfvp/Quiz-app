import { loadQuizzes, loadStats, getStreak, loadProgress, loadMarked, loadErrorDiary, loadProfile, loadCoins, addCoins, loadAchievements, saveAchievements, loadRecents, loadSubjects } from "../store.js";
import { navigate } from "../router.js";
import { getAccount } from "../firebase-sync.js";
import { esc, getBoxCounts } from "../utils.js";
import { renderAvatarSVG, HOUSE_LEVELS } from "../shop-catalog.js";

export async function render(root) {
  const [quizzes, stats, progress, account, marked, diary, profile, coins, recents, subjects] = await Promise.all([
    loadQuizzes(), loadStats(), loadProgress(), Promise.resolve(getAccount()),
    loadMarked(), loadErrorDiary(), loadProfile(), loadCoins(), loadRecents().catch(() => []),
    loadSubjects().catch(() => []),
  ]);
  const { current: streak, max: maxStreak } = getStreak(stats);

  // Streak milestone coin rewards (once per milestone)
  const STREAK_REWARDS = [[3, 15], [7, 30], [14, 50], [30, 100]];
  let streakBonus = 0;
  try {
    const ach = await loadAchievements();
    for (const [days, reward] of STREAK_REWARDS) {
      const key = `streak_coins_${days}`;
      if (streak >= days && !ach[key]) {
        ach[key] = Date.now();
        streakBonus += reward;
      }
    }
    if (streakBonus > 0) {
      await addCoins(streakBonus, "streak-bonus");
      await saveAchievements(ach);
    }
  } catch (_) {}

  let html = "";

  const house = HOUSE_LEVELS[profile.house.level] || HOUSE_LEVELS[0];
  html += `<div class="profile-strip" data-nav="shop">
    <div class="profile-avatar">${renderAvatarSVG(profile.equipped, 54)}</div>
    <div class="profile-info">
      <strong>👋 Willkommen zurück!</strong>
      <small>${esc(house.name)} · 🪙 ${coins.balance}</small>
    </div>
    <div class="profile-coins">🛒</div>
  </div>`;

  if (streak > 0 || maxStreak > 0) {
    const fire = streak >= 3 ? "🔥" : "⚡";
    html += `<div class="streak-bar">
      <span class="streak-fire">${fire}</span>
      <div class="streak-info">
        <strong>${streak} Tage Streak</strong>
        <small>Bester: ${maxStreak} Tage</small>
      </div>
      ${streakBonus > 0 ? `<div style="margin-left:auto;background:var(--warning);color:#fff;padding:2px 10px;border-radius:12px;font-size:0.8rem;font-weight:600">🪙 +${streakBonus}</div>` : ""}
    </div>`;
  }

  // Search bar
  html += `<div class="search-bar" data-nav="search" style="display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:8px 14px;border-radius:12px;background:var(--glass-bg);border:1px solid var(--border);cursor:pointer">
    <span style="font-size:1.1rem">🔍</span>
    <span style="color:var(--text-light);font-size:0.9rem">Quizze, Formeln, Lernpläne durchsuchen…</span>
  </div>`;

  // Eigene Themen-Shortcuts (z.B. "Mathe"): horizontal scrollbare Chip-Reihe
  html += `<div class="section-title" style="margin-top:4px">Deine Themen</div>
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;margin-bottom:10px">
      ${subjects.map(s => `
        <div class="subject-chip" data-subject-id="${s.id}" style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 14px;border-radius:12px;border:2px solid ${s.color};background:var(--card-glass-bg,var(--card-bg));cursor:pointer;min-width:76px">
          <div style="font-size:1.4rem">${s.icon}</div>
          <small style="font-size:0.72rem;font-weight:600;white-space:nowrap">${esc(s.name)}</small>
        </div>`).join("")}
      <div class="subject-chip" data-nav="subjects" style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 14px;border-radius:12px;border:2px dashed var(--border);cursor:pointer;min-width:76px">
        <div style="font-size:1.4rem">➕</div>
        <small style="font-size:0.72rem;color:var(--text-light);white-space:nowrap">Thema</small>
      </div>
    </div>`;

  html += `<div class="daily-card" id="daily-btn">
    <span class="daily-icon">📅</span>
    <div class="daily-info">
      <h3>Tägliches Lernen</h3>
      <p>Personalisierte Wiederholung starten</p>
    </div>
    <span class="chev">›</span>
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
    <div class="grid-card" data-nav="study-plan">
      <div class="icon">📅</div>
      <div class="title">Lernpläne</div>
      <div class="desc">Klausurvorbereitung</div>
    </div>
    <div class="grid-card" data-nav="math-tools">
      <div class="icon">🧮</div>
      <div class="title">Mathe-Tools</div>
      <div class="desc">Plotter & mehr</div>
    </div>
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

  if (recents.length > 0) {
    html += `<div class="section-title">Zuletzt</div>`;
    const ICONS = { quiz: "📚", formula: "📋", plan: "📅", daily: "📆", tutor: "🤖" };
    for (const r of recents.slice(0, 6)) {
      const nav = r.type === "quiz" ? `quiz-modes?quizId=${r.id}` : r.type === "formula" ? `formula-sheets?sheetId=${r.id}` : r.type === "plan" ? "study-plan" : r.type === "daily" ? "daily" : "tutor";
      html += `<div class="quiz-row" data-nav="${nav}">
        <div class="quiz-accent" style="background:var(--secondary)"></div>
        <div class="quiz-info">
          <h4>${ICONS[r.type] || "📄"} ${esc(r.name)}</h4>
          <small>${r.type === "quiz" ? "Quiz" : r.type === "formula" ? "Formelsammlung" : r.type === "plan" ? "Lernplan" : r.type === "daily" ? "Daily" : "Tutor"}</small>
        </div>
        <span style="color:var(--text-light)">›</span>
      </div>`;
    }
  } else if (quizzes.length > 0) {
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
  root.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const raw = el.dataset.nav;
      const q = raw.indexOf("?");
      if (q >= 0) {
        const screen = raw.slice(0, q);
        const params = Object.fromEntries(new URLSearchParams(raw.slice(q)));
        navigate(screen, params);
      } else {
        navigate(raw);
      }
    });
  });
  root.querySelectorAll("[data-quiz-id]").forEach((el) => {
    el.addEventListener("click", () => navigate("quiz-modes", { quizId: el.dataset.quizId }));
  });
  root.querySelectorAll("[data-subject-id]").forEach((el) => {
    el.addEventListener("click", () => navigate("subject-hub", { subjectId: el.dataset.subjectId }));
  });
}
