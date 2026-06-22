import { loadQuizzes, saveQuizzes } from "../store.js";
import { generateQuiz } from "../ai-service.js";
import { navigate } from "../router.js";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

export async function render(root, params = {}) {
  const prefillText = params.text ?? "";
  const prefillName = params.name ?? "";

  root.innerHTML = `
    <div class="editor-header">
      <button class="btn-icon back-btn" id="ai-back">←</button>
      <h2>Quiz mit KI erstellen</h2>
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="editor-form">
        <div class="input-group">
          <label>Quiz-Name (optional)</label>
          <input type="text" id="ai-quiz-name" class="input" value="${esc(prefillName)}" placeholder="z.B. Biologie Kapitel 5">
        </div>

        <div class="input-group">
          <label>Lerntext eingeben oder Datei hochladen</label>
          <textarea id="ai-text" class="textarea input" rows="10" placeholder="Hier den Text einfügen, aus dem Fragen generiert werden sollen…">${esc(prefillText)}</textarea>
        </div>

        <div class="input-group">
          <label>Datei laden (.txt)</label>
          <input type="file" id="ai-file" accept=".txt" class="input">
          <small style="color:var(--text-secondary,#888);margin-top:0.25rem;display:block">
            PDF- und DOCX-Unterstützung folgt in einer zukünftigen Version.
          </small>
        </div>

        <div class="input-group">
          <label>Anzahl Fragen</label>
          <select id="ai-num-questions" class="input">
            <option value="5">5 Fragen</option>
            <option value="10" selected>10 Fragen</option>
            <option value="15">15 Fragen</option>
            <option value="20">20 Fragen</option>
          </select>
        </div>

        <div id="ai-error" style="display:none;color:var(--danger,#e53e3e);background:var(--danger-bg,#fff5f5);padding:0.75rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:0.95rem"></div>

        <button id="ai-generate" class="btn btn-primary btn-lg btn-block">
          Quiz generieren
        </button>
      </div>
    </div>
  `;

  // --- Elements ---
  const backBtn = root.querySelector("#ai-back");
  const nameInput = root.querySelector("#ai-quiz-name");
  const textArea = root.querySelector("#ai-text");
  const fileInput = root.querySelector("#ai-file");
  const numSelect = root.querySelector("#ai-num-questions");
  const genBtn = root.querySelector("#ai-generate");
  const errorBox = root.querySelector("#ai-error");

  // --- File reading ---
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (!file.name.endsWith(".txt")) {
      showError("Bitte eine .txt-Datei auswählen. PDF/DOCX wird noch nicht unterstützt.");
      fileInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      textArea.value = reader.result;
      hideError();
    };
    reader.onerror = () => showError("Datei konnte nicht gelesen werden.");
    reader.readAsText(file);
  });

  // --- Back ---
  backBtn.addEventListener("click", () => navigate("home"));

  // --- Generate ---
  genBtn.addEventListener("click", async () => {
    const text = textArea.value.trim();
    if (!text) {
      showError("Bitte einen Lerntext eingeben oder eine Datei hochladen.");
      return;
    }
    if (text.length < 50) {
      showError("Der Text ist sehr kurz. Bitte mindestens ein paar Sätze eingeben, damit sinnvolle Fragen entstehen.");
      return;
    }

    const numQuestions = parseInt(numSelect.value, 10);
    const quizName = nameInput.value.trim() || `KI-Quiz (${numQuestions} Fragen)`;

    hideError();
    genBtn.disabled = true;
    genBtn.textContent = "⏳ Generiere…";

    try {
      const questions = await generateQuiz(text, numQuestions);

      const quiz = {
        id: uid(),
        name: quizName,
        questions,
        description: "KI-generiert",
        created: new Date().toISOString(),
      };

      const quizzes = await loadQuizzes();
      quizzes.push(quiz);
      await saveQuizzes(quizzes);

      navigate("quiz-modes", { quizId: quiz.id });
    } catch (err) {
      showError(err.message || "Beim Generieren ist ein Fehler aufgetreten.");
      genBtn.disabled = false;
      genBtn.textContent = "Quiz generieren";
    }
  });

  // --- Helpers ---
  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = "block";
  }

  function hideError() {
    errorBox.style.display = "none";
  }
}
