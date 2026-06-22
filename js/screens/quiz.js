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
      <div class="question-text">${esc(q.text)}</div>
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
    const sources = shuffle([...q.drag_drop_pairs.map(p => p.source)]);
    const targets = q.drag_drop_pairs.map(p => p.target);
    html += `<div style="margin-bottom:8px;font-size:0.8rem;color:var(--text-light)">Ordne jedem Ziel die richtige Quelle zu.</div>`;
    html += targets.map((t, i) => `
      <div class="input-group">
        <label>${esc(t)}</label>
        <select class="dnd-select" data-target="${esc(t)}" style="width:100%;padding:10px;border-radius:var(--radius-md);border:2px solid var(--border);background:var(--input-bg);color:var(--text);font-size:0.9rem;">
          <option value="">-- Auswählen --</option>
          ${sources.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}
        </select>
      </div>`).join("");
  } else if (q.question_type === "math_formula") {
    html += `<div class="input-group">
      <label>Formel / Ergebnis</label>
      <input type="text" id="math-input" placeholder="z.B. x = 2 oder $\\frac{a}{b}$">
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
      answer = {};
      root.querySelectorAll(".dnd-select").forEach(s => { if (s.value) answer[s.dataset.target] = s.value; });
    } else if (q.question_type === "math_formula") answer = root.querySelector("#math-input")?.value ?? "";
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
