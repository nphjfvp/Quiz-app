import { loadStats, getStreak, loadProgress, loadQuizzes, loadAchievements, saveAchievements, loadErrorDiary } from "../store.js";
import { navigate } from "../router.js";

const ACHIEVEMENTS = [
  { id: "first_quiz", icon: "🎯", name: "Erster Schritt", desc: "Beantworte deine erste Frage", check: (s) => s.totalAnswered >= 1 },
  { id: "ans_50", icon: "📝", name: "Fleißig", desc: "50 Fragen beantwortet", check: (s) => s.totalAnswered >= 50 },
  { id: "ans_200", icon: "📚", name: "Bücherwurm", desc: "200 Fragen beantwortet", check: (s) => s.totalAnswered >= 200 },
  { id: "ans_500", icon: "🏆", name: "Meisterschüler", desc: "500 Fragen beantwortet", check: (s) => s.totalAnswered >= 500 },
  { id: "ans_1000", icon: "👑", name: "Legende", desc: "1000 Fragen beantwortet", check: (s) => s.totalAnswered >= 1000 },
  { id: "streak_3", icon: "🔥", name: "Auf Kurs", desc: "3 Tage Streak", check: (s) => s.maxStreak >= 3 },
  { id: "streak_7", icon: "🔥", name: "Woche geschafft", desc: "7 Tage Streak", check: (s) => s.maxStreak >= 7 },
  { id: "streak_14", icon: "💪", name: "Zwei Wochen", desc: "14 Tage Streak", check: (s) => s.maxStreak >= 14 },
  { id: "streak_30", icon: "⚡", name: "Monats-Streak", desc: "30 Tage Streak", check: (s) => s.maxStreak >= 30 },
  { id: "perfect", icon: "💯", name: "Perfekt!", desc: "Ein Quiz mit 100% abschließen", check: (s) => s.hasPerfect },
  { id: "box5_10", icon: "🧠", name: "Langzeitgedächtnis", desc: "10 Karten in Box 5", check: (s) => s.box5 >= 10 },
  { id: "box5_50", icon: "🎓", name: "Wissensfestung", desc: "50 Karten in Box 5", check: (s) => s.box5 >= 50 },
  { id: "quizzes_5", icon: "📂", name: "Sammler", desc: "5 Quizze erstellt/importiert", check: (s) => s.quizCount >= 5 },
  { id: "quizzes_20", icon: "🗄️", name: "Bibliothek", desc: "20 Quizze", check: (s) => s.quizCount >= 20 },
  { id: "errors_fixed", icon: "🔧", name: "Fehlersucher", desc: "10 Fehler im Fehlerbuch", check: (s) => s.diaryCount >= 10 },
  { id: "night_owl", icon: "🦉", name: "Nachteule", desc: "Nach 23 Uhr gelernt", check: (s) => s.lateNight },
  { id: "early_bird", icon: "🐦", name: "Frühaufsteher", desc: "Vor 7 Uhr gelernt", check: (s) => s.earlyMorning },
];

export async function render(root) {
  const [stats, progress, quizzes, saved, diary] = await Promise.all([
    loadStats(), loadProgress(), loadQuizzes(), loadAchievements(), loadErrorDiary(),
  ]);
  const { current: streak, max: maxStreak } = getStreak(stats);

  const allDays = Object.entries(stats);
  const totalAnswered = allDays.reduce((s, [, d]) => s + (d.answered || 0), 0);
  const totalCorrect = allDays.reduce((s, [, d]) => s + (d.correct || 0), 0);
  const box5 = Object.values(progress).filter(p => (p.box ?? 1) >= 5).length;
  const hasPerfect = allDays.some(([, d]) => d.answered >= 5 && d.correct === d.answered);

  // Tageszeit-Erfolge: Flags werden in store.js logAnswer() gesetzt, da die
  // Stats-Keys (YYYY-MM-DD) keine Uhrzeit enthalten.
  const lateNight = !!saved.night_owl_unlocked;
  const earlyMorning = !!saved.early_bird_unlocked;

  const ctx = {
    totalAnswered, totalCorrect, maxStreak, streak,
    box5, hasPerfect, quizCount: quizzes.length,
    diaryCount: diary.length, lateNight, earlyMorning,
  };

  const unlocked = {};
  const newlyUnlocked = [];
  for (const a of ACHIEVEMENTS) {
    const wasUnlocked = !!saved[a.id];
    const isUnlocked = a.check(ctx);
    unlocked[a.id] = isUnlocked;
    if (isUnlocked && !wasUnlocked) {
      newlyUnlocked.push(a);
      saved[a.id] = Date.now();
    }
  }
  if (newlyUnlocked.length) await saveAchievements(saved);

  const unlockedCount = ACHIEVEMENTS.filter(a => unlocked[a.id]).length;
  const pct = Math.round((unlockedCount / ACHIEVEMENTS.length) * 100);

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="section-title">🏅 Erfolge</div>
    <div class="card" style="text-align:center">
      <div style="font-size:1.5rem;font-weight:700">${unlockedCount} / ${ACHIEVEMENTS.length}</div>
      <div class="progress-bar" style="margin:10px auto;max-width:250px">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
      <div style="font-size:0.85rem;color:var(--text-light)">${pct}% freigeschaltet</div>
    </div>`;

  if (newlyUnlocked.length) {
    html += `<div class="card" style="border:2px solid var(--warning);text-align:center">
      <div style="font-size:1.2rem;margin-bottom:8px">🎉 Neu freigeschaltet!</div>
      ${newlyUnlocked.map(a => `<div style="font-size:1.1rem">${a.icon} <strong>${a.name}</strong></div>`).join("")}
    </div>`;
  }

  for (const a of ACHIEVEMENTS) {
    const done = unlocked[a.id];
    html += `<div class="achievement-row ${done ? "unlocked" : "locked"}">
      <div class="achievement-icon">${done ? a.icon : "🔒"}</div>
      <div class="achievement-info">
        <div class="achievement-name">${a.name}</div>
        <div class="achievement-desc">${a.desc}</div>
      </div>
      ${done && saved[a.id] ? `<div class="achievement-date">${new Date(saved[a.id]).toLocaleDateString("de")}</div>` : ""}
    </div>`;
  }

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
}
