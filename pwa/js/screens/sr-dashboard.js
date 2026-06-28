import { loadQuizzes, loadProgress, loadFsrs } from "../store.js";
import { navigate } from "../router.js";
import { daysUntilDue, retrievability, projectMasteryTimeline } from "../fsrs.js";
import { esc } from "../utils.js";

export async function render(root) {
  const [quizzes, progress, fsrs] = await Promise.all([
    loadQuizzes(), loadProgress(), loadFsrs(),
  ]);

  const allQuestions = quizzes.flatMap(q => (q.questions || []).map(qq => ({ ...qq, quizName: q.name, quizId: q.id })));

  let dueNow = 0, dueSoon = 0, mature = 0, young = 0, unseen = 0;
  const forecast = [0, 0, 0, 0, 0, 0, 0];
  const perQuiz = {};

  for (const q of allQuestions) {
    const card = fsrs[q.id];
    const prog = progress[q.id];
    const box = prog?.box ?? 1;

    if (!perQuiz[q.quizId]) perQuiz[q.quizId] = { name: q.quizName, total: 0, mastered: 0, due: 0, avgRet: 0, retSum: 0, retCount: 0 };
    perQuiz[q.quizId].total++;

    if (!card || card.state === "new") {
      unseen++;
      perQuiz[q.quizId].due++;
      forecast[0]++;
      continue;
    }

    const days = daysUntilDue(card);
    const ret = retrievability(card);
    perQuiz[q.quizId].retSum += ret;
    perQuiz[q.quizId].retCount++;

    if (days <= 0) {
      dueNow++;
      perQuiz[q.quizId].due++;
      forecast[0]++;
    } else if (days <= 1) {
      dueSoon++;
      const dayIdx = Math.min(Math.floor(days), 6);
      forecast[dayIdx]++;
    } else {
      const dayIdx = Math.min(Math.floor(days), 6);
      if (dayIdx < 7) forecast[dayIdx]++;
    }

    if (box >= 4) { mature++; perQuiz[q.quizId].mastered++; }
    else young++;
  }

  const totalCards = allQuestions.length;

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="section-title">🧠 Spaced Repetition</div>

    <div class="card">
      <div class="stat-summary">
        <div>
          <div class="stat-num" style="color:var(--danger)">${dueNow}</div>
          <div class="stat-label">Jetzt fällig</div>
        </div>
        <div>
          <div class="stat-num" style="color:var(--warning)">${dueSoon}</div>
          <div class="stat-label">Bald fällig</div>
        </div>
        <div>
          <div class="stat-num" style="color:var(--success)">${mature}</div>
          <div class="stat-label">Gemeistert</div>
        </div>
        <div>
          <div class="stat-num">${unseen}</div>
          <div class="stat-label">Neu</div>
        </div>
      </div>
    </div>`;

  if (dueNow > 0) {
    html += `<button class="btn btn-primary btn-lg btn-block" id="start-review">
      🚀 ${dueNow} fällige Karten wiederholen
    </button>`;
  }

  // 7-day forecast
  const maxF = Math.max(...forecast, 1);
  const dayNames = ["Heute", "Mo+1", "Mo+2", "Mo+3", "Mo+4", "Mo+5", "Mo+6"];
  const today = new Date();
  html += `<div class="section-title">📅 7-Tage Prognose</div>
    <div class="card">
      <div class="forecast-chart">
        ${forecast.map((n, i) => {
          const d = new Date(today);
          d.setDate(d.getDate() + i);
          const label = i === 0 ? "Heute" : d.toLocaleDateString("de", { weekday: "short" });
          const h = Math.max((n / maxF) * 100, 5);
          return `<div class="forecast-col">
            <div class="forecast-num">${n}</div>
            <div class="forecast-bar" style="height:${h}%;background:${i === 0 ? "var(--danger)" : "var(--primary)"}"></div>
            <div class="forecast-label">${label}</div>
          </div>`;
        }).join("")}
      </div>
    </div>`;

  // Per-quiz mastery
  const quizEntries = Object.values(perQuiz).sort((a, b) => (b.due - a.due) || (a.mastered / a.total - b.mastered / b.total));
  if (quizEntries.length) {
    html += `<div class="section-title">📚 Fortschritt pro Quiz</div>`;
    for (const q of quizEntries) {
      const pct = q.total > 0 ? Math.round((q.mastered / q.total) * 100) : 0;
      const avgRet = q.retCount > 0 ? Math.round((q.retSum / q.retCount) * 100) : 0;
      const barColor = pct >= 80 ? "var(--success)" : pct >= 40 ? "var(--warning)" : "var(--danger)";
      html += `<div class="card" style="padding:12px 16px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong style="font-size:0.9rem">${esc(q.name)}</strong>
          <span style="font-size:0.8rem;color:var(--text-light)">${q.due > 0 ? q.due + " fällig" : "✓"}</span>
        </div>
        <div class="progress-bar" style="height:6px">
          <div class="progress-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-light);margin-top:4px">
          <span>${pct}% gemeistert (${q.mastered}/${q.total})</span>
          <span>Ø ${avgRet}% Abrufbarkeit</span>
        </div>
      </div>`;
    }
  }

  // Summary card
  html += `<div class="section-title">Zusammenfassung</div>
    <div class="card">
      <div style="font-size:0.9rem;line-height:1.6">
        📊 <strong>${totalCards}</strong> Karten insgesamt<br>
        🟢 <strong>${mature}</strong> gemeistert (Box 4-5)<br>
        🟡 <strong>${young}</strong> in Bearbeitung (Box 1-3)<br>
        ⚪ <strong>${unseen}</strong> noch nicht gelernt
      </div>
    </div>`;

  // ── SR Insights & Prognose ──
  const insights = projectMasteryTimeline(allQuestions, fsrs);
  const tlBars = insights.timeline.map(m => {
    const labelMap = { 7: "1 Wo", 14: "2 Wo", 30: "1 Mo", 60: "2 Mo", 90: "3 Mo" };
    return `<div class="forecast-col">
      <div class="forecast-num">${m.pct}%</div>
      <div class="forecast-bar" style="height:${Math.max(m.pct, 8)}%;background:var(--success)"></div>
      <div class="forecast-label">${labelMap[m.days] || m.days + "d"}</div>
    </div>`;
  }).join("");

  html += `<div class="section-title">🔮 Lern-Prognose (FSRS)</div>
    <div class="card">
      <p style="font-size:0.85rem;color:var(--text-light);margin:0 0 12px">Simulation: bei täglichem Lernen mit "Gut"-Bewertung</p>
      <div class="forecast-chart">${tlBars}</div>
      <div style="margin-top:12px;font-size:0.9rem;line-height:1.6">
        ${insights.daysTo90
          ? `🎯 <strong>90% aller Karten gemeistert in ~${insights.daysTo90} Tagen</strong><br>`
          : `📈 <strong>${insights.timeline[insights.timeline.length-1].pct}%</strong> in 3 Monaten prognostiziert<br>`}
        📋 <strong>${insights.dueNow}</strong> aktuell fällig<br>
        ⚡ <strong>~${insights.optimalDaily}</strong> Karten/Tag für stetigen Fortschritt
      </div>
    </div>`;

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelector("#start-review")?.addEventListener("click", () => navigate("daily"));
}
