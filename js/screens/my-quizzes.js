import { loadQuizzes, loadProgress, saveQuizzes } from "../store.js";
import { navigate } from "../router.js";
import { esc, getBoxCounts } from "../utils.js";

export async function render(root) {
  const quizzes = await loadQuizzes();
  const progress = await loadProgress();

  // Multi-select state for bulk deletion.
  let selectMode = false;
  const selected = new Set();

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="list-header">
      <div class="section-title" style="margin:0">📚 Meine Quizze</div>
      <div style="display:flex;gap:6px">
        ${quizzes.length ? `<button class="btn btn-ghost btn-sm" id="select-btn">Auswählen</button>` : ""}
        <button class="btn btn-primary btn-sm" id="new-quiz-btn">+ Neu</button>
      </div>
    </div>
    <div id="select-bar" style="display:none;align-items:center;gap:8px;margin-bottom:10px">
      <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer">
        <input type="checkbox" id="select-all"> Alle
      </label>
      <span style="flex:1"></span>
      <button class="btn btn-danger btn-sm" id="delete-selected" disabled>🗑️ Löschen</button>
      <button class="btn btn-ghost btn-sm" id="cancel-select">Abbrechen</button>
    </div>`;

  if (!quizzes.length) {
    html += `<div class="empty">Noch keine Quizze.<br>Importiere welche über Einstellungen!</div>`;
  } else {
    for (const quiz of quizzes) {
      const n = quiz.questions?.length ?? 0;
      const counts = getBoxCounts(quiz, progress);
      html += `<div class="quiz-row" data-quiz-id="${quiz.id}">
        <input type="checkbox" class="quiz-select" data-select-id="${quiz.id}" style="display:none;margin-right:4px">
        <div class="quiz-accent"></div>
        <div class="quiz-info">
          <h4>${esc(quiz.name)}</h4>
          <small>${n} Fragen${quiz.description ? " · " + esc(quiz.description) : ""}</small>
        </div>
        <div class="quiz-boxes">
          ${[1,2,3,4,5].map(b => `<span class="quiz-box box-${b}">${counts[b]||0}</span>`).join("")}
        </div>
        <button class="btn-icon btn-icon-sm row-action" data-edit-id="${quiz.id}">✏️</button>
        <button class="btn-icon btn-icon-sm row-action" data-bulk-id="${quiz.id}" title="Bulk-Edit">🔧</button>
        <button class="btn-icon btn-icon-sm row-action" data-export-id="${quiz.id}" data-format="json" title="Als JSON exportieren">📥</button>
        <button class="btn-icon btn-icon-sm row-action" data-export-id="${quiz.id}" data-format="html" title="Als HTML exportieren">📄</button>
        <span class="row-chev">›</span>
      </div>`;
    }
  }

  // Learning tools – accessible from the Lernen tab
  html += `<div class="section-title">Lern-Werkzeuge</div>`;
  html += `<div class="grid-4">
    <div class="grid-card mini-card" data-nav="ai-generate"><div class="icon">🤖</div><div class="title">KI-Generator</div></div>
    <div class="grid-card mini-card" data-nav="editor"><div class="icon">✏️</div><div class="title">Editor</div></div>
    <div class="grid-card mini-card" data-nav="study"><div class="icon">🃏</div><div class="title">Karteikarten</div></div>
    <div class="grid-card mini-card" data-nav="cloze"><div class="icon">✂️</div><div class="title">Lückentext</div></div>
    <div class="grid-card mini-card" data-nav="folders"><div class="icon">📁</div><div class="title">Ordner / Klausuren</div></div>
    <div class="grid-card mini-card" data-nav="random"><div class="icon">🎲</div><div class="title">Zufalls-Modus</div></div>
    <div class="grid-card mini-card" data-nav="formula-sheets"><div class="icon">📋</div><div class="title">Formelsammlung</div></div>
    <div class="grid-card mini-card" data-nav="marked"><div class="icon">⭐</div><div class="title">Markiert</div></div>
    <div class="grid-card mini-card" data-nav="scaffold"><div class="icon">🔢</div><div class="title">Formel-Training</div></div>
    <div class="grid-card mini-card" data-nav="deep-learn"><div class="icon">🔬</div><div class="title">Deep Learn</div></div>
    <div class="grid-card mini-card" data-nav="socratic"><div class="icon">🏛️</div><div class="title">Sokrates</div></div>
    <div class="grid-card mini-card" data-nav="tutor"><div class="icon">💬</div><div class="title">KI-Tutor</div></div>
    <div class="grid-card mini-card" data-nav="pomodoro"><div class="icon">🍅</div><div class="title">Pomodoro</div></div>
    <div class="grid-card mini-card" data-nav="image-editor"><div class="icon">🖌️</div><div class="title">Bild-Editor</div></div>
    <div class="grid-card mini-card" data-nav="study-plan"><div class="icon">📋</div><div class="title">Lernplan</div></div>
  </div>`;

  root.innerHTML = html;

  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelector("#new-quiz-btn").addEventListener("click", () => navigate("editor"));

  // ── Multi-select / bulk delete ───────────────────────────────────────
  const selectBar = root.querySelector("#select-bar");
  const selectBtn = root.querySelector("#select-btn");
  const deleteBtn = root.querySelector("#delete-selected");
  const selectAll = root.querySelector("#select-all");
  const checkboxes = root.querySelectorAll(".quiz-select");
  const rowActions = root.querySelectorAll(".row-action, .row-chev");

  function refreshDeleteBtn() {
    if (!deleteBtn) return;
    deleteBtn.disabled = selected.size === 0;
    deleteBtn.textContent = selected.size ? `🗑️ Löschen (${selected.size})` : "🗑️ Löschen";
  }

  function setSelectMode(on) {
    selectMode = on;
    selected.clear();
    if (selectBar) selectBar.style.display = on ? "flex" : "none";
    if (selectBtn) selectBtn.style.display = on ? "none" : "";
    if (selectAll) selectAll.checked = false;
    checkboxes.forEach((cb) => { cb.style.display = on ? "" : "none"; cb.checked = false; });
    rowActions.forEach((el) => { el.style.display = on ? "none" : ""; });
    refreshDeleteBtn();
  }

  selectBtn?.addEventListener("click", () => setSelectMode(true));
  root.querySelector("#cancel-select")?.addEventListener("click", () => setSelectMode(false));

  checkboxes.forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(cb.dataset.selectId);
      else selected.delete(cb.dataset.selectId);
      if (selectAll) selectAll.checked = selected.size === checkboxes.length;
      refreshDeleteBtn();
    });
  });

  selectAll?.addEventListener("change", () => {
    checkboxes.forEach((cb) => {
      cb.checked = selectAll.checked;
      if (selectAll.checked) selected.add(cb.dataset.selectId);
      else selected.delete(cb.dataset.selectId);
    });
    refreshDeleteBtn();
  });

  deleteBtn?.addEventListener("click", async () => {
    if (!selected.size) return;
    const ok = confirm(`${selected.size} Quiz${selected.size > 1 ? "ze" : ""} wirklich löschen? Das kann nicht rückgängig gemacht werden.`);
    if (!ok) return;
    const all = await loadQuizzes();
    await saveQuizzes(all.filter((q) => !selected.has(q.id)));
    navigate("my-quizzes");
  });
  root.querySelectorAll("[data-edit-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigate("editor", { quizId: btn.dataset.editId });
    });
  });
  root.querySelectorAll("[data-bulk-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigate("bulk-edit", { quizId: btn.dataset.bulkId });
    });
  });
  root.querySelectorAll("[data-export-id]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const quizId = btn.dataset.exportId;
      const format = btn.dataset.format;
      const quizzes = await loadQuizzes();
      const quiz = quizzes.find(q => q.id === quizId);
      if (!quiz) return;
      const { downloadQuiz } = await import("../html-export.js");
      await downloadQuiz(quiz, format);
    });
  });
  root.querySelectorAll("[data-quiz-id]").forEach((el) => {
    el.addEventListener("click", () => {
      if (selectMode) {
        const cb = el.querySelector(".quiz-select");
        if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
        return;
      }
      navigate("quiz-modes", { quizId: el.dataset.quizId });
    });
  });
  root.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.nav));
  });
}
