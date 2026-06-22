import { loadSettings, saveSettings } from "../store.js";
import { navigate } from "../router.js";
import { getAccount, setAccount, signIn, signUp, pullAll, pushAll, pullBySyncCode } from "../firebase-sync.js";

export async function render(root) {
  const settings = await loadSettings();
  const account = getAccount();

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="section-title">Konto</div>`;

  if (account) {
    html += `<div class="card">
      <div style="font-size:0.85rem;color:var(--text-light)">Angemeldet als</div>
      <div style="font-size:1rem;font-weight:600;margin:4px 0">${esc(account.email)}</div>
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" id="sync-push">☁️ Hochladen</button>
        <button class="btn btn-success btn-sm" id="sync-pull">⬇️ Herunterladen</button>
        <button class="btn btn-ghost btn-sm" id="logout-btn">Abmelden</button>
      </div>
      <div id="sync-status" style="font-size:0.8rem;color:var(--text-light);margin-top:8px"></div>
    </div>`;
  } else {
    html += `<div class="card">
      <div style="margin-bottom:12px;font-size:0.85rem;color:var(--text-light)">
        Melde dich an, um deine Quizze geräteübergreifend zu synchronisieren.
      </div>
      <div class="input-group">
        <label>E-Mail</label>
        <input type="email" id="auth-email" placeholder="email@example.com">
      </div>
      <div class="input-group">
        <label>Passwort</label>
        <input type="password" id="auth-pass" placeholder="Min. 6 Zeichen">
      </div>
      <div id="auth-error" style="color:var(--danger);font-size:0.8rem;margin-bottom:8px"></div>
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" id="login-btn">Anmelden</button>
        <button class="btn btn-ghost btn-sm" id="register-btn">Registrieren</button>
      </div>
    </div>`;
  }

  // Sync code import
  html += `<div class="section-title">Sync-Code Import</div>
    <div class="card">
      <div style="font-size:0.85rem;color:var(--text-light);margin-bottom:8px">
        Hast du einen Sync-Code vom Desktop? Gib ihn hier ein, um Quizze zu laden.
      </div>
      <div class="input-group">
        <label>Sync-Code</label>
        <input type="text" id="sync-code" placeholder="z.B. mein-code-123" value="${esc(settings.syncCode || "")}">
      </div>
      <button class="btn btn-primary btn-sm" id="code-import-btn">Quizze laden</button>
      <div id="code-status" style="font-size:0.8rem;color:var(--text-light);margin-top:8px"></div>
    </div>`;

  // AI Settings
  html += `<div class="section-title">KI-Einstellungen</div>
    <div class="card">
      <div style="font-size:0.85rem;color:var(--text-light);margin-bottom:8px">
        Für KI-Funktionen (Quiz-Generator, Tutor) wird ein OpenRouter API-Key benötigt.
      </div>
      <div class="input-group">
        <label>OpenRouter API-Key</label>
        <input type="password" id="api-key" placeholder="sk-or-..." value="${esc(settings.apiKey || "")}">
      </div>
      <div class="input-group">
        <label>KI-Modell</label>
        <select id="ai-model" style="width:100%;padding:10px;border-radius:var(--radius-md);border:2px solid var(--border);background:var(--input-bg);color:var(--text);font-size:0.9rem">
          ${[
            ["openai/gpt-4o-mini", "GPT-4o Mini (günstig)"],
            ["openai/gpt-4o", "GPT-4o"],
            ["anthropic/claude-sonnet-4-6", "Claude Sonnet 4.6"],
            ["anthropic/claude-haiku-4-5-20251001", "Claude Haiku 4.5 (günstig)"],
            ["google/gemini-2.5-flash", "Gemini 2.5 Flash (günstig)"],
            ["google/gemini-2.5-pro", "Gemini 2.5 Pro"],
            ["deepseek/deepseek-chat-v3", "DeepSeek V3 (sehr günstig)"],
          ].map(([v, l]) => `<option value="${v}" ${(settings.aiModel || "openai/gpt-4o-mini") === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <button class="btn btn-primary btn-sm" id="save-ai">Speichern</button>
      <div id="ai-status" style="font-size:0.8rem;color:var(--text-light);margin-top:8px"></div>
    </div>`;

  // JSON Import
  html += `<div class="section-title">JSON Import</div>
    <div class="card">
      <div style="font-size:0.85rem;color:var(--text-light);margin-bottom:8px">
        Importiere eine Quiz-Datei (.json) vom Desktop.
      </div>
      <input type="file" id="file-import" accept=".json" style="font-size:0.85rem">
      <div id="file-status" style="font-size:0.8rem;color:var(--text-light);margin-top:8px"></div>
    </div>`;

  root.innerHTML = html;

  // Navigation
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));

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
    const file = e.target.files[0];
    const st = root.querySelector("#file-status");
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const { loadQuizzes, saveQuizzes } = await import("../store.js");
      const existing = await loadQuizzes();
      const imported = Array.isArray(data) ? data : data.questions ? [data] : [];
      const merged = [...existing, ...imported];
      await saveQuizzes(merged);
      st.textContent = `✓ ${imported.length} Quiz(ze) importiert!`;
    } catch { st.textContent = "Fehler: Ungültiges Dateiformat."; }
  });
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
