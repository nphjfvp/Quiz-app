import { navigate } from "../router.js";
import { esc } from "../utils.js";
import { loadSettings } from "../store.js";
import { analyzeClozeKeywords, aiValidateAnswer } from "../ai-service.js";
import { getModelContextLimit } from "../ai-service.js";

const LENGTH_PRESETS = {
  "Sehr kurz": [200, 500],
  "Kurz": [500, 1200],
  "Mittel": [1200, 2500],
  "Lang": [2500, 5000],
  "Sehr lang": [5000, 50000],
};

export async function render(root) {
  const settings = await loadSettings();

  root.innerHTML = `
    <div class="screen-header">
      <button class="back-btn" id="back">← Zurück</button>
      <h2>✂️ Lückentext-Generator</h2>
      <p class="subtitle">Text eingeben → KI analysiert → Lückentext üben</p>
    </div>

    <div class="card mt-section">
      <label class="card-title">Quelltext eingeben oder einfügen:</label>
      <textarea id="source-text" class="textarea" rows="6" placeholder="Lernstoff hier einfügen…"></textarea>
      <div class="char-counter" id="char-count">0 Zeichen</div>
    </div>

    <div class="card mt-sm">
      <label class="card-title">Textlänge der Zusammenfassung:</label>
      <div class="preset-row" id="presets">
        ${Object.keys(LENGTH_PRESETS).map(name =>
          `<button class="btn btn-sm${name === "Mittel" ? " btn-primary" : ""}" data-preset="${name}">${name}</button>`
        ).join("")}
      </div>
      <div class="mt-sm">
        <label><input type="checkbox" id="adv-toggle"> Erweitert (eigene Länge)</label>
      </div>
      <div id="adv-fields" class="mt-sm" style="display:none">
        <span>Min: </span><input type="number" id="min-chars" value="1200" class="input-sm" style="width:80px">
        <span style="margin-left:12px">Max: </span><input type="number" id="max-chars" value="2500" class="input-sm" style="width:80px">
        <span style="margin-left:4px;opacity:0.7">Zeichen</span>
      </div>
    </div>

    <div class="btn-row mt-section">
      <button class="btn btn-primary" id="analyze-btn">🔍 Analysieren</button>
    </div>
    <div id="progress-msg" class="subtitle"></div>
    <div id="result-area"></div>
  `;

  let selectedPreset = "Mittel";

  root.querySelector("#back").addEventListener("click", () => navigate("home"));

  const sourceBox = root.querySelector("#source-text");
  const charCount = root.querySelector("#char-count");
  sourceBox.addEventListener("input", () => {
    charCount.textContent = `${sourceBox.value.length} Zeichen`;
  });

  root.querySelectorAll("[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("[data-preset]").forEach(b => b.classList.remove("btn-primary"));
      btn.classList.add("btn-primary");
      selectedPreset = btn.dataset.preset;
      const [mn, mx] = LENGTH_PRESETS[selectedPreset];
      root.querySelector("#min-chars").value = mn;
      root.querySelector("#max-chars").value = mx;
    });
  });

  root.querySelector("#adv-toggle").addEventListener("change", (e) => {
    root.querySelector("#adv-fields").style.display = e.target.checked ? "" : "none";
  });

  root.querySelector("#analyze-btn").addEventListener("click", () => runAnalysis());

  async function getLengthParams() {
    if (root.querySelector("#adv-toggle").checked) {
      const mn = Math.max(100, parseInt(root.querySelector("#min-chars").value) || 1200);
      const mx = Math.max(mn + 200, parseInt(root.querySelector("#max-chars").value) || 2500);
      return [mn, mx];
    }
    return LENGTH_PRESETS[selectedPreset] || [1200, 2500];
  }

  async function runAnalysis() {
    const text = sourceBox.value.trim();
    if (!text) { alert("Bitte Text eingeben!"); return; }

    const progressMsg = root.querySelector("#progress-msg");
    const analyzeBtn = root.querySelector("#analyze-btn");
    progressMsg.textContent = "⏳ KI analysiert Text…";
    analyzeBtn.disabled = true;

    try {
      const [minC, maxC] = await getLengthParams();
      const result = await analyzeClozeKeywords(text, minC, maxC, { model: settings.aiModel });
      showPhase2(result);
    } catch (err) {
      progressMsg.textContent = `❌ Fehler: ${err.message}`;
    } finally {
      analyzeBtn.disabled = false;
    }
  }

  function showPhase2(result) {
    const progressMsg = root.querySelector("#progress-msg");
    progressMsg.textContent = "";
    const area = root.querySelector("#result-area");

    const summary = result.summary || "";
    const keywords = result.keywords || [];
    keywords.sort((a, b) => a.index - b.index);

    const nKw = keywords.length;

    let hideCount = Math.max(1, Math.floor(nKw / 2));

    area.innerHTML = `
      <div class="card mt-section">
        <div class="card-title" style="color:var(--primary)">${nKw} relevante Wörter gefunden</div>
        <div class="mt-sm">
          <label>Wörter verstecken: <strong id="hide-val">${hideCount}</strong></label>
          <input type="range" id="hide-slider" min="0" max="${nKw}" value="${hideCount}" style="width:100%;max-width:400px">
        </div>
        <div class="mt-sm">
          <label><input type="radio" name="cloze-mode" value="freetext" checked> Freitext (schwer)</label>
          <label style="margin-left:16px"><input type="radio" name="cloze-mode" value="dragdrop"> Drag & Drop (einfach)</label>
        </div>
        <div class="btn-row mt-sm">
          <button class="btn btn-primary" id="start-exercise">▶ Lückentext starten</button>
        </div>
      </div>
    `;

    const slider = area.querySelector("#hide-slider");
    const hideVal = area.querySelector("#hide-val");
    slider.addEventListener("input", () => {
      hideCount = parseInt(slider.value);
      hideVal.textContent = hideCount;
    });

    area.querySelector("#start-exercise").addEventListener("click", () => {
      const mode = area.querySelector('input[name="cloze-mode"]:checked').value;
      const hidden = keywords.slice(0, hideCount);
      if (mode === "freetext") {
        renderFreetext(area, summary, hidden);
      } else {
        renderDragDrop(area, summary, hidden);
      }
    });
  }

  function renderFreetext(area, summary, hiddenKeywords) {
    const forwardKws = [...hiddenKeywords].sort((a, b) => a.index - b.index);

    let displayText = summary;
    const sorted = [...forwardKws].sort((a, b) => b.index - a.index);
    sorted.forEach((kw, i) => {
      const blankNum = sorted.length - i;
      displayText = displayText.slice(0, kw.index) + `[ ${blankNum} ]` + displayText.slice(kw.index + kw.word.length);
    });

    area.innerHTML = `
      <div class="card mt-section">
        <div class="cloze-text">${esc(displayText)}</div>
        <div class="mt-section">
          <strong>Lücken ausfüllen:</strong>
          <div class="cloze-inputs" id="cloze-inputs"></div>
        </div>
      </div>
      <div class="btn-row mt-sm" id="cloze-actions"></div>
    `;

    const inputsDiv = area.querySelector("#cloze-inputs");
    const entries = [];
    forwardKws.forEach((kw, i) => {
      const row = document.createElement("div");
      row.className = "cloze-input-row";
      row.innerHTML = `<span class="cloze-label">[${i + 1}]</span><input type="text" class="input-sm cloze-entry" placeholder="Lücke ${i + 1}" data-idx="${i}">`;
      inputsDiv.appendChild(row);
      entries.push(row.querySelector("input"));
    });

    const actionsDiv = area.querySelector("#cloze-actions");

    const checkBtn = document.createElement("button");
    checkBtn.className = "btn btn-primary";
    checkBtn.textContent = "✓ Exakt prüfen";
    checkBtn.addEventListener("click", () => checkFreetext(entries, forwardKws, false));
    actionsDiv.appendChild(checkBtn);

    if (settings.apiKey) {
      const aiBtn = document.createElement("button");
      aiBtn.className = "btn btn-accent";
      aiBtn.textContent = "🤖 KI-Prüfung";
      aiBtn.addEventListener("click", () => checkFreetext(entries, forwardKws, true));
      actionsDiv.appendChild(aiBtn);
    }

    const newBtn = document.createElement("button");
    newBtn.className = "btn btn-outline";
    newBtn.textContent = "🔄 Neue Version";
    newBtn.addEventListener("click", () => runAnalysis());
    actionsDiv.appendChild(newBtn);
  }

  async function checkFreetext(entries, forwardKws, useAI) {
    let correct = 0;
    for (let i = 0; i < entries.length; i++) {
      const userVal = entries[i].value.trim();
      const answer = forwardKws[i].word;
      let ok;
      if (useAI && settings.apiKey) {
        try {
          ok = await aiValidateAnswer(`Lücke ${i + 1}`, answer, userVal, { model: settings.aiModel });
        } catch {
          ok = userVal.toLowerCase() === answer.toLowerCase();
        }
      } else {
        ok = userVal.toLowerCase() === answer.toLowerCase();
      }
      entries[i].style.borderColor = ok ? "var(--success)" : "var(--danger)";
      if (ok) correct++;
    }
    alert(`${correct}/${entries.length} richtig!`);
  }

  function renderDragDrop(area, summary, hiddenKeywords) {
    const forwardKws = [...hiddenKeywords].sort((a, b) => a.index - b.index);

    let displayText = summary;
    const sorted = [...forwardKws].sort((a, b) => b.index - a.index);
    sorted.forEach((kw, i) => {
      const blankNum = sorted.length - i;
      displayText = displayText.slice(0, kw.index) + `___BLANK_${blankNum}___` + displayText.slice(kw.index + kw.word.length);
    });

    const shuffled = [...forwardKws].map(kw => kw.word);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const assignments = new Array(forwardKws.length).fill(null);

    let textHtml = esc(displayText);
    for (let i = 1; i <= forwardKws.length; i++) {
      textHtml = textHtml.replace(
        `___BLANK_${i}___`,
        `<span class="cloze-drop-zone" data-blank="${i - 1}" id="drop-${i - 1}">[ ${i} ]</span>`
      );
    }

    area.innerHTML = `
      <div class="card mt-section">
        <div class="cloze-text">${textHtml}</div>
        <hr style="opacity:0.3;margin:16px 0">
        <div class="cloze-chip-pool" id="chip-pool">
          ${shuffled.map((w, i) => `<span class="cloze-chip" draggable="true" data-word="${esc(w)}" id="chip-${i}">${esc(w)}</span>`).join("")}
        </div>
      </div>
      <div class="btn-row mt-sm" id="cloze-actions"></div>
    `;

    let draggedChip = null;

    area.querySelectorAll(".cloze-chip").forEach(chip => {
      chip.addEventListener("dragstart", (e) => {
        draggedChip = chip;
        e.dataTransfer.effectAllowed = "move";
        chip.classList.add("dragging");
      });
      chip.addEventListener("dragend", () => {
        chip.classList.remove("dragging");
        draggedChip = null;
      });
    });

    area.querySelectorAll(".cloze-drop-zone").forEach(zone => {
      zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("drag-over");
        if (!draggedChip) return;
        const blankIdx = parseInt(zone.dataset.blank);
        const word = draggedChip.dataset.word;

        // Remove from previous zone if any
        const prevIdx = assignments.indexOf(word);
        if (prevIdx !== -1) {
          assignments[prevIdx] = null;
          const prevZone = area.querySelector(`#drop-${prevIdx}`);
          if (prevZone) { prevZone.textContent = `[ ${prevIdx + 1} ]`; prevZone.classList.remove("filled"); }
        }

        // Remove previous chip from this zone
        if (assignments[blankIdx]) {
          const oldWord = assignments[blankIdx];
          const oldChip = area.querySelector(`.cloze-chip[data-word="${CSS.escape(oldWord)}"]`);
          if (oldChip) oldChip.style.display = "";
        }

        assignments[blankIdx] = word;
        zone.textContent = word;
        zone.classList.add("filled");
        draggedChip.style.display = "none";
      });
    });

    // Also support click-to-place on mobile
    let selectedChip = null;
    area.querySelectorAll(".cloze-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        if (selectedChip === chip) {
          chip.classList.remove("selected");
          selectedChip = null;
        } else {
          area.querySelectorAll(".cloze-chip").forEach(c => c.classList.remove("selected"));
          chip.classList.add("selected");
          selectedChip = chip;
        }
      });
    });

    area.querySelectorAll(".cloze-drop-zone").forEach(zone => {
      zone.addEventListener("click", () => {
        if (!selectedChip) return;
        const blankIdx = parseInt(zone.dataset.blank);
        const word = selectedChip.dataset.word;

        const prevIdx = assignments.indexOf(word);
        if (prevIdx !== -1) {
          assignments[prevIdx] = null;
          const prevZone = area.querySelector(`#drop-${prevIdx}`);
          if (prevZone) { prevZone.textContent = `[ ${prevIdx + 1} ]`; prevZone.classList.remove("filled"); }
        }

        if (assignments[blankIdx]) {
          const oldWord = assignments[blankIdx];
          const oldChip = area.querySelector(`.cloze-chip[data-word="${CSS.escape(oldWord)}"]`);
          if (oldChip) oldChip.style.display = "";
        }

        assignments[blankIdx] = word;
        zone.textContent = word;
        zone.classList.add("filled");
        selectedChip.style.display = "none";
        selectedChip.classList.remove("selected");
        selectedChip = null;
      });
    });

    const actionsDiv = area.querySelector("#cloze-actions");

    const checkBtn = document.createElement("button");
    checkBtn.className = "btn btn-primary";
    checkBtn.textContent = "✓ Prüfen";
    checkBtn.addEventListener("click", () => {
      let correct = 0;
      forwardKws.forEach((kw, i) => {
        const zone = area.querySelector(`#drop-${i}`);
        const ok = assignments[i] && assignments[i].toLowerCase() === kw.word.toLowerCase();
        zone.style.borderColor = ok ? "var(--success)" : "var(--danger)";
        zone.style.borderWidth = "2px";
        if (ok) correct++;
      });
      alert(`${correct}/${forwardKws.length} richtig!`);
    });
    actionsDiv.appendChild(checkBtn);

    const newBtn = document.createElement("button");
    newBtn.className = "btn btn-outline";
    newBtn.textContent = "🔄 Neue Version";
    newBtn.addEventListener("click", () => runAnalysis());
    actionsDiv.appendChild(newBtn);
  }
}
