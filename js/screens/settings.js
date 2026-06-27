import { loadSettings, saveSettings, loadMemory, saveMemory, loadMemoryEntries, createMemoryEntry, addMemoryEntry, deleteMemoryEntry } from "../store.js";
import { navigate } from "../router.js";
import { getAccount, setAccount, signIn, signUp, pullAll, pushAll, pullBySyncCode } from "../firebase-sync.js";
import { MODELS } from "../ai-service.js";
import { esc, setLatexEnabled } from "../utils.js";

export async function render(root) {
  const settings = await loadSettings();
  const memoryText = await loadMemory();
  const memoryEntries = await loadMemoryEntries();
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
    </div>
    <div class="card">
      <div class="card-desc">Mathematische Formeln und Gleichungen mit LaTeX darstellen (KaTeX).</div>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" id="latex-toggle">${settings.latexEnabled !== false ? "✅ LaTeX aktiv" : "⬜ LaTeX deaktiviert"}</button>
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
        ${(() => {
          const disabled = settings.disabledModels || [];
          const curModel = settings.aiModel || "nvidia/nemotron-3-super-120b-a12b:free";
          const freeModels = MODELS.filter(m => m.price === "$0");
          const paidModels = MODELS.filter(m => m.price !== "$0");
          const renderModel = (m) => {
            const sel = curModel === m.id;
            const locked = disabled.includes(m.id);
            const icons = m.vision ? "👁 Bilder" : "📝 Text";
            const ctxLabel = m.context >= 1000000 ? "1M" : Math.floor(m.context/1000) + "k";
            return `<div class="model-option ${sel ? "selected" : ""} ${locked ? "model-locked" : ""}" data-model="${m.id}">
              <div class="model-name">${esc(m.name)} <span class="model-icons">${icons}</span></div>
              <div class="model-meta">${m.tier} · ${m.price} · ${ctxLabel} ctx</div>
              <button class="btn btn-ghost btn-icon-sm model-lock-btn" data-lock="${m.id}" title="${locked ? "Entsperren" : "Sperren"}">${locked ? "🔒" : "🔓"}</button>
            </div>`;
          };
          let h = `<div id="model-list" class="model-select-list">`;
          h += freeModels.map(renderModel).join("");
          h += `<div id="paid-models-section" style="display:none">${paidModels.map(renderModel).join("")}</div>`;
          h += `</div>`;
          h += `<button class="btn btn-ghost btn-sm" id="show-paid-models" style="margin-top:6px">▼ Weitere Modelle anzeigen (kostenpflichtig)</button>`;
          h += `<input type="hidden" id="ai-model" value="${esc(curModel)}">`;
          return h;
        })()}
        <div class="gen-model-hint">👁 = kann Bilder sehen · 📝 = nur Text. Bei Bild-Aufgaben wird automatisch ein Bild-Modell genutzt.<br>🔒 = gesperrte Modelle werden nirgends angeboten.</div>
      </div>
      <button class="btn btn-primary btn-sm" id="save-ai">Speichern</button>
      <div id="ai-status" class="status-line"></div>
    </div>`;

  // KI-Funktionen
  const aiValidation = settings.aiValidation !== false;
  const detailedAnswers = settings.detailedAnswers === true;
  const enableImages = settings.enableImages !== false;
  const useFsrs = settings.useFsrs !== false;
  html += `<div class="section-title">KI-Funktionen</div>
    <div class="card">
      <div class="card-desc">Steuere, welche KI-Hilfen beim Lernen aktiv sind.</div>
      <div class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
        <span>🤖 KI-Freitext-Prüfung</span>
        <button class="btn btn-sm ${aiValidation ? "btn-primary" : "btn-ghost"}" id="toggle-aiValidation">${aiValidation ? "✅ Ein" : "⬜ Aus"}</button>
      </div>
      <div style="font-size:0.75rem;color:var(--text-light);margin-bottom:8px">Prüft Freitext-Antworten per KI auf inhaltliche Richtigkeit.</div>
      <div class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
        <span>📝 Ausführliche KI-Antworten</span>
        <button class="btn btn-sm ${detailedAnswers ? "btn-primary" : "btn-ghost"}" id="toggle-detailedAnswers">${detailedAnswers ? "✅ Ein" : "⬜ Aus"}</button>
      </div>
      <div style="font-size:0.75rem;color:var(--text-light);margin-bottom:8px">KI-Erklärungen und Tutor-Antworten werden detailreicher und länger.</div>
      <div class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
        <span>🖼️ Bild-Fragetypen erlauben</span>
        <button class="btn btn-sm ${enableImages ? "btn-primary" : "btn-ghost"}" id="toggle-enableImages">${enableImages ? "✅ Ein" : "⬜ Aus"}</button>
      </div>
      <div style="font-size:0.75rem;color:var(--text-light);margin-bottom:8px">Wenn aus, erzeugt der KI-Generator keine diagram_label / mark_image Fragen.</div>
      <div class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
        <span>🧠 Spaced Repetition (FSRS)</span>
        <button class="btn btn-sm ${useFsrs ? "btn-primary" : "btn-ghost"}" id="toggle-useFsrs">${useFsrs ? "✅ Ein" : "⬜ Aus"}</button>
      </div>
      <div style="font-size:0.75rem;color:var(--text-light)">Plant Wiederholungen nach dem Vergessenskurve-Algorithmus (FSRS-4.5).</div>
      <div class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
        <span>🧠 KI-Gedächtnis</span>
        <button class="btn btn-sm ${settings.use_memory ? "btn-primary" : "btn-ghost"}" id="toggle-use_memory">${settings.use_memory ? "✅ Ein" : "⬜ Aus"}</button>
      </div>
      <div style="font-size:0.75rem;color:var(--text-light)">Merkt sich deine Stärken/Schwächen und personalisiert KI-Antworten.</div>
    </div>`;

  // ── Memory-Manager ──
  html += `<div class="section-title">KI-Gedächtnis</div>
    <div class="card" id="memory-manager" style="display:${settings.use_memory ? "" : "none"}">
      <div class="card-desc">Persönliche Informationen, die in KI-Antworten einfließen. Diese Daten bleiben lokal.</div>
      <div style="margin-top:8px">
        <label style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:4px">Freitext-Profil</label>
        <textarea id="memory-text" rows="2" class="model-select-list" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border)">${esc(memoryText)}</textarea>
        <div style="font-size:0.7rem;color:var(--text-light);margin-top:2px">z. B. „Ich tue mich schwer mit Mathe-Formeln. Ich lerne am besten mit Eselsbrücken."</div>
      </div>
      <div style="margin-top:10px">
        <span style="font-size:0.8rem;font-weight:600">Einträge (${memoryEntries.length})</span>
        <div id="mem-entry-list" style="margin-top:6px"></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <select id="mem-category" class="btn btn-sm btn-ghost" style="padding:4px 8px">
          <option value="weakness">Schwäche</option>
          <option value="strength">Stärke</option>
          <option value="preference">Vorliebe</option>
          <option value="fact">Fakt</option>
          <option value="custom">Notiz</option>
        </select>
        <input id="mem-topic" class="btn btn-sm btn-ghost" placeholder="Thema (optional)" style="padding:4px 8px;flex:1;min-width:100px">
        <button class="btn btn-sm btn-primary" id="mem-add-btn">+ Hinzufügen</button>
      </div>
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

  // LaTeX toggle
  root.querySelector("#latex-toggle")?.addEventListener("click", async () => {
    const s = await loadSettings();
    const cur = s.latexEnabled !== false;
    const next = !cur;
    s.latexEnabled = next;
    await saveSettings(s);
    setLatexEnabled(next);
    const btn = root.querySelector("#latex-toggle");
    btn.textContent = next ? "✅ LaTeX aktiv" : "⬜ LaTeX deaktiviert";
  });

  // KI-Funktionen toggles
  for (const key of ["aiValidation", "detailedAnswers", "enableImages", "useFsrs", "use_memory"]) {
    const btn = root.querySelector(`#toggle-${key}`);
    if (!btn) continue;
    btn.addEventListener("click", async () => {
      const s = await loadSettings();
      const cur = key === "detailedAnswers" ? s[key] === true : key === "use_memory" ? s[key] === true : s[key] !== false;
      const next = !cur;
      s[key] = next;
      await saveSettings(s);
      btn.textContent = next ? "✅ Ein" : "⬜ Aus";
      btn.className = `btn btn-sm ${next ? "btn-primary" : "btn-ghost"}`;
      if (key === "use_memory") {
        const mgr = root.querySelector("#memory-manager");
        if (mgr) mgr.style.display = next ? "" : "none";
      }
    });
  }

  // ── Memory-Manager Events ──
  const memTextarea = root.querySelector("#memory-text");
  if (memTextarea) {
    memTextarea.addEventListener("blur", async () => {
      await saveMemory(memTextarea.value);
    });
  }

  const memEntryList = root.querySelector("#mem-entry-list");
  function renderMemEntries(entries) {
    if (!memEntryList) return;
    if (!entries.length) { memEntryList.innerHTML = `<span style="color:var(--text-light);font-size:0.8rem">Noch keine Einträge.</span>`; return; }
    memEntryList.innerHTML = entries.map(e => {
      const catLabels = { weakness: "Schwäche", strength: "Stärke", preference: "Vorliebe", fact: "Fakt", custom: "Notiz" };
      return `<div style="background:var(--bg);border-radius:6px;padding:6px 8px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">
        <span><span style="font-size:0.7rem;color:var(--text-light)">${catLabels[e.category] || e.category}</span>${e.topic ? ` <span style="font-size:0.7rem;color:var(--text-light)">(${esc(e.topic)})</span>` : ""}<br><span style="font-size:0.85rem">${esc(e.text)}</span></span>
        <button class="btn-icon btn-icon-sm" data-mem-del="${e.id}">🗑️</button>
      </div>`;
    }).join("");
    memEntryList.querySelectorAll("[data-mem-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await deleteMemoryEntry(btn.dataset.memDel);
        const e = await loadMemoryEntries();
        renderMemEntries(e);
      });
    });
  }
  if (memEntryList) renderMemEntries(memoryEntries);

  root.querySelector("#mem-add-btn")?.addEventListener("click", async () => {
    const cat = root.querySelector("#mem-category")?.value || "custom";
    const topic = root.querySelector("#mem-topic")?.value?.trim() || "";
    const entry = createMemoryEntry(cat, "", topic, "manual");
    // Prompt user for text inline — use a simple prompt dialog
    const text = prompt("Text für den Eintrag:");
    if (!text || !text.trim()) return;
    entry.text = text.trim();
    await addMemoryEntry(entry);
    const entries = await loadMemoryEntries();
    renderMemEntries(entries);
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
      catch (e) { st.textContent = "Fehler beim Hochladen: " + (e?.message || ""); }
    });
    root.querySelector("#sync-pull")?.addEventListener("click", async () => {
      const st = root.querySelector("#sync-status");
      st.textContent = "Lade herunter…";
      try { const ok = await pullAll(); st.textContent = ok ? "✓ Heruntergeladen!" : "Keine Cloud-Daten gefunden."; }
      catch (e) { st.textContent = "Fehler beim Herunterladen: " + (e?.message || ""); }
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
  // Model selection clicks (skip locked, confirm paid)
  root.querySelectorAll(".model-option").forEach(el => {
    el.addEventListener("click", async (e) => {
      if (e.target.closest(".model-lock-btn")) return; // lock button handles itself
      const modelId = el.dataset.model;
      const s = await loadSettings();
      const disabled = s.disabledModels || [];
      if (disabled.includes(modelId)) return; // locked
      const model = MODELS.find(m => m.id === modelId);
      if (model && model.price !== "$0") {
        if (!confirm(`Dieses Modell kostet Geld (${model.price}/M Tokens) – trotzdem nutzen?`)) return;
      }
      root.querySelectorAll(".model-option").forEach(o => o.classList.remove("selected"));
      el.classList.add("selected");
      root.querySelector("#ai-model").value = modelId;
    });
  });

  // Lock/unlock model buttons
  root.querySelectorAll(".model-lock-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const modelId = btn.dataset.lock;
      const s = await loadSettings();
      let disabled = s.disabledModels || [];
      if (disabled.includes(modelId)) {
        disabled = disabled.filter(id => id !== modelId);
      } else {
        disabled.push(modelId);
        // If currently selected model is now locked, deselect it
        if (s.aiModel === modelId) {
          root.querySelector("#ai-model").value = "";
          root.querySelectorAll(".model-option").forEach(o => o.classList.remove("selected"));
        }
      }
      s.disabledModels = disabled;
      await saveSettings(s);
      btn.textContent = disabled.includes(modelId) ? "🔒" : "🔓";
      btn.title = disabled.includes(modelId) ? "Entsperren" : "Sperren";
      const row = btn.closest(".model-option");
      if (row) row.classList.toggle("model-locked", disabled.includes(modelId));
    });
  });

  // Show/hide paid models
  root.querySelector("#show-paid-models")?.addEventListener("click", () => {
    const sec = root.querySelector("#paid-models-section");
    const btn = root.querySelector("#show-paid-models");
    if (sec.style.display === "none") {
      sec.style.display = "";
      btn.textContent = "▲ Weniger Modelle anzeigen";
    } else {
      sec.style.display = "none";
      btn.textContent = "▼ Weitere Modelle anzeigen (kostenpflichtig)";
    }
  });

  root.querySelector("#save-ai")?.addEventListener("click", async () => {
    const key = root.querySelector("#api-key").value.trim();
    const model = root.querySelector("#ai-model").value;
    const st = root.querySelector("#ai-status");
    const s = await loadSettings();
    const disabled = s.disabledModels || [];
    if (disabled.includes(model)) {
      st.textContent = "⚠️ Das gewählte Modell ist gesperrt. Bitte entsperren oder anderes wählen.";
      return;
    }
    s.apiKey = key;
    s.aiModel = model;
    await saveSettings(s);
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
