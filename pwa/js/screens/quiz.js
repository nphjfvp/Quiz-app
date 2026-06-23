import { QuizSession, updateProgress } from "../quiz-engine.js";
import { loadProgress, saveProgress, logAnswer, loadMarked, saveMarked, loadErrorDiary, saveErrorDiary } from "../store.js";
import { navigate } from "../router.js";

let session = null;

export async function render(root, params) {
  const { quiz, mode } = params;
  if (!quiz) { navigate("home"); return; }
  const questions = quiz.questions || [];
  if (!questions.length) { root.innerHTML = `<div class="empty">Keine Fragen in diesem Quiz.</div>`; return; }

  session = new QuizSession(questions, mode || "single");
  showQuestion(root, quiz);
}

function showQuestion(root, quiz) {
  if (session.finished) { navigate("results", { session, quiz }); return; }

  const q = session.current;
  const total = session.questions.length;
  const idx = session.currentIndex + 1;
  let feedbackShown = false;

  let html = `
    <div class="progress-row">
      <div class="progress-bar"><div class="progress-fill" style="width:${session.progress * 100}%"></div></div>
      <span class="progress-label">Frage ${idx}/${total}</span>
    </div>
    <div class="card">
      ${q.title ? `<div class="question-title">${esc(q.title)}</div>` : ""}
      <div class="question-text">${esc(q.question_text || q.text)}</div>
    </div>
    <div class="card" id="answer-area">`;

  if (q.question_type === "single_choice") {
    html += q.options.map((o, i) => `
      <div class="option-card" data-idx="${i}">
        <div class="option-radio"></div>
        <span class="option-text">${esc(o.text)}</span>
      </div>`).join("");
  } else if (q.question_type === "multiple_choice") {
    html += q.options.map((o, i) => `
      <div class="option-card" data-idx="${i}" data-mc="true">
        <div class="option-check"></div>
        <span class="option-text">${esc(o.text)}</span>
      </div>`).join("");
  } else if (q.question_type === "free_text") {
    html += `<div class="input-group">
      <label>Deine Antwort</label>
      <input type="text" id="free-input" placeholder="Antwort eingeben…">
    </div>`;
  } else if (q.question_type === "fill_blank") {
    html += (q.blanks || []).map((_, i) => `
      <div class="input-group">
        <label>Lücke ${i + 1}</label>
        <input type="text" class="blank-input" placeholder="…">
      </div>`).join("");
  } else if (q.question_type === "drag_drop") {
    html += `<div style="margin-bottom:8px;font-size:0.8rem;color:var(--text-light)">Ziehe die Begriffe auf die passenden Ziele (oder wähle per Dropdown).</div>`;
    html += `<div id="dnd-chips" class="dnd-chips"></div>`;
    html += `<div id="dnd-targets" class="dnd-targets"></div>`;
  } else if (q.question_type === "diagram_label") {
    html += `<div style="margin-bottom:8px;font-size:0.8rem;color:var(--text-light)">Ziehe die Labels auf die richtigen Stellen im Diagramm.</div>`;
    html += `<div id="diagram-container" style="position:relative;width:100%;touch-action:none">
      <canvas id="diagram-canvas" style="width:100%;border-radius:var(--radius-md);border:2px solid var(--border)"></canvas>
    </div>`;
    html += `<div id="diagram-chips" class="dnd-chips" style="margin-top:8px"></div>`;
  } else if (q.question_type === "mark_image") {
    html += `<div style="margin-bottom:8px;font-size:0.8rem;color:var(--text-light)">Tippe auf die richtige Stelle im Bild.</div>`;
    html += `<div id="mark-container" style="position:relative;width:100%;touch-action:none">
      <canvas id="mark-canvas" style="width:100%;border-radius:var(--radius-md);border:2px solid var(--border)"></canvas>
    </div>`;
  } else if (q.question_type === "math_formula") {
    html += `<div class="math-tabs" style="display:flex;gap:6px;margin-bottom:10px">
      <button class="btn btn-sm btn-primary" data-math-tab="text">Formel</button>
      <button class="btn btn-sm btn-ghost" data-math-tab="draw">Zeichnen</button>
      <button class="btn btn-sm btn-ghost" data-math-tab="photo">Foto</button>
    </div>`;
    html += `<div id="math-tab-text">
      <div class="input-group">
        <label>Formel / Ergebnis</label>
        <input type="text" id="math-input" placeholder="z.B. x = 2 oder $\\frac{a}{b}$">
      </div>
      ${q.formula_sheet ? `<details style="margin-top:6px"><summary style="font-size:0.8rem;color:var(--text-light);cursor:pointer">Formelsammlung</summary><pre style="font-size:0.75rem;margin-top:4px;white-space:pre-wrap;color:var(--text-light)">${esc(q.formula_sheet)}</pre></details>` : ""}
    </div>`;
    html += `<div id="math-tab-draw" style="display:none">
      <canvas id="math-canvas" width="560" height="200" style="width:100%;border:2px solid var(--border);border-radius:var(--radius-md);touch-action:none;background:var(--input-bg)"></canvas>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn-ghost btn-sm" id="math-clear">Löschen</button>
      </div>
    </div>`;
    html += `<div id="math-tab-photo" style="display:none">
      <input type="file" id="math-photo" accept="image/*" capture="environment" style="font-size:0.85rem">
      <div id="math-photo-preview" style="margin-top:8px"></div>
    </div>`;
  } else {
    html += `<div class="input-group">
      <label>Antwort</label>
      <input type="text" id="generic-input" placeholder="Antwort eingeben…">
    </div>`;
  }

  html += `</div>
    <div id="feedback-area"></div>
    <div class="btn-row" id="nav-btns">
      ${session.currentIndex > 0 ? `<button class="btn btn-ghost btn-sm" id="prev-btn">‹ Zurück</button>` : ""}
      <button class="btn btn-primary btn-lg" id="submit-btn" style="flex:1">
        ${session.mode === "single" ? "Antwort prüfen" : "Weiter"}
      </button>
    </div>`;

  root.innerHTML = html;

  // Drag & Drop setup
  const dndAssignments = {};
  if (q.question_type === "drag_drop") {
    setupDragDrop(root, q, dndAssignments);
  }

  // Diagram Label setup
  const diagramPlacements = {};
  if (q.question_type === "diagram_label") {
    setupDiagramLabel(root, q, diagramPlacements);
  }

  // Mark Image setup
  let markClick = null;
  if (q.question_type === "mark_image") {
    markClick = setupMarkImage(root, q);
  }

  // Math formula tabs + drawing
  let mathMode = "text";
  let mathDrawingData = null;
  let mathPhotoData = null;
  if (q.question_type === "math_formula") {
    setupMathTabs(root);
    mathDrawingData = setupMathCanvas(root);
  }

  // Single choice selection
  let selectedSC = -1;
  root.querySelectorAll(".option-card:not([data-mc])").forEach((el) => {
    el.addEventListener("click", () => {
      if (feedbackShown) return;
      selectedSC = parseInt(el.dataset.idx);
      root.querySelectorAll(".option-card:not([data-mc])").forEach((e) => e.classList.remove("selected"));
      el.classList.add("selected");
    });
  });

  // Multiple choice
  const mcSelected = new Set();
  root.querySelectorAll(".option-card[data-mc]").forEach((el) => {
    el.addEventListener("click", () => {
      if (feedbackShown) return;
      const idx = parseInt(el.dataset.idx);
      if (mcSelected.has(idx)) { mcSelected.delete(idx); el.classList.remove("selected"); }
      else { mcSelected.add(idx); el.classList.add("selected"); }
    });
  });

  // Submit
  root.querySelector("#submit-btn").addEventListener("click", async () => {
    if (feedbackShown) { session.next(); showQuestion(root, quiz); return; }

    let answer;
    if (q.question_type === "single_choice") answer = selectedSC;
    else if (q.question_type === "multiple_choice") answer = [...mcSelected];
    else if (q.question_type === "free_text") answer = root.querySelector("#free-input")?.value ?? "";
    else if (q.question_type === "fill_blank") answer = [...root.querySelectorAll(".blank-input")].map(e => e.value);
    else if (q.question_type === "drag_drop") {
      answer = { ...dndAssignments };
    } else if (q.question_type === "diagram_label") {
      answer = { ...diagramPlacements };
    } else if (q.question_type === "mark_image") {
      answer = markClick.value;
    } else if (q.question_type === "math_formula") {
      const textVal = root.querySelector("#math-input")?.value ?? "";
      answer = textVal || (mathDrawingData?.hasDrawn ? "[drawing]" : "") || (mathPhotoData ? "[photo]" : "") || "";
    }
    else answer = root.querySelector("#generic-input")?.value ?? "";

    const result = session.submit(answer);
    if (!result) return;

    // Update progress + stats
    let progress = await loadProgress();
    progress = updateProgress(progress, q.id, result.is_correct);
    await saveProgress(progress);
    await logAnswer(result.is_correct);

    if (session.mode === "single") {
      feedbackShown = true;
      const fb = root.querySelector("#feedback-area");
      const icon = result.is_correct ? "✓" : "✗";
      const label = result.is_correct ? "Richtig!" : "Falsch!";
      fb.innerHTML = `<div class="feedback ${result.is_correct ? "correct" : "wrong"}">
        <h3>${icon}  ${label}</h3>
        <p>Punkte: ${result.score}/${result.max_score}</p>
        ${!result.is_correct ? `<p style="margin-top:4px;font-weight:600">✓ ${esc(result.correct_answer)}</p>` : ""}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="btn btn-ghost btn-sm" id="mark-btn">⭐ Markieren</button>
        <button class="btn btn-ghost btn-sm" id="tutor-btn">💬 KI fragen</button>
      </div>`;

      root.querySelector("#mark-btn")?.addEventListener("click", async () => {
        const marked = await loadMarked();
        if (!marked.includes(q.id)) { marked.push(q.id); await saveMarked(marked); }
        root.querySelector("#mark-btn").textContent = "⭐ Markiert!";
        root.querySelector("#mark-btn").disabled = true;
      });
      root.querySelector("#tutor-btn")?.addEventListener("click", () => {
        navigate("tutor", { question: { text: q.question_text || q.text, correct: result.correct_answer } });
      });

      if (!result.is_correct) {
        const diary = await loadErrorDiary();
        diary.unshift({ id: Date.now().toString(36), date: new Date().toISOString(), questionText: q.question_text || q.text || "", userAnswer: result.user_answer, correctAnswer: result.correct_answer, topic: q.topic || "", quizName: quiz.name || "" });
        if (diary.length > 500) diary.length = 500;
        await saveErrorDiary(diary);
      }

      // Highlight correct/wrong options
      if (q.question_type === "single_choice") {
        const correctIdx = q.options.findIndex(o => o.is_correct);
        root.querySelectorAll(".option-card").forEach((el) => {
          const i = parseInt(el.dataset.idx);
          if (i === correctIdx) el.classList.add("correct");
          else if (i === selectedSC && !result.is_correct) el.classList.add("wrong");
        });
      }

      root.querySelector("#submit-btn").textContent = "Nächste Frage ›";
    } else {
      showQuestion(root, quiz);
    }
  });

  root.querySelector("#prev-btn")?.addEventListener("click", () => {
    session.prev();
    showQuestion(root, quiz);
  });
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const CHIP_COLORS = ["#ef4444","#f59e0b","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f97316"];

function setupDragDrop(root, q, assignments) {
  const sources = shuffle([...q.drag_drop_pairs.map(p => p.source)]);
  const targets = q.drag_drop_pairs.map(p => p.target);
  const chipsEl = root.querySelector("#dnd-chips");
  const targetsEl = root.querySelector("#dnd-targets");

  function renderDnd() {
    const usedSources = new Set(Object.values(assignments));
    chipsEl.innerHTML = sources.filter(s => !usedSources.has(s)).map((s, i) =>
      `<div class="dnd-chip" draggable="true" data-source="${esc(s)}" style="background:${CHIP_COLORS[i % CHIP_COLORS.length]}20;border:2px solid ${CHIP_COLORS[i % CHIP_COLORS.length]};color:var(--text)">${esc(s)}</div>`
    ).join("");
    targetsEl.innerHTML = targets.map(t => {
      const assigned = Object.entries(assignments).find(([k]) => k === t)?.[1];
      return `<div class="dnd-target ${assigned ? "filled" : ""}" data-target="${esc(t)}">
        <div class="dnd-target-label">${esc(t)}</div>
        <div class="dnd-target-slot">${assigned ? `<span class="dnd-assigned" data-target="${esc(t)}">${esc(assigned)} ✕</span>` : "Hierher ziehen"}</div>
      </div>`;
    }).join("");

    // Touch/click to assign (tap chip then tap target)
    let selectedChip = null;
    chipsEl.querySelectorAll(".dnd-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        chipsEl.querySelectorAll(".dnd-chip").forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
        selectedChip = chip.dataset.source;
      });
      chip.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/plain", chip.dataset.source);
      });
    });
    targetsEl.querySelectorAll(".dnd-target").forEach(tgt => {
      tgt.addEventListener("click", () => {
        if (selectedChip) {
          assignments[tgt.dataset.target] = selectedChip;
          selectedChip = null;
          renderDnd();
        }
      });
      tgt.addEventListener("dragover", e => e.preventDefault());
      tgt.addEventListener("drop", e => {
        e.preventDefault();
        const src = e.dataTransfer.getData("text/plain");
        if (src) { assignments[tgt.dataset.target] = src; renderDnd(); }
      });
    });
    targetsEl.querySelectorAll(".dnd-assigned").forEach(el => {
      el.addEventListener("click", e => {
        e.stopPropagation();
        delete assignments[el.dataset.target];
        renderDnd();
      });
    });
  }
  renderDnd();
}

function setupDiagramLabel(root, q, placements) {
  const canvas = root.querySelector("#diagram-canvas");
  const chipsEl = root.querySelector("#diagram-chips");
  const ctx = canvas.getContext("2d");
  const labels = q.diagram_labels || [];
  let img = null;
  let selectedLabel = null;

  function draw() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    if (img) ctx.drawImage(img, 0, 0, w, h);
    else { ctx.fillStyle = "var(--input-bg)"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#999"; ctx.font = "14px sans-serif"; ctx.textAlign = "center"; ctx.fillText("Kein Bild verfügbar", w/2, h/2); }

    for (const [label, pos] of Object.entries(placements)) {
      const idx = labels.findIndex(l => l.label === label);
      const color = CHIP_COLORS[idx % CHIP_COLORS.length];
      const px = pos.x * w, py = pos.y * h;
      ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2);
      ctx.fillStyle = color + "cc"; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label.slice(0, 3), px, py);
    }
  }

  function renderChips() {
    const placed = new Set(Object.keys(placements));
    chipsEl.innerHTML = labels.filter(l => !placed.has(l.label)).map((l, i) =>
      `<div class="dnd-chip ${selectedLabel === l.label ? "selected" : ""}" data-label="${esc(l.label)}" style="background:${CHIP_COLORS[i % CHIP_COLORS.length]}20;border:2px solid ${CHIP_COLORS[i % CHIP_COLORS.length]};color:var(--text)">${esc(l.label)}</div>`
    ).join("");
    chipsEl.innerHTML += Object.keys(placements).map(label =>
      `<div class="dnd-chip placed" data-remove="${esc(label)}" style="opacity:0.6;text-decoration:line-through">${esc(label)} ✕</div>`
    ).join("");
    chipsEl.querySelectorAll("[data-label]").forEach(chip => {
      chip.addEventListener("click", () => { selectedLabel = chip.dataset.label; renderChips(); });
    });
    chipsEl.querySelectorAll("[data-remove]").forEach(chip => {
      chip.addEventListener("click", () => { delete placements[chip.dataset.remove]; selectedLabel = null; renderChips(); draw(); });
    });
  }

  const imgSrc = q.diagram_image_path || q.diagram_image;
  if (imgSrc) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.style.height = (canvas.getBoundingClientRect().width * img.height / img.width) + "px";
      draw(); renderChips();
    };
    img.src = imgSrc;
  } else {
    canvas.style.height = "200px";
    draw(); renderChips();
  }

  canvas.addEventListener("click", e => {
    if (!selectedLabel) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    placements[selectedLabel] = { x, y };
    selectedLabel = null;
    draw(); renderChips();
  });
  canvas.addEventListener("touchend", e => {
    if (!selectedLabel || !e.changedTouches[0]) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t = e.changedTouches[0];
    const x = (t.clientX - rect.left) / rect.width;
    const y = (t.clientY - rect.top) / rect.height;
    placements[selectedLabel] = { x, y };
    selectedLabel = null;
    draw(); renderChips();
  });
}

function setupMarkImage(root, q) {
  const canvas = root.querySelector("#mark-canvas");
  const ctx = canvas.getContext("2d");
  const result = { value: null };
  let img = null;
  let marker = null;

  function draw() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    if (img) ctx.drawImage(img, 0, 0, w, h);
    if (marker) {
      const px = marker.x * w, py = marker.y * h;
      ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444"; ctx.fill();
    }
  }

  const imgSrc = q.image_path || q.image;
  if (imgSrc) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.style.height = (canvas.getBoundingClientRect().width * img.height / img.width) + "px";
      draw();
    };
    img.src = imgSrc;
  } else {
    canvas.style.height = "200px";
    draw();
  }

  function handleClick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    marker = { x, y };
    result.value = { x, y };
    draw();
  }
  canvas.addEventListener("click", e => handleClick(e.clientX, e.clientY));
  canvas.addEventListener("touchend", e => {
    if (!e.changedTouches[0]) return;
    e.preventDefault();
    handleClick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  });
  return result;
}

function setupMathTabs(root) {
  const tabs = root.querySelectorAll("[data-math-tab]");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => { t.classList.remove("btn-primary"); t.classList.add("btn-ghost"); });
      tab.classList.remove("btn-ghost"); tab.classList.add("btn-primary");
      ["text", "draw", "photo"].forEach(id => {
        const el = root.querySelector(`#math-tab-${id}`);
        if (el) el.style.display = tab.dataset.mathTab === id ? "" : "none";
      });
    });
  });
  const photoInput = root.querySelector("#math-photo");
  if (photoInput) {
    photoInput.addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const preview = root.querySelector("#math-photo-preview");
      const url = URL.createObjectURL(file);
      preview.innerHTML = `<img src="${url}" style="max-width:100%;border-radius:var(--radius-md);margin-top:8px">`;
    });
  }
}

function setupMathCanvas(root) {
  const canvas = root.querySelector("#math-canvas");
  if (!canvas) return { hasDrawn: false };
  const ctx = canvas.getContext("2d");
  const state = { hasDrawn: false, drawing: false };
  ctx.strokeStyle = "var(--text, #000)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
  }
  canvas.addEventListener("mousedown", e => { state.drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
  canvas.addEventListener("mousemove", e => { if (!state.drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); state.hasDrawn = true; });
  canvas.addEventListener("mouseup", () => { state.drawing = false; });
  canvas.addEventListener("touchstart", e => { e.preventDefault(); state.drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
  canvas.addEventListener("touchmove", e => { e.preventDefault(); if (!state.drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); state.hasDrawn = true; });
  canvas.addEventListener("touchend", () => { state.drawing = false; });

  root.querySelector("#math-clear")?.addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.hasDrawn = false;
  });
  return state;
}
