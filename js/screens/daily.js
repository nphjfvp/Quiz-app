import { loadQuizzes, loadProgress, loadDailyState, saveDailyState } from "../store.js";
import { navigate } from "../router.js";

export async function render(root) {
  const quizzes = await loadQuizzes();
  const progress = await loadProgress();
  const today = new Date().toISOString().slice(0, 10);
  let daily = await loadDailyState();

  if (!quizzes.length) {
    root.innerHTML = `<button class="back-btn" id="back-btn">‹ Zurück</button>
      <div class="empty">Keine Quizze vorhanden.<br>Importiere zuerst Quizze!</div>`;
    root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
    return;
  }

  // Create daily plan if needed
  if (!daily || daily.date !== today) {
    daily = createDailyPlan(quizzes, progress, today);
    await saveDailyState(daily);
  }

  const allQs = quizzes.flatMap(q => q.questions || []);
  const planQs = daily.plan?.map(id => allQs.find(q => q.id === id)).filter(Boolean) ?? [];
  const completed = new Set(daily.completed || []);
  const remaining = planQs.filter(q => !completed.has(q.id));
  const totalPlan = planQs.length;
  const donePct = totalPlan > 0 ? Math.round((completed.size / totalPlan) * 100) : 0;

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="card-hero" style="background:var(--primary-dark)">
      <div style="font-size:2rem">📅</div>
      <div style="font-size:1.2rem;font-weight:700;margin:6px 0">Tägliches Lernen</div>
      <div style="font-size:0.85rem;opacity:0.9">${today}</div>
      <div class="progress-row" style="margin-top:12px;justify-content:center">
        <div class="progress-bar" style="max-width:250px">
          <div class="progress-fill" style="width:${donePct}%"></div>
        </div>
        <span class="progress-label">${completed.size}/${totalPlan}</span>
      </div>
    </div>`;

  if (remaining.length > 0) {
    html += `<button class="btn btn-primary btn-lg btn-block" id="start-btn">
      🚀 ${remaining.length} Fragen lernen
    </button>`;
  } else if (totalPlan > 0) {
    html += `<div class="card" style="text-align:center">
      <div style="font-size:2rem;margin-bottom:8px">🎉</div>
      <div style="font-size:1rem;font-weight:700">Alles geschafft!</div>
      <div style="font-size:0.85rem;color:var(--text-light);margin-top:4px">Dein Daily ist erledigt. Komm morgen wieder!</div>
    </div>`;
  }

  // Show wrong questions for retry
  const wrongIds = daily.wrong || [];
  if (wrongIds.length > 0 && remaining.length === 0) {
    const wrongQs = wrongIds.map(id => allQs.find(q => q.id === id)).filter(Boolean);
    html += `<button class="btn btn-warning btn-block" id="retry-wrong" style="margin-top:12px">
      🔄 ${wrongQs.length} falsche Fragen wiederholen
    </button>`;
  }

  root.innerHTML = html;

  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelector("#start-btn")?.addEventListener("click", () => {
    const fakeQuiz = { id: "daily", name: "Tägliches Lernen", questions: remaining, description: "", created: "", exam_date: "", weight: 1 };
    navigate("quiz", { quiz: fakeQuiz, mode: "single" });
  });
  root.querySelector("#retry-wrong")?.addEventListener("click", () => {
    const wrongQs = wrongIds.map(id => allQs.find(q => q.id === id)).filter(Boolean);
    const fakeQuiz = { id: "daily-retry", name: "Wiederholung", questions: wrongQs, description: "", created: "", exam_date: "", weight: 1 };
    navigate("quiz", { quiz: fakeQuiz, mode: "single" });
  });
}

function createDailyPlan(quizzes, progress, today) {
  const allQs = quizzes.flatMap(q => q.questions || []);

  // Prioritize: box 1 > box 2 > box 3 > not-seen > box 4 > box 5
  const scored = allQs.map(q => {
    const p = progress[q.id];
    const box = p?.box ?? 1;
    const seen = p?.last_seen ?? "";
    const priority = [0, 50, 40, 30, 10, 5][box] ?? 20;
    const daysSince = seen ? Math.max(0, (Date.now() - new Date(seen).getTime()) / 86400000) : 100;
    return { q, score: priority + Math.min(daysSince, 30) };
  });

  scored.sort((a, b) => b.score - a.score);
  const plan = scored.slice(0, 20).map(s => s.q.id);

  return { date: today, plan, completed: [], wrong: [], extra_done: false };
}
