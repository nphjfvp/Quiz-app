import { loadQuizzes, loadProgress } from "../store.js";
import { navigate } from "../router.js";
import { esc } from "../utils.js";

export async function render(root, params) {
  const quizzes = await loadQuizzes();
  const quiz = quizzes.find((q) => q.id === params.quizId);
  if (!quiz) { navigate("home"); return; }

  const progress = await loadProgress();
  const n = quiz.questions?.length ?? 0;
  const counts = {};
  for (const q of (quiz.questions || [])) {
    const b = progress[q.id]?.box ?? 1;
    counts[b] = (counts[b] || 0) + 1;
  }

  // Weak questions (box 1-2)
  const weakQs = quiz.questions.filter(q => (progress[q.id]?.box ?? 1) <= 2);

  // Topics
  const topics = [...new Set(quiz.questions.map(q => q.topic).filter(Boolean))];

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="quiz-hero">
      <div class="quiz-hero-title">${esc(quiz.name)}</div>
      <div class="quiz-hero-sub">${n} Fragen</div>
      <div class="quiz-boxes" style="justify-content:center;margin-top:12px">
        ${[1,2,3,4,5].map(b => `<span class="quiz-box box-${b}">${counts[b]||0}</span>`).join("")}
      </div>
    </div>

    <div class="section-title">Lernmodus</div>
    <div class="grid-2">
      <div class="grid-card" id="mode-single">
        <div class="icon">📝</div>
        <div class="title">Einzeln</div>
        <div class="desc">Sofortiges Feedback</div>
      </div>
      <div class="grid-card" id="mode-exam">
        <div class="icon">📋</div>
        <div class="title">Klausur</div>
        <div class="desc">Alle am Ende</div>
      </div>
    </div>`;

  if (weakQs.length > 0) {
    html += `<div class="grid-card card-clickable" id="mode-weak" style="margin-bottom:12px;text-align:center">
      <div class="icon">🎯</div>
      <div class="title">Schwache Fragen (${weakQs.length})</div>
      <div class="desc">Box 1–2 wiederholen</div>
    </div>`;
  }

  if (topics.length > 1) {
    html += `<div class="section-title">Nach Thema</div>`;
    for (const topic of topics) {
      const tQs = quiz.questions.filter(q => q.topic === topic);
      html += `<div class="quiz-row" data-topic="${esc(topic)}">
        <div class="quiz-accent"></div>
        <div class="quiz-info">
          <h4>${esc(topic)}</h4>
          <small>${tQs.length} Fragen</small>
        </div>
        <span style="color:var(--text-light)">›</span>
      </div>`;
    }
  }

  root.innerHTML = html;

  root.querySelector("#back-btn").addEventListener("click", () => navigate("my-quizzes"));
  root.querySelector("#mode-single")?.addEventListener("click", () => navigate("quiz", { quiz, mode: "single" }));
  root.querySelector("#mode-exam")?.addEventListener("click", () => navigate("quiz", { quiz, mode: "exam" }));
  root.querySelector("#mode-weak")?.addEventListener("click", () => {
    const filtered = { ...quiz, questions: weakQs };
    navigate("quiz", { quiz: filtered, mode: "single" });
  });
  root.querySelectorAll("[data-topic]").forEach((el) => {
    el.addEventListener("click", () => {
      const filtered = { ...quiz, questions: quiz.questions.filter(q => q.topic === el.dataset.topic) };
      navigate("quiz", { quiz: filtered, mode: "single" });
    });
  });
}
