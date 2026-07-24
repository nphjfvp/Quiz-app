// "Trick erkennen"-Modus: Mathe-Aufgaben hochladen, bei denen ein entscheidender
// Kniff (Umformung/Vereinfachung) nötig ist, z.B. quadratische Form in
// Nullstellenform umschreiben, um einen Bruch zu kürzen. Die KI erkennt Aufgabe
// + Trick + kompletten Lösungsweg. Beim Üben: Trick erraten (Freitext,
// semantisch geprüft) → bei richtiger Antwort den Lösungsweg bis zum Trick
// oder bis ganz zum Ende (inkl. Vereinfachungen) in LaTeX anzeigen.
import { loadTrickSets, saveTrickSets, loadSettings } from "../store.js";
import { navigate } from "../router.js";
import { esc, uid, mathEsc, loadPdfJs, getPdfText } from "../utils.js";
import { extractMathTricks, checkTrickGuess, MODELS } from "../ai-service.js";

export async function render(root) {
  const sets = await loadTrickSets();
  const settings = await loadSettings();
  const disabledModels = settings.disabledModels || [];
  const currentModel = settings.aiModel || "";

  let html = `<div class="list-header">
      <div class="section-title" style="margin:0">🕵️ Trick erkennen</div>
    </div>
    <div class="card" style="margin-bottom:10px">
      <p style="font-size:0.85rem;color:var(--text-light);margin:0 0 10px">
        Lade Mathe-Übungsaufgaben hoch (PDF oder Text). Die KI findet Aufgaben mit einem
        entscheidenden <strong>Kniff</strong> — z.B. quadratische Form in Nullstellenform
        umschreiben, um einen Bruch zu kürzen. Beim Üben musst du diesen Trick zuerst
        <strong>erkennen und beschreiben</strong>, bevor du den Lösungsweg siehst.
      </p>
      <div class="input-group">
        <label>Aufgaben hochladen (.txt, .pdf)</label>
        <input type="file" id="tm-file" accept=".txt,.pdf" class="input">
      </div>
      <div class="input-group">
        <label>Oder Text einfügen</label>
        <textarea id="tm-text" class="textarea input" rows="6" placeholder="Übungsaufgaben hier einfügen…"></textarea>
      </div>
      <div class="input-group">
        <label>KI-Modell</label>
        <select id="tm-model" class="input">
          ${MODELS.filter(m => !disabledModels.includes(m.id)).map(m =>
            `<option value="${m.id}" ${m.id === currentModel ? "selected" : ""}>${esc(m.name)} (${m.tier})</option>`
          ).join("")}
        </select>
      </div>
      <div id="tm-progress" style="display:none">
        <div class="progress-bar" style="margin:8px 0"><div id="tm-bar" class="progress-fill" style="width:0%"></div></div>
        <small id="tm-status" style="color:var(--text-light)"></small>
      </div>
      <div id="tm-error" class="error-box" style="display:none"></div>
      <button id="tm-analyze" class="btn btn-primary btn-block" style="margin-top:8px">🔍 Aufgaben analysieren</button>
    </div>`;

  if (!sets.length) {
    html += `<div class="empty">Noch keine Trick-Sets.<br>Lade Übungsaufgaben hoch!</div>`;
  } else {
    html += `<div class="section-title">Deine Trick-Sets</div>`;
    for (const s of sets) {
      const solved = (s.progress || []).filter(p => p.solved).length;
      html += `<div class="card" data-set-id="${s.id}" style="margin-top:8px;cursor:pointer;display:flex;align-items:center;gap:8px">
        <div style="flex:1">
          <strong>${esc(s.name)}</strong>
          <div style="font-size:0.78rem;color:var(--text-light);margin-top:2px">
            ${s.tasks.length} Aufgaben · ${solved}/${s.tasks.length} Tricks erkannt
          </div>
        </div>
        <button class="btn btn-sm btn-primary tm-start" data-id="${s.id}">▶️ Üben</button>
        <button class="btn-icon btn-icon-sm tm-del" data-id="${s.id}" title="Löschen">✕</button>
      </div>`;
    }
  }

  root.innerHTML = html;

  const errorBox = root.querySelector("#tm-error");
  const progressDiv = root.querySelector("#tm-progress");
  const bar = root.querySelector("#tm-bar");
  const statusEl = root.querySelector("#tm-status");
  const modelSel = root.querySelector("#tm-model");
  const textArea = root.querySelector("#tm-text");
  const fileInput = root.querySelector("#tm-file");

  const showError = (msg) => { errorBox.textContent = msg; errorBox.style.display = "block"; };
  const setProgress = (pct, text) => {
    progressDiv.style.display = "block";
    bar.style.width = pct + "%";
    statusEl.textContent = text;
  };

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    errorBox.style.display = "none";
    if (file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = () => { textArea.value = reader.result; };
      reader.readAsText(file);
      return;
    }
    if (file.name.endsWith(".pdf")) {
      setProgress(5, "Extrahiere PDF-Text…");
      try {
        await loadPdfJs();
        const pages = await getPdfText(file);
        textArea.value = pages.map(p => p.text).join("\n\n").trim();
        progressDiv.style.display = "none";
      } catch (err) {
        progressDiv.style.display = "none";
        showError("PDF konnte nicht gelesen werden: " + (err.message || err));
      }
    }
  });

  root.querySelector("#tm-analyze").addEventListener("click", async () => {
    const text = textArea.value.trim();
    if (text.length < 30) { showError("Bitte Aufgaben hochladen oder einfügen (mindestens 30 Zeichen)."); return; }
    errorBox.style.display = "none";
    const btn = root.querySelector("#tm-analyze");
    btn.disabled = true;
    btn.textContent = "⏳ Analysiere…";
    setProgress(5, "Suche nach Aufgaben mit Trick…");

    try {
      const model = modelSel.value;
      const tasks = await extractMathTricks(text, { model }, (i, n, label) => {
        setProgress(10 + 80 * i / n, `${label} (Abschnitt ${i}/${n})…`);
      });
      if (!tasks.length) {
        throw new Error("Keine Aufgaben mit erkennbarem Trick gefunden. Versuche ein anderes Übungsblatt oder mehr Text.");
      }
      const set = {
        id: uid(), createdAt: Date.now(),
        name: `Trick-Set (${tasks.length} Aufgaben)`,
        tasks, progress: tasks.map(() => ({ solved: false, attempts: 0 })),
      };
      const all = await loadTrickSets();
      all.unshift(set);
      await saveTrickSets(all);
      setProgress(100, "✓ Fertig!");
      render(root);
    } catch (err) {
      progressDiv.style.display = "none";
      showError(err.message || "Analyse fehlgeschlagen.");
      btn.disabled = false;
      btn.textContent = "🔍 Aufgaben analysieren";
    }
  });

  root.querySelectorAll(".tm-del").forEach(b => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Trick-Set wirklich löschen?")) return;
      const all = await loadTrickSets();
      await saveTrickSets(all.filter(x => x.id !== b.dataset.id));
      render(root);
    });
  });
  async function openSet(id) {
    const all = await loadTrickSets();
    const set = all.find(x => x.id === id);
    if (set) practiceSet(root, set, modelSel.value);
  }
  root.querySelectorAll(".tm-start").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openSet(btn.dataset.id); });
  });
  root.querySelectorAll("[data-set-id]").forEach(card => {
    card.addEventListener("click", () => openSet(card.dataset.setId));
  });
}

function practiceSet(root, set, model) {
  let idx = set.progress.findIndex(p => !p.solved);
  if (idx < 0) idx = 0;

  function showTask() {
    const task = set.tasks[idx];
    const prog = set.progress[idx];
    const total = set.tasks.length;

    root.innerHTML = `
      <div class="editor-header">
        <button class="btn-icon back-btn" id="tm-quit">←</button>
        <h2 style="font-size:1rem">${esc(set.name)}</h2>
        <span style="font-size:0.8rem;color:var(--text-light)">${idx + 1}/${total}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${(set.progress.filter(p => p.solved).length / total) * 100}%"></div></div>

      <div class="card" style="margin-top:10px">
        <div style="font-size:0.95rem">${mathEsc(task.text || "")}</div>
      </div>

      <div class="card" style="margin-top:10px;background:var(--primary-subtle)">
        <div style="font-size:0.82rem;color:var(--text)"><strong>💡 Hinweis:</strong> ${mathEsc(task.trick_hint || "Welchen Kniff brauchst du hier, um effizient zur Lösung zu kommen?")}</div>
      </div>

      <div class="input-group" style="margin-top:10px">
        <label>Welchen Trick erkennst du? Beschreibe ihn.</label>
        <textarea id="tm-guess" class="textarea input" rows="3" placeholder="z.B. „Quadratische Form in Nullstellenform umschreiben, dann kürzt sich der Bruch"…"></textarea>
      </div>
      <div id="tm-feedback" style="display:none;margin-top:8px" class="card"></div>
      <div id="tm-solution" style="display:none;margin-top:10px"></div>

      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-ghost" id="tm-skip">Überspringen</button>
        <button class="btn btn-primary" id="tm-check" style="flex:1">✓ Prüfen</button>
      </div>
      <div class="btn-row" id="tm-nav-row" style="display:none;margin-top:8px">
        <button class="btn btn-ghost" id="tm-prev" ${idx === 0 ? "disabled" : ""}>← Zurück</button>
        <button class="btn btn-primary" id="tm-next" style="flex:1">${idx < total - 1 ? "Weiter →" : "Fertig 🎉"}</button>
      </div>`;

    const guessEl = root.querySelector("#tm-guess");
    const feedbackEl = root.querySelector("#tm-feedback");
    const solutionEl = root.querySelector("#tm-solution");
    const checkBtn = root.querySelector("#tm-check");
    const navRow = root.querySelector("#tm-nav-row");

    root.querySelector("#tm-quit").addEventListener("click", () => navigate("trick-mode"));
    root.querySelector("#tm-prev")?.addEventListener("click", () => { if (idx > 0) { idx--; showTask(); } });
    root.querySelector("#tm-next")?.addEventListener("click", async () => {
      if (idx < total - 1) { idx++; showTask(); }
      else { await persistProgress(); navigate("trick-mode"); }
    });

    // Bereits gelöste Aufgaben: Lösungsweg direkt anzeigen, kein erneutes Raten nötig
    if (prog.solved) {
      checkBtn.style.display = "none";
      root.querySelector("#tm-skip").style.display = "none";
      guessEl.disabled = true;
      renderSolution(solutionEl, task, true);
      navRow.style.display = "flex";
      return;
    }

    root.querySelector("#tm-skip").addEventListener("click", () => {
      // Aufgeben zeigt direkt die Lösung, zählt nicht als "erkannt"
      checkBtn.disabled = true;
      root.querySelector("#tm-skip").disabled = true;
      renderSolution(solutionEl, task, false);
      navRow.style.display = "flex";
    });

    checkBtn.addEventListener("click", async () => {
      const guess = guessEl.value.trim();
      if (!guess) return;
      checkBtn.disabled = true;
      checkBtn.textContent = "⏳ Prüfe…";
      feedbackEl.style.display = "block";
      feedbackEl.style.background = "";
      feedbackEl.innerHTML = `<span style="color:var(--text-light)">Prüfe deine Antwort…</span>`;
      try {
        const result = await checkTrickGuess(task, guess, { model });
        prog.attempts = (prog.attempts || 0) + 1;
        if (result.correct) {
          prog.solved = true;
          feedbackEl.style.borderLeft = "4px solid var(--success)";
          feedbackEl.innerHTML = `<strong style="color:var(--success)">✓ Richtig erkannt!</strong><div style="font-size:0.85rem;margin-top:4px">${mathEsc(result.feedback || "")}</div>`;
          renderSolution(solutionEl, task, true);
          navRow.style.display = "flex";
          checkBtn.style.display = "none";
          root.querySelector("#tm-skip").style.display = "none";
          await persistProgress();
        } else {
          feedbackEl.style.borderLeft = "4px solid var(--danger)";
          feedbackEl.innerHTML = `<strong style="color:var(--danger)">✗ Noch nicht ganz.</strong><div style="font-size:0.85rem;margin-top:4px">${mathEsc(result.feedback || "")}</div>`;
          checkBtn.disabled = false;
          checkBtn.textContent = "✓ Prüfen";
        }
      } catch (err) {
        feedbackEl.innerHTML = `<span style="color:var(--danger)">Fehler: ${esc(err.message || "Prüfung fehlgeschlagen.")}</span>`;
        checkBtn.disabled = false;
        checkBtn.textContent = "✓ Prüfen";
      }
    });
  }

  // steps mit Toggle: nur bis zum Trick-Schritt vs. kompletter Weg bis Ende (inkl. Vereinfachungen)
  function renderSolution(el, task, revealed) {
    if (!revealed) {
      el.style.display = "block";
      el.innerHTML = `<div class="card"><div style="font-size:0.85rem;color:var(--text-light)">Lösungsweg wird nach richtiger Antwort oder Überspringen angezeigt.</div></div>`;
      return;
    }
    const steps = task.steps || [];
    const trickIdx = steps.findIndex(s => s.isTrickStep);
    let showFull = false;

    function draw() {
      const visible = (!showFull && trickIdx >= 0) ? steps.slice(0, trickIdx + 1) : steps;
      el.innerHTML = `
        <div class="card">
          <div style="font-size:0.85rem;font-weight:600;margin-bottom:6px">🎯 Trick: ${esc(task.trick_name || "")}</div>
          <div style="font-size:0.85rem;color:var(--text-light);margin-bottom:10px">${mathEsc(task.trick_explanation || "")}</div>
          <div style="font-size:0.85rem;font-weight:600;margin-bottom:6px">📝 Lösungsweg</div>
          ${visible.map((s, i) => `<div style="margin:6px 0;padding:6px 8px;border-radius:6px;${s.isTrickStep ? "background:var(--primary-subtle);border-left:3px solid var(--primary)" : ""}">
            <span style="font-size:0.78rem;color:var(--text-light)">Schritt ${i + 1}${s.isTrickStep ? " · Trick angewendet hier" : ""}</span>
            <div>${mathEsc(s.text || "")}</div>
          </div>`).join("")}
          ${(!showFull && trickIdx >= 0 && trickIdx < steps.length - 1)
            ? `<button class="btn btn-sm btn-ghost" id="tm-show-full" style="margin-top:6px">👁️ Ganzen Weg bis zum Ende zeigen</button>`
            : `<div style="margin-top:8px;font-size:0.9rem"><strong>Endergebnis:</strong> ${mathEsc(task.finalAnswer || "")}</div>`}
        </div>`;
      el.querySelector("#tm-show-full")?.addEventListener("click", () => { showFull = true; draw(); });
    }
    el.style.display = "block";
    draw();
  }

  async function persistProgress() {
    try {
      const all = await loadTrickSets();
      const s = all.find(x => x.id === set.id);
      if (s) { s.progress = set.progress; await saveTrickSets(all); }
    } catch (_) {}
  }

  showTask();
}
