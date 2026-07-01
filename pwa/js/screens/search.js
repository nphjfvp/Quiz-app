import { loadQuizzes, loadFormulaSheets, loadStudyPlans } from "../store.js";
import { navigate } from "../router.js";
import { esc } from "../utils.js";

// Globale Suche über Quizze, Formelsammlungen und Lernpläne
// Routed from app.js, linked from home search bar

export async function render(root) {
  const [quizzes, sheets, plans] = await Promise.all([
    loadQuizzes(), loadFormulaSheets(), loadStudyPlans(),
  ]);

  // Build search index
  const idx = [];
  for (const q of quizzes) {
    idx.push({
      type: "quiz", id: q.id, name: q.name,
      text: [q.name, ...(q.questions || []).map(qn => qn.question_text || qn.text || "")].join(" ").toLowerCase(),
      count: (q.questions || []).length,
    });
  }
  for (const s of sheets) {
    idx.push({
      type: "formula", id: s.id, name: s.name,
      text: [s.name, s.subject || "", s.body || "", ...(s.formulas || []).map(f => f.name + " " + f.formula)].join(" ").toLowerCase(),
      count: (s.formulas || []).length || (s.body || "").split("\n").filter(l => l.trim()).length,
    });
  }
  for (const p of plans) {
    idx.push({
      type: "plan", id: p.id, name: p.name,
      text: [p.name, ...(p.topics || []).map(t => t.name)].join(" ").toLowerCase(),
      count: (p.topics || []).length,
    });
  }

  const ICONS = { quiz: "📚", formula: "📋", plan: "📅" };
  const LABELS = { quiz: "Quizze", formula: "Formelsammlungen", plan: "Lernpläne" };

  function renderResults(query) {
    const q = query.trim().toLowerCase();
    const resultsEl = root.querySelector("#search-results");
    if (!resultsEl) return;
    if (!q) { resultsEl.innerHTML = ""; return; }

    const matches = idx.filter(item => item.text.includes(q));

    // Group by type
    const groups = {};
    for (const m of matches) {
      if (!groups[m.type]) groups[m.type] = [];
      groups[m.type].push(m);
    }

    if (!Object.keys(groups).length) {
      resultsEl.innerHTML = `<div class="empty" style="margin-top:20px">Keine Ergebnisse für „${esc(query)}"</div>`;
      return;
    }

    let html = "";
    for (const [type, items] of Object.entries(groups)) {
      html += `<div class="section-title" style="margin-top:16px">${ICONS[type] || ""} ${LABELS[type] || type} (${items.length})</div>`;
      for (const item of items) {
        html += `<div class="quiz-row" data-search-nav="${type}" data-search-id="${item.id}">
          <div class="quiz-accent" style="background:var(--${type === "quiz" ? "primary" : type === "formula" ? "secondary" : "warning"})"></div>
          <div class="quiz-info">
            <h4>${esc(item.name)}</h4>
            <small>${item.count} ${type === "quiz" ? "Fragen" : type === "formula" ? "Formeln" : "Themen"}</small>
          </div>
          <span style="color:var(--text-light)">›</span>
        </div>`;
      }
    }
    resultsEl.innerHTML = html;

    resultsEl.querySelectorAll("[data-search-nav]").forEach(el => {
      el.addEventListener("click", () => {
        const t = el.dataset.searchNav;
        const id = el.dataset.searchId;
        if (t === "quiz") navigate("quiz-modes", { quizId: id });
        else if (t === "formula") navigate("formula-sheets", { sheetId: id });
        else if (t === "plan") navigate("study-plan");
      });
    });
  }

  root.innerHTML = `<div class="editor-header">
    <button class="btn-icon" id="search-back">←</button>
    <h2>🔍 Suche</h2>
  </div>
  <div style="margin-bottom:12px">
    <input type="text" id="search-input" class="input" placeholder="Quiz, Formel, Thema…" autofocus style="font-size:1rem;padding:12px">
  </div>
  <div id="search-results"></div>
  <div style="font-size:0.75rem;color:var(--text-light);text-align:center;margin-top:20px">
    ${idx.length} Elemente im Index (${quizzes.length} Quizze, ${sheets.length} Formelsammlungen, ${plans.length} Lernpläne)
  </div>`;

  root.querySelector("#search-back").addEventListener("click", () => navigate("home"));

  const input = root.querySelector("#search-input");
  input.addEventListener("input", () => renderResults(input.value));
  input.focus();
}
