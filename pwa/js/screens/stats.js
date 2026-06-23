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

    <div class="card" style="text-align:center">
      <div style="display:flex;justify-content:space-around">
        <div>
          <div style="font-size:1.8rem;font-weight:800;color:var(--streak)">${streak}</div>
          <div style="font-size:0.75rem;color:var(--text-light)">Tage Streak</div>
        </div>
        <div>
          <div style="font-size:1.8rem;font-weight:800;color:var(--primary)">${avgPct}%</div>
          <div style="font-size:0.75rem;color:var(--text-light)">Ø Richtig (14T)</div>
        </div>
        <div>
          <div style="font-size:1.8rem;font-weight:800;color:var(--text)">${totalAnswered}</div>
          <div style="font-size:0.75rem;color:var(--text-light)">Antworten (14T)</div>
        </div>
      </div>
    </div>`;

  // Heatmap (13 weeks)
  html += `<div class="section-title">Aktivität (13 Wochen)</div>
    <div class="card" style="overflow-x:auto">
      <div style="display:grid;grid-template-columns:repeat(13,1fr);grid-template-rows:repeat(7,1fr);gap:2px;min-width:260px">`;
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
      html += `<div style="width:100%;aspect-ratio:1;border-radius:2px;background:${isFuture ? "transparent" : color}" title="${key}: ${count}"></div>`;
    }
  }
  html += `</div>
    <div style="display:flex;justify-content:flex-end;gap:4px;margin-top:6px;font-size:0.65rem;color:var(--text-light);align-items:center">
      <span>Wenig</span>
      <div style="width:10px;height:10px;border-radius:2px;background:var(--border)"></div>
      <div style="width:10px;height:10px;border-radius:2px;background:var(--primary-subtle)"></div>
      <div style="width:10px;height:10px;border-radius:2px;background:var(--primary-light)"></div>
      <div style="width:10px;height:10px;border-radius:2px;background:var(--primary)"></div>
      <div style="width:10px;height:10px;border-radius:2px;background:var(--primary-dark)"></div>
      <span>Viel</span>
    </div>
  </div>`;

  // Leitner boxes
  html += `<div class="section-title">Leitner-Boxen</div>
    <div class="card">
      <div style="display:flex;gap:8px;align-items:flex-end;height:80px;margin-bottom:8px">
        ${[1,2,3,4,5].map(b => {
          const pct = totalCards > 0 ? (boxes[b] / totalCards * 100) : 0;
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center">
            <div style="font-size:0.7rem;font-weight:700;margin-bottom:2px">${boxes[b]}</div>
            <div style="width:100%;background:var(--box${b});border-radius:4px 4px 0 0;height:${Math.max(pct, 5)}%"></div>
          </div>`;
        }).join("")}
      </div>
      <div style="display:flex;gap:8px">
        ${[1,2,3,4,5].map(b => `<div style="flex:1;text-align:center;font-size:0.7rem;color:var(--text-light)">Box ${b}</div>`).join("")}
      </div>
    </div>

    <div class="section-title">Letzte 14 Tage</div>`;

  if (days.length > 0) {
    for (const [date, d] of days) {
      const pct = d.answered > 0 ? Math.round((d.correct / d.answered) * 100) : 0;
      const barColor = pct >= 60 ? "var(--success)" : pct >= 40 ? "var(--warning)" : "var(--danger)";
      html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="font-size:0.75rem;color:var(--text-light);width:70px">${date.slice(5)}</span>
        <div style="flex:1;height:8px;background:var(--row-neutral);border-radius:4px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${barColor};border-radius:4px"></div>
        </div>
        <span style="font-size:0.75rem;font-weight:600;width:40px;text-align:right">${pct}%</span>
        <span style="font-size:0.7rem;color:var(--text-light);width:50px">${d.correct}/${d.answered}</span>
      </div>`;
    }
  } else {
    html += `<div class="empty">Noch keine Lernaktivität.</div>`;
  }

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
}
