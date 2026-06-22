import { loadQuizzes, loadProgress } from "../store.js";
import { navigate } from "../router.js";

export async function render(root) {
  const quizzes = await loadQuizzes();
  const progress = await loadProgress();

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="section-title" style="margin:0">📚 Meine Quizze</div>
    </div>`;

  if (!quizzes.length) {
    html += `<div class="empty">Noch keine Quizze.<br>Importiere welche über Einstellungen!</div>`;
  } else {
    for (const quiz of quizzes) {
      const n = quiz.questions?.length ?? 0;
      const counts = {};
      for (const q of (quiz.questions || [])) {
        const b = progress[q.id]?.box ?? 1;
        counts[b] = (counts[b] || 0) + 1;
      }
      html += `<div class="quiz-row" data-quiz-id="${quiz.id}">
        <div class="quiz-accent"></div>
        <div class="quiz-info">
          <h4>${esc(quiz.name)}</h4>
          <small>${n} Fragen${quiz.description ? " · " + esc(quiz.description) : ""}</small>
        </div>
        <div class="quiz-boxes">
          ${[1,2,3,4,5].map(b => `<span class="quiz-box box-${b}">${counts[b]||0}</span>`).join("")}
        </div>
        <span style="color:var(--text-light)">›</span>
      </div>`;
    }
  }

  root.innerHTML = html;

  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelectorAll("[data-quiz-id]").forEach((el) => {
    el.addEventListener("click", () => navigate("quiz-modes", { quizId: el.dataset.quizId }));
  });
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
