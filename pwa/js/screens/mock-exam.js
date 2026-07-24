// Probeklausur-Modus: Klausur-PDF hochladen → KI erkennt alle Aufgaben (mit
// Screenshot-Ausschnitt, Punkten, Typ), löst sie und verifiziert die Lösungen
// in einem zweiten unabhängigen KI-Aufruf. Danach: Klausur durchspielen,
// Antworten unter dem Aufgaben-Screenshot eingeben, KI bewertet mit
// Teilpunkten, zeigt Lösungswege bei Fehlern und errechnet die Note.
// Extras: Mix-Klausuren aus mehreren Uploads, KI-generierte Klausuren im
// Stil einer Vorlage (experimentell).
import { loadMockExams, saveMockExams, loadSettings } from "../store.js";
import { esc, escAttr, uid, mathEsc, loadPdfJs } from "../utils.js";
import {
  analyzeExamPages, solveExamTask, verifyExamSolution,
  gradeExamAnswer, generateExamInStyle, askTutor, MODELS,
} from "../ai-service.js";

// Standard-Notenschlüssel (Prozent → Note)
const GRADE_SCALE = [
  [95, "1,0"], [90, "1,3"], [85, "1,7"], [80, "2,0"], [75, "2,3"],
  [70, "2,7"], [65, "3,0"], [60, "3,3"], [55, "3,7"], [50, "4,0"], [0, "5,0"],
];
function toGrade(pct) {
  for (const [min, grade] of GRADE_SCALE) if (pct >= min) return grade;
  return "5,0";
}

const TYPE_LABELS = { calc: "🔢 Rechnen", proof: "📐 Beweis", text: "📝 Erklärung", draw: "✏️ Zeichnen", multiple_choice: "☑️ Choice" };

export async function render(root) {
  const exams = await loadMockExams();
  const settings = await loadSettings();
  const disabledModels = settings.disabledModels || [];
  const currentModel = settings.aiModel || "";

  let html = `<div class="list-header">
      <div class="section-title" style="margin:0">🎓 Probeklausuren</div>
    </div>
    <div class="card" style="margin-bottom:10px">
      <p style="font-size:0.85rem;color:var(--text-light);margin:0 0 10px">
        Lade eine Probeklausur (PDF) hoch. Die KI erkennt alle Aufgaben, löst sie und
        <strong>verifiziert jede Lösung in einem zweiten Prüf-Durchlauf</strong>. Danach kannst du
        die Klausur unter realen Bedingungen durchspielen — am Ende gibt es Punkte, Note und
        Lösungswege für deine Fehler.
      </p>
      <div class="input-group">
        <label>Klausur-PDF hochladen</label>
        <input type="file" id="me-file" accept=".pdf" class="input">
      </div>
      <div class="input-group">
        <label>KI-Modell (Vision empfohlen)</label>
        <select id="me-model" class="input">
          ${MODELS.filter(m => !disabledModels.includes(m.id)).map(m =>
            `<option value="${m.id}" ${m.id === currentModel ? "selected" : ""}>${esc(m.name)} (${m.tier}${m.vision ? " · Vision" : ""})</option>`
          ).join("")}
        </select>
      </div>
      <div id="me-progress" style="display:none">
        <div class="progress-bar" style="margin:8px 0"><div id="me-bar" class="progress-fill" style="width:0%"></div></div>
        <small id="me-status" style="color:var(--text-light)"></small>
      </div>
      <div id="me-error" class="error-box" style="display:none"></div>
    </div>`;

  if (exams.length >= 2) {
    html += `<button class="btn btn-secondary btn-block" id="me-mix" style="margin-bottom:8px">🔀 Mix-Klausur aus allen Uploads erstellen</button>`;
  }

  if (!exams.length) {
    html += `<div class="empty">Noch keine Probeklausuren.<br>Lade eine PDF hoch!</div>`;
  } else {
    html += `<div class="section-title">Deine Klausuren</div>`;
    for (const ex of exams) {
      const best = (ex.attempts || []).reduce((b, a) => (a.pct > (b?.pct ?? -1) ? a : b), null);
      const kindBadge = ex.kind === "mix" ? "🔀 Mix" : ex.kind === "generated" ? "🤖 Generiert" : "📄 Original";
      html += `<div class="card" data-exam-id="${ex.id}" style="margin-top:8px;cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1">
            <strong>${esc(ex.name)}</strong>
            <div style="font-size:0.78rem;color:var(--text-light);margin-top:2px">
              ${kindBadge} · ${ex.tasks.length} Aufgaben · ${ex.style?.totalPoints || "?"} Punkte
              ${ex.style?.subject ? " · " + esc(ex.style.subject) : ""}
              ${best ? ` · Beste Note: <strong>${best.grade}</strong>` : ""}
            </div>
          </div>
          <button class="btn btn-sm btn-primary me-start" data-id="${ex.id}">▶️ Üben</button>
          ${ex.kind !== "generated" ? `<button class="btn-icon btn-icon-sm me-gen" data-id="${ex.id}" title="Neue Klausur in diesem Stil (experimentell)">🤖</button>` : ""}
          <button class="btn-icon btn-icon-sm me-del" data-id="${ex.id}" title="Löschen">✕</button>
        </div>
      </div>`;
    }
  }

  root.innerHTML = html;

  const errorBox = root.querySelector("#me-error");
  const progressDiv = root.querySelector("#me-progress");
  const bar = root.querySelector("#me-bar");
  const statusEl = root.querySelector("#me-status");
  const modelSel = root.querySelector("#me-model");

  const showError = (msg) => { errorBox.textContent = msg; errorBox.style.display = "block"; };
  const setProgress = (pct, text) => {
    progressDiv.style.display = "block";
    bar.style.width = pct + "%";
    statusEl.textContent = text;
  };

  // ── Upload & Analyse-Pipeline ──────────────────────────────────────────
  root.querySelector("#me-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    errorBox.style.display = "none";
    const model = modelSel.value;

    try {
      // 1) PDF-Seiten als Bilder rendern
      setProgress(5, "Rendere PDF-Seiten…");
      const pdfjsLib = await loadPdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const pageCount = Math.min(pdf.numPages, 15);
      const pages = [];
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        pages.push(canvas);
        setProgress(5 + 15 * i / pageCount, `Rendere Seite ${i}/${pageCount}…`);
      }
      const pageUrls = pages.map(c => c.toDataURL("image/jpeg", 0.8));

      // 2) Aufgaben + Metadaten erkennen (Vision)
      setProgress(22, "Erkenne Aufgaben…");
      const { style, tasks } = await analyzeExamPages(pageUrls, {
        model, onProgress: (i, n) => setProgress(22 + 18 * i / n, `Analysiere Seiten-Batch ${i}/${n}…`),
      });
      if (!tasks.length) throw new Error("Keine Aufgaben erkannt — ist das eine Klausur-PDF?");

      // 3) Screenshot-Ausschnitt pro Aufgabe aus der Seite schneiden
      for (const t of tasks) {
        const canvas = pages[Math.min(Math.max((t.page || 1) - 1, 0), pages.length - 1)];
        t.image = cropTask(canvas, t.yStart, t.yEnd);
        delete t.yStart; delete t.yEnd;
      }

      // 4) Jede Aufgabe lösen + im zweiten Durchlauf verifizieren
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        setProgress(40 + 55 * i / tasks.length, `Löse Aufgabe ${t.number} (${i + 1}/${tasks.length})…`);
        const sol = await solveExamTask(t, t.image, { model });
        setProgress(40 + 55 * (i + 0.5) / tasks.length, `Verifiziere Aufgabe ${t.number}…`);
        const v = await verifyExamSolution(t, sol, { model });
        t.solution = {
          finalAnswer: v.finalAnswer, steps: v.steps || [], keyPoints: sol.keyPoints || [],
          describeOnly: !!sol.describeOnly, verified: v.verified, corrected: v.corrected,
          verifyNote: v.verifyNote || "",
        };
      }

      // 5) Speichern
      const exam = {
        id: uid(), kind: "original", createdAt: Date.now(),
        name: style.title || file.name.replace(/\.pdf$/i, ""),
        style, tasks, attempts: [],
      };
      const all = await loadMockExams();
      all.unshift(exam);
      await saveMockExams(all);
      setProgress(100, "✓ Fertig!");
      render(root);
    } catch (err) {
      progressDiv.style.display = "none";
      showError(err.message || "Analyse fehlgeschlagen.");
    }
  });

  // ── Mix-Klausur ────────────────────────────────────────────────────────
  root.querySelector("#me-mix")?.addEventListener("click", async () => {
    const all = await loadMockExams();
    const sources = all.filter(e => e.kind === "original");
    if (sources.length < 2) { showError("Mindestens 2 hochgeladene Klausuren nötig."); return; }
    // Aufgaben nach Typ gruppieren und ausgewogen ziehen (Struktur der ersten Klausur als Richtwert)
    const byType = {};
    for (const ex of sources) for (const t of ex.tasks) {
      (byType[t.type || "text"] ||= []).push({ ...t, _src: ex.name });
    }
    const targetCount = Math.max(...sources.map(e => e.tasks.length));
    const picked = [];
    const types = Object.keys(byType);
    let ti = 0;
    while (picked.length < targetCount && types.some(t => byType[t].length)) {
      const pool = byType[types[ti % types.length]];
      ti++;
      if (!pool.length) continue;
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    picked.forEach((t, i) => { t.number = String(i + 1); });
    const exam = {
      id: uid(), kind: "mix", createdAt: Date.now(),
      name: `Mix-Klausur (${sources.length} Quellen)`,
      style: {
        subject: sources[0].style?.subject || "",
        totalPoints: picked.reduce((s, t) => s + (Number(t.points) || 0), 0),
        styleNotes: "Gemischt aus: " + sources.map(s => s.name).join(", "),
      },
      tasks: picked, attempts: [],
    };
    all.unshift(exam);
    await saveMockExams(all);
    render(root);
  });

  // ── KI-Klausur im Stil (experimentell) ─────────────────────────────────
  root.querySelectorAll(".me-gen").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const all = await loadMockExams();
      const src = all.find(x => x.id === btn.dataset.id);
      if (!src) return;
      if (!confirm(`Neue Klausur im Stil von „${src.name}" generieren? (experimentell — Lösungen werden ebenfalls erzeugt und verifiziert)`)) return;
      const model = modelSel.value;
      errorBox.style.display = "none";
      try {
        setProgress(10, "Generiere Klausur im Stil…");
        const gen = await generateExamInStyle(src, { model });
        const tasks = gen.tasks.map((t, i) => ({
          number: t.number || String(i + 1), text: t.text, type: t.type || "calc",
          points: Number(t.points) || 2, pointsEstimated: true,
          solvable: t.solvable !== false, image: null, page: 0,
        }));
        for (let i = 0; i < tasks.length; i++) {
          setProgress(20 + 70 * i / tasks.length, `Löse & verifiziere Aufgabe ${tasks[i].number}…`);
          const sol = await solveExamTask(tasks[i], null, { model });
          const v = await verifyExamSolution(tasks[i], sol, { model });
          tasks[i].solution = {
            finalAnswer: v.finalAnswer, steps: v.steps || [], keyPoints: sol.keyPoints || [],
            describeOnly: !!sol.describeOnly, verified: v.verified, corrected: v.corrected, verifyNote: v.verifyNote || "",
          };
        }
        const exam = {
          id: uid(), kind: "generated", createdAt: Date.now(),
          name: gen.title || `${src.name} (KI-Variante)`,
          style: { ...src.style, totalPoints: tasks.reduce((s, t) => s + t.points, 0) },
          tasks, attempts: [],
        };
        all.unshift(exam);
        await saveMockExams(all);
        render(root);
      } catch (err) {
        progressDiv.style.display = "none";
        showError(err.message || "Generierung fehlgeschlagen.");
      }
    });
  });

  // ── Löschen / Starten ──────────────────────────────────────────────────
  root.querySelectorAll(".me-del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Klausur wirklich löschen?")) return;
      const all = await loadMockExams();
      await saveMockExams(all.filter(x => x.id !== btn.dataset.id));
      render(root);
    });
  });
  root.querySelectorAll(".me-start").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const all = await loadMockExams();
      const ex = all.find(x => x.id === btn.dataset.id);
      if (ex) runExam(root, ex, modelSel.value);
    });
  });
}

// Schneidet den Aufgaben-Bereich (yStart..yEnd) mit Rand aus der Seiten-Canvas.
function cropTask(canvas, yStart, yEnd) {
  const pad = 0.02;
  let y0 = Math.max(0, (Number(yStart) || 0) - pad);
  let y1 = Math.min(1, (Number(yEnd) || 1) + pad);
  // Vision-Modelle liefern gelegentlich vertauschte Werte → sortieren,
  // sonst entsteht eine negative Canvas-Höhe und der Crop schlägt fehl.
  if (y1 < y0) [y0, y1] = [y1, y0];
  if (y1 - y0 < 0.1) { y0 = Math.max(0, y0 - 0.05); y1 = Math.min(1, y1 + 0.05); } // Mindesthöhe
  const h = Math.round((y1 - y0) * canvas.height);
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = h;
  out.getContext("2d").drawImage(canvas, 0, Math.round(y0 * canvas.height), canvas.width, h, 0, 0, canvas.width, h);
  return out.toDataURL("image/jpeg", 0.8);
}

// ── Übungsmodus: Klausur durchspielen ─────────────────────────────────────
function runExam(root, exam, model) {
  const answers = {}; // taskId-index → Text
  let idx = 0;

  function showTask() {
    const t = exam.tasks[idx];
    const total = exam.tasks.length;
    root.innerHTML = `
      <div class="editor-header">
        <button class="btn-icon back-btn" id="me-quit">✕</button>
        <h2 style="font-size:1rem">${esc(exam.name)}</h2>
        <span style="font-size:0.8rem;color:var(--text-light)">${idx + 1}/${total}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${(idx / total) * 100}%"></div></div>

      <div class="card" style="margin-top:10px">
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--text-light);margin-bottom:6px">
          <span>Aufgabe ${esc(t.number)} · ${TYPE_LABELS[t.type] || t.type}</span>
          <span>${t.points} P${t.pointsEstimated ? " (geschätzt)" : ""}</span>
        </div>
        ${t.image
          ? `<img src="${escAttr(t.image)}" alt="Aufgabe ${escAttr(t.number)}" style="width:100%;border-radius:8px;border:1px solid var(--border)">`
          : `<div style="font-size:0.95rem">${mathEsc(t.text || "")}</div>`}
        ${t.solvable === false || t.solution?.describeOnly
          ? `<div style="font-size:0.78rem;color:var(--warning);margin-top:6px">✏️ Zeichen-/Skizzen-Aufgabe: beschreibe deine Lösung in Worten.</div>` : ""}
      </div>

      <div class="input-group" style="margin-top:10px">
        <label>Deine Lösung</label>
        <textarea id="me-answer" class="textarea input" rows="5" placeholder="Lösung / Lösungsweg hier eingeben…">${esc(answers[idx] || "")}</textarea>
      </div>
      <div id="me-kb-wrap"></div>

      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-ghost" id="me-prev" ${idx === 0 ? "disabled" : ""}>← Zurück</button>
        ${idx < total - 1
          ? `<button class="btn btn-primary" id="me-next" style="flex:1">Weiter →</button>`
          : `<button class="btn btn-success" id="me-submit" style="flex:1">✅ Abgeben &amp; bewerten</button>`}
      </div>`;

    const answerEl = root.querySelector("#me-answer");
    answerEl.addEventListener("input", () => { answers[idx] = answerEl.value; });
    // Mathe-Tastatur für Formel-Eingaben
    import("../math-keyboard.js").then(({ createMathKeyboard }) => {
      const wrap = root.querySelector("#me-kb-wrap");
      if (wrap) createMathKeyboard(wrap, { target: answerEl });
    }).catch(() => {});

    root.querySelector("#me-quit").addEventListener("click", () => {
      if (confirm("Klausur abbrechen? Eingaben gehen verloren.")) render(root);
    });
    root.querySelector("#me-prev")?.addEventListener("click", () => { if (idx > 0) { idx--; showTask(); } });
    root.querySelector("#me-next")?.addEventListener("click", () => { idx++; showTask(); });
    root.querySelector("#me-submit")?.addEventListener("click", () => gradeAll());
  }

  async function gradeAll() {
    root.innerHTML = `<div class="card" style="margin-top:30px;text-align:center">
      <div style="font-size:2rem">🧑‍🏫</div>
      <div style="font-weight:700;margin:8px 0">Korrigiere deine Klausur…</div>
      <div class="progress-bar" style="max-width:260px;margin:10px auto"><div id="me-gbar" class="progress-fill" style="width:0%"></div></div>
      <small id="me-gstatus" style="color:var(--text-light)"></small>
    </div>`;
    const gbar = root.querySelector("#me-gbar");
    const gstatus = root.querySelector("#me-gstatus");

    const results = [];
    for (let i = 0; i < exam.tasks.length; i++) {
      const t = exam.tasks[i];
      gbar.style.width = (100 * i / exam.tasks.length) + "%";
      gstatus.textContent = `Aufgabe ${t.number} (${i + 1}/${exam.tasks.length})…`;
      try {
        const g = await gradeExamAnswer(t, t.solution || {}, answers[i] || "", { model });
        results.push({ task: t, answer: answers[i] || "", ...g });
      } catch {
        results.push({ task: t, answer: answers[i] || "", score: 0, maxScore: Number(t.points) || 1, verdict: "wrong", feedback: "Bewertung fehlgeschlagen." });
      }
    }

    const totalScore = results.reduce((s, r) => s + r.score, 0);
    const maxScore = results.reduce((s, r) => s + (Number(r.task.points) || 1), 0);
    const pct = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    const grade = toGrade(pct);
    const anyEstimated = exam.tasks.some(t => t.pointsEstimated);

    // Versuch speichern
    try {
      const all = await loadMockExams();
      const ex = all.find(x => x.id === exam.id);
      if (ex) {
        (ex.attempts ||= []).push({ date: Date.now(), totalScore, maxScore, pct, grade });
        await saveMockExams(all);
      }
    } catch (_) {}

    showResults(results, totalScore, maxScore, pct, grade, anyEstimated);
  }

  function showResults(results, totalScore, maxScore, pct, grade, anyEstimated) {
    const gradeColor = pct >= 80 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--danger)";
    let html = `
      <div class="result-hero" style="background:${gradeColor}">
        <div style="font-size:0.9rem;opacity:0.9">${esc(exam.name)}</div>
        <div class="pct" style="font-size:2.6rem">Note ${grade}</div>
        <div class="subtitle">${totalScore.toFixed(1)} / ${maxScore} Punkte (${pct}%)</div>
        ${anyEstimated ? `<div style="font-size:0.72rem;opacity:0.85;margin-top:4px">⚠️ Punktzahlen teilweise von der KI geschätzt</div>` : ""}
      </div>
      <div class="section-title" style="margin-top:14px">Aufgaben im Detail</div>`;

    results.forEach((r, i) => {
      const icon = r.verdict === "correct" ? "✅" : r.verdict === "partial" ? "🟡" : "❌";
      const sol = r.task.solution || {};
      html += `<div class="card" style="margin-top:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${icon} Aufgabe ${esc(r.task.number)}</strong>
          <span style="font-size:0.85rem">${r.score.toFixed(1)} / ${r.task.points} P</span>
        </div>
        <div style="font-size:0.83rem;color:var(--text-light);margin-top:4px">${mathEsc(r.feedback || "")}</div>
        ${r.verdict !== "correct" ? `
          <details style="margin-top:8px">
            <summary style="cursor:pointer;font-size:0.85rem;color:var(--primary)">💡 ${sol.describeOnly ? "Erwartete Lösung (Beschreibung)" : "Mein Lösungsweg"}${sol.verified === false ? " (unverifiziert)" : ""}</summary>
            <div style="font-size:0.85rem;margin-top:6px">
              ${sol.finalAnswer ? `<div style="margin-bottom:6px"><strong>Ergebnis:</strong> ${mathEsc(sol.finalAnswer)}</div>` : ""}
              ${(sol.steps || []).map((s, si) => `<div style="margin:3px 0">${si + 1}. ${mathEsc(s)}</div>`).join("")}
              ${sol.verifyNote ? `<div style="font-size:0.75rem;color:var(--warning);margin-top:4px">🔎 Verifikation korrigierte: ${esc(sol.verifyNote)}</div>` : ""}
            </div>
          </details>` : ""}
        <button class="btn btn-sm btn-ghost me-ask" data-idx="${i}" style="margin-top:6px">💬 Frage zu dieser Aufgabe</button>
        <div class="me-chat" data-idx="${i}" style="display:none;margin-top:8px"></div>
      </div>`;
    });

    html += `<div class="btn-row" style="margin-top:12px">
      <button class="btn btn-warning" id="me-retry">🔁 Nochmal</button>
      <button class="btn btn-primary" id="me-back" style="flex:1">Fertig</button>
    </div>`;

    root.innerHTML = html;
    root.querySelector("#me-retry").addEventListener("click", () => runExam(root, exam, model));
    root.querySelector("#me-back").addEventListener("click", () => render(root));

    // Rückfragen-Chat pro Aufgabe (Tutor mit Aufgaben-Kontext)
    root.querySelectorAll(".me-ask").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.idx);
        const chatEl = root.querySelector(`.me-chat[data-idx="${i}"]`);
        if (chatEl.style.display === "none") {
          chatEl.style.display = "block";
          if (!chatEl.dataset.init) { initChat(chatEl, results[i]); chatEl.dataset.init = "1"; }
        } else {
          chatEl.style.display = "none";
        }
      });
    });
  }

  function initChat(el, r) {
    el.innerHTML = `
      <div class="me-chat-msgs" style="max-height:220px;overflow-y:auto"></div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input type="text" class="input me-chat-in" placeholder="Frage zur Aufgabe…" style="flex:1">
        <button class="btn btn-sm btn-primary me-chat-send">▶</button>
      </div>`;
    const msgs = el.querySelector(".me-chat-msgs");
    const input = el.querySelector(".me-chat-in");
    const history = [];
    const sol = r.task.solution || {};
    const context = `Du hilfst bei einer Klausur-Aufgabe. Beziehe dich auf diese Daten:
Aufgabe ${r.task.number}: ${r.task.text}
Musterlösung: ${sol.finalAnswer || "?"} — Weg: ${(sol.steps || []).join(" | ")}
Antwort des Studierenden: ${r.answer || "(leer)"} (Bewertung: ${r.score}/${r.task.points} P, ${r.feedback})
Erkläre geduldig und konkret. Formeln in LaTeX ($...$).`;

    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      msgs.innerHTML += `<div class="tutor-bubble user" style="font-size:0.85rem">${esc(text)}</div>`;
      msgs.scrollTop = msgs.scrollHeight;
      const typing = document.createElement("div");
      typing.className = "tutor-bubble assistant";
      typing.textContent = "…";
      msgs.appendChild(typing);
      try {
        const reply = await askTutor(text, context, history);
        history.push({ role: "user", content: text }, { role: "assistant", content: reply });
        typing.innerHTML = mathEsc(reply);
      } catch (err) {
        typing.textContent = "Fehler: " + (err.message || "?");
      }
      msgs.scrollTop = msgs.scrollHeight;
    };
    el.querySelector(".me-chat-send").addEventListener("click", send);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  }

  showTask();
}
