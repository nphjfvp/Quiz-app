import { loadQuizzes, saveQuizzes, loadSettings } from "../store.js";
import { generateQuiz, generateQuizFromImage, generateQuizFromImages, getModelContextLimit, MODELS, editQuestionWithAI } from "../ai-service.js";
import { navigate } from "../router.js";
import { esc, loadPdfJs, uid } from "../utils.js";

const Q_TYPES = [
  { id: "single_choice", label: "Single Choice" },
  { id: "multiple_choice", label: "Multiple Choice" },
  { id: "free_text", label: "Freitext" },
  { id: "fill_blank", label: "Lückentext" },
  { id: "drag_drop", label: "Drag & Drop" },
  { id: "drag_category", label: "Kategorie-Zuordnung" },
  { id: "math_formula", label: "Mathe-Formel" },
];

export async function render(root, params = {}) {
  const prefillText = params.text ?? "";
  const prefillName = params.name ?? "";
  const settings = await loadSettings();
  let currentModel = settings.aiModel || "nvidia/nemotron-3-super-120b-a12b:free";
  let charLimit = getModelContextLimit(currentModel);
  let uploadedFileType = null;
  let uploadedImageData = null;
  let pdfPageImages = null; // data-URLs of rendered PDF pages when visual mode is on

  function fmtLimit(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return Math.floor(n / 1000) + "k";
    return n;
  }

  root.innerHTML = `
    <div class="editor-header">
      <button class="btn-icon back-btn" id="ai-back">←</button>
      <h2>Quiz mit KI erstellen</h2>
    </div>

    <div class="card mt-section">
      <div class="editor-form">
        <div class="input-group">
          <label>Quiz-Name (optional)</label>
          <input type="text" id="ai-quiz-name" class="input" value="${esc(prefillName)}" placeholder="z.B. Biologie Kapitel 5">
        </div>

        <div class="input-group">
          <label>Lerntext eingeben oder Datei hochladen</label>
          <textarea id="ai-text" class="textarea input" rows="10" placeholder="Hier den Text einfügen, aus dem Fragen generiert werden sollen…">${esc(prefillText)}</textarea>
          <div id="char-counter" class="char-counter">
            <span id="char-count">0 Zeichen</span>
            <span>Max ~${fmtLimit(charLimit)} Zeichen (${esc(currentModel.split("/").pop())})</span>
          </div>
        </div>

        <div class="input-group">
          <label>Datei laden (.txt, .pdf, Bild)</label>
          <input type="file" id="ai-file" accept=".txt,.pdf,image/*" class="input">
          <small class="file-hint">PDF-Text wird automatisch extrahiert. Bilder (Diagramme, Screenshots) werden per Vision-KI analysiert.</small>
          <div id="visual-toggle-row" class="visual-toggle-row" style="display:none">
            <label class="toggle-label">
              <input type="checkbox" id="visual-toggle">
              <span>📸 Enthält relevante Bilder</span>
            </label>
            <small class="file-hint">Wenn aktiv, werden PDF-Seiten als Bilder an ein Vision-Modell gesendet — so werden Diagramme, Formeln und Grafiken erkannt.</small>
          </div>
          <div id="img-preview" class="img-preview"></div>
          <div id="file-progress" class="file-progress">
            <div class="file-track">
              <div id="file-bar" class="file-fill"></div>
            </div>
            <small id="file-info" class="file-info">Extrahiere Text...</small>
          </div>
        </div>

        <div class="input-group">
          <label>KI-Modell</label>
          <div id="gen-model-list" class="model-select-list">
            ${MODELS.map(m => {
              const sel = currentModel === m.id;
              const icons = m.vision ? "👁 Bilder" : "📝 Text";
              const ctxLabel = m.context >= 1000000 ? "1M" : Math.floor(m.context/1000) + "k";
              return `<div class="model-option ${sel ? "selected" : ""}" data-model="${m.id}" data-vision="${m.vision}">
                <div class="model-name">${esc(m.name)} <span class="model-icons">${icons}</span></div>
                <div class="model-meta">${m.tier} · ${m.price} · ${ctxLabel} ctx</div>
              </div>`;
            }).join("")}
          </div>
          <div class="gen-model-hint">👁 = kann Bilder sehen · 📝 = nur Text</div>
        </div>

        <div class="input-group">
          <label>Anzahl Fragen</label>
          <div class="num-q-row">
            <input type="number" id="ai-num-questions" class="input" min="1" max="500" value="10" placeholder="z.B. 15">
            <button type="button" id="ai-num-auto" class="btn btn-ghost num-auto-btn">🤖 KI entscheidet</button>
          </div>
          <div class="num-q-presets">
            ${[5, 10, 20, 30, 50].map(n => `<button type="button" class="num-preset" data-n="${n}">${n}</button>`).join("")}
          </div>
          <small class="file-hint" id="num-q-hint">Frei wählbar (1–500) oder die KI bestimmt die sinnvolle Anzahl selbst.</small>
          <div id="detail-level-row" class="detail-level-row" style="display:none">
            <label style="font-size:0.85rem;font-weight:600;margin-bottom:4px;display:block">Genauigkeit</label>
            <div class="detail-presets">
              <button type="button" class="detail-preset" data-level="compact">🎯 Kompakt</button>
              <button type="button" class="detail-preset active" data-level="normal">⚖️ Normal</button>
              <button type="button" class="detail-preset" data-level="thorough">🔬 Maximal gründlich</button>
            </div>
            <small class="file-hint" id="detail-hint">Normal: Eine Frage pro wichtigem Konzept.</small>
          </div>
        </div>

        <div id="ai-error" class="error-box"></div>

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
  const numInput = root.querySelector("#ai-num-questions");
  const numAutoBtn = root.querySelector("#ai-num-auto");
  const numHint = root.querySelector("#num-q-hint");
  const genBtn = root.querySelector("#ai-generate");
  const errorBox = root.querySelector("#ai-error");

  // --- Question count: free input + AI-decides toggle ---
  let autoCount = false;
  let detailLevel = "normal";
  const detailRow = root.querySelector("#detail-level-row");
  const detailHintEl = root.querySelector("#detail-hint");
  const DETAIL_HINTS = {
    compact: "Kompakt: Nur die wichtigsten Kernkonzepte.",
    normal: "Normal: Eine Frage pro wichtigem Konzept.",
    thorough: "Maximal gründlich: Zu JEDEM Fakt, jeder Definition und Formel eine Frage.",
  };
  root.querySelectorAll(".detail-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".detail-preset").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      detailLevel = btn.dataset.level;
      detailHintEl.textContent = DETAIL_HINTS[detailLevel];
    });
  });
  function setAuto(on) {
    autoCount = on;
    numAutoBtn.classList.toggle("active", on);
    numInput.disabled = on;
    detailRow.style.display = on ? "" : "none";
    if (on) {
      numInput.value = "";
      numInput.placeholder = "🤖 KI entscheidet";
      numHint.textContent = "Die KI bestimmt die sinnvolle Anzahl Fragen selbst.";
    } else {
      numInput.placeholder = "z.B. 15";
      if (!numInput.value) numInput.value = "10";
      numHint.textContent = "Frei wählbar (1–500) oder die KI bestimmt die sinnvolle Anzahl selbst.";
    }
  }
  numAutoBtn.addEventListener("click", () => setAuto(!autoCount));
  numInput.addEventListener("input", () => { if (autoCount) setAuto(false); });
  root.querySelectorAll(".num-preset").forEach(b => {
    b.addEventListener("click", () => {
      setAuto(false);
      numInput.value = b.dataset.n;
    });
  });

  function getNumQuestions() {
    if (autoCount) return 0;
    const n = parseInt(numInput.value, 10);
    if (!Number.isFinite(n) || n < 1) return 10;
    return Math.min(500, n);
  }

  const fileProgress = root.querySelector("#file-progress");
  const fileBar = root.querySelector("#file-bar");
  const fileInfo = root.querySelector("#file-info");

  // --- Model selection ---
  function needsVision() {
    if (uploadedFileType === "image") return true;
    if (uploadedFileType === "pdf" && root.querySelector("#visual-toggle")?.checked) return true;
    return false;
  }

  function updateModelAvailability() {
    const requireVision = needsVision();
    root.querySelectorAll("#gen-model-list .model-option").forEach(el => {
      const vision = el.dataset.vision === "true";
      const incompatible = requireVision && !vision;
      el.classList.toggle("disabled", incompatible);
      if (incompatible && el.classList.contains("selected")) {
        el.classList.remove("selected");
      }
    });
  }

  root.querySelectorAll("#gen-model-list .model-option").forEach(el => {
    el.addEventListener("click", () => {
      if (el.classList.contains("disabled")) return;
      root.querySelectorAll("#gen-model-list .model-option").forEach(o => o.classList.remove("selected"));
      el.classList.add("selected");
      currentModel = el.dataset.model;
      charLimit = getModelContextLimit(currentModel);
      const charLimitLabel = charLimit >= 1000000 ? (charLimit/1000000).toFixed(1)+"M" : Math.floor(charLimit/1000)+"k";
      root.querySelector("#char-counter span:last-child").textContent = `Max ~${charLimitLabel} Zeichen (${currentModel.split("/").pop()})`;
      updateCharCount();
    });
  });

  root.querySelector("#visual-toggle").addEventListener("change", async () => {
    updateModelAvailability();
    const visualOn = root.querySelector("#visual-toggle").checked;
    const file = fileInput.files[0];
    if (visualOn && file && file.name.endsWith(".pdf") && !pdfPageImages) {
      await renderPdfAsImages(file);
    }
    if (!visualOn) {
      pdfPageImages = null;
      root.querySelector("#img-preview").innerHTML = "";
    }
  });

  async function renderPdfAsImages(file) {
    fileProgress.style.display = "block";
    fileBar.style.width = "10%";
    fileInfo.textContent = "Rendere PDF-Seiten als Bilder…";
    try {
      const pdfjsLib = await loadPdfJs();
      fileBar.style.width = "20%";
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const images = [];
      const maxPages = Math.min(pdf.numPages, 20);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 2;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        images.push(canvas.toDataURL("image/jpeg", 0.85));
        fileBar.style.width = (20 + 80 * i / maxPages) + "%";
        fileInfo.textContent = `Seite ${i}/${maxPages} gerendert…`;
      }
      pdfPageImages = images;
      const previewDiv = root.querySelector("#img-preview");
      previewDiv.innerHTML = `<div class="file-hint">📸 ${images.length} Seiten als Bilder geladen${pdf.numPages > 20 ? ` (max. 20 von ${pdf.numPages})` : ""}. Vision-KI wird Bilder, Diagramme und Formeln erkennen.</div>`;
      previewDiv.innerHTML += images.slice(0, 3).map(src => `<img src="${src}" alt="PDF-Seite" style="max-height:120px;border-radius:8px;margin:4px">`).join("");
      if (images.length > 3) previewDiv.innerHTML += `<small>… und ${images.length - 3} weitere</small>`;
      fileInfo.textContent = `✓ ${images.length} Seiten gerendert`;
      setTimeout(() => { fileProgress.style.display = "none"; }, 2000);
    } catch (err) {
      showError("PDF-Seiten konnten nicht gerendert werden: " + (err.message || err));
      fileProgress.style.display = "none";
    }
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    hideError();

    const isImage = file.type.startsWith("image/") || file.name.match(/\.(png|jpg|jpeg|gif|webp)$/i);
    uploadedFileType = file.name.endsWith(".pdf") ? "pdf" : isImage ? "image" : null;
    uploadedImageData = null;
    pdfPageImages = null;
    root.querySelector("#img-preview").innerHTML = "";
    root.querySelector("#visual-toggle-row").style.display = uploadedFileType === "pdf" ? "" : "none";
    root.querySelector("#visual-toggle").checked = false;
    updateModelAvailability();

    if (isImage) {
      const reader = new FileReader();
      reader.onload = () => {
        uploadedImageData = reader.result;
        root.querySelector("#img-preview").innerHTML = `<img src="${uploadedImageData}" alt="Vorschau"><div class="file-hint">Bild wird per Vision-KI analysiert. „Quiz generieren" startet die Auswertung.</div>`;
      };
      reader.onerror = () => showError("Bild konnte nicht gelesen werden.");
      reader.readAsDataURL(file);
      return;
    }

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
        const extractedLen = text.replace(/\s/g, "").length;
        if (extractedLen < 50) {
          root.querySelector("#visual-toggle-row").style.display = "";
          root.querySelector("#visual-toggle").checked = true;
          updateModelAvailability();
          fileInfo.textContent = `⚠ Kaum Text erkannt – visueller Modus aktiviert`;
          await renderPdfAsImages(file);
        } else {
          fileInfo.textContent = `✓ ${pdf.numPages} Seiten extrahiert`;
          setTimeout(() => { fileProgress.style.display = "none"; }, 2000);
        }
      } catch (err) {
        showError("PDF konnte nicht gelesen werden: " + (err.message || err));
        fileProgress.style.display = "none";
      }
      return;
    }

    showError("Bitte eine .txt oder .pdf Datei auswählen.");
    fileInput.value = "";
  });

  // --- Char counter ---
  const charCountEl = root.querySelector("#char-count");
  function updateCharCount() {
    const len = textArea.value.length;
    const over = len > charLimit;
    charCountEl.textContent = `${len.toLocaleString("de")} Zeichen`;
    charCountEl.style.color = over ? "var(--danger)" : "var(--text-light)";
    if (over) charCountEl.textContent += ` (${(len - charLimit).toLocaleString("de")} zu viel!)`;
  }
  textArea.addEventListener("input", updateCharCount);
  updateCharCount();

  // --- Back ---
  backBtn.addEventListener("click", () => navigate("home"));

  // --- Generate ---
  genBtn.addEventListener("click", async () => {
    const text = textArea.value.trim();
    const numQuestions = getNumQuestions();

    // Bild-Pfad: per Vision-KI auswerten (einzelnes Bild)
    if (uploadedImageData && !text) {
      const quizName = nameInput.value.trim() || `KI-Quiz (Bild)`;
      hideError();
      genBtn.disabled = true;
      genBtn.textContent = "⏳ Analysiere Bild…";
      try {
        const questions = await generateQuizFromImage(uploadedImageData, numQuestions, "de", { model: currentModel, detailLevel });
        showReview(root, questions, quizName, currentModel, "");
      } catch (err) {
        showError(err.message || "Bild konnte nicht ausgewertet werden.");
        genBtn.disabled = false;
        genBtn.textContent = "Quiz generieren";
      }
      return;
    }

    // PDF visuell: Seiten als Bilder an Vision-KI
    if (pdfPageImages && root.querySelector("#visual-toggle")?.checked) {
      const quizName = nameInput.value.trim() || `KI-Quiz (PDF visuell)`;
      hideError();
      genBtn.disabled = true;
      genBtn.textContent = `⏳ Analysiere ${pdfPageImages.length} Seiten…`;
      try {
        const questions = await generateQuizFromImages(pdfPageImages, numQuestions, "de", { model: currentModel, detailLevel }, text || undefined);
        showReview(root, questions, quizName, currentModel, text || "");
      } catch (err) {
        showError(err.message || "PDF-Bilder konnten nicht ausgewertet werden.");
        genBtn.disabled = false;
        genBtn.textContent = "Quiz generieren";
      }
      return;
    }

    if (!text) {
      showError("Bitte einen Lerntext eingeben oder eine Datei/Bild hochladen.");
      return;
    }
    if (text.length < 50) {
      showError("Der Text ist sehr kurz. Bitte mindestens ein paar Sätze eingeben, damit sinnvolle Fragen entstehen.");
      return;
    }

    const quizName = nameInput.value.trim() || (numQuestions > 0 ? `KI-Quiz (${numQuestions} Fragen)` : "KI-Quiz");

    let inputText = text;
    if (inputText.length > charLimit) {
      if (!confirm(`Der Text ist ${(inputText.length - charLimit).toLocaleString("de")} Zeichen zu lang für das gewählte Modell. Soll der Text gekürzt werden?`)) return;
      inputText = inputText.slice(0, charLimit);
    }

    hideError();
    genBtn.disabled = true;
    genBtn.textContent = "⏳ Generiere…";

    try {
      const questions = await generateQuiz(inputText, numQuestions, "de", { model: currentModel, detailLevel });
      showReview(root, questions, quizName, currentModel, inputText);
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

// ─── Review Screen ──────────────────────────────────────────────────

function showReview(root, questions, quizName, modelId, sourceText = "") {
  let qs = [...questions];
  const _sourceText = sourceText;

  function renderReview() {
    let html = `<div class="editor-header">
      <button class="btn-icon" id="review-back">←</button>
      <h2>Fragen prüfen (${qs.length})</h2>
    </div>
    <div class="review-hint">Prüfe die generierten Fragen. Du kannst sie bearbeiten, per KI ändern lassen, den Typ wechseln oder löschen.</div>`;

    qs.forEach((q, i) => {
      const typeLabel = Q_TYPES.find(t => t.id === q.question_type)?.label || q.question_type;
      html += `<div class="card review-card" data-idx="${i}">
        <div class="review-card-head">
          <span class="review-card-num">Frage ${i + 1}</span>
          <span class="tag">${typeLabel}</span>
        </div>
        <div class="input-group">
          <label>Fragetext</label>
          <textarea class="textarea input q-text" rows="2">${esc(q.question_text || "")}</textarea>
        </div>`;

      if (q.options && q.options.length) {
        html += `<div class="review-opts">
          <label>Antworten</label>`;
        q.options.forEach((o, oi) => {
          html += `<div class="review-opt-row">
            <input type="checkbox" class="opt-correct" data-oi="${oi}" ${o.is_correct ? "checked" : ""}>
            <input type="text" class="input opt-text" data-oi="${oi}" value="${esc(o.text || "")}">
          </div>`;
        });
        html += `</div>`;
      }

      if (q.correct_text !== undefined && q.question_type === "free_text") {
        html += `<div class="input-group">
          <label>Richtige Antwort</label>
          <input type="text" class="input q-correct-text" value="${esc(q.correct_text || "")}">
        </div>`;
      }

      if (q.explanation) {
        html += `<div class="input-group">
          <label>Erklärung</label>
          <textarea class="textarea input q-explanation" rows="2">${esc(q.explanation || "")}</textarea>
        </div>`;
      }

      html += `<div class="review-convert">
        <select class="input q-type-select">
          ${Q_TYPES.map(t => `<option value="${t.id}" ${t.id === q.question_type ? "selected" : ""}>${t.label}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm q-convert-btn">Typ ändern</button>
      </div>`;

      html += `<div class="review-ai-row">
        <input type="text" class="input q-ai-instruction" placeholder="KI-Anweisung, z.B. 'Mach die Frage schwerer'">
        <button class="btn btn-primary btn-sm q-ai-btn">KI ändern</button>
      </div>
      <div class="q-ai-status review-ai-status"></div>`;

      html += `<div class="review-delete">
        <button class="btn btn-ghost btn-sm q-delete-btn">Frage löschen</button>
      </div>`;

      html += `</div>`;
    });

    html += `<div class="review-save-row">
      <button class="btn btn-primary btn-lg" id="review-save">Quiz speichern (${qs.length} Fragen)</button>
    </div>`;

    root.innerHTML = html;
    bindReviewEvents();
  }

  function syncManualEdits(card, idx) {
    const q = qs[idx];
    const textEl = card.querySelector(".q-text");
    if (textEl) q.question_text = textEl.value;
    const correctTextEl = card.querySelector(".q-correct-text");
    if (correctTextEl) q.correct_text = correctTextEl.value;
    const explEl = card.querySelector(".q-explanation");
    if (explEl) q.explanation = explEl.value;
    card.querySelectorAll(".opt-text").forEach(el => {
      const oi = parseInt(el.dataset.oi);
      if (q.options?.[oi]) q.options[oi].text = el.value;
    });
    card.querySelectorAll(".opt-correct").forEach(el => {
      const oi = parseInt(el.dataset.oi);
      if (q.options?.[oi]) q.options[oi].is_correct = el.checked;
    });
  }

  function syncAllEdits() {
    root.querySelectorAll(".card[data-idx]").forEach(card => {
      syncManualEdits(card, parseInt(card.dataset.idx));
    });
  }

  function bindReviewEvents() {
    root.querySelector("#review-back")?.addEventListener("click", () => {
      if (confirm("Zurück? Nicht gespeicherte Änderungen gehen verloren.")) {
        render(root);
      }
    });

    root.querySelector("#review-save")?.addEventListener("click", async () => {
      syncAllEdits();
      if (qs.length === 0) { alert("Keine Fragen zum Speichern."); return; }
      const quiz = {
        id: uid(),
        name: quizName,
        questions: qs,
        description: "KI-generiert",
        created: new Date().toISOString(),
      };
      const quizzes = await loadQuizzes();
      quizzes.push(quiz);
      await saveQuizzes(quizzes);

      if (_sourceText && _sourceText.length > 100) {
        const { saveMaterial } = await import("../store.js");
        const doSave = confirm("Möchtest du das Quellmaterial (Skript/PDF-Text) mit dem Quiz verknüpfen?\n\nDamit kann die KI dir gezielt beim Lernen helfen — auch zu Themen, die nicht im Quiz vorkommen.");
        if (doSave) {
          await saveMaterial(quiz.id, { text: _sourceText, name: quizName, saved: new Date().toISOString() });
        }
      }

      navigate("quiz-modes", { quizId: quiz.id });
    });

    // Delete
    root.querySelectorAll(".q-delete-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".card[data-idx]");
        const idx = parseInt(card.dataset.idx);
        syncAllEdits();
        qs.splice(idx, 1);
        renderReview();
      });
    });

    // AI edit
    root.querySelectorAll(".q-ai-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".card[data-idx]");
        const idx = parseInt(card.dataset.idx);
        syncManualEdits(card, idx);
        const instruction = card.querySelector(".q-ai-instruction").value.trim();
        const st = card.querySelector(".q-ai-status");
        if (!instruction) { st.textContent = "Bitte eine Anweisung eingeben."; return; }
        btn.disabled = true;
        st.textContent = "⏳ KI arbeitet…";
        try {
          const edited = await editQuestionWithAI(qs[idx], instruction, null, { model: modelId });
          qs[idx] = { ...edited, id: qs[idx].id };
          renderReview();
        } catch (e) {
          st.textContent = "Fehler: " + e.message;
          btn.disabled = false;
        }
      });
    });

    // Type conversion
    root.querySelectorAll(".q-convert-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".card[data-idx]");
        const idx = parseInt(card.dataset.idx);
        syncManualEdits(card, idx);
        const targetType = card.querySelector(".q-type-select").value;
        if (targetType === qs[idx].question_type) return;
        const st = card.querySelector(".q-ai-status");
        btn.disabled = true;
        st.textContent = `⏳ Wandle in ${targetType} um…`;
        try {
          const edited = await editQuestionWithAI(qs[idx], `Wandle diese Frage in den Typ "${targetType}" um. Behalte den Inhalt bei.`, targetType, { model: modelId });
          edited.question_type = targetType;
          qs[idx] = { ...edited, id: qs[idx].id };
          renderReview();
        } catch (e) {
          st.textContent = "Fehler: " + e.message;
          btn.disabled = false;
        }
      });
    });
  }

  renderReview();
}
