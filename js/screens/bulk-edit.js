import { loadQuizzes, saveQuizzes } from "../store.js";
import { navigate } from "../router.js";
import { esc, escAttr, mathEsc } from "../utils.js";

export async function render(root, params) {
  const { quizId } = params || {};
  const quizzes = await loadQuizzes();
  const quiz = quizzes.find(q => q.id === quizId);
  if (!quiz) { navigate("my-quizzes"); return; }

  const questions = quiz.questions || [];
  let selected = new Set();
  let filterText = "";
  let showReplace = false;

  function renderUI() {
    const filtered = filterText
      ? questions.filter(q => {
          const txt = (q.question_text || q.text || "").toLowerCase();
          const opts = (q.options || []).map(o => o.text?.toLowerCase() || "").join(" ");
          const ans = (q.correct_text || q.correct_answer || "").toLowerCase();
          const all = txt + " " + opts + " " + ans;
          return all.includes(filterText.toLowerCase());
        })
      : questions;

    let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
      <div class="section-title">🔧 Bulk-Edit: ${esc(quiz.name)}</div>
      <div class="card" style="padding:12px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="text" id="filter-input" class="input" placeholder="Suchen…" value="${escAttr(filterText)}" style="flex:1;min-width:150px">
          <button class="btn btn-ghost btn-sm" id="select-all">Alle</button>
          <button class="btn btn-ghost btn-sm" id="select-none">Keine</button>
        </div>
        <div style="margin-top:10px;font-size:0.8rem;color:var(--text-light)">
          ${filtered.length}/${questions.length} Fragen · ${selected.size} ausgewählt
        </div>
      </div>`;

    if (filtered.length === 0) {
      html += `<div class="empty">Keine Fragen gefunden.</div>`;
    } else {
      html += `<div class="bulk-list" style="max-height:55vh;overflow-y:auto">`;
      for (const q of filtered) {
        const id = q.id;
        const checked = selected.has(id);
        const preview = (q.question_text || q.text || "").slice(0, 80);
        const topic = q.topic || "";
        html += `<div class="card bulk-item" data-bid="${escAttr(id)}" style="padding:10px 12px;margin-bottom:6px;display:flex;align-items:flex-start;gap:10px">
          <input type="checkbox" class="bulk-check" data-id="${escAttr(id)}" ${checked ? "checked" : ""} style="margin-top:3px;flex-shrink:0">
          <div style="flex:1;min-width:0">
            <div style="font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mathEsc(preview)}${preview.length >= 80 ? "…" : ""}</div>
            <div style="font-size:0.7rem;color:var(--text-light)">${q.question_type || "?"}${topic ? " · " + esc(topic) : ""}</div>
          </div>
        </div>`;
      }
      html += `</div>`;
    }

    html += `<div class="card" style="padding:12px;margin-top:10px">
      <div style="font-size:0.85rem;font-weight:600;margin-bottom:8px">⚡ Aktionen (${selected.size} ausgewählt)</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <button class="btn btn-ghost btn-sm" id="topic-btn">🏷️ Thema setzen</button>
        <button class="btn btn-ghost btn-sm" id="replace-btn">🔄 Suchen & Ersetzen</button>
        <button class="btn btn-danger btn-sm" id="delete-btn">🗑️ Löschen</button>
      </div>
      ${showReplace ? `<div id="replace-area" style="display:flex;gap:6px;margin-top:8px">
        <input type="text" id="find-input" class="input" placeholder="Finden…" style="flex:1">
        <input type="text" id="replace-input" class="input" placeholder="Ersetzen mit…" style="flex:1">
        <button class="btn btn-primary btn-sm" id="do-replace">Ersetzen</button>
      </div>` : ""}
    </div>`;

    root.innerHTML = html;

    root.querySelector("#back-btn").addEventListener("click", () => navigate("my-quizzes"));

    const filterEl = root.querySelector("#filter-input");
    if (filterEl) {
      filterEl.addEventListener("input", () => { filterText = filterEl.value; renderUI(); });
      filterEl.focus();
    }

    root.querySelector("#select-all")?.addEventListener("click", () => {
      filtered.forEach(q => selected.add(q.id)); renderUI();
    });
    root.querySelector("#select-none")?.addEventListener("click", () => {
      selected.clear(); renderUI();
    });

    root.querySelectorAll(".bulk-check").forEach(cb => {
      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        if (cb.checked) selected.add(cb.dataset.id);
        else selected.delete(cb.dataset.id);
        renderUI();
      });
    });

    root.querySelectorAll(".bulk-item").forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT") return;
        const cb = el.querySelector(".bulk-check");
        if (!cb) return;
        cb.checked = !cb.checked;
        if (cb.checked) selected.add(cb.dataset.id);
        else selected.delete(cb.dataset.id);
        renderUI();
      });
    });

    root.querySelector("#topic-btn")?.addEventListener("click", async () => {
      if (selected.size === 0) return;
      const topic = prompt("Neues Thema für ausgewählte Fragen:");
      if (topic === null) return;
      for (const q of questions) { if (selected.has(q.id)) q.topic = topic; }
      await saveQuizzes(quizzes);
      renderUI();
    });

    root.querySelector("#delete-btn")?.addEventListener("click", async () => {
      if (selected.size === 0) return;
      if (!confirm(`${selected.size} Frage(n) wirklich löschen?`)) return;
      quiz.questions = questions.filter(q => !selected.has(q.id));
      selected.clear();
      await saveQuizzes(quizzes);
      renderUI();
    });

    root.querySelector("#replace-btn")?.addEventListener("click", () => {
      showReplace = !showReplace; renderUI();
    });

    root.querySelector("#do-replace")?.addEventListener("click", async () => {
      const findText = root.querySelector("#find-input")?.value;
      const replaceText = root.querySelector("#replace-input")?.value;
      if (!findText) return;
      let count = 0;
      for (const q of questions) {
        if (!selected.has(q.id)) continue;
        if (q.question_text && q.question_text.includes(findText)) { q.question_text = q.question_text.split(findText).join(replaceText); count++; }
        if (q.text && q.text.includes(findText)) { q.text = q.text.split(findText).join(replaceText); count++; }
        if (q.options) for (const o of q.options) {
          if (o.text && o.text.includes(findText)) { o.text = o.text.split(findText).join(replaceText); count++; }
        }
        if (q.correct_text && q.correct_text.includes(findText)) { q.correct_text = q.correct_text.split(findText).join(replaceText); count++; }
        if (q.correct_answer && q.correct_answer.includes(findText)) { q.correct_answer = q.correct_answer.split(findText).join(replaceText); count++; }
      }
      await saveQuizzes(quizzes);
      showReplace = false;
      renderUI();
      alert(`${count} Vorkommen in ${selected.size} Fragen ersetzt.`);
    });
  }

  renderUI();
}
