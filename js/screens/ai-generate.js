import { loadQuizzes, saveQuizzes, loadSettings } from "../store.js";
import { generateQuiz, generateQuizFromImage, generateQuizFromImages, importQuiz, getModelContextLimit, MODELS, editQuestionWithAI, crossCheckQuiz } from "../ai-service.js";
import { navigate } from "../router.js";
import { esc, loadPdfJs, uid } from "../utils.js";

function getQTypes(enableImages) {
  const types = [
    { id: "single_choice", label: "Single Choice" },
    { id: "multiple_choice", label: "Multiple Choice" },
    { id: "free_text", label: "Freitext" },
    { id: "fill_blank", label: "Lückentext" },
    { id: "drag_drop", label: "Drag & Drop" },
    { id: "drag_category", label: "Kategorie-Zuordnung" },
    { id: "math_formula", label: "Mathe-Formel" },
  ];
  if (enableImages) {
    types.push({ id: "diagram_label", label: "Diagramm beschriften" });
    types.push({ id: "mark_image", label: "Bild markieren" });
  }
  return types;
}

export async function render(root, params = {}) {
  const prefillText = params.text ?? "";
  const prefillName = params.name ?? "";
  const settings = await loadSettings();
  const enableImages = settings.enableImages !== false;
  const disabledModels = settings.disabledModels || [];
  const Q_TYPES = getQTypes(enableImages);
  let currentModel = settings.aiModel || "nvidia/nemotron-3-super-120b-a12b:free";
  let charLimit = getModelContextLimit(currentModel);
  let uploadedFileType = null;
  let uploadedImageData = null;
  let pdfPageImages = null; // data-URLs of rendered PDF pages (images/hybrid mode)
  let pdfFile = null;       // File-Referenz, um Seiten bei Moduswechsel neu zu rendern
  let pdfPageTexts = [];    // extrahierter Text pro Seite (Index 0 = Seite 1)
  let pdfVisualPages = [];  // 1-basierte Seitennummern mit wenig Text (Grafik/Formel)
  let pdfMode = "text";     // "text" | "hybrid" | "images"

  // Eine Seite mit weniger Text gilt als „visuell" (Diagramm/Formel/Scan) und
  // wird im Hybrid-Modus zusätzlich als Bild an ein Vision-Modell geschickt.
  const VISUAL_PAGE_MIN_CHARS = 100;

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
          <label>Modus</label>
          <div class="detail-presets" id="gen-mode-presets">
            <button type="button" class="detail-preset active" data-genmode="generate">🤖 Neu generieren</button>
            <button type="button" class="detail-preset" data-genmode="import">📄 Importieren (1:1)</button>
          </div>
          <small class="file-hint" id="gen-mode-hint">Neu generieren: KI erstellt neue Fragen aus dem Stoff. Importieren: übernimmt bereits vorhandene Fragen (Altklausur, Übungsblatt) 1:1.</small>
        </div>

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
          <details style="margin-top:8px;font-size:0.85rem">
            <summary style="cursor:pointer;color:var(--text-light)">🔍 Text filtern (optional)</summary>
            <div style="margin-top:6px">
              <label style="font-size:0.8rem">Auszuschließende Schlüsselwörter (Abschnitte mit diesen Wörtern werden ignoriert)</label>
              <input type="text" id="exclude-keywords" class="input" placeholder="z.B. Inhaltsverzeichnis, Literatur, Anhang" style="margin-top:4px">
              <small class="file-hint">Kommagetrennt. Jeder Absatz wird geprüft — enthält er ein Schlüsselwort, wird er ausgeschlossen.</small>
            </div>
          </details>
        </div>

        <div class="input-group">
          <label>Datei laden (.txt, .pdf, Bild)</label>
          <input type="file" id="ai-file" accept=".txt,.pdf,image/*" class="input">
          <small class="file-hint">PDF-Text wird automatisch extrahiert. Bilder (Diagramme, Screenshots) werden per Vision-KI analysiert.</small>
          <div id="pdf-mode-row" class="visual-toggle-row" style="display:none">
            <label style="font-size:0.85rem;font-weight:600;margin-bottom:4px;display:block">PDF-Verarbeitung</label>
            <div class="detail-presets" id="pdf-mode-presets">
              <button type="button" class="detail-preset active" data-mode="text">📝 Nur Text</button>
              <button type="button" class="detail-preset" data-mode="hybrid">🎨 Hybrid</button>
              <button type="button" class="detail-preset" data-mode="images">📸 Alle als Bild</button>
            </div>
            <small class="file-hint" id="pdf-mode-hint">Nur Text: schnell &amp; günstig. Diagramme/Formeln gehen verloren.</small>
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
            ${MODELS.filter(m => !disabledModels.includes(m.id)).map(m => {
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

        <div class="input-group">
          <label>Verarbeitung großer Texte (Chunking)</label>
          <div class="detail-presets" id="chunk-presets">
            <button type="button" class="detail-preset active" data-chunk="auto">⚙️ Auto</button>
            <button type="button" class="detail-preset" data-chunk="off">⛔ Aus</button>
            <button type="button" class="detail-preset" data-chunk="coarse">🧱 Grob</button>
            <button type="button" class="detail-preset" data-chunk="medium">⚖️ Mittel</button>
            <button type="button" class="detail-preset" data-chunk="fine">🔬 Fein</button>
          </div>
          <small class="file-hint" id="chunk-hint">Auto: Große Texte werden automatisch in Abschnitte zerlegt, damit nichts abgeschnitten wird. Feiner = kleinere Abschnitte, gründlicher, aber mehr KI-Aufrufe.</small>
        </div>

        <div class="input-group">
          <label>Fragetypen (welche erlaubt sind)</label>
          <div id="qtype-select" class="qtype-select">
            ${Q_TYPES.map(t => `<label class="qtype-chip">
              <input type="checkbox" class="qtype-cb" value="${t.id}" checked>
              <span>${esc(t.label)}</span>
            </label>`).join("")}
          </div>
          <small class="file-hint">Abgewählte Typen werden nicht generiert. Bei Bild/PDF stehen nur Single/Multiple Choice, Freitext &amp; Lückentext zur Verfügung.</small>
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

  // Vom Nutzer erlaubte Fragetypen. Leer = alle (Fallback im ai-service).
  function getAllowedTypes() {
    const ids = [...root.querySelectorAll(".qtype-cb:checked")].map(cb => cb.value);
    return ids.length ? ids : undefined;
  }

  // --- Chunking-Granularität ---
  let chunkMode = "auto";
  const CHUNK_SIZES = { coarse: 12000, medium: 7000, fine: 3500 };
  const CHUNK_HINTS = {
    auto: "Auto: Große Texte werden automatisch in Abschnitte zerlegt, damit nichts abgeschnitten wird.",
    off: "Aus: Text wird in EINEM Aufruf gesendet und ggf. auf das Kontextfenster gekürzt (schnell, günstig).",
    coarse: "Grob: ~12.000 Zeichen pro Abschnitt — wenige Aufrufe, schnell.",
    medium: "Mittel: ~7.000 Zeichen pro Abschnitt — ausgewogen.",
    fine: "Fein: ~3.500 Zeichen pro Abschnitt — gründlichste Abdeckung, aber die meisten KI-Aufrufe (höhere Kosten).",
  };
  const chunkHintEl = root.querySelector("#chunk-hint");
  root.querySelectorAll("#chunk-presets .detail-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("#chunk-presets .detail-preset").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      chunkMode = btn.dataset.chunk;
      if (chunkHintEl) chunkHintEl.textContent = CHUNK_HINTS[chunkMode];
    });
  });

  // --- Modus: generieren vs. importieren ---
  let genMode = "generate";
  const numGroup = numInput.closest(".input-group");
  root.querySelectorAll("#gen-mode-presets .detail-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("#gen-mode-presets .detail-preset").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      genMode = btn.dataset.genmode;
      // Beim Import bestimmt das Dokument die Anzahl → Anzahl-Auswahl ausblenden.
      if (numGroup) numGroup.style.display = genMode === "import" ? "none" : "";
      genBtn.textContent = genMode === "import" ? "Fragen importieren" : "Quiz generieren";
    });
  });

  // Liefert die Chunk-Größe in Zeichen (0 = kein Chunking).
  function getChunkSize(textLen) {
    if (chunkMode === "off") return 0;
    if (chunkMode === "auto") return textLen > 10000 ? 8000 : 0;
    return CHUNK_SIZES[chunkMode] || 0;
  }

  const fileProgress = root.querySelector("#file-progress");
  const fileBar = root.querySelector("#file-bar");
  const fileInfo = root.querySelector("#file-info");

  // --- Model selection ---
  function needsVision() {
    if (uploadedFileType === "image") return true;
    if (uploadedFileType === "pdf" && pdfMode === "images") return true;
    if (uploadedFileType === "pdf" && pdfMode === "hybrid" && pdfVisualPages.length > 0) return true;
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

  function updatePdfModeHint() {
    const hintEl = root.querySelector("#pdf-mode-hint");
    if (!hintEl) return;
    if (pdfMode === "text") {
      hintEl.textContent = "Nur Text: schnell & günstig. Diagramme/Formeln gehen verloren.";
    } else if (pdfMode === "hybrid") {
      hintEl.textContent = `Hybrid (empfohlen): Volltext + ${pdfVisualPages.length} Seite(n) mit Grafik/Formel als Bild. Bestes Preis-Leistungs-Verhältnis.`;
    } else {
      hintEl.textContent = "Alle Seiten als Bild: vollständigste, aber teuerste Variante (Vision-Modell nötig).";
    }
  }

  function setPdfMode(mode) {
    pdfMode = mode;
    root.querySelectorAll("#pdf-mode-presets .detail-preset").forEach(b =>
      b.classList.toggle("active", b.dataset.mode === mode));
    updatePdfModeHint();
    updateModelAvailability();
  }

  // Rendert die gewünschten Seiten als JPEG-Bilder. pageNumbers=null → alle Seiten.
  async function renderPdfPages(file, pageNumbers) {
    fileProgress.style.display = "block";
    fileBar.style.width = "10%";
    fileInfo.textContent = "Rendere PDF-Seiten als Bilder…";
    try {
      const pdfjsLib = await loadPdfJs();
      fileBar.style.width = "20%";
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let pages = (pageNumbers && pageNumbers.length)
        ? pageNumbers.filter(n => n >= 1 && n <= pdf.numPages)
        : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
      const capped = pages.length > 20;
      pages = pages.slice(0, 20);
      const images = [];
      for (let idx = 0; idx < pages.length; idx++) {
        const i = pages[idx];
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        images.push(canvas.toDataURL("image/jpeg", 0.85));
        fileBar.style.width = (20 + 80 * (idx + 1) / pages.length) + "%";
        fileInfo.textContent = `Seite ${i} gerendert (${idx + 1}/${pages.length})…`;
      }
      pdfPageImages = images;
      const previewDiv = root.querySelector("#img-preview");
      const label = pdfMode === "hybrid"
        ? `🎨 Hybrid: Volltext + ${images.length} Bildseite(n)${capped ? " (max. 20)" : ""}.`
        : `📸 ${images.length} Seiten als Bilder${capped ? ` (max. 20 von ${pdf.numPages})` : ""}.`;
      previewDiv.innerHTML = `<div class="file-hint">${label} Vision-KI erkennt Bilder, Diagramme und Formeln.</div>`;
      previewDiv.innerHTML += images.slice(0, 3).map(src => `<img src="${src}" alt="PDF-Seite" style="max-height:120px;border-radius:8px;margin:4px">`).join("");
      if (images.length > 3) previewDiv.innerHTML += `<small>… und ${images.length - 3} weitere</small>`;
      fileInfo.textContent = `✓ ${images.length} Seite(n) gerendert`;
      setTimeout(() => { fileProgress.style.display = "none"; }, 2000);
    } catch (err) {
      showError("PDF-Seiten konnten nicht gerendert werden: " + (err.message || err));
      fileProgress.style.display = "none";
    }
  }

  root.querySelectorAll("#pdf-mode-presets .detail-preset").forEach(btn => {
    btn.addEventListener("click", async () => {
      setPdfMode(btn.dataset.mode);
      if (!pdfFile) return;
      if (pdfMode === "images") {
        await renderPdfPages(pdfFile, null);
      } else if (pdfMode === "hybrid") {
        if (pdfVisualPages.length) {
          await renderPdfPages(pdfFile, pdfVisualPages);
        } else {
          pdfPageImages = null;
          root.querySelector("#img-preview").innerHTML = `<div class="file-hint">🎨 Hybrid: Keine reinen Bildseiten erkannt — es wird nur Text gesendet.</div>`;
        }
      } else { // text
        pdfPageImages = null;
        root.querySelector("#img-preview").innerHTML = "";
      }
    });
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    hideError();

    const isImage = file.type.startsWith("image/") || file.name.match(/\.(png|jpg|jpeg|gif|webp)$/i);
    uploadedFileType = file.name.endsWith(".pdf") ? "pdf" : isImage ? "image" : null;
    uploadedImageData = null;
    pdfPageImages = null;
    pdfFile = null;
    pdfPageTexts = [];
    pdfVisualPages = [];
    pdfMode = "text";
    root.querySelector("#img-preview").innerHTML = "";
    root.querySelector("#pdf-mode-row").style.display = uploadedFileType === "pdf" ? "" : "none";
    setPdfMode("text");
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
      pdfFile = file;
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
        pdfPageTexts = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(" ");
          pdfPageTexts.push(pageText);
          text += pageText + "\n\n";
          fileBar.style.width = (30 + 70 * i / pdf.numPages) + "%";
          fileInfo.textContent = `Seite ${i}/${pdf.numPages}...`;
        }
        textArea.value = text.trim();

        // Seiten mit wenig Text gelten als „visuell" (Diagramm/Formel/Scan).
        pdfVisualPages = pdfPageTexts
          .map((t, idx) => ({ n: idx + 1, len: t.replace(/\s/g, "").length }))
          .filter(p => p.len < VISUAL_PAGE_MIN_CHARS)
          .map(p => p.n);

        const extractedLen = text.replace(/\s/g, "").length;
        if (extractedLen < 50) {
          // Scan-/Bild-PDF: gesamter Text fehlt → alle Seiten als Bild.
          setPdfMode("images");
          fileInfo.textContent = `⚠ Kaum Text erkannt – „Alle als Bild" aktiviert`;
          await renderPdfPages(pdfFile, null);
        } else if (pdfVisualPages.length > 0) {
          // Teilweise visuell → Hybrid empfehlen und Bildseiten rendern.
          setPdfMode("hybrid");
          fileInfo.textContent = `✓ ${pdf.numPages} Seiten · ${pdfVisualPages.length} Bildseite(n) → Hybrid empfohlen`;
          await renderPdfPages(pdfFile, pdfVisualPages);
        } else {
          setPdfMode("text");
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
    let text = textArea.value.trim();
    // Text-Filter: Abschnitte mit ausgeschlossenen Schlüsselwörtern entfernen
    const excludeInput = root.querySelector("#exclude-keywords");
    if (excludeInput?.value.trim()) {
      const keywords = excludeInput.value.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
      if (keywords.length) {
        const paragraphs = text.split(/\n\s*\n/);
        const kept = paragraphs.filter(p => !keywords.some(kw => p.toLowerCase().includes(kw)));
        text = kept.join("\n\n");
      }
    }
    const numQuestions = getNumQuestions();
    const allowedTypes = getAllowedTypes();

    // Bild-Pfad: per Vision-KI auswerten (einzelnes Bild). Im Import-Modus
    // immer den extrahierten Text nutzen (kein Vision-Pfad).
    if (genMode !== "import" && uploadedImageData && !text) {
      const quizName = nameInput.value.trim() || `KI-Quiz (Bild)`;
      hideError();
      genBtn.disabled = true;
      genBtn.textContent = "⏳ Analysiere Bild…";
      try {
        const questions = await generateQuizFromImage(uploadedImageData, numQuestions, "de", { model: currentModel, detailLevel, allowedTypes });
        showReview(root, questions, quizName, currentModel, "");
      } catch (err) {
        showError(err.message || "Bild konnte nicht ausgewertet werden.");
        genBtn.disabled = false;
        genBtn.textContent = "Quiz generieren";
      }
      return;
    }

    // PDF visuell (alle Seiten) oder hybrid (Volltext + Bildseiten)
    if (genMode !== "import" && uploadedFileType === "pdf" && (pdfMode === "images" || pdfMode === "hybrid")) {
      const haveImages = pdfPageImages && pdfPageImages.length > 0;
      // Images-Modus braucht Bilder; Hybrid ohne Bildseiten fällt in den Textpfad.
      if (pdfMode === "images" || (pdfMode === "hybrid" && haveImages)) {
        const quizName = nameInput.value.trim() || (pdfMode === "hybrid" ? "KI-Quiz (PDF hybrid)" : "KI-Quiz (PDF visuell)");
        hideError();
        genBtn.disabled = true;
        const imgChunkSize = 5; // Seiten pro Batch für Vision-KI
        try {
          let ctxText = pdfMode === "hybrid" ? text : (text || undefined);
          if (ctxText && ctxText.length > charLimit) ctxText = ctxText.slice(0, charLimit);
          const onProgress = (i, n) => { genBtn.textContent = `⏳ Batch ${i}/${n}…`; };
          const questions = await generateQuizFromImages(pdfPageImages, numQuestions, "de", { model: currentModel, detailLevel, allowedTypes, chunkSize: imgChunkSize, onProgress }, ctxText);
          showReview(root, questions, quizName, currentModel, text || "");
        } catch (err) {
          showError(err.message || "PDF konnte nicht ausgewertet werden.");
          genBtn.disabled = false;
          genBtn.textContent = "Quiz generieren";
        }
        return;
      }
      // Hybrid ohne Bildseiten → weiter unten reiner Textpfad
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
    const chunkSize = getChunkSize(inputText.length);
    // Ohne Chunking wird der Text auf das Kontextfenster gekürzt. Mit Chunking
    // bleibt der Volltext erhalten und wird abschnittsweise verarbeitet.
    if (!chunkSize && inputText.length > charLimit) {
      if (!confirm(`Der Text ist ${(inputText.length - charLimit).toLocaleString("de")} Zeichen zu lang für das gewählte Modell. Soll der Text gekürzt werden? (Tipp: „Chunking" oben aktivieren, um den ganzen Text zu verarbeiten.)`)) return;
      inputText = inputText.slice(0, charLimit);
    }

    hideError();
    genBtn.disabled = true;
    genBtn.textContent = chunkSize ? "⏳ Verarbeite Abschnitte…" : (genMode === "import" ? "⏳ Importiere…" : "⏳ Generiere…");

    try {
      const onProgress = (i, n) => { genBtn.textContent = `⏳ Abschnitt ${i}/${n}…`; };
      const questions = genMode === "import"
        ? await importQuiz(inputText, "de", { model: currentModel, chunkSize, onProgress })
        : await generateQuiz(inputText, numQuestions, "de", { model: currentModel, detailLevel, allowedTypes, chunkSize, onProgress });
      const importName = nameInput.value.trim() || "Importiertes Quiz";
      showReview(root, questions, genMode === "import" ? importName : quizName, currentModel, inputText);
    } catch (err) {
      showError(err.message || (genMode === "import" ? "Beim Importieren ist ein Fehler aufgetreten." : "Beim Generieren ist ein Fehler aufgetreten."));
      genBtn.disabled = false;
      genBtn.textContent = genMode === "import" ? "Fragen importieren" : "Quiz generieren";
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

async function showReview(root, questions, quizName, modelId, sourceText = "") {
  const settings = await loadSettings();
  const Q_TYPES = getQTypes(settings.enableImages !== false);
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

    html += `<div class="review-save-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary btn-lg" id="review-save">Quiz speichern (${qs.length} Fragen)</button>
      <button class="btn btn-ghost" id="review-crosscheck">🔍 KI-Cross-Check</button>
      <span style="font-size:0.75rem;color:var(--text-light)">Zweite KI prüft auf Fehler</span>
    </div>
    <div id="crosscheck-results"></div>`;

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

    root.querySelector("#review-crosscheck")?.addEventListener("click", async () => {
      syncAllEdits();
      const btn = root.querySelector("#review-crosscheck");
      const resultsDiv = root.querySelector("#crosscheck-results");
      btn.textContent = "⏳ Prüfe…";
      btn.disabled = true;
      resultsDiv.innerHTML = `<div style="padding:8px;font-size:0.85rem;color:var(--text-light)">🔍 KI-Cross-Check läuft…</div>`;
      try {
        const findings = await crossCheckQuiz(qs);
        if (!findings || findings.length === 0) {
          resultsDiv.innerHTML = `<div class="card" style="padding:10px 14px;margin-top:8px;background:var(--success-bg, #dcfce7)">
            ✅ <strong>Keine Probleme gefunden!</strong> Alle ${qs.length} Fragen sehen gut aus.
          </div>`;
        } else {
          let findingHtml = `<div class="card" style="padding:10px 14px;margin-top:8px">
            <div style="font-weight:600;margin-bottom:8px">⚠️ ${findings.length} ${findings.length === 1 ? "Problem" : "Probleme"} gefunden:</div>`;
          for (const f of findings) {
            const sevColor = f.severity === "high" ? "var(--danger)" : f.severity === "medium" ? "var(--warning)" : "var(--text-light)";
            findingHtml += `<div style="padding:8px 0;border-bottom:1px solid var(--border-light, #eee)">
              <div><span style="color:${sevColor};font-weight:600">${f.severity === "high" ? "🔴" : f.severity === "medium" ? "🟡" : "🔵"} Frage ${f.nr || "?"}</span>: ${f.issue || ""}</div>
              ${f.suggestion ? `<div style="font-size:0.8rem;color:var(--text-light);margin-top:2px">💡 ${f.suggestion}</div>` : ""}
            </div>`;
          }
          findingHtml += `</div>`;
          resultsDiv.innerHTML = findingHtml;
        }
      } catch (e) {
        resultsDiv.innerHTML = `<div class="card" style="padding:10px 14px;margin-top:8px;color:var(--danger)">❌ Cross-Check fehlgeschlagen: ${e.message || "Unbekannter Fehler"}</div>`;
      }
      btn.textContent = "🔍 KI-Cross-Check";
      btn.disabled = false;
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
