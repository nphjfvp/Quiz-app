import { loadQuizzes, loadProgress, getMaterial } from "../store.js";
import { navigate } from "../router.js";
import { esc, getBoxCounts, loadPdfJs } from "../utils.js";

export async function render(root, params) {
  const quizzes = await loadQuizzes();
  const quiz = quizzes.find((q) => q.id === params.quizId);
  if (!quiz) { navigate("home"); return; }

  const [progress, material] = await Promise.all([loadProgress(), getMaterial(params.quizId)]);
  const n = quiz.questions?.length ?? 0;
  const counts = getBoxCounts(quiz, progress);

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

  html += `<div class="grid-card card-clickable" id="mode-study" style="margin-bottom:12px;text-align:center">
    <div class="icon">📖</div>
    <div class="title">KI-Lernmodus</div>
    <div class="desc">${material ? "Mit Quellmaterial" : "Schwächen gezielt lernen"}</div>
  </div>`;

  if (weakQs.length > 0) {
    html += `<div class="grid-card card-clickable" id="mode-weak" style="margin-bottom:12px;text-align:center">
      <div class="icon">🎯</div>
      <div class="title">Schwache Fragen (${weakQs.length})</div>
      <div class="desc">Box 1–2 wiederholen</div>
    </div>`;
  }

  if (!material) {
    html += `<div class="card" style="padding:12px;margin-bottom:12px;text-align:center">
      <small>📄 Quellmaterial verknüpfen (Skript/Vorlesung)</small><br>
      <input type="file" id="material-upload" accept=".txt,.pdf" style="margin-top:8px;font-size:0.85rem">
      <div id="material-status" style="font-size:0.8rem;margin-top:4px"></div>
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
  root.querySelector("#mode-study")?.addEventListener("click", () => navigate("study", { quizId: quiz.id }));
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

  root.querySelector("#material-upload")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const st = root.querySelector("#material-status");
    st.textContent = "Lade...";
    try {
      let text = "";
      if (file.name.endsWith(".pdf")) {
        const pdfjsLib = await loadPdfJs();
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(item => item.str).join(" ") + "\n\n";
          st.textContent = `Seite ${i}/${pdf.numPages}...`;
        }
      } else {
        text = await file.text();
      }
      if (text.trim().length < 20) { st.textContent = "Datei enthält zu wenig Text."; return; }
      const { saveMaterial } = await import("../store.js");
      await saveMaterial(quiz.id, { text: text.trim(), name: file.name, saved: new Date().toISOString() });
      st.textContent = "✓ Material verknüpft!";
      setTimeout(() => render(root, params), 1500);
    } catch (err) { st.textContent = "Fehler: " + (err.message || err); }
  });
}
