import { loadQuizzes, loadProgress, saveQuizzes } from "../store.js";
import { navigate } from "../router.js";
import { esc, getBoxCounts } from "../utils.js";

export async function render(root) {
  const quizzes = await loadQuizzes();
  const progress = await loadProgress();

  // Multi-select state for bulk deletion.
  let selectMode = false;
  const selected = new Set();

  // Learning tools FIRST — the ways to learn are the primary content of the
  // Lernen tab; the quiz library lives in its own section below.
  const TOOLS = [
    ["ai-generate", "🤖", "KI-Generator", "Quiz aus Text/PDF/Bild"],
    ["study-plan", "📅", "Lernplan", "Klausurvorbereitung"],
    ["mock-exam", "🎓", "Probeklausur", "Klausur hochladen & üben"],
    ["trick-mode", "🕵️", "Trick erkennen", "Mathe-Kniffe identifizieren"],
    ["subjects", "🗂️", "Eigene Themen", "Fragetypen & Lernarten pro Fach"],
    ["study", "🃏", "Karteikarten", "Spaced Repetition"],
    ["socratic", "🏛️", "Sokrates", "Fragend verstehen"],
    ["deep-learn", "🔬", "Deep Learn", "Geführte Sessions"],
    ["tutor", "💬", "KI-Tutor", "Freier Lern-Chat"],
    ["random", "🎲", "Zufalls-Modus", "Fragen aus allen Quizzen"],
    ["scaffold", "🔢", "Formel-Training", "Schritt für Schritt"],
    ["cloze", "✂️", "Lückentext", "KI-Zusammenfassung"],
    ["formula-sheets", "📋", "Formelsammlung", "Pro Fach sammeln"],
    ["editor", "✏️", "Editor", "Quiz manuell erstellen"],
    ["folders", "📁", "Ordner", "Klausuren gruppieren"],
    ["marked", "⭐", "Markiert", "Gemerkte Fragen"],
    ["pomodoro", "🍅", "Pomodoro", "Fokus-Timer"],
    ["image-editor", "🖌️", "Bild-Editor", "Schwärzen & malen"],
  ];
  let html = `<div class="section-title" style="margin-top:4px">Lernen</div>
    <div class="grid-2">
      ${TOOLS.map(([nav, icon, title, desc]) => `
        <div class="grid-card tool-card" data-nav="${nav}">
          <div class="icon">${icon}</div>
          <div><div class="title">${title}</div><div class="desc">${desc}</div></div>
        </div>`).join("")}
    </div>`;

  // Quiz library below, in its own section
  html += `<div class="list-header" style="margin-top:6px">
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
    html += `<div class="empty">Noch keine Quizze.<br>Erstelle eins mit dem KI-Generator oder Editor!</div>`;
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

  root.innerHTML = html;

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
