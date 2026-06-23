import { loadQuizzes, saveQuizzes } from "../store.js";
import { navigate } from "../router.js";
import { esc } from "../utils.js";
import { openBlackoutEditor } from "../blackout.js";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptyQuestion(type = "single_choice") {
  const q = { id: uid(), question_text: "", question_type: type, points: 1 };
  if (type === "single_choice" || type === "multiple_choice") {
    q.options = [
      { text: "", is_correct: true },
      { text: "", is_correct: false },
    ];
  } else if (type === "free_text") {
    q.correct_text = "";
  } else if (type === "fill_blank") {
    q.question_text = "Der ___ ist blau.";
    q.blanks = ["Himmel"];
  } else if (type === "drag_drop") {
    q.drag_drop_pairs = [{ source: "", target: "" }];
  } else if (type === "diagram_label") {
    q.diagram_image = "";
    q.diagram_labels = [{ label: "", x: 0.5, y: 0.5 }];
  } else if (type === "mark_image") {
    q.image = "";
    q.mark_regions = [{ type: "circle", x: 0.5, y: 0.5, radius: 0.1 }];
  } else if (type === "math_formula") {
    q.correct_formula = "";
    q.tolerance = 0.001;
    q.formula_sheet = "";
  }
  return q;
}

let quiz = null;
let editingIndex = -1;

export async function render(root, params = {}) {
  const quizzes = await loadQuizzes();

  if (params.quizId) {
    quiz = quizzes.find((q) => q.id === params.quizId);
    if (!quiz) { navigate("home"); return; }
    quiz = JSON.parse(JSON.stringify(quiz));
  } else {
    quiz = { id: uid(), name: "", questions: [], created: new Date().toISOString() };
  }
  editingIndex = -1;

  renderMain(root, quizzes);
}

function renderMain(root, quizzes) {
  let html = `<div class="editor-header">
    <button class="btn-icon" id="editor-back">←</button>
    <h2>${quiz.questions.length > 0 || quiz.name ? "Quiz bearbeiten" : "Neues Quiz"}</h2>
    <button class="btn-primary btn-sm" id="editor-save">Speichern</button>
  </div>`;

  html += `<div class="editor-form">
    <label>Quiz-Name</label>
    <input type="text" id="quiz-name" class="input" value="${esc(quiz.name)}" placeholder="z.B. Biologie Kapitel 3">
  </div>`;

  html += `<div class="section-title">Fragen (${quiz.questions.length})</div>`;

  if (quiz.questions.length === 0) {
    html += `<div class="empty">Noch keine Fragen. Tippe auf + um eine hinzuzufügen.</div>`;
  } else {
    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const typeLabel = { single_choice: "SC", multiple_choice: "MC", free_text: "Freitext", fill_blank: "Lücke", drag_drop: "D&D", diagram_label: "Diagramm", mark_image: "Markieren", math_formula: "Mathe" }[q.question_type] || q.question_type;
      html += `<div class="question-row" data-qi="${i}">
        <div class="q-num">${i + 1}</div>
        <div class="q-info">
          <div class="q-text">${esc(q.question_text || "Neue Frage...")}</div>
          <small class="q-type">${typeLabel} · ${q.points} Pkt</small>
        </div>
        <div class="q-actions">
          <button class="btn-icon q-edit" data-qi="${i}">✏️</button>
          <button class="btn-icon q-del" data-qi="${i}">🗑️</button>
        </div>
      </div>`;
    }
  }

  html += `<div class="add-question-bar">
    <button class="btn-primary" id="add-q">+ Frage hinzufügen</button>
  </div>`;

  root.innerHTML = html;

  root.querySelector("#editor-back").addEventListener("click", () => navigate("home"));
  root.querySelector("#editor-save").addEventListener("click", () => saveQuiz(quizzes));
  root.querySelector("#quiz-name").addEventListener("input", (e) => { quiz.name = e.target.value; });
  root.querySelector("#add-q")?.addEventListener("click", () => showTypeChooser(root, quizzes));

  root.querySelectorAll(".q-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      editingIndex = parseInt(btn.dataset.qi);
      renderQuestionEditor(root, quizzes);
    });
  });
  root.querySelectorAll(".q-del").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.qi);
      if (confirm(`Frage ${i + 1} löschen?`)) {
        quiz.questions.splice(i, 1);
        renderMain(root, quizzes);
      }
    });
  });
  root.querySelectorAll(".question-row").forEach((row) => {
    row.addEventListener("click", () => {
      editingIndex = parseInt(row.dataset.qi);
      renderQuestionEditor(root, quizzes);
    });
  });
}

function showTypeChooser(root, quizzes) {
  const types = [
    { type: "single_choice", label: "Single Choice", icon: "🔘", desc: "Eine richtige Antwort" },
    { type: "multiple_choice", label: "Multiple Choice", icon: "☑️", desc: "Mehrere richtige Antworten" },
    { type: "free_text", label: "Freitext", icon: "✍️", desc: "Antwort eintippen" },
    { type: "fill_blank", label: "Lückentext", icon: "📝", desc: "Lücken ausfüllen (___)" },
    { type: "drag_drop", label: "Drag & Drop", icon: "🔀", desc: "Begriffe zuordnen" },
    { type: "diagram_label", label: "Diagramm", icon: "🏷️", desc: "Bild beschriften" },
    { type: "mark_image", label: "Bild markieren", icon: "📍", desc: "Stelle im Bild markieren" },
    { type: "math_formula", label: "Mathe-Formel", icon: "🔢", desc: "Formel / Berechnung" },
  ];

  let html = `<div class="editor-header">
    <button class="btn-icon" id="type-back">←</button>
    <h2>Fragetyp wählen</h2>
    <div></div>
  </div>`;

  for (const t of types) {
    html += `<div class="type-card" data-type="${t.type}">
      <span class="type-icon">${t.icon}</span>
      <div class="type-info">
        <strong>${t.label}</strong>
        <small>${t.desc}</small>
      </div>
      <span class="type-chev">›</span>
    </div>`;
  }

  root.innerHTML = html;

  root.querySelector("#type-back").addEventListener("click", () => renderMain(root, quizzes));
  root.querySelectorAll(".type-card").forEach((card) => {
    card.addEventListener("click", () => {
      const q = emptyQuestion(card.dataset.type);
      quiz.questions.push(q);
      editingIndex = quiz.questions.length - 1;
      renderQuestionEditor(root, quizzes);
    });
  });
}

function renderQuestionEditor(root, quizzes) {
  const q = quiz.questions[editingIndex];
  if (!q) { renderMain(root, quizzes); return; }

  const typeLabel = { single_choice: "Single Choice", multiple_choice: "Multiple Choice", free_text: "Freitext", fill_blank: "Lückentext", drag_drop: "Drag & Drop", diagram_label: "Diagramm", mark_image: "Bild markieren", math_formula: "Mathe-Formel" }[q.question_type] || q.question_type;

  let html = `<div class="editor-header">
    <button class="btn-icon" id="qe-back">←</button>
    <h2>Frage ${editingIndex + 1}</h2>
    <span class="q-type-badge">${typeLabel}</span>
  </div>`;

  html += `<div class="editor-form">
    <label>Fragetext</label>
    <textarea id="qe-text" class="input textarea" rows="3" placeholder="${q.question_type === "fill_blank" ? "Nutze ___ für Lücken" : "Fragetext eingeben..."}">${esc(q.question_text)}</textarea>
  </div>`;

  html += `<div class="editor-form">
    <label>Punkte</label>
    <input type="number" id="qe-points" class="input input-sm" value="${q.points}" min="1" max="100">
  </div>`;

  if (q.question_type === "single_choice" || q.question_type === "multiple_choice") {
    html += `<div class="section-title" class="mt-section">Antwortmöglichkeiten</div>`;
    html += `<div id="options-list">`;
    for (let i = 0; i < q.options.length; i++) {
      const o = q.options[i];
      const inputType = q.question_type === "single_choice" ? "radio" : "checkbox";
      html += `<div class="option-edit-row">
        <input type="${inputType}" name="correct" class="opt-correct" data-oi="${i}" ${o.is_correct ? "checked" : ""}>
        <input type="text" class="input opt-text" data-oi="${i}" value="${esc(o.text)}" placeholder="Antwort ${i + 1}">
        <button class="btn-icon opt-del" data-oi="${i}" ${q.options.length <= 2 ? "disabled" : ""}>✕</button>
      </div>`;
    }
    html += `</div>`;
    html += `<button class="btn-secondary btn-sm" id="add-option" class="mt-sm">+ Antwort</button>`;
  } else if (q.question_type === "free_text") {
    html += `<div class="editor-form">
      <label>Richtige Antwort</label>
      <input type="text" id="qe-correct-text" class="input" value="${esc(q.correct_text || "")}" placeholder="Exakte richtige Antwort">
      <small class="hint">Groß-/Kleinschreibung wird ignoriert</small>
    </div>`;
  } else if (q.question_type === "fill_blank") {
    const blanks = q.blanks || [];
    html += `<div class="section-title" class="mt-section">Lücken-Antworten (in Reihenfolge)</div>`;
    html += `<div id="blanks-list">`;
    for (let i = 0; i < blanks.length; i++) {
      html += `<div class="option-edit-row">
        <span class="blank-num">${i + 1}.</span>
        <input type="text" class="input blank-text" data-bi="${i}" value="${esc(blanks[i])}" placeholder="Antwort für Lücke ${i + 1}">
        <button class="btn-icon blank-del" data-bi="${i}" ${blanks.length <= 1 ? "disabled" : ""}>✕</button>
      </div>`;
    }
    html += `</div>`;
    html += `<button class="btn-secondary btn-sm" id="add-blank" class="mt-sm">+ Lücke</button>`;
  } else if (q.question_type === "drag_drop") {
    html += `<div class="section-title" class="mt-section">Zuordnungspaare</div>`;
    html += `<div id="pairs-list">`;
    for (let i = 0; i < q.drag_drop_pairs.length; i++) {
      const p = q.drag_drop_pairs[i];
      html += `<div class="option-edit-row">
        <input type="text" class="input pair-src" data-pi="${i}" value="${esc(p.source)}" placeholder="Quelle ${i + 1}">
        <span class="pair-arrow">→</span>
        <input type="text" class="input pair-tgt" data-pi="${i}" value="${esc(p.target)}" placeholder="Ziel ${i + 1}">
        <button class="btn-icon pair-del" data-pi="${i}" ${q.drag_drop_pairs.length <= 1 ? "disabled" : ""}>✕</button>
      </div>`;
    }
    html += `</div>`;
    html += `<button class="btn-secondary btn-sm" id="add-pair" class="mt-sm">+ Paar</button>`;
  } else if (q.question_type === "diagram_label") {
    html += `<div class="editor-form">
      <label>Bild</label>
      <input type="text" id="qe-diagram-img" class="input" value="${esc(q.diagram_image || "")}" placeholder="https://... oder Datei hochladen">
      <input type="file" id="qe-diagram-file" accept="image/*" class="editor-file-input">
      ${q.diagram_image ? `<button class="btn btn-sm btn-ghost" id="qe-blackout-diagram">✏️ Bild schwärzen</button>` : ""}
    </div>`;
    html += `<div class="section-title" class="mt-section">Labels</div>`;
    html += `<div class="editor-canvas-hint">Füge Labels hinzu und platziere sie per Tippen auf dem Bild.</div>`;
    html += `<div id="labels-list">`;
    for (let i = 0; i < (q.diagram_labels || []).length; i++) {
      const l = q.diagram_labels[i];
      const placed = l.x !== undefined && l.y !== undefined && l._placed;
      html += `<div class="option-edit-row">
        <input type="text" class="input label-name" data-li="${i}" value="${esc(l.label)}" placeholder="Label ${i + 1}">
        <span class="label-status ${placed ? "placed" : "open"}">${placed ? "✓ platziert" : "⚠ offen"}</span>
        <button class="btn-icon label-del" data-li="${i}" ${q.diagram_labels.length <= 1 ? "disabled" : ""}>✕</button>
      </div>`;
    }
    html += `</div>`;
    html += `<button class="btn-secondary btn-sm" id="add-label" class="mt-sm">+ Label</button>`;
    html += `<div class="section-title" class="mt-section">Platzierung</div>`;
    html += `<div class="editor-canvas-hint">Wähle ein Label unten, dann tippe auf die Stelle im Bild.</div>`;
    html += `<div id="placement-chips" class="dnd-chips"></div>`;
    html += `<div id="placement-canvas-wrap" class="media-canvas-wrap">
      <canvas id="placement-canvas" class="media-canvas"></canvas>
    </div>`;
  } else if (q.question_type === "mark_image") {
    html += `<div class="editor-form">
      <label>Bild-URL (oder Base64)</label>
      <input type="text" id="qe-mark-img" class="input" value="${esc(q.image || "")}" placeholder="https://...">
      <input type="file" id="qe-mark-file" accept="image/*" class="editor-file-input">
      ${q.image ? `<button class="btn btn-sm btn-ghost" id="qe-blackout-mark">✏️ Bild schwärzen</button>` : ""}
    </div>`;
    html += `<div class="section-title" class="mt-section">Markierungs-Regionen</div>`;
    html += `<div id="regions-list">`;
    for (let i = 0; i < (q.mark_regions || []).length; i++) {
      const r = q.mark_regions[i];
      html += `<div class="option-edit-row region-row">
        <select class="input region-type" data-ri="${i}">
          <option value="circle" ${r.type === "circle" ? "selected" : ""}>Kreis</option>
          <option value="polygon" ${r.type === "polygon" ? "selected" : ""}>Polygon</option>
        </select>
        ${r.type === "circle" ? `
          <input type="number" class="input region-val region-x" data-ri="${i}" value="${r.x}" placeholder="X" step="0.01" min="0" max="1">
          <input type="number" class="input region-val region-y" data-ri="${i}" value="${r.y}" placeholder="Y" step="0.01" min="0" max="1">
          <input type="number" class="input region-val region-r" data-ri="${i}" value="${r.radius}" placeholder="Radius" step="0.01" min="0" max="1">
        ` : `<input type="text" class="input region-pts" data-ri="${i}" value="${(r.points || []).map(p => p.join(",")).join("; ")}" placeholder="x1,y1; x2,y2; ...">`}
        <button class="btn-icon region-del" data-ri="${i}" ${q.mark_regions.length <= 1 ? "disabled" : ""}>✕</button>
      </div>`;
    }
    html += `</div>`;
    html += `<button class="btn-secondary btn-sm" id="add-region" class="mt-sm">+ Region</button>`;
  } else if (q.question_type === "math_formula") {
    html += `<div class="editor-form">
      <label>Richtige Formel / Ergebnis</label>
      <input type="text" id="qe-formula" class="input" value="${esc(q.correct_formula || "")}" placeholder="z.B. x = 42 oder $\\frac{1}{2}$">
    </div>`;
    html += `<div class="editor-form">
      <label>Toleranz (numerisch)</label>
      <input type="number" id="qe-tolerance" class="input input-sm" value="${q.tolerance || 0.001}" step="0.001" min="0">
      <small class="hint">Relative Abweichung für numerische Vergleiche</small>
    </div>`;
    html += `<div class="editor-form">
      <label>Formelsammlung (optional)</label>
      <textarea id="qe-formulas" class="input textarea" rows="3" placeholder="Formeln die als Hilfe angezeigt werden...">${esc(q.formula_sheet || "")}</textarea>
    </div>`;
  }

  html += `<div class="editor-bottom-bar">
    <button class="btn-primary" id="qe-done">✓ Fertig</button>
  </div>`;

  root.innerHTML = html;

  // Events
  root.querySelector("#qe-back").addEventListener("click", () => renderMain(root, quizzes));
  root.querySelector("#qe-done").addEventListener("click", () => {
    if (q.question_type === "diagram_label" && q.diagram_labels?.some(l => !l._placed)) {
      if (!confirm("Einige Labels sind noch nicht platziert. Trotzdem fortfahren?")) return;
    }
    renderMain(root, quizzes);
  });

  root.querySelector("#qe-text").addEventListener("input", (e) => { q.question_text = e.target.value; });
  root.querySelector("#qe-points").addEventListener("input", (e) => { q.points = Math.max(1, parseInt(e.target.value) || 1); });

  if (q.question_type === "single_choice" || q.question_type === "multiple_choice") {
    bindOptionEvents(root, q, quizzes);
    root.querySelector("#add-option")?.addEventListener("click", () => {
      q.options.push({ text: "", is_correct: false });
      renderQuestionEditor(root, quizzes);
    });
  } else if (q.question_type === "free_text") {
    root.querySelector("#qe-correct-text")?.addEventListener("input", (e) => { q.correct_text = e.target.value; });
  } else if (q.question_type === "fill_blank") {
    bindBlankEvents(root, q, quizzes);
    root.querySelector("#add-blank")?.addEventListener("click", () => {
      q.blanks.push("");
      renderQuestionEditor(root, quizzes);
    });
  } else if (q.question_type === "drag_drop") {
    root.querySelectorAll(".pair-src").forEach(input => {
      input.addEventListener("input", e => { q.drag_drop_pairs[parseInt(e.target.dataset.pi)].source = e.target.value; });
    });
    root.querySelectorAll(".pair-tgt").forEach(input => {
      input.addEventListener("input", e => { q.drag_drop_pairs[parseInt(e.target.dataset.pi)].target = e.target.value; });
    });
    root.querySelectorAll(".pair-del").forEach(btn => {
      btn.addEventListener("click", () => { q.drag_drop_pairs.splice(parseInt(btn.dataset.pi), 1); renderQuestionEditor(root, quizzes); });
    });
    root.querySelector("#add-pair")?.addEventListener("click", () => { q.drag_drop_pairs.push({ source: "", target: "" }); renderQuestionEditor(root, quizzes); });
  } else if (q.question_type === "diagram_label") {
    root.querySelector("#qe-diagram-img")?.addEventListener("input", e => { q.diagram_image = e.target.value; });
    root.querySelector("#qe-diagram-file")?.addEventListener("change", e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { q.diagram_image = reader.result; root.querySelector("#qe-diagram-img").value = "(Bild hochgeladen)"; renderQuestionEditor(root, quizzes); };
      reader.readAsDataURL(file);
    });
    root.querySelector("#qe-blackout-diagram")?.addEventListener("click", () => {
      if (!q.diagram_image) return;
      openBlackoutEditor(q.diagram_image, (dataUrl) => { q.diagram_image = dataUrl; renderQuestionEditor(root, quizzes); });
    });
    root.querySelectorAll(".label-name").forEach(input => { input.addEventListener("input", e => { q.diagram_labels[parseInt(e.target.dataset.li)].label = e.target.value; refreshPlacementUI(); }); });
    root.querySelectorAll(".label-del").forEach(btn => { btn.addEventListener("click", () => { q.diagram_labels.splice(parseInt(btn.dataset.li), 1); renderQuestionEditor(root, quizzes); }); });
    root.querySelector("#add-label")?.addEventListener("click", () => { q.diagram_labels.push({ label: "", x: 0.5, y: 0.5, _placed: false }); renderQuestionEditor(root, quizzes); });
    initDiagramPlacement(root, q, quizzes);
    function refreshPlacementUI() { initDiagramPlacement(root, q, quizzes); }
  } else if (q.question_type === "mark_image") {
    root.querySelector("#qe-mark-img")?.addEventListener("input", e => { q.image = e.target.value; });
    root.querySelector("#qe-mark-file")?.addEventListener("change", e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { q.image = reader.result; root.querySelector("#qe-mark-img").value = "(Bild hochgeladen)"; renderQuestionEditor(root, quizzes); };
      reader.readAsDataURL(file);
    });
    root.querySelector("#qe-blackout-mark")?.addEventListener("click", () => {
      if (!q.image) return;
      openBlackoutEditor(q.image, (dataUrl) => { q.image = dataUrl; renderQuestionEditor(root, quizzes); });
    });
    root.querySelectorAll(".region-type").forEach(sel => {
      sel.addEventListener("change", e => {
        const i = parseInt(e.target.dataset.ri);
        q.mark_regions[i].type = e.target.value;
        if (e.target.value === "circle") { q.mark_regions[i].x = 0.5; q.mark_regions[i].y = 0.5; q.mark_regions[i].radius = 0.1; delete q.mark_regions[i].points; }
        else { q.mark_regions[i].points = [[0.3,0.3],[0.7,0.3],[0.7,0.7],[0.3,0.7]]; delete q.mark_regions[i].x; delete q.mark_regions[i].y; delete q.mark_regions[i].radius; }
        renderQuestionEditor(root, quizzes);
      });
    });
    root.querySelectorAll(".region-x").forEach(input => { input.addEventListener("input", e => { q.mark_regions[parseInt(e.target.dataset.ri)].x = parseFloat(e.target.value) || 0; }); });
    root.querySelectorAll(".region-y").forEach(input => { input.addEventListener("input", e => { q.mark_regions[parseInt(e.target.dataset.ri)].y = parseFloat(e.target.value) || 0; }); });
    root.querySelectorAll(".region-r").forEach(input => { input.addEventListener("input", e => { q.mark_regions[parseInt(e.target.dataset.ri)].radius = parseFloat(e.target.value) || 0.1; }); });
    root.querySelectorAll(".region-pts").forEach(input => {
      input.addEventListener("input", e => {
        const pts = e.target.value.split(";").map(s => s.trim().split(",").map(Number)).filter(p => p.length === 2 && !p.some(isNaN));
        q.mark_regions[parseInt(e.target.dataset.ri)].points = pts;
      });
    });
    root.querySelectorAll(".region-del").forEach(btn => { btn.addEventListener("click", () => { q.mark_regions.splice(parseInt(btn.dataset.ri), 1); renderQuestionEditor(root, quizzes); }); });
    root.querySelector("#add-region")?.addEventListener("click", () => { q.mark_regions.push({ type: "circle", x: 0.5, y: 0.5, radius: 0.1 }); renderQuestionEditor(root, quizzes); });
  } else if (q.question_type === "math_formula") {
    root.querySelector("#qe-formula")?.addEventListener("input", e => { q.correct_formula = e.target.value; });
    root.querySelector("#qe-tolerance")?.addEventListener("input", e => { q.tolerance = parseFloat(e.target.value) || 0.001; });
    root.querySelector("#qe-formulas")?.addEventListener("input", e => { q.formula_sheet = e.target.value; });
  }
}

function bindOptionEvents(root, q, quizzes) {
  root.querySelectorAll(".opt-text").forEach((input) => {
    input.addEventListener("input", (e) => {
      q.options[parseInt(e.target.dataset.oi)].text = e.target.value;
    });
  });
  root.querySelectorAll(".opt-correct").forEach((input) => {
    input.addEventListener("change", (e) => {
      const i = parseInt(e.target.dataset.oi);
      if (q.question_type === "single_choice") {
        q.options.forEach((o, idx) => { o.is_correct = idx === i; });
      } else {
        q.options[i].is_correct = e.target.checked;
      }
    });
  });
  root.querySelectorAll(".opt-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.oi);
      q.options.splice(i, 1);
      if (q.question_type === "single_choice" && !q.options.some((o) => o.is_correct)) {
        q.options[0].is_correct = true;
      }
      renderQuestionEditor(root, quizzes);
    });
  });
}

function bindBlankEvents(root, q, quizzes) {
  root.querySelectorAll(".blank-text").forEach((input) => {
    input.addEventListener("input", (e) => {
      q.blanks[parseInt(e.target.dataset.bi)] = e.target.value;
    });
  });
  root.querySelectorAll(".blank-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      q.blanks.splice(parseInt(btn.dataset.bi), 1);
      renderQuestionEditor(root, quizzes);
    });
  });
}

async function saveQuiz(quizzes) {
  if (!quiz.name.trim()) {
    alert("Bitte gib einen Quiz-Namen ein.");
    return;
  }
  if (quiz.questions.length === 0) {
    alert("Füge mindestens eine Frage hinzu.");
    return;
  }
  for (let i = 0; i < quiz.questions.length; i++) {
    const q = quiz.questions[i];
    if (!q.question_text.trim()) {
      alert(`Frage ${i + 1} hat keinen Fragetext.`);
      return;
    }
    if ((q.question_type === "single_choice" || q.question_type === "multiple_choice") &&
        q.options.some((o) => !o.text.trim())) {
      alert(`Frage ${i + 1}: Alle Antworten müssen Text haben.`);
      return;
    }
  }

  const idx = quizzes.findIndex((q) => q.id === quiz.id);
  if (idx >= 0) {
    quizzes[idx] = quiz;
  } else {
    quizzes.push(quiz);
  }
  await saveQuizzes(quizzes);
  navigate("my-quizzes");
}

const CHIP_COLORS = ["#ef4444","#f59e0b","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f97316"];

function initDiagramPlacement(root, q, quizzes) {
  const canvas = root.querySelector("#placement-canvas");
  const chipsEl = root.querySelector("#placement-chips");
  if (!canvas || !chipsEl) return;
  const ctx = canvas.getContext("2d");
  const labels = q.diagram_labels || [];
  let img = null;
  let dragGhost = null;
  let dragIdx = -1;

  function draw() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    if (img) {
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      ctx.fillStyle = "#e2e8f0"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#94a3b8"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Lade zuerst ein Bild hoch", w / 2, h / 2);
    }
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if (!l._placed || l.x === undefined) continue;
      const color = CHIP_COLORS[i % CHIP_COLORS.length];
      const px = l.x * w, py = l.y * h;
      ctx.beginPath(); ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.fillStyle = color + "dd"; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((l.label || "?").slice(0, 5), px, py);
    }
  }

  function createGhost(text, color, x, y) {
    dragGhost = document.createElement("div");
    dragGhost.textContent = text;
    dragGhost.style.cssText = `position:fixed;left:${x-30}px;top:${y-18}px;z-index:9999;pointer-events:none;
      background:${color}dd;color:#fff;font-size:0.8rem;font-weight:700;padding:6px 14px;border-radius:20px;
      box-shadow:0 4px 16px rgba(0,0,0,0.3);transform:scale(1.1)`;
    document.body.appendChild(dragGhost);
  }
  function moveGhost(x, y) { if (dragGhost) { dragGhost.style.left = (x-30)+"px"; dragGhost.style.top = (y-18)+"px"; } }
  function removeGhost() { if (dragGhost) { dragGhost.remove(); dragGhost = null; } }

  function dropAt(clientX, clientY) {
    if (dragIdx < 0) return;
    const rect = canvas.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) {
      labels[dragIdx].x = fx;
      labels[dragIdx].y = fy;
      labels[dragIdx]._placed = true;
      updateStatusBadges();
    }
    dragIdx = -1;
    removeGhost();
    draw(); renderChips();
  }

  function updateStatusBadges() {
    root.querySelectorAll(".label-status").forEach((el, i) => {
      if (labels[i]?._placed) { el.textContent = "✓ platziert"; el.className = "label-status placed"; }
      else { el.textContent = "⚠ offen"; el.className = "label-status open"; }
    });
  }

  function renderChips() {
    chipsEl.innerHTML = "";
    labels.forEach((l, i) => {
      const color = CHIP_COLORS[i % CHIP_COLORS.length];
      const name = l.label || `Label ${i + 1}`;
      const chip = document.createElement("div");
      chip.className = "dnd-chip" + (l._placed ? " placed" : "");
      chip.textContent = name + (l._placed ? " ✓" : "");
      chip.style.cssText = `background:${color}20;border:2px solid ${color};color:var(--text);
        ${l._placed ? "opacity:0.5;" : "cursor:grab;"}touch-action:none;user-select:none`;

      if (l._placed) {
        chip.style.cursor = "pointer";
        chip.addEventListener("click", () => { l._placed = false; l.x = 0.5; l.y = 0.5; draw(); renderChips(); updateStatusBadges(); });
      } else {
        // Touch drag
        chip.addEventListener("touchstart", e => {
          e.preventDefault(); dragIdx = i;
          createGhost(name, color, e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });
        chip.addEventListener("touchmove", e => { e.preventDefault(); moveGhost(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
        chip.addEventListener("touchend", e => { e.preventDefault(); dropAt(e.changedTouches[0].clientX, e.changedTouches[0].clientY); });

        // Mouse drag
        let mouseDown = false;
        chip.addEventListener("mousedown", e => { mouseDown = true; dragIdx = i; createGhost(name, color, e.clientX, e.clientY); e.preventDefault(); });
        document.addEventListener("mousemove", e => { if (mouseDown) moveGhost(e.clientX, e.clientY); });
        document.addEventListener("mouseup", e => { if (mouseDown) { mouseDown = false; dropAt(e.clientX, e.clientY); } });
      }
      chipsEl.appendChild(chip);
    });
  }

  const imgSrc = q.diagram_image;
  if (imgSrc && imgSrc !== "(Bild hochgeladen)") {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.style.height = (canvas.getBoundingClientRect().width * img.height / img.width) + "px";
      draw(); renderChips();
    };
    img.onerror = () => { canvas.style.height = "200px"; draw(); renderChips(); };
    img.src = imgSrc;
  } else {
    canvas.style.height = "200px";
    draw(); renderChips();
  }
}
