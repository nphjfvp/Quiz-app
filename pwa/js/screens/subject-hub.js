// Themen-Hub: wird von einem Startseiten-Shortcut geöffnet. Zeigt nur die für
// dieses Thema freigeschalteten Lernarten sowie die dem Thema zugeordneten Quizze.
import { loadSubjects, loadQuizzes, loadProgress } from "../store.js";
import { navigate } from "../router.js";
import { esc, getBoxCounts } from "../utils.js";
import { LEARNING_MODE_CATALOG } from "./subjects.js";

export async function render(root, params = {}) {
  const [subjects, quizzes, progress] = await Promise.all([loadSubjects(), loadQuizzes(), loadProgress()]);
  const subject = subjects.find(s => s.id === params.subjectId);
  if (!subject) { navigate("subjects"); return; }

  const modes = LEARNING_MODE_CATALOG.filter(m => (subject.allowedModes || []).includes(m.id));
  const subjectQuizzes = quizzes.filter(q => q.subject === subject.id);

  let html = `<div class="editor-header">
      <button class="btn-icon back-btn" id="hub-back">←</button>
      <h2 style="display:flex;align-items:center;gap:8px"><span>${subject.icon}</span> ${esc(subject.name)}</h2>
      <button class="btn-icon" id="hub-edit" title="Bearbeiten">✏️</button>
    </div>

    <div class="section-title" style="margin-top:8px">Lernarten</div>
    <div class="grid-2">
      ${modes.map(m => `
        <div class="grid-card tool-card" data-mode="${m.id}" style="border-left:3px solid ${subject.color}">
          <div class="icon">${m.icon}</div>
          <div><div class="title">${m.label}</div></div>
        </div>`).join("")}
    </div>`;

  if (subjectQuizzes.length) {
    html += `<div class="section-title">Quizze zu „${esc(subject.name)}"</div>`;
    for (const quiz of subjectQuizzes) {
      const n = quiz.questions?.length ?? 0;
      const counts = getBoxCounts(quiz, progress);
      html += `<div class="quiz-row" data-quiz-id="${quiz.id}">
        <div class="quiz-accent" style="background:${subject.color}"></div>
        <div class="quiz-info">
          <h4>${esc(quiz.name)}</h4>
          <small>${n} Fragen</small>
        </div>
        <div class="quiz-boxes">
          ${[1,2,3,4,5].map(b => `<span class="quiz-box box-${b}">${counts[b]||0}</span>`).join("")}
        </div>
        <span style="color:var(--text-light)">›</span>
      </div>`;
    }
  } else {
    html += `<div class="empty">Noch keine Quizze zu diesem Thema.<br>Erstelle eins über „KI-Generator" oder „Editor" oben.</div>`;
  }

  root.innerHTML = html;
  root.querySelector("#hub-back").addEventListener("click", () => navigate("home"));
  root.querySelector("#hub-edit").addEventListener("click", () => navigate("subjects", { edit: subject.id }));
  root.querySelectorAll("[data-quiz-id]").forEach(el => {
    el.addEventListener("click", () => navigate("quiz-modes", { quizId: el.dataset.quizId }));
  });
  root.querySelectorAll("[data-mode]").forEach(el => {
    el.addEventListener("click", () => {
      const mode = el.dataset.mode;
      if (mode === "ai-generate") {
        navigate("ai-generate", { presetTypes: subject.allowedTypes, subjectId: subject.id, subjectName: subject.name });
      } else if (mode === "editor") {
        navigate("editor", { subjectId: subject.id });
      } else {
        navigate(mode);
      }
    });
  });
}
