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
        <button class="btn-icon btn-icon-sm" data-export-id="${quiz.id}" data-format="json" title="Als JSON exportieren">📥</button>
        <button class="btn-icon btn-icon-sm" data-export-id="${quiz.id}" data-format="html" title="Als HTML exportieren">📄</button>
        <span class="row-chev">›</span>
      </div>`;
    }
  }

  // Learning tools – accessible from the Lernen tab
  html += `<div class="section-title">Lern-Werkzeuge</div>`;
  html += `<div class="grid-4">
    <div class="grid-card mini-card" data-nav="ai-generate"><div class="icon">🤖</div><div class="title">KI-Generator</div></div>
    <div class="grid-card mini-card" data-nav="editor"><div class="icon">✏️</div><div class="title">Editor</div></div>
    <div class="grid-card mini-card" data-nav="study"><div class="icon">🃏</div><div class="title">Karteikarten</div></div>
    <div class="grid-card mini-card" data-nav="cloze"><div class="icon">✂️</div><div class="title">Lückentext</div></div>
    <div class="grid-card mini-card" data-nav="folders"><div class="icon">📁</div><div class="title">Ordner / Klausuren</div></div>
    <div class="grid-card mini-card" data-nav="random"><div class="icon">🎲</div><div class="title">Zufalls-Modus</div></div>
    <div class="grid-card mini-card" data-nav="formula-sheets"><div class="icon">📋</div><div class="title">Formelsammlung</div></div>
    <div class="grid-card mini-card" data-nav="marked"><div class="icon">⭐</div><div class="title">Markiert</div></div>
    <div class="grid-card mini-card" data-nav="scaffold"><div class="icon">🔢</div><div class="title">Formel-Training</div></div>
    <div class="grid-card mini-card" data-nav="deep-learn"><div class="icon">🔬</div><div class="title">Deep Learn</div></div>
    <div class="grid-card mini-card" data-nav="socratic"><div class="icon">🏛️</div><div class="title">Sokrates</div></div>
    <div class="grid-card mini-card" data-nav="tutor"><div class="icon">💬</div><div class="title">KI-Tutor</div></div>
    <div class="grid-card mini-card" data-nav="pomodoro"><div class="icon">🍅</div><div class="title">Pomodoro</div></div>
    <div class="grid-card mini-card" data-nav="image-editor"><div class="icon">🖌️</div><div class="title">Bild-Editor</div></div>
  </div>`;

  root.innerHTML = html;

  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelector("#new-quiz-btn").addEventListener("click", () => navigate("editor"));
  root.querySelectorAll("[data-edit-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigate("editor", { quizId: btn.dataset.editId });
    });
  });
  root.querySelectorAll("[data-export-id]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const quizId = btn.dataset.exportId;
      const format = btn.dataset.format;
      const quizzes = await loadQuizzes();
      const quiz = quizzes.find(q => q.id === quizId);
      if (!quiz) return;
      const { downloadQuiz } = await import("../html-export.js");
      await downloadQuiz(quiz, format);
    });
  });
  root.querySelectorAll("[data-quiz-id]").forEach((el) => {
    el.addEventListener("click", () => navigate("quiz-modes", { quizId: el.dataset.quizId }));
  });
  root.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.nav));
  });
}
