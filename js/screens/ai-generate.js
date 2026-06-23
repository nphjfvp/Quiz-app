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
          <label>Datei laden (.txt, .pdf)</label>
          <input type="file" id="ai-file" accept=".txt,.pdf" class="input">
          <small style="color:var(--text-light);margin-top:0.25rem;display:block">
            PDF-Text wird automatisch extrahiert.
          </small>
          <div id="file-progress" style="display:none;margin-top:0.5rem">
            <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
              <div id="file-bar" style="height:100%;background:var(--primary);width:0%;transition:width 0.3s"></div>
            </div>
            <small id="file-info" style="color:var(--text-light)">Extrahiere Text...</small>
          </div>
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

  const fileProgress = root.querySelector("#file-progress");
  const fileBar = root.querySelector("#file-bar");
  const fileInfo = root.querySelector("#file-info");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    hideError();

    if (file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = () => { textArea.value = reader.result; };
      reader.onerror = () => showError("Datei konnte nicht gelesen werden.");
      reader.readAsText(file);
      return;
    }

    if (file.name.endsWith(".pdf")) {
      fileProgress.style.display = "block";
      fileBar.style.width = "10%";
      fileInfo.textContent = "Lade PDF-Bibliothek...";
      try {
        const pdfjsLib = await loadPdfJs();
        fileBar.style.width = "30%";
        fileInfo.textContent = "Lese PDF...";
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(item => item.str).join(" ") + "\n\n";
          fileBar.style.width = (30 + 70 * i / pdf.numPages) + "%";
          fileInfo.textContent = `Seite ${i}/${pdf.numPages}...`;
        }
        textArea.value = text.trim();
        fileInfo.textContent = `✓ ${pdf.numPages} Seiten extrahiert`;
        setTimeout(() => { fileProgress.style.display = "none"; }, 2000);
      } catch (err) {
        showError("PDF konnte nicht gelesen werden: " + (err.message || err));
        fileProgress.style.display = "none";
      }
      return;
    }

    showError("Bitte eine .txt oder .pdf Datei auswählen.");
    fileInput.value = "";
  });

  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = () => {
        const lib = window.pdfjsLib;
        if (lib) {
          lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          resolve(lib);
        } else reject(new Error("pdf.js konnte nicht geladen werden"));
      };
      script.onerror = () => reject(new Error("pdf.js konnte nicht geladen werden. Prüfe deine Internetverbindung."));
      document.head.appendChild(script);
    });
  }

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
