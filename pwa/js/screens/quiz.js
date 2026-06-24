import { QuizSession, updateProgress } from "../quiz-engine.js";
import { loadProgress, saveProgress, logAnswer, loadMarked, saveMarked, loadErrorDiary, saveErrorDiary, loadFsrs, saveFsrs } from "../store.js";
import { navigate } from "../router.js";
import { esc, mathEsc } from "../utils.js";
import { newCard, review as fsrsReview, ratingFromResult } from "../fsrs.js";
import { openBlackoutEditor } from "../blackout.js";

export async function render(root, params) {
  const { quiz, mode } = params;
  if (!quiz) { navigate("home"); return; }
  const questions = quiz.questions || [];
  if (!questions.length) { root.innerHTML = `<div class="empty">Keine Fragen in diesem Quiz.</div>`; return; }

  const session = new QuizSession(questions, mode || "single");
  showQuestion(root, quiz, session);
}

function showQuestion(root, quiz, session) {
  if (session.finished) { navigate("results", { session, quiz }); return; }

  const q = session.current;
  const total = session.questions.length;
  const idx = session.currentIndex + 1;
  let feedbackShown = false;
  const questionStart = Date.now();

  // Lückentext im Satzkontext, wenn der Fragetext ___-Marker enthält
  const clozeParts = q.question_type === "fill_blank" ? String(q.question_text || "").split("___") : null;
  const useCloze = clozeParts && clozeParts.length > 1;

  let html = `
    <div class="progress-row">
      <div class="progress-bar"><div class="progress-fill" style="width:${session.progress * 100}%"></div></div>
      <span class="progress-label">Frage ${idx}/${total}</span>
    </div>
    <div class="card">
      ${(q.topic || q.title) ? `<div class="question-title">${mathEsc(q.topic || q.title)}</div>` : ""}
      ${useCloze ? `<div class="question-hint">Fülle die Lücken im Satz aus.</div>` : `<div class="question-text">${mathEsc(q.question_text || q.text)}</div>`}
      ${q.question_type === "multiple_choice" ? `<div class="mc-badge">☑️ Mehrere Antworten richtig</div>` : ""}
      ${q.question_type === "single_choice" ? `<div class="mc-badge sc">🔘 Genau eine Antwort richtig</div>` : ""}
      ${(q.image || q.image_path) && !["diagram_label", "mark_image"].includes(q.question_type) ? `<div class="img-wrap" id="q-img-wrap"><img src="${q.image || q.image_path}" alt="Fragebild"><button class="blackout-trigger" id="q-blackout-btn">✏️ Schwärzen</button></div>` : ""}
    </div>
    <div class="card" id="answer-area">`;

  if (q.question_type === "single_choice") {
    html += q.options.map((o, i) => `
      <div class="option-card" data-idx="${i}" role="radio" aria-checked="false" tabindex="0">
        <span class="option-key">${String.fromCharCode(65 + i)}</span>
        <span class="option-text">${mathEsc(o.text)}</span>
      </div>`).join("");
  } else if (q.question_type === "multiple_choice") {
    html += q.options.map((o, i) => `
      <div class="option-card" data-idx="${i}" data-mc="true" role="checkbox" aria-checked="false" tabindex="0">
        <span class="option-key">${String.fromCharCode(65 + i)}</span>
        <span class="option-text">${mathEsc(o.text)}</span>
      </div>`).join("");
  } else if (q.question_type === "free_text") {
    html += `<div class="input-group">
      <label>Deine Antwort</label>
      <input type="text" id="free-input" class="input" placeholder="Antwort eingeben…">
    </div>`;
  } else if (q.question_type === "fill_blank") {
    if (useCloze) {
      let cloze = `<div class="cloze">`;
      clozeParts.forEach((part, i) => {
        cloze += esc(part);
        if (i < clozeParts.length - 1) {
          cloze += `<input type="text" class="blank-input cloze-blank" data-i="${i}" placeholder="…" autocomplete="off">`;
        }
      });
      cloze += `</div>`;
      html += cloze;
    } else {
      html += (q.blanks || []).map((_, i) => `
        <div class="input-group">
          <label>Lücke ${i + 1}</label>
          <input type="text" class="blank-input input" placeholder="…">
        </div>`).join("");
    }
  } else if (q.question_type === "drag_drop") {
    html += `<div class="question-hint">Ziehe die Begriffe auf die passenden Ziele (oder tippe Begriff &amp; dann Ziel).</div>`;
    html += `<div id="dnd-chips" class="dnd-chips"></div>`;
    html += `<div id="dnd-targets" class="dnd-targets"></div>`;
  } else if (q.question_type === "drag_category") {
    const cats = [...new Set((q.drag_drop_pairs ?? []).map(p => p.target))];
    html += `<div class="question-hint">Ordne jeden Begriff der richtigen Kategorie zu (tippe Begriff, dann Kategorie).</div>`;
    html += `<div id="dc-items" class="dnd-chips"></div>`;
    html += `<div id="dc-categories" class="dc-categories">${cats.map(c =>
      `<div class="dc-cat" data-cat="${esc(c)}">
        <div class="dc-cat-title">${esc(c)}</div>
        <div class="dc-cat-items" data-cat="${esc(c)}"></div>
      </div>`).join("")}</div>`;
  } else if (q.question_type === "diagram_label") {
    html += `<div class="question-hint">Ziehe die Labels auf die markierten Einrast-Zonen im Diagramm.</div>`;
    html += `<div id="diagram-container" class="media-canvas-wrap">
      <canvas id="diagram-canvas" class="media-canvas"></canvas>
    </div>`;
    html += `<div id="diagram-chips" class="dnd-chips" style="margin-top:12px"></div>`;
  } else if (q.question_type === "mark_image") {
    html += `<div class="question-hint">Tippe auf die richtige Stelle im Bild.</div>`;
    html += `<div id="mark-container" class="media-canvas-wrap">
      <canvas id="mark-canvas" class="media-canvas"></canvas>
    </div>`;
  } else if (q.question_type === "math_formula") {
    html += `<div class="seg-tabs" role="tablist">
      <button class="seg-tab active" data-math-tab="text">✏️ Formel</button>
      <button class="seg-tab" data-math-tab="draw">🖊️ Zeichnen</button>
      <button class="seg-tab" data-math-tab="photo">📷 Foto</button>
    </div>`;
    html += `<div id="math-tab-text">
      <div class="input-group">
        <label>Formel / Ergebnis</label>
        <input type="text" id="math-input" class="input" placeholder="z.B. x = 2 oder $\\frac{a}{b}$">
      </div>
      ${q.formula_sheet ? `<details class="formula-sheet"><summary>Formelsammlung</summary><div class="formula-sheet-body">${mathEsc(q.formula_sheet)}</div></details>` : ""}
    </div>`;
    html += `<div id="math-tab-draw" style="display:none">
      <canvas id="math-canvas" width="560" height="200" class="media-canvas" style="touch-action:none;background:var(--input-bg)"></canvas>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-ghost btn-sm" id="math-clear">Löschen</button>
      </div>
    </div>`;
    html += `<div id="math-tab-photo" style="display:none">
      <input type="file" id="math-photo" accept="image/*" capture="environment" class="input">
      <div id="math-photo-preview" style="margin-top:8px"></div>
    </div>`;
  } else {
    html += `<div class="input-group">
      <label>Antwort</label>
      <input type="text" id="generic-input" class="input" placeholder="Antwort eingeben…">
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

  // Blackout button on question image
  root.querySelector("#q-blackout-btn")?.addEventListener("click", () => {
    const imgSrc = q.image || q.image_path;
    if (!imgSrc) return;
    openBlackoutEditor(imgSrc, (dataUrl) => {
      q.image = dataUrl;
      const img = root.querySelector("#q-img-wrap img");
      if (img) img.src = dataUrl;
    });
  });

  // Drag & Drop setup
  const dndAssignments = {};
  if (q.question_type === "drag_drop") {
    setupDragDrop(root, q, dndAssignments);
  }

  // Drag Category setup
  const dcAssignments = {};
  if (q.question_type === "drag_category") {
    setupDragCategory(root, q, dcAssignments);
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

  // Enter/Leertaste löst Klick aus (Tastaturbedienung)
  function onActivateKey(el, handler) {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
    });
  }

  // Single choice selection
  let selectedSC = -1;
  root.querySelectorAll(".option-card:not([data-mc])").forEach((el) => {
    const select = () => {
      if (feedbackShown) return;
      selectedSC = parseInt(el.dataset.idx);
      root.querySelectorAll(".option-card:not([data-mc])").forEach((e) => {
        e.classList.remove("selected"); e.setAttribute("aria-checked", "false");
      });
      el.classList.add("selected"); el.setAttribute("aria-checked", "true");
    };
    el.addEventListener("click", select);
    onActivateKey(el, select);
  });

  // Multiple choice
  const mcSelected = new Set();
  root.querySelectorAll(".option-card[data-mc]").forEach((el) => {
    const toggle = () => {
      if (feedbackShown) return;
      const idx = parseInt(el.dataset.idx);
      if (mcSelected.has(idx)) { mcSelected.delete(idx); el.classList.remove("selected"); el.setAttribute("aria-checked", "false"); }
      else { mcSelected.add(idx); el.classList.add("selected"); el.setAttribute("aria-checked", "true"); }
    };
    el.addEventListener("click", toggle);
    onActivateKey(el, toggle);
  });

  // Submit
  root.querySelector("#submit-btn").addEventListener("click", async () => {
    if (feedbackShown) { session.next(); showQuestion(root, quiz, session); return; }

    let answer;
    if (q.question_type === "single_choice") answer = selectedSC;
    else if (q.question_type === "multiple_choice") answer = [...mcSelected];
    else if (q.question_type === "free_text") answer = root.querySelector("#free-input")?.value ?? "";
    else if (q.question_type === "fill_blank") answer = [...root.querySelectorAll(".blank-input")].map(e => e.value);
    else if (q.question_type === "drag_drop") {
      answer = { ...dndAssignments };
    } else if (q.question_type === "drag_category") {
      answer = { ...dcAssignments };
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

    // FSRS-Planung aktualisieren (Spaced Repetition)
    try {
      const fsrs = await loadFsrs();
      const card = fsrs[q.id] || newCard(q.id);
      const answerTimeMs = Date.now() - questionStart;
      const rating = ratingFromResult(result.is_correct, 3);
      fsrs[q.id] = fsrsReview(card, rating, answerTimeMs, 0.5);
      await saveFsrs(fsrs);
    } catch (_) { /* FSRS optional */ }

    if (session.mode === "single") {
      feedbackShown = true;
      const fb = root.querySelector("#feedback-area");
      const icon = result.is_correct ? "✓" : "✗";
      const label = result.is_correct ? "Richtig!" : "Falsch!";
      fb.innerHTML = `<div class="feedback ${result.is_correct ? "correct" : "wrong"}">
        <div class="feedback-icon">${icon}</div>
        <div class="feedback-body">
          <h3>${label}</h3>
          <p>Punkte: ${result.score}/${result.max_score}</p>
          ${!result.is_correct ? `<p class="feedback-correct-answer">✓ ${mathEsc(result.correct_answer)}</p>` : ""}
        </div>
      </div>
      <div class="feedback-actions">
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
        const qImage = q.diagram_image_path || q.diagram_image || q.image_path || q.image || null;
        navigate("tutor", { question: { text: q.question_text || q.text, correct: result.correct_answer, image: qImage } });
      });

      if (!result.is_correct) {
        const diary = await loadErrorDiary();
        diary.unshift({ id: Date.now().toString(36), date: new Date().toISOString(), questionText: q.question_text || q.text || "", userAnswer: result.user_answer, correctAnswer: result.correct_answer, topic: q.topic || "", quizName: quiz.name || "" });
        if (diary.length > 500) diary.length = 500;
        await saveErrorDiary(diary);
      }

      // KI-Bewertung für Freitext: vergleicht Musterlösung + Antwort semantisch.
      // Wenn inhaltlich richtig (nur anders formuliert) → als richtig werten lassen.
      if (!result.is_correct && q.question_type === "free_text" && (result.user_answer || "").trim()) {
        const kiBox = document.createElement("div");
        kiBox.className = "ki-validate";
        kiBox.innerHTML = `<div class="ki-validate-status">🤖 KI prüft, ob deine Antwort inhaltlich richtig ist…</div>`;
        fb.appendChild(kiBox);
        (async () => {
          try {
            const { checkFreeTextAI } = await import("../ai-service.js");
            const accepted = String(q.correct_text || result.correct_answer || "").split(/[;|]/).map(s => s.trim()).filter(Boolean);
            const r = await checkFreeTextAI(q.question_text || q.text || "", result.user_answer, accepted);
            if (!r) { kiBox.remove(); return; }
            if (r.correct) {
              kiBox.innerHTML = `<div class="ki-validate-ok">🤖 KI: Inhaltlich richtig!</div>
                ${r.feedback ? `<div class="ki-validate-fb">${mathEsc(r.feedback)}</div>` : ""}
                <button class="btn btn-success btn-sm" id="ki-accept">Als richtig werten</button>`;
              kiBox.querySelector("#ki-accept")?.addEventListener("click", async () => {
                let pr = await loadProgress();
                pr = updateProgress(pr, q.id, true);
                await saveProgress(pr);
                kiBox.innerHTML = `<div class="ki-validate-ok">✓ Als richtig gewertet!</div>`;
              });
            } else {
              kiBox.innerHTML = `<div class="ki-validate-no">🤖 KI: Inhaltlich nicht korrekt.</div>
                ${r.feedback ? `<div class="ki-validate-fb">${mathEsc(r.feedback)}</div>` : ""}`;
            }
          } catch { kiBox.remove(); }
        })();
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
      showQuestion(root, quiz, session);
    }
  });

  root.querySelector("#prev-btn")?.addEventListener("click", () => {
    session.prev();
    showQuestion(root, quiz, session);
  });
}

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

function setupDragCategory(root, q, assignments) {
  const pairs = q.drag_drop_pairs ?? [];
  const items = shuffle(pairs.map(p => p.source));
  const cats = [...new Set(pairs.map(p => p.target))];
  const itemsEl = root.querySelector("#dc-items");
  const catsEl = root.querySelector("#dc-categories");

  function renderDC() {
    const assigned = new Set(Object.keys(assignments));
    itemsEl.innerHTML = items.filter(s => !assigned.has(s)).map((s, i) =>
      `<div class="dnd-chip" data-item="${esc(s)}" style="background:${CHIP_COLORS[i % CHIP_COLORS.length]}20;border:2px solid ${CHIP_COLORS[i % CHIP_COLORS.length]};color:var(--text);cursor:pointer">${esc(s)}</div>`
    ).join("");

    cats.forEach(cat => {
      const slot = catsEl.querySelector(`.dc-cat-items[data-cat="${CSS.escape(cat)}"]`);
      if (!slot) return;
      const catItems = Object.entries(assignments).filter(([, c]) => c === cat).map(([item]) => item);
      slot.innerHTML = catItems.map(item =>
        `<span class="dnd-assigned dc-assigned" data-item="${esc(item)}">${esc(item)} ✕</span>`
      ).join("") || `<span class="dc-placeholder">Hierher ziehen</span>`;
    });

    let selectedChip = null;
    itemsEl.querySelectorAll(".dnd-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        itemsEl.querySelectorAll(".dnd-chip").forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
        selectedChip = chip.dataset.item;
      });
      chip.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/plain", chip.dataset.item);
      });
    });

    catsEl.querySelectorAll(".dc-cat").forEach(catEl => {
      catEl.addEventListener("click", () => {
        if (selectedChip) {
          assignments[selectedChip] = catEl.dataset.cat;
          selectedChip = null;
          renderDC();
        }
      });
      catEl.addEventListener("dragover", e => e.preventDefault());
      catEl.addEventListener("drop", e => {
        e.preventDefault();
        const item = e.dataTransfer.getData("text/plain");
        if (item) { assignments[item] = catEl.dataset.cat; renderDC(); }
      });
    });

    catsEl.querySelectorAll(".dc-assigned").forEach(el => {
      el.addEventListener("click", e => {
        e.stopPropagation();
        delete assignments[el.dataset.item];
        renderDC();
      });
    });
  }
  renderDC();
}

function setupDiagramLabel(root, q, placements) {
  const container = root.querySelector("#diagram-container");
  const canvas = root.querySelector("#diagram-canvas");
  const chipsEl = root.querySelector("#diagram-chips");
  const ctx = canvas.getContext("2d");
  const labels = q.diagram_labels || [];
  let img = null;
  const SNAP_RADIUS = 0.10;

  function draw() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    if (img) ctx.drawImage(img, 0, 0, w, h);
    else { ctx.fillStyle = "#e2e8f0"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#999"; ctx.font = "14px sans-serif"; ctx.textAlign = "center"; ctx.fillText("Kein Bild verfügbar", w/2, h/2); }

    // Draw snap zones
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      const px = l.x * w, py = l.y * h;
      const snapPx = SNAP_RADIUS * Math.max(w, h);
      ctx.beginPath();
      ctx.arc(px, py, snapPx, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(100,100,100,0.08)";
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(100,100,100,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw placed labels
    for (const [label, pos] of Object.entries(placements)) {
      const idx = labels.findIndex(l => l.label === label);
      const color = CHIP_COLORS[idx % CHIP_COLORS.length];
      const px = pos.x * w, py = pos.y * h;
      ctx.beginPath(); ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.fillStyle = color + "dd"; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label.slice(0, 5), px, py);
    }
  }

  // Floating drag ghost element
  let dragGhost = null;
  let dragLabel = null;

  function createGhost(label, color, x, y) {
    dragGhost = document.createElement("div");
    dragGhost.className = "drag-ghost";
    dragGhost.textContent = label;
    dragGhost.style.cssText = `position:fixed;left:${x-30}px;top:${y-18}px;z-index:9999;pointer-events:none;
      background:${color}dd;color:#fff;font-size:0.8rem;font-weight:700;padding:6px 14px;border-radius:20px;
      box-shadow:0 4px 16px rgba(0,0,0,0.3);transform:scale(1.1);transition:transform 0.1s`;
    document.body.appendChild(dragGhost);
  }

  function moveGhost(x, y) {
    if (dragGhost) { dragGhost.style.left = (x - 30) + "px"; dragGhost.style.top = (y - 18) + "px"; }
  }

  function removeGhost() {
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
  }

  function trySnap(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    const aspect = rect.width / rect.height;
    let bestDist = Infinity, bestIdx = -1;
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      const alreadyPlaced = Object.entries(placements).some(([k, v]) => k !== dragLabel && Math.abs(v.x - l.x) < 0.02 && Math.abs(v.y - l.y) < 0.02);
      if (alreadyPlaced) continue;
      const dx = (fx - l.x) * aspect;
      const dy = fy - l.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < SNAP_RADIUS * Math.max(1, aspect) && dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    return bestIdx;
  }

  function renderChips() {
    const placed = new Set(Object.keys(placements));
    chipsEl.innerHTML = "";
    labels.forEach((l, i) => {
      if (placed.has(l.label)) return;
      const color = CHIP_COLORS[i % CHIP_COLORS.length];
      const chip = document.createElement("div");
      chip.className = "dnd-chip";
      chip.textContent = l.label;
      chip.dataset.label = l.label;
      chip.dataset.idx = i;
      chip.style.cssText = `background:${color}20;border:2px solid ${color};color:var(--text);cursor:grab;user-select:none;touch-action:none`;
      chipsEl.appendChild(chip);
      bindChipDrag(chip, l.label, color);
    });
    // Show placed chips as removable
    for (const label of Object.keys(placements)) {
      const idx = labels.findIndex(l => l.label === label);
      const chip = document.createElement("div");
      chip.className = "dnd-chip placed";
      chip.textContent = label + " ✕";
      chip.style.cssText = "opacity:0.5;text-decoration:line-through;cursor:pointer";
      chip.addEventListener("click", () => { delete placements[label]; draw(); renderChips(); });
      chipsEl.appendChild(chip);
    }
  }

  function bindChipDrag(chip, label, color) {
    // Touch drag
    chip.addEventListener("touchstart", e => {
      e.preventDefault();
      dragLabel = label;
      const t = e.touches[0];
      createGhost(label, color, t.clientX, t.clientY);
    }, { passive: false });
    chip.addEventListener("touchmove", e => {
      e.preventDefault();
      moveGhost(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    chip.addEventListener("touchend", e => {
      e.preventDefault();
      if (!dragLabel) return;
      const t = e.changedTouches[0];
      const snapIdx = trySnap(t.clientX, t.clientY);
      if (snapIdx >= 0) {
        placements[dragLabel] = { x: labels[snapIdx].x, y: labels[snapIdx].y };
      }
      dragLabel = null;
      removeGhost();
      draw(); renderChips();
    });

    // Mouse drag
    let mouseDown = false;
    chip.addEventListener("mousedown", e => {
      mouseDown = true;
      dragLabel = label;
      createGhost(label, color, e.clientX, e.clientY);
      e.preventDefault();
    });
    const onMouseMove = e => { if (mouseDown) moveGhost(e.clientX, e.clientY); };
    const onMouseUp = e => {
      if (!mouseDown) return;
      mouseDown = false;
      if (dragLabel) {
        const snapIdx = trySnap(e.clientX, e.clientY);
        if (snapIdx >= 0) {
          placements[dragLabel] = { x: labels[snapIdx].x, y: labels[snapIdx].y };
        }
        dragLabel = null;
      }
      removeGhost();
      draw(); renderChips();
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
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
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
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
