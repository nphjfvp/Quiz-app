import { loadStats, getStreak, loadProgress, loadQuizzes } from "../store.js";
import { navigate } from "../router.js";

export async function render(root) {
  const stats = await loadStats();
  const { current: streak, max: maxStreak } = getStreak(stats);
  const progress = await loadProgress();

  const days = Object.entries(stats).sort(([a], [b]) => b.localeCompare(a)).slice(0, 14);
  const totalAnswered = days.reduce((s, [, d]) => s + d.answered, 0);
  const totalCorrect = days.reduce((s, [, d]) => s + d.correct, 0);
  const avgPct = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const boxes = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const p of Object.values(progress)) {
    boxes[p.box ?? 1] = (boxes[p.box ?? 1] || 0) + 1;
  }
  const totalCards = Object.values(boxes).reduce((a, b) => a + b, 0);

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="section-title">📊 Statistik</div>

    <div class="card">
      <div class="stat-summary">
        <div>
          <div class="stat-num streak">${streak}</div>
          <div class="stat-label">Tage Streak</div>
        </div>
        <div>
          <div class="stat-num primary">${avgPct}%</div>
          <div class="stat-label">Ø Richtig (14T)</div>
        </div>
        <div>
          <div class="stat-num">${totalAnswered}</div>
          <div class="stat-label">Antworten (14T)</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="grid-card mini-card" data-nav="sr-dashboard"><div class="icon">🧠</div><div class="title">SR-Dashboard</div></div>
      <div class="grid-card mini-card" data-nav="achievements"><div class="icon">🏆</div><div class="title">Erfolge</div></div>
    </div>`;

  // Heatmap (13 weeks)
  html += `<div class="section-title">Aktivität (13 Wochen)</div>
    <div class="card card-scroll-x">
      <div class="heatmap">`;
  const today = new Date();
  const dayOfWeek = today.getDay() || 7;
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (13 * 7 - 1) - (dayOfWeek - 1));
  for (let w = 0; w < 13; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + w * 7 + d);
      const key = date.toISOString().slice(0, 10);
      const entry = stats[key];
      const count = entry?.answered ?? 0;
      let color = "var(--border)";
      if (count > 0) color = "var(--primary-subtle)";
      if (count >= 5) color = "var(--primary-light)";
      if (count >= 15) color = "var(--primary)";
      if (count >= 30) color = "var(--primary-dark)";
      const isFuture = date > today;
      html += `<div class="heatmap-cell" style="background:${isFuture ? "transparent" : color}" title="${key}: ${count}"></div>`;
    }
  }
  html += `</div>
    <div class="heatmap-legend">
      <span>Wenig</span>
      <i style="background:var(--border)"></i>
      <i style="background:var(--primary-subtle)"></i>
      <i style="background:var(--primary-light)"></i>
      <i style="background:var(--primary)"></i>
      <i style="background:var(--primary-dark)"></i>
      <span>Viel</span>
    </div>
  </div>`;

  // Leitner boxes
  html += `<div class="section-title">Leitner-Boxen</div>
    <div class="card">
      <div class="box-chart">
        ${[1,2,3,4,5].map(b => {
          const pct = totalCards > 0 ? (boxes[b] / totalCards * 100) : 0;
          return `<div class="box-col">
            <div class="box-col-num">${boxes[b]}</div>
            <div class="box-bar box-${b}" style="height:${Math.max(pct, 5)}%"></div>
          </div>`;
        }).join("")}
      </div>
      <div class="box-labels">
        ${[1,2,3,4,5].map(b => `<span>Box ${b}</span>`).join("")}
      </div>
    </div>

    <div class="section-title">Letzte 14 Tage</div>`;

  if (days.length > 0) {
    for (const [date, d] of days) {
      const pct = d.answered > 0 ? Math.round((d.correct / d.answered) * 100) : 0;
      const barColor = pct >= 60 ? "var(--success)" : pct >= 40 ? "var(--warning)" : "var(--danger)";
      html += `<div class="day-row">
        <span class="day-label">${date.slice(5)}</span>
        <div class="day-track">
          <div class="day-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <span class="day-pct">${pct}%</span>
        <span class="day-frac">${d.correct}/${d.answered}</span>
      </div>`;
    }
  } else {
    html += `<div class="empty">Noch keine Lernaktivität.</div>`;
  }

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelectorAll("[data-nav]").forEach((el) =>
    el.addEventListener("click", () => navigate(el.dataset.nav)));
}
