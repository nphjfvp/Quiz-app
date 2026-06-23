import { navigate } from "../router.js";
import { explainAnswer } from "../ai-service.js";
import { esc } from "../utils.js";

export async function render(root, params) {
  const { session, quiz } = params;
  if (!session) { navigate("home"); return; }

  const total = session.totalScore;
  const max = session.maxScore;
  const pct = max > 0 ? Math.round((total / max) * 100) : 0;
  const answered = Object.keys(session.answers).length;
  const correct = Object.values(session.answers).filter((a) => a.is_correct).length;

  let bgColor, emoji;
  if (pct >= 80) { bgColor = "var(--success)"; emoji = "🎉"; }
  else if (pct >= 60) { bgColor = "var(--success)"; emoji = "👍"; }
  else if (pct >= 40) { bgColor = "var(--warning)"; emoji = "💪"; }
  else { bgColor = "var(--danger)"; emoji = "📚"; }

  let html = `
    <div class="result-hero" style="background:${bgColor}">
      <div style="font-size:2rem;margin-bottom:4px">${emoji}</div>
      <div class="pct">${pct}%</div>
      <div class="subtitle">${total.toFixed(1)} / ${max.toFixed(1)} Punkte</div>
      <div class="subtitle" style="margin-top:4px;font-weight:600">${correct}/${answered} Fragen richtig</div>
    </div>

    <div class="section-title">Details</div>`;

  for (const q of session.questions) {
    const r = session.answers[q.id];
    const ok = r?.is_correct;
    const cls = ok ? "ok" : r ? "bad" : "skip";
    const icon = ok ? "✓" : r ? "✗" : "–";
    const rowText = q.title || (q.question_text || q.text || "").slice(0, 60);
    html += `<div class="result-row ${cls}" data-qid="${q.id}">
      <span class="result-icon ${cls}">${icon}</span>
      <span class="result-title">${esc(rowText)}</span>
      ${r ? `<span class="result-score" style="color:${ok ? "var(--success)" : "var(--danger)"}">${r.score}/${r.max_score}</span>` : ""}
      <span style="color:var(--text-light)">›</span>
    </div>`;
  }

  html += `<div class="btn-row">
    <button class="btn btn-warning" id="retry-btn">Nochmal</button>
    <button class="btn btn-primary" id="home-btn" style="flex:1">Zurück</button>
  </div>`;

  root.innerHTML = html;

  root.querySelector("#retry-btn")?.addEventListener("click", () => {
    navigate("quiz", { quiz, mode: session.mode });
  });
  root.querySelector("#home-btn")?.addEventListener("click", () => navigate("home"));

  // Detail rows
  root.querySelectorAll(".result-row").forEach((el) => {
    el.addEventListener("click", () => {
      const q = session.questions.find((q) => q.id === el.dataset.qid);
      const r = session.answers[q?.id];
      if (q) showDetail(root, q, r, session, quiz);
    });
  });
}

function showDetail(root, q, result, session, quiz) {
  let html = `<button class="back-btn" id="back-results">‹ Zurück zu den Ergebnissen</button>`;
  html += `<div class="card">
    ${(q.topic || q.title) ? `<div class="question-title">${esc(q.topic || q.title)}</div>` : ""}
    <div class="question-text">${esc(q.question_text || q.text || "")}</div>
  </div>`;

  if (result) {
    const icon = result.is_correct ? "✓" : "✗";
    const label = result.is_correct ? "Richtig!" : "Falsch!";
    html += `<div class="feedback ${result.is_correct ? "correct" : "wrong"}">
      <h3>${icon}  ${label}</h3>
      <p>Punkte: ${result.score}/${result.max_score}</p>
    </div>`;
    html += `<div class="card">
      <div style="font-size:0.8rem;color:var(--text-light);margin-bottom:4px">Deine Antwort:</div>
      <div style="font-size:0.9rem;margin-bottom:10px">${esc(result.user_answer || "–")}</div>
      <div style="font-size:0.8rem;color:var(--text-light);margin-bottom:4px">Richtige Antwort:</div>
      <div style="font-size:0.9rem;font-weight:600;color:var(--success)">${esc(result.correct_answer || "–")}</div>
    </div>`;
  }

  if (q.explanation) {
    html += `<div class="card">
      <div style="font-size:0.8rem;color:var(--text-light);margin-bottom:4px">Erklärung</div>
      <div style="font-size:0.9rem">${esc(q.explanation)}</div>
    </div>`;
  }

  html += `<div class="btn-row">
    <button class="btn btn-primary btn-sm" id="ai-explain">🤖 KI-Erklärung</button>
    <button class="btn btn-ghost btn-sm" id="ai-tutor">💬 KI-Tutor</button>
  </div>
  <div id="ai-explanation" style="display:none" class="card" style="margin-top:8px">
    <div style="font-size:0.8rem;color:var(--text-light);margin-bottom:4px">🤖 KI-Erklärung</div>
    <div id="ai-explain-text" style="font-size:0.9rem;white-space:pre-wrap"></div>
  </div>`;

  root.innerHTML = html;
  root.querySelector("#back-results").addEventListener("click", () => render(root, { session, quiz }));

  root.querySelector("#ai-explain")?.addEventListener("click", async () => {
    const btn = root.querySelector("#ai-explain");
    const box = root.querySelector("#ai-explanation");
    const textEl = root.querySelector("#ai-explain-text");
    btn.disabled = true;
    btn.textContent = "⏳ Lade...";
    box.style.display = "block";
    textEl.textContent = "Generiere Erklärung...";
    try {
      const questionText = q.question_text || q.text || q.title || "";
      const qImage = q.diagram_image_path || q.diagram_image || q.image_path || q.image || null;
      const explanation = await explainAnswer(questionText, result?.user_answer || "", result?.correct_answer || "", {}, qImage);
      textEl.textContent = explanation;
    } catch (err) {
      textEl.textContent = "Fehler: " + (err.message || "KI-Erklärung konnte nicht geladen werden.");
    }
    btn.textContent = "🤖 KI-Erklärung";
    btn.disabled = false;
  });

  root.querySelector("#ai-tutor")?.addEventListener("click", () => {
    const qImage = q.diagram_image_path || q.diagram_image || q.image_path || q.image || null;
    navigate("tutor", { question: { text: q.question_text || q.text, correct: result?.correct_answer, image: qImage } });
  });
}
