import { loadQuizzes, loadProgress } from "../store.js";
import { navigate } from "../router.js";
import { esc, getBoxCounts } from "../utils.js";

export async function render(root) {
  const quizzes = await loadQuizzes();
  const progress = await loadProgress();

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="list-header">
      <div class="section-title" style="margin:0">📚 Meine Quizze</div>
      <button class="btn btn-primary btn-sm" id="new-quiz-btn">+ Neu</button>
    </div>`;

  if (!quizzes.length) {
    html += `<div class="empty">Noch keine Quizze.<br>Importiere welche über Einstellungen!</div>`;
  } else {
    for (const quiz of quizzes) {
      const n = quiz.questions?.length ?? 0;
      const counts = getBoxCounts(quiz, progress);
      html += `<div class="quiz-row" data-quiz-id="${quiz.id}">
        <div class="quiz-accent"></div>
        <div class="quiz-info">
          <h4>${esc(quiz.name)}</h4>
          <small>${n} Fragen${quiz.description ? " · " + esc(quiz.description) : ""}</small>
        </div>
        <div class="quiz-boxes">
          ${[1,2,3,4,5].map(b => `<span class="quiz-box box-${b}">${counts[b]||0}</span>`).join("")}
        </div>
        <button class="btn-icon btn-icon-sm" data-edit-id="${quiz.id}">✏️</button>
        <span class="row-chev">›</span>
      </div>`;
    }
  }

  root.innerHTML = html;

  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelector("#new-quiz-btn").addEventListener("click", () => navigate("editor"));
  root.querySelectorAll("[data-edit-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigate("editor", { quizId: btn.dataset.editId });
    });
  });
  root.querySelectorAll("[data-quiz-id]").forEach((el) => {
    el.addEventListener("click", () => navigate("quiz-modes", { quizId: el.dataset.quizId }));
  });
}
