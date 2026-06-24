import { loadSettings, saveSettings } from "../store.js";
import { navigate } from "../router.js";
import { getAccount, setAccount, signIn, signUp, pullAll, pushAll, pullBySyncCode } from "../firebase-sync.js";
import { MODELS } from "../ai-service.js";
import { esc } from "../utils.js";

export async function render(root) {
  const settings = await loadSettings();
  const account = getAccount();

  const theme = (() => { try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; } })();

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>`;

  // Darstellung / Theme
  html += `<div class="section-title">Darstellung</div>
    <div class="card">
      <div class="card-desc">Farbschema der App.</div>
      <div class="theme-picker">
        <button class="theme-opt ${theme === "auto" ? "active" : ""}" data-theme-val="auto">🖥️ Automatisch</button>
        <button class="theme-opt ${theme === "light" ? "active" : ""}" data-theme-val="light">☀️ Hell</button>
        <button class="theme-opt ${theme === "dark" ? "active" : ""}" data-theme-val="dark">🌙 Dunkel</button>
      </div>
    </div>`;

  html += `<div class="section-title">Konto</div>`;

  if (account) {
    html += `<div class="card">
      <div class="account-label">Angemeldet als</div>
      <div class="account-email">${esc(account.email)}</div>
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" id="sync-push">☁️ Hochladen</button>
        <button class="btn btn-success btn-sm" id="sync-pull">⬇️ Herunterladen</button>
        <button class="btn btn-ghost btn-sm" id="logout-btn">Abmelden</button>
      </div>
      <div id="sync-status" class="status-line"></div>
    </div>`;
  } else {
    html += `<div class="card">
      <div class="card-desc">Melde dich an, um deine Quizze geräteübergreifend zu synchronisieren.</div>
      <div class="input-group">
        <label>E-Mail</label>
        <input type="email" id="auth-email" placeholder="email@example.com">
      </div>
      <div class="input-group">
        <label>Passwort</label>
        <input type="password" id="auth-pass" placeholder="Min. 6 Zeichen">
      </div>
      <div id="auth-error" class="error-line"></div>
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" id="login-btn">Anmelden</button>
        <button class="btn btn-ghost btn-sm" id="register-btn">Registrieren</button>
      </div>
    </div>`;
  }

  // Sync code import
  html += `<div class="section-title">Sync-Code Import</div>
    <div class="card">
      <div class="card-desc">Hast du einen Sync-Code vom Desktop? Gib ihn hier ein, um Quizze zu laden.</div>
      <div class="input-group">
        <label>Sync-Code</label>
        <input type="text" id="sync-code" placeholder="z.B. mein-code-123" value="${esc(settings.syncCode || "")}">
      </div>
      <button class="btn btn-primary btn-sm" id="code-import-btn">Quizze laden</button>
      <div id="code-status" class="status-line"></div>
    </div>`;

  // AI Settings
  html += `<div class="section-title">KI-Einstellungen</div>
    <div class="card">
      <div class="card-desc">Für KI-Funktionen (Quiz-Generator, Tutor) wird ein OpenRouter API-Key benötigt.</div>
      <div class="input-group">
        <label>OpenRouter API-Key</label>
        <input type="password" id="api-key" placeholder="sk-or-..." value="${esc(settings.apiKey || "")}">
      </div>
      <div class="input-group">
        <label>KI-Modell</label>
        <div id="model-list" class="model-select-list">
          ${MODELS.map(m => {
            const sel = (settings.aiModel || "nvidia/nemotron-3-super-120b-a12b:free") === m.id;
            const icons = m.vision ? "👁 Bilder" : "📝 Text";
            const ctxLabel = m.context >= 1000000 ? "1M" : Math.floor(m.context/1000) + "k";
            return `<div class="model-option ${sel ? "selected" : ""}" data-model="${m.id}">
              <div class="model-name">${esc(m.name)} <span class="model-icons">${icons}</span></div>
              <div class="model-meta">${m.tier} · ${m.price} · ${ctxLabel} ctx</div>
            </div>`;
          }).join("")}
        </div>
        <input type="hidden" id="ai-model" value="${esc(settings.aiModel || "nvidia/nemotron-3-super-120b-a12b:free")}">
        <div class="gen-model-hint">👁 = kann Bilder sehen · 📝 = nur Text. Bei Bild-Aufgaben wird automatisch ein Bild-Modell genutzt.</div>
      </div>
      <button class="btn btn-primary btn-sm" id="save-ai">Speichern</button>
      <div id="ai-status" class="status-line"></div>
    </div>`;

  // JSON Import
  html += `<div class="section-title">JSON Import</div>
    <div class="card">
      <div class="card-desc">Importiere eine Quiz-Datei (.json) vom Desktop.</div>
      <input type="file" id="file-import" accept=".json" multiple class="editor-file-input">
      <div id="file-status" class="status-line"></div>
    </div>`;

  // Reset
  html += `<div class="section-title">Zurücksetzen</div>
    <div class="card">
      <div class="card-desc">Alle lokalen Daten löschen: Quizze, Fortschritt, Statistiken und Einstellungen.</div>
      <button class="btn btn-danger btn-sm" id="reset-btn">Alle Daten zurücksetzen</button>
      <div id="reset-status" class="status-line"></div>
    </div>`;

  root.innerHTML = html;

  // Navigation
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));

  // Theme-Auswahl
  root.querySelectorAll(".theme-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.themeVal;
      try {
        if (val === "auto") { localStorage.removeItem("theme"); delete document.documentElement.dataset.theme; }
        else { localStorage.setItem("theme", val); document.documentElement.dataset.theme = val; }
      } catch {}
      root.querySelectorAll(".theme-opt").forEach(b => b.classList.toggle("active", b === btn));
    });
  });

  // Auth
  if (!account) {
    root.querySelector("#login-btn")?.addEventListener("click", async () => {
      const email = root.querySelector("#auth-email").value.trim();
      const pass = root.querySelector("#auth-pass").value;
      const errEl = root.querySelector("#auth-error");
      if (!email || !pass) { errEl.textContent = "Bitte E-Mail und Passwort eingeben."; return; }
      try {
        errEl.textContent = "Anmelden…";
        await signIn(email, pass);
        await saveSettings({ ...settings, accountEmail: email });
        render(root);
      } catch (e) { errEl.textContent = e.message; }
    });
    root.querySelector("#register-btn")?.addEventListener("click", async () => {
      const email = root.querySelector("#auth-email").value.trim();
      const pass = root.querySelector("#auth-pass").value;
      const errEl = root.querySelector("#auth-error");
      if (!email || pass.length < 6) { errEl.textContent = "Passwort muss min. 6 Zeichen haben."; return; }
      try {
        errEl.textContent = "Registrieren…";
        await signUp(email, pass);
        await saveSettings({ ...settings, accountEmail: email });
        render(root);
      } catch (e) { errEl.textContent = e.message; }
    });
  } else {
    root.querySelector("#sync-push")?.addEventListener("click", async () => {
      const st = root.querySelector("#sync-status");
      st.textContent = "Lade hoch…";
      try { await pushAll(); st.textContent = "✓ Hochgeladen!"; }
      catch { st.textContent = "Fehler beim Hochladen."; }
    });
    root.querySelector("#sync-pull")?.addEventListener("click", async () => {
      const st = root.querySelector("#sync-status");
      st.textContent = "Lade herunter…";
      try { const ok = await pullAll(); st.textContent = ok ? "✓ Heruntergeladen!" : "Keine Cloud-Daten gefunden."; }
      catch { st.textContent = "Fehler beim Herunterladen."; }
    });
    root.querySelector("#logout-btn")?.addEventListener("click", async () => {
      setAccount(null);
      render(root);
    });
  }

  // Sync code
  root.querySelector("#code-import-btn")?.addEventListener("click", async () => {
    const code = root.querySelector("#sync-code").value.trim();
    const st = root.querySelector("#code-status");
    if (!code) { st.textContent = "Bitte Code eingeben."; return; }
    st.textContent = "Lade…";
    try {
      const ok = await pullBySyncCode(code);
      st.textContent = ok ? "✓ Quizze geladen!" : "Keine Daten gefunden für diesen Code.";
      if (ok) await saveSettings({ ...settings, syncCode: code });
    } catch { st.textContent = "Fehler beim Laden."; }
  });

  // AI settings
  // Model selection clicks
  root.querySelectorAll(".model-option").forEach(el => {
    el.addEventListener("click", () => {
      root.querySelectorAll(".model-option").forEach(o => o.classList.remove("selected"));
      el.classList.add("selected");
      root.querySelector("#ai-model").value = el.dataset.model;
    });
  });

  root.querySelector("#save-ai")?.addEventListener("click", async () => {
    const key = root.querySelector("#api-key").value.trim();
    const model = root.querySelector("#ai-model").value;
    const st = root.querySelector("#ai-status");
    await saveSettings({ ...await loadSettings(), apiKey: key, aiModel: model });
    st.textContent = "✓ Gespeichert!";
    setTimeout(() => { st.textContent = ""; }, 2000);
  });

  // File import
  root.querySelector("#file-import")?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    const st = root.querySelector("#file-status");
    if (!files.length) return;
    try {
      const { loadQuizzes, saveQuizzes } = await import("../store.js");
      const existing = await loadQuizzes();
      let totalImported = 0, needsPlacement = 0, errors = 0;
      const allImported = [];
      for (const file of files) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const imported = Array.isArray(data) ? data : data.questions ? [data] : [];
          for (const q of imported) {
            for (const question of (q.questions || [])) {
              if (question.question_type === "diagram_label" && question.diagram_labels) {
                for (const l of question.diagram_labels) { if (!l._placed) l._placed = false; }
                needsPlacement++;
              }
            }
          }
          allImported.push(...imported);
          totalImported += imported.length;
        } catch { errors++; }
      }
      await saveQuizzes([...existing, ...allImported]);
      let msg = `✓ ${totalImported} Quiz(ze) aus ${files.length} Datei(en) importiert!`;
      if (errors) msg += ` ${errors} Datei(en) fehlerhaft.`;
      if (needsPlacement) msg += ` ${needsPlacement} Diagramm-Frage(n) – bitte Labels im Editor platzieren.`;
      st.textContent = msg;
    } catch { st.textContent = "Fehler: Import fehlgeschlagen."; }
  });

  // Reset
  root.querySelector("#reset-btn")?.addEventListener("click", async () => {
    const st = root.querySelector("#reset-status");
    if (!confirm("Wirklich ALLE Daten löschen? Quizze, Fortschritt, Statistiken — alles wird unwiderruflich gelöscht!")) return;
    if (!confirm("Bist du sicher? Dies kann NICHT rückgängig gemacht werden.")) return;
    try {
      const { saveQuizzes, saveProgress, saveSettings: saveSett, saveMarked: saveMark, saveStats: saveStat, saveErrorDiary, saveFolders, saveDailyState, saveFsrs } = await import("../store.js");
      await Promise.all([
        saveQuizzes([]), saveProgress({}), saveSett({}), saveMark([]),
        saveStat({}), saveErrorDiary([]), saveFolders([]), saveDailyState(null), saveFsrs({}),
      ]);
      setAccount(null);
      st.textContent = "✓ Alle Daten gelöscht.";
      setTimeout(() => navigate("home"), 1500);
    } catch { st.textContent = "Fehler beim Zurücksetzen."; }
  });
}
