import { loadFormulaSheets, saveFormulaSheets } from "../store.js";
import { navigate } from "../router.js";
import { esc, mathEsc, uid } from "../utils.js";

// Formelsammlung: wiederverwendbare Formel-Sammlungen pro Fach anlegen/ansehen.
// Sheet-Form: { id, name, subject, body } – body ist LaTeX-fähiger Text
// (eine Formel pro Zeile), gerendert via mathEsc.
export async function render(root, params = {}) {
  const sheets = await loadFormulaSheets();

  if (params.sheetId) {
    const sheet = sheets.find(s => s.id === params.sheetId);
    if (sheet) return showView(root, sheet);
  }
  if (params.edit) return showEdit(root, sheets, params.sheetId);

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="list-header">
      <div class="section-title" style="margin:0">📋 Formelsammlung</div>
      <button class="btn btn-primary btn-sm" id="new-btn">+ Neu</button>
    </div>
    <p style="color:var(--text-light);font-size:0.88rem;margin:0 0 12px">
      Sammle wichtige Formeln pro Fach als Spickzettel.
    </p>`;

  if (!sheets.length) {
    html += `<div class="empty">Noch keine Formelsammlungen.<br>Lege deine erste an!</div>`;
  } else {
    for (const s of sheets) {
      const lines = (s.body || "").split("\n").filter(l => l.trim()).length;
      html += `<div class="quiz-row" data-open="${s.id}">
        <div class="quiz-accent" style="background:var(--primary)"></div>
        <div class="quiz-info">
          <h4>${esc(s.name)}</h4>
          <small>${s.subject ? esc(s.subject) + " · " : ""}${lines} Formel(n)</small>
        </div>
        <button class="btn-icon btn-icon-sm" data-edit="${s.id}">✏️</button>
        <button class="btn-icon btn-icon-sm" data-del="${s.id}">🗑️</button>
        <span class="row-chev">›</span>
      </div>`;
    }
  }

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelector("#new-btn").addEventListener("click", () => showEdit(root, sheets, null));
  root.querySelectorAll("[data-open]").forEach(el =>
    el.addEventListener("click", () => {
      const s = sheets.find(x => x.id === el.dataset.open);
      if (s) showView(root, s);
    }));
  root.querySelectorAll("[data-edit]").forEach(b =>
    b.addEventListener("click", (e) => { e.stopPropagation(); showEdit(root, sheets, b.dataset.edit); }));
  root.querySelectorAll("[data-del]").forEach(b =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const s = sheets.find(x => x.id === b.dataset.del);
      if (!s) return;
      if (!confirm(`Formelsammlung „${s.name}" löschen?`)) return;
      const next = sheets.filter(x => x.id !== s.id);
      await saveFormulaSheets(next);
      render(root);
    }));
}

function showView(root, sheet) {
  const body = (sheet.body || "").split("\n").filter(l => l.trim());
  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="section-title" style="margin-bottom:2px">${esc(sheet.name)}</div>
    ${sheet.subject ? `<p style="color:var(--text-light);font-size:0.85rem;margin:0 0 12px">${esc(sheet.subject)}</p>` : ""}
    <div class="card">`;
  if (!body.length) {
    html += `<div class="empty">Keine Formeln eingetragen.</div>`;
  } else {
    html += body.map(l => `<div class="formula-sheet-body" style="padding:8px 0;border-bottom:1px solid var(--border)">${mathEsc(l)}</div>`).join("");
  }
  html += `</div>
    <button class="btn btn-ghost btn-block" id="edit-btn" style="margin-top:10px">✏️ Bearbeiten</button>`;

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("formula-sheets"));
  root.querySelector("#edit-btn").addEventListener("click", async () => {
    const sheets = await loadFormulaSheets();
    showEdit(root, sheets, sheet.id);
  });
}

function showEdit(root, sheets, sheetId) {
  const sheet = sheetId ? sheets.find(s => s.id === sheetId) : null;
  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="section-title">${sheet ? "Formelsammlung bearbeiten" : "Neue Formelsammlung"}</div>
    <div class="card">
      <div class="input-group">
        <label>Name</label>
        <input type="text" id="fs-name" class="input" value="${esc(sheet?.name || "")}" placeholder="z.B. Analysis Grundlagen">
      </div>
      <div class="input-group">
        <label>Fach (optional)</label>
        <input type="text" id="fs-subject" class="input" value="${esc(sheet?.subject || "")}" placeholder="z.B. Mathematik">
      </div>
      <div class="input-group">
        <label>Formeln (eine pro Zeile, LaTeX wird gerendert)</label>
        <textarea id="fs-body" class="input textarea" rows="10" placeholder="a^2 + b^2 = c^2\n\\frac{d}{dx} x^n = n x^{n-1}">${esc(sheet?.body || "")}</textarea>
      </div>
      <div id="fs-error" class="error-box"></div>
      <button class="btn btn-primary btn-block" id="fs-save">Speichern</button>
    </div>`;

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("formula-sheets"));
  root.querySelector("#fs-save").addEventListener("click", async () => {
    const name = root.querySelector("#fs-name").value.trim();
    const errBox = root.querySelector("#fs-error");
    if (!name) { errBox.textContent = "Bitte einen Namen eingeben."; errBox.style.display = "block"; return; }
    const subject = root.querySelector("#fs-subject").value.trim();
    const body = root.querySelector("#fs-body").value;
    let next;
    if (sheet) {
      sheet.name = name; sheet.subject = subject; sheet.body = body;
      next = sheets.map(s => s.id === sheet.id ? sheet : s);
    } else {
      next = [...sheets, { id: uid(), name, subject, body }];
    }
    await saveFormulaSheets(next);
    navigate("formula-sheets");
  });
}
