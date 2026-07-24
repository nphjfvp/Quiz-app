// Eigene Themen-Profile ("Mathe", "Englisch" …): erscheinen als Shortcuts auf
// der Startseite. Pro Thema wählt der Nutzer, welche Fragetypen bei der
// KI-Generierung erlaubt sind und welche Lernarten (Werkzeuge) freigeschaltet
// werden sollen — subject-hub.js zeigt dann nur diese Auswahl.
import { loadSubjects, saveSubjects } from "../store.js";
import { navigate } from "../router.js";
import { esc, uid } from "../utils.js";

export const SUBJECT_COLORS = [
  "#1cb487", "#7c5cff", "#2196f3", "#ff7043", "#2e9e5b", "#ec4899", "#d4a017", "#64748b",
];
export const SUBJECT_ICONS = ["📘", "🔢", "🧪", "🌍", "📖", "⚖️", "🩺", "💻", "🎨", "🎵", "🏛️", "⚗️"];

export const QUESTION_TYPE_CATALOG = [
  { id: "single_choice", label: "Single Choice" },
  { id: "multiple_choice", label: "Multiple Choice" },
  { id: "free_text", label: "Freitext" },
  { id: "fill_blank", label: "Lückentext" },
  { id: "drag_drop", label: "Drag & Drop" },
  { id: "drag_category", label: "Kategorie-Zuordnung" },
  { id: "math_formula", label: "Mathe-Formel" },
  { id: "diagram_label", label: "Diagramm beschriften" },
  { id: "mark_image", label: "Bild markieren" },
];

export const LEARNING_MODE_CATALOG = [
  { id: "ai-generate", icon: "🤖", label: "KI-Generator" },
  { id: "editor", icon: "✏️", label: "Editor" },
  { id: "study", icon: "🃏", label: "Karteikarten" },
  { id: "socratic", icon: "🏛️", label: "Sokrates" },
  { id: "deep-learn", icon: "🔬", label: "Deep Learn" },
  { id: "tutor", icon: "💬", label: "KI-Tutor" },
  { id: "scaffold", icon: "🔢", label: "Formel-Training" },
  { id: "trick-mode", icon: "🕵️", label: "Trick erkennen" },
  { id: "cloze", icon: "✂️", label: "Lückentext-Generator" },
  { id: "formula-sheets", icon: "📋", label: "Formelsammlung" },
  { id: "mock-exam", icon: "🎓", label: "Probeklausur" },
  { id: "study-plan", icon: "📅", label: "Lernplan" },
  { id: "random", icon: "🎲", label: "Zufalls-Modus" },
  { id: "math-tools", icon: "🧮", label: "Mathe-Tools" },
];

const DEFAULT_TYPES = ["single_choice", "multiple_choice", "free_text", "fill_blank"];
const DEFAULT_MODES = ["ai-generate", "editor", "study", "tutor"];

export async function render(root, params = {}) {
  const subjects = await loadSubjects();

  if (params.edit || params.new) {
    const editing = params.edit ? subjects.find(s => s.id === params.edit) : null;
    return renderForm(root, subjects, editing);
  }

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="list-header">
      <div class="section-title" style="margin:0">🗂️ Eigene Themen</div>
      <button class="btn btn-primary btn-sm" id="new-subject">+ Neues Thema</button>
    </div>
    <p style="font-size:0.85rem;color:var(--text-light);margin:0 0 10px">
      Erstelle Themen wie „Mathe" oder „Englisch" mit eigener Farbe/Icon. Du legst pro Thema fest,
      welche Fragetypen bei der KI-Generierung erlaubt sind und welche Lernarten sichtbar sein sollen.
      Themen erscheinen als Shortcuts direkt auf der Startseite.
    </p>`;

  if (!subjects.length) {
    html += `<div class="empty">Noch keine Themen.<br>Erstelle dein erstes Thema!</div>`;
  } else {
    for (const s of subjects) {
      html += `<div class="card" data-subject-id="${s.id}" style="margin-top:8px;cursor:pointer;display:flex;align-items:center;gap:10px;border-left:4px solid ${s.color}">
        <div style="font-size:1.6rem">${s.icon}</div>
        <div style="flex:1">
          <strong>${esc(s.name)}</strong>
          <div style="font-size:0.75rem;color:var(--text-light)">
            ${(s.allowedTypes || []).length} Fragetypen · ${(s.allowedModes || []).length} Lernarten
          </div>
        </div>
        <button class="btn-icon btn-icon-sm subj-edit" data-id="${s.id}" title="Bearbeiten">✏️</button>
        <button class="btn-icon btn-icon-sm subj-del" data-id="${s.id}" title="Löschen">✕</button>
      </div>`;
    }
  }

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelector("#new-subject").addEventListener("click", () => navigate("subjects", { new: true }));
  root.querySelectorAll("[data-subject-id]").forEach(el => {
    el.addEventListener("click", () => navigate("subject-hub", { subjectId: el.dataset.subjectId }));
  });
  root.querySelectorAll(".subj-edit").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); navigate("subjects", { edit: btn.dataset.id }); });
  });
  root.querySelectorAll(".subj-del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Thema wirklich löschen? (Zugeordnete Quizze bleiben erhalten)")) return;
      const all = await loadSubjects();
      await saveSubjects(all.filter(s => s.id !== btn.dataset.id));
      render(root);
    });
  });
}

function renderForm(root, subjects, editing) {
  const s = editing || { id: uid(), name: "", icon: SUBJECT_ICONS[0], color: SUBJECT_COLORS[0], allowedTypes: DEFAULT_TYPES, allowedModes: DEFAULT_MODES };
  let selectedIcon = s.icon, selectedColor = s.color;

  const html = `<button class="back-btn" id="form-back">‹ Zurück</button>
    <div class="section-title">${editing ? "✏️ Thema bearbeiten" : "🗂️ Neues Thema"}</div>

    <div class="card">
      <div class="input-group">
        <label>Name</label>
        <input type="text" id="subj-name" class="input" placeholder="z.B. Mathe" value="${esc(s.name)}">
      </div>

      <div class="input-group">
        <label>Icon</label>
        <div id="subj-icons" style="display:flex;gap:6px;flex-wrap:wrap">
          ${SUBJECT_ICONS.map(ic => `<button type="button" class="icon-opt" data-icon="${ic}" style="font-size:1.3rem;padding:6px 10px;border-radius:8px;border:2px solid ${ic === s.icon ? "var(--primary)" : "var(--border)"};background:var(--card-glass-bg,var(--card-bg));cursor:pointer">${ic}</button>`).join("")}
        </div>
      </div>

      <div class="input-group">
        <label>Farbe</label>
        <div id="subj-colors" style="display:flex;gap:8px;flex-wrap:wrap">
          ${SUBJECT_COLORS.map(c => `<button type="button" class="color-opt" data-color="${c}" style="width:32px;height:32px;border-radius:50%;background:${c};border:3px solid ${c === s.color ? "var(--text)" : "transparent"};cursor:pointer"></button>`).join("")}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:10px">
      <label style="font-weight:600;font-size:0.9rem">Erlaubte Fragetypen (für KI-Generierung)</label>
      <div class="card-desc" style="margin-bottom:8px">Bei der KI-Quiz-Erstellung für dieses Thema werden nur diese Typen vorausgewählt.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${QUESTION_TYPE_CATALOG.map(t => `<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer">
          <input type="checkbox" class="subj-type" value="${t.id}" ${(s.allowedTypes || []).includes(t.id) ? "checked" : ""}> ${t.label}
        </label>`).join("")}
      </div>
    </div>

    <div class="card" style="margin-top:10px">
      <label style="font-weight:600;font-size:0.9rem">Erlaubte Lernarten</label>
      <div class="card-desc" style="margin-bottom:8px">Nur ausgewählte Werkzeuge erscheinen im Themen-Hub.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${LEARNING_MODE_CATALOG.map(m => `<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer">
          <input type="checkbox" class="subj-mode" value="${m.id}" ${(s.allowedModes || []).includes(m.id) ? "checked" : ""}> ${m.icon} ${m.label}
        </label>`).join("")}
      </div>
    </div>

    <div id="subj-err" class="error-box" style="display:none"></div>
    <button class="btn btn-primary btn-block" id="subj-save" style="margin-top:12px">💾 Speichern</button>`;

  root.innerHTML = html;
  root.querySelector("#form-back").addEventListener("click", () => navigate("subjects"));

  root.querySelectorAll(".icon-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedIcon = btn.dataset.icon;
      root.querySelectorAll(".icon-opt").forEach(b => b.style.borderColor = b === btn ? "var(--primary)" : "var(--border)");
    });
  });
  root.querySelectorAll(".color-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedColor = btn.dataset.color;
      root.querySelectorAll(".color-opt").forEach(b => b.style.borderColor = b === btn ? "var(--text)" : "transparent");
    });
  });

  root.querySelector("#subj-save").addEventListener("click", async () => {
    const name = root.querySelector("#subj-name").value.trim();
    const errBox = root.querySelector("#subj-err");
    if (!name) { errBox.textContent = "Bitte einen Namen eingeben."; errBox.style.display = "block"; return; }

    const allowedTypes = [...root.querySelectorAll(".subj-type:checked")].map(el => el.value);
    const allowedModes = [...root.querySelectorAll(".subj-mode:checked")].map(el => el.value);
    if (!allowedModes.length) { errBox.textContent = "Bitte mindestens eine Lernart erlauben."; errBox.style.display = "block"; return; }

    const updated = { id: s.id, name, icon: selectedIcon, color: selectedColor, allowedTypes, allowedModes, createdAt: s.createdAt || Date.now() };
    const all = await loadSubjects();
    const idx = all.findIndex(x => x.id === s.id);
    if (idx >= 0) all[idx] = updated; else all.push(updated);
    await saveSubjects(all);
    navigate("subjects");
  });
}
