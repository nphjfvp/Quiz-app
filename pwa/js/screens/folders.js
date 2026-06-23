import { loadQuizzes, loadFolders, saveFolders, loadProgress } from "../store.js";
import { navigate } from "../router.js";

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

export async function render(root, params = {}) {
  if (params.folderId) {
    await renderDetail(root, params.folderId);
  } else {
    await renderList(root);
  }
}

/* ─── Folder List ─── */

async function renderList(root) {
  const folders = await loadFolders() || [];
  const quizzes = await loadQuizzes();

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="section-title" style="margin:0">📁 Prüfungsordner</div>
      <button class="btn btn-primary btn-sm" id="new-folder-btn">+ Neuer Ordner</button>
    </div>
    <div id="create-form-container"></div>`;

  if (!folders.length) {
    html += `<div class="empty">Noch keine Ordner.<br>Erstelle einen, um Quizze für eine Prüfung zu bündeln!</div>`;
  } else {
    const today = new Date();
    for (const folder of folders) {
      const count = folder.quizIds?.length ?? 0;
      let countdown = "";
      if (folder.examDate) {
        const diff = Math.ceil((new Date(folder.examDate) - today) / 86400000);
        if (diff > 0) countdown = `${diff} Tage bis zur Prüfung`;
        else if (diff === 0) countdown = "Heute ist die Prüfung!";
        else countdown = "Prüfung vorbei";
      }
      html += `<div class="quiz-row" data-folder-id="${folder.id}">
        <div class="quiz-accent"></div>
        <div class="quiz-info">
          <h4>${esc(folder.name)}</h4>
          <small>${count} Quiz${count !== 1 ? "ze" : ""}${folder.examDate ? " · " + esc(folder.examDate) : ""}</small>
          ${countdown ? `<br><small style="color:var(--accent)">${esc(countdown)}</small>` : ""}
        </div>
        <span style="color:var(--text-light)">›</span>
      </div>`;
    }
  }

  root.innerHTML = html;

  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelectorAll("[data-folder-id]").forEach(el => {
    el.addEventListener("click", () => navigate("folders", { folderId: el.dataset.folderId }));
  });
  root.querySelector("#new-folder-btn").addEventListener("click", () => {
    showCreateForm(root.querySelector("#create-form-container"), quizzes);
  });
}

function showCreateForm(container, quizzes) {
  if (container.querySelector(".editor-form")) return;

  let quizCheckboxes = "";
  for (const q of quizzes) {
    quizCheckboxes += `<label style="display:flex;align-items:center;gap:8px;padding:4px 0">
      <input type="checkbox" value="${q.id}"> ${esc(q.name)}
    </label>`;
  }

  container.innerHTML = `<div class="card" style="margin-bottom:16px">
    <form class="editor-form" id="folder-form">
      <div class="input-group">
        <label>Name</label>
        <input class="input" type="text" id="folder-name" placeholder="z.B. Mathe Klausur" required>
      </div>
      <div class="input-group">
        <label>Prüfungsdatum</label>
        <input class="input" type="date" id="folder-date">
      </div>
      <div class="input-group">
        <label>Quizze auswählen</label>
        <div id="quiz-checkboxes" style="max-height:200px;overflow-y:auto">
          ${quizCheckboxes || "<small>Keine Quizze vorhanden.</small>"}
        </div>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Erstellen</button>
        <button type="button" class="btn btn-ghost" id="cancel-create">Abbrechen</button>
      </div>
    </form>
  </div>`;

  container.querySelector("#cancel-create").addEventListener("click", () => {
    container.innerHTML = "";
  });

  container.querySelector("#folder-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = container.querySelector("#folder-name").value.trim();
    if (!name) return;
    const date = container.querySelector("#folder-date").value || null;
    const checked = [...container.querySelectorAll("#quiz-checkboxes input:checked")].map(c => c.value);

    const folders = await loadFolders() || [];
    folders.push({
      id: uid(),
      name,
      quizIds: checked,
      examDate: date,
      created: new Date().toISOString()
    });
    await saveFolders(folders);
    navigate("folders");
  });
}

/* ─── Folder Detail ─── */

async function renderDetail(root, folderId) {
  const folders = await loadFolders() || [];
  const folder = folders.find(f => f.id === folderId);
  if (!folder) {
    root.innerHTML = `<button class="back-btn" id="back-btn">‹ Zurück</button>
      <div class="empty">Ordner nicht gefunden.</div>`;
    root.querySelector("#back-btn").addEventListener("click", () => navigate("folders"));
    return;
  }

  const quizzes = await loadQuizzes();
  const progress = await loadProgress();
  const quizMap = Object.fromEntries(quizzes.map(q => [q.id, q]));
  const folderQuizzes = folder.quizIds.map(id => quizMap[id]).filter(Boolean);

  // Count weak questions (box 1-2) across all folder quizzes
  let weakCount = 0;
  let totalCount = 0;
  for (const quiz of folderQuizzes) {
    for (const q of (quiz.questions || [])) {
      totalCount++;
      const box = progress[q.id]?.box ?? 1;
      if (box <= 2) weakCount++;
    }
  }

  // Countdown
  let countdown = "";
  if (folder.examDate) {
    const diff = Math.ceil((new Date(folder.examDate) - new Date()) / 86400000);
    if (diff > 0) countdown = `📅 ${diff} Tage bis zur Prüfung (${esc(folder.examDate)})`;
    else if (diff === 0) countdown = "📅 Heute ist die Prüfung!";
    else countdown = `📅 Prüfung war am ${esc(folder.examDate)}`;
  }

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="editor-header">
      <div class="section-title">📁 ${esc(folder.name)}</div>
      <button class="btn-icon" id="edit-folder-btn" title="Bearbeiten">✏️</button>
    </div>
    ${countdown ? `<p style="margin-bottom:12px">${countdown}</p>` : ""}
    <div id="edit-form-container"></div>
    <div class="btn-row" style="margin-bottom:16px">
      <button class="btn btn-primary" id="learn-all-btn" ${!totalCount ? "disabled" : ""}>Alle lernen (${totalCount})</button>
      <button class="btn btn-ghost" id="weak-btn" ${!weakCount ? "disabled" : ""}>Schwache Fragen (${weakCount})</button>
    </div>
    <div class="section-title" style="font-size:0.95rem">Quizze im Ordner</div>`;

  if (!folderQuizzes.length) {
    html += `<div class="empty">Keine Quizze in diesem Ordner.</div>`;
  } else {
    for (const quiz of folderQuizzes) {
      const n = quiz.questions?.length ?? 0;
      html += `<div class="quiz-row">
        <div class="quiz-accent"></div>
        <div class="quiz-info">
          <h4>${esc(quiz.name)}</h4>
          <small>${n} Fragen</small>
        </div>
        <button class="btn btn-danger btn-sm" data-remove-id="${quiz.id}" title="Entfernen">✕</button>
      </div>`;
    }
  }

  html += `<div style="margin-top:24px">
    <button class="btn btn-danger btn-block" id="delete-folder-btn">Ordner löschen</button>
  </div>`;

  root.innerHTML = html;

  // Navigation
  root.querySelector("#back-btn").addEventListener("click", () => navigate("folders"));

  root.querySelector("#learn-all-btn").addEventListener("click", () => {
    if (!totalCount) return;
    const allQs = folderQuizzes.flatMap(q => q.questions || []);
    const combined = { id: "folder-" + folder.id, name: folder.name, questions: allQs };
    navigate("quiz", { quiz: combined, mode: "single" });
  });

  root.querySelector("#weak-btn").addEventListener("click", () => {
    if (!weakCount) return;
    const weakQs = folderQuizzes.flatMap(q => (q.questions || []).filter(x => (progress[x.id]?.box ?? 1) <= 2));
    const combined = { id: "folder-weak-" + folder.id, name: folder.name + " (Schwach)", questions: weakQs };
    navigate("quiz", { quiz: combined, mode: "single" });
  });

  // Remove quiz from folder
  root.querySelectorAll("[data-remove-id]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const qid = btn.dataset.removeId;
      const fresh = await loadFolders() || [];
      const f = fresh.find(x => x.id === folderId);
      if (f) {
        f.quizIds = f.quizIds.filter(id => id !== qid);
        await saveFolders(fresh);
        navigate("folders", { folderId });
      }
    });
  });

  // Delete folder
  root.querySelector("#delete-folder-btn").addEventListener("click", async () => {
    if (!confirm("Ordner wirklich löschen?")) return;
    const fresh = await loadFolders() || [];
    const updated = fresh.filter(f => f.id !== folderId);
    await saveFolders(updated);
    navigate("folders");
  });

  // Edit folder
  root.querySelector("#edit-folder-btn").addEventListener("click", () => {
    showEditForm(root.querySelector("#edit-form-container"), folder, quizzes, folderId);
  });
}

function showEditForm(container, folder, allQuizzes, folderId) {
  if (container.querySelector(".editor-form")) return;

  let quizCheckboxes = "";
  for (const q of allQuizzes) {
    const checked = folder.quizIds.includes(q.id) ? "checked" : "";
    quizCheckboxes += `<label style="display:flex;align-items:center;gap:8px;padding:4px 0">
      <input type="checkbox" value="${q.id}" ${checked}> ${esc(q.name)}
    </label>`;
  }

  container.innerHTML = `<div class="card" style="margin-bottom:16px">
    <form class="editor-form" id="edit-folder-form">
      <div class="input-group">
        <label>Name</label>
        <input class="input" type="text" id="edit-name" value="${esc(folder.name)}" required>
      </div>
      <div class="input-group">
        <label>Prüfungsdatum</label>
        <input class="input" type="date" id="edit-date" value="${folder.examDate || ""}">
      </div>
      <div class="input-group">
        <label>Quizze</label>
        <div id="edit-checkboxes" style="max-height:200px;overflow-y:auto">
          ${quizCheckboxes || "<small>Keine Quizze vorhanden.</small>"}
        </div>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Speichern</button>
        <button type="button" class="btn btn-ghost" id="cancel-edit">Abbrechen</button>
      </div>
    </form>
  </div>`;

  container.querySelector("#cancel-edit").addEventListener("click", () => {
    container.innerHTML = "";
  });

  container.querySelector("#edit-folder-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = container.querySelector("#edit-name").value.trim();
    if (!name) return;
    const date = container.querySelector("#edit-date").value || null;
    const checked = [...container.querySelectorAll("#edit-checkboxes input:checked")].map(c => c.value);

    const folders = await loadFolders() || [];
    const f = folders.find(x => x.id === folderId);
    if (f) {
      f.name = name;
      f.examDate = date;
      f.quizIds = checked;
      await saveFolders(folders);
      navigate("folders", { folderId });
    }
  });
}
