import { loadQuizzes, saveQuizzes } from "../store.js";
import { navigate } from "../router.js";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
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

  html += `<div class="section-title" style="margin-top:1rem">Fragen (${quiz.questions.length})</div>`;

  if (quiz.questions.length === 0) {
    html += `<div class="empty">Noch keine Fragen. Tippe auf + um eine hinzuzufügen.</div>`;
  } else {
    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const typeLabel = { single_choice: "SC", multiple_choice: "MC", free_text: "Freitext", fill_blank: "Lücke" }[q.question_type] || q.question_type;
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
      <span style="color:var(--text-light)">›</span>
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

  const typeLabel = { single_choice: "Single Choice", multiple_choice: "Multiple Choice", free_text: "Freitext", fill_blank: "Lückentext" }[q.question_type] || q.question_type;

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
    html += `<div class="section-title" style="margin-top:1rem">Antwortmöglichkeiten</div>`;
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
    html += `<button class="btn-secondary btn-sm" id="add-option" style="margin-top:0.5rem">+ Antwort</button>`;
  } else if (q.question_type === "free_text") {
    html += `<div class="editor-form">
      <label>Richtige Antwort</label>
      <input type="text" id="qe-correct-text" class="input" value="${esc(q.correct_text || "")}" placeholder="Exakte richtige Antwort">
      <small class="hint">Groß-/Kleinschreibung wird ignoriert</small>
    </div>`;
  } else if (q.question_type === "fill_blank") {
    const blanks = q.blanks || [];
    html += `<div class="section-title" style="margin-top:1rem">Lücken-Antworten (in Reihenfolge)</div>`;
    html += `<div id="blanks-list">`;
    for (let i = 0; i < blanks.length; i++) {
      html += `<div class="option-edit-row">
        <span class="blank-num">${i + 1}.</span>
        <input type="text" class="input blank-text" data-bi="${i}" value="${esc(blanks[i])}" placeholder="Antwort für Lücke ${i + 1}">
        <button class="btn-icon blank-del" data-bi="${i}" ${blanks.length <= 1 ? "disabled" : ""}>✕</button>
      </div>`;
    }
    html += `</div>`;
    html += `<button class="btn-secondary btn-sm" id="add-blank" style="margin-top:0.5rem">+ Lücke</button>`;
  }

  html += `<div class="editor-bottom-bar">
    <button class="btn-primary" id="qe-done">✓ Fertig</button>
  </div>`;

  root.innerHTML = html;

  // Events
  root.querySelector("#qe-back").addEventListener("click", () => renderMain(root, quizzes));
  root.querySelector("#qe-done").addEventListener("click", () => renderMain(root, quizzes));

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
