// Formel-Training (Scaffolding) — PWA
// Upload a math PDF/text → AI extracts sub-tasks → AI solves them step by step
// (multi-step calc_chain) → practice with 4 graduated stages.

import { navigate } from "../router.js";
import { esc, mathEsc } from "../utils.js";
import { loadMathTasks, saveMathTasks, logAnswer,
         loadErrorDiary, saveErrorDiary, loadFsrs, saveFsrs, loadSettings } from "../store.js";
import { extractMathTasks, solveMathTasks, generateSimilarTasks } from "../ai-service.js";
import { newCard, review as fsrsReview } from "../fsrs.js";

const STAGE_NAMES = { 1: "Geführte Formel", 2: "Struktur-Vorlage", 3: "Formel-Recall", 4: "Lineare Eingabe" };
const STAGE_ICONS = { 1: "📝", 2: "🧩", 3: "🧠", 4: "✍️" };
const STAGE_DESCS = {
  1: "Formel + Werte angezeigt. Trage jeden Wert ein und berechne das Ergebnis.",
  2: "Formel mit □-Platzhaltern. Fülle die Felder aus, dann löse.",
  3: "Benenne die benötigte Formel, dann weiter wie Stufe 2.",
  4: "Tippe die komplette Lösung bzw. das Ergebnis – mit gestufter Hilfe.",
};
const EPS = 0.02;

// ── Answer checking (mirrors src/mathutils.py) ──
function normNum(s) {
  s = String(s).trim().replace(/\s+/g, "");
  if (s.includes(",") && !s.includes(";")) s = s.replace(",", ".");
  return s;
}
function validateNumeric(val, correct) {
  const u = parseFloat(normNum(val));
  if (Number.isNaN(u)) return false;
  const list = Array.isArray(correct) ? correct : [correct];
  return list.some((c) => {
    const cv = parseFloat(c);
    return !Number.isNaN(cv) && Math.abs(Math.round(u * 100) / 100 - Math.round(cv * 100) / 100) <= EPS;
  });
}
function evalExpr(raw) {
  if (!raw || !String(raw).trim()) return null;
  let s = normNum(raw).replace(/\^/g, "**").replace(/wrzl|√/g, "sqrt");
  s = s.replace(/(\d)([a-zA-Z(])/g, "$1*$2");
  if (s.includes("=")) s = s.split("=").pop();
  // allow only safe characters + a few functions
  if (!/^[0-9.+\-*/() a-z]*$/i.test(s)) return null;
  s = s.replace(/sqrt/g, "Math.sqrt").replace(/\bpi\b/g, "Math.PI").replace(/\babs\b/g, "Math.abs");
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict";return (${s});`)();
    return typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : null;
  } catch { return null; }
}
function checkAnswer(val, numeric, text) {
  if (val == null || String(val).trim() === "") return false;
  if (numeric && numeric.length && validateNumeric(val, numeric)) return true;
  if (text) {
    const cv = parseFloat(normNum(text));
    if (!Number.isNaN(cv)) {
      if (validateNumeric(val, cv)) return true;
      const ev = evalExpr(val);
      if (ev != null && validateNumeric(String(ev), cv)) return true;
    }
    if (String(val).trim().toLowerCase() === String(text).trim().toLowerCase()) return true;
  }
  if (numeric && numeric.length) {
    const ev = evalExpr(val);
    if (ev != null && validateNumeric(String(ev), numeric)) return true;
  }
  return false;
}

function taskUid(task) {
  const key = (task.text || "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) { h = (h * 31 + key.charCodeAt(i)) | 0; }
  return "math:" + (h >>> 0).toString(16);
}

async function recordResult(task, correct, setName) {
  try { await logAnswer(!!correct); } catch {}
  if (!correct) {
    try {
      const diary = await loadErrorDiary();
      diary.unshift({
        id: Date.now().toString(36), date: new Date().toISOString(),
        questionText: task.text || "", userAnswer: "(Scaffolding)",
        correctAnswer: task.final_result_text || task.result_text || "",
        topic: task.topic || "Mathe", quizName: setName || "Formel-Training",
      });
      if (diary.length > 500) diary.length = 500;
      await saveErrorDiary(diary);
    } catch {}
  }
  try {
    const settings = await loadSettings();
    if (!settings.use_fsrs && !settings.useFsrs) return;
    const fsrs = await loadFsrs();
    const uid = taskUid(task);
    fsrs[uid] = fsrsReview(fsrs[uid] || newCard(uid), correct ? 3 : 1, 0, 0.5);
    await saveFsrs(fsrs);
  } catch {}
}

function asSingleStep(task) {
  return [{
    step_nr: 1,
    formula_name: task.formula_name || "",
    formula_latex: task.formula_latex || "",
    description: (task.text || "").slice(0, 80),
    inputs: task.variables || Object.entries(task.given || {}).map(([k, v]) => ({ symbol: k, value: v })),
    result_symbol: task.result_symbol || task.sought || "?",
    result_unit: "",
    result_numeric: task.result_numeric || [],
    result_text: task.result_text || "",
    linear_notation: task.linear_notation || "",
  }];
}

// ── Main screen ──
export async function render(root, params = {}) {
  const sets = await loadMathTasks();
  let html = `
    <div class="topbar">
      <button class="btn btn-ghost btn-sm" id="back">← Zurück</button>
      <h2 style="margin:0">🔢 Formel-Training</h2>
    </div>
    <div class="card upload-card" id="import-card" style="border:2px solid var(--primary);cursor:pointer">
      <h3>📄 Mathe-Aufgaben importieren</h3>
      <p style="color:var(--text-light)">PDF/Text hochladen → KI extrahiert & löst alle Aufgaben → in 4 Stufen üben.</p>
    </div>`;

  if (sets.length) {
    html += `<div class="section-title">📦 Gespeicherte Aufgaben-Sets</div>`;
    sets.forEach((s, i) => {
      html += `<div class="quiz-row" data-set="${i}" style="cursor:pointer">
        <div class="quiz-accent"></div>
        <div class="quiz-info"><h4>📐 ${esc(s.name || "Mathe-Set")}</h4>
          <small>${(s.tasks || []).length} Aufgaben</small></div>
        <button class="btn btn-ghost btn-icon-sm" data-del="${i}" title="Löschen">🗑</button>
        <span style="color:var(--text-light)">›</span>
      </div>`;
    });
  } else {
    html += `<div class="empty">Noch keine Mathe-Sets. Lade ein PDF hoch, um zu starten!</div>`;
  }

  root.innerHTML = html;
  root.querySelector("#back").addEventListener("click", () => navigate("home"));
  root.querySelector("#import-card").addEventListener("click", () => showImport(root));
  root.querySelectorAll("[data-set]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-del]")) return;
      showStagePicker(root, sets[parseInt(el.dataset.set)]);
    });
  });
  root.querySelectorAll("[data-del]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const all = await loadMathTasks();
      all.splice(parseInt(el.dataset.del), 1);
      await saveMathTasks(all);
      render(root);
    });
  });
}

// ── Import view ──
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    sc.onload = () => {
      const lib = window.pdfjsLib;
      if (lib) { lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; resolve(lib); }
      else reject(new Error("pdf.js nicht geladen"));
    };
    sc.onerror = () => reject(new Error("pdf.js nicht geladen"));
    document.head.appendChild(sc);
  });
}

function showImport(root) {
  root.innerHTML = `
    <div class="topbar">
      <button class="btn btn-ghost btn-sm" id="back">← Zurück</button>
      <h2 style="margin:0">📄 Mathe-Import</h2>
    </div>
    <div class="card">
      <label>Name des Aufgaben-Sets</label>
      <input type="text" id="set-name" class="input" placeholder="z.B. Analysis Übungsblatt 3">
      <label style="margin-top:12px">Datei (.txt, .pdf) oder Text einfügen</label>
      <input type="file" id="file" accept=".txt,.pdf" class="input">
      <textarea id="text" class="textarea input" rows="6" placeholder="…oder Aufgaben hier einfügen" style="margin-top:8px"></textarea>
      <label style="margin-top:12px">Anweisungen an die KI (optional)</label>
      <input type="text" id="instr" class="input" placeholder='z.B. "Nutze ABC-Formel statt PQ"'>
      <div class="file-progress" id="prog" style="display:none;margin-top:12px">
        <div class="file-track"><div id="bar" class="file-fill"></div></div>
        <small id="info" class="file-info"></small>
      </div>
      <button class="btn btn-primary btn-block" id="go" style="margin-top:16px">🚀 Importieren & Lösen</button>
    </div>`;

  root.querySelector("#back").addEventListener("click", () => render(root));

  let fileText = "";
  root.querySelector("#file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const info = root.querySelector("#info");
    root.querySelector("#prog").style.display = "block";
    info.textContent = "Lese Datei…";
    try {
      if (file.name.endsWith(".pdf")) {
        const lib = await loadPdfJs();
        const ab = await file.arrayBuffer();
        const pdf = await lib.getDocument({ data: ab }).promise;
        let txt = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const c = await page.getTextContent();
          txt += c.items.map((it) => it.str).join(" ") + "\n--- Seite ---\n";
          info.textContent = `Seite ${i}/${pdf.numPages}…`;
        }
        fileText = txt;
      } else {
        fileText = await file.text();
      }
      info.textContent = `✓ ${file.name} geladen (${fileText.length} Zeichen)`;
      if (!root.querySelector("#set-name").value) {
        root.querySelector("#set-name").value = file.name.replace(/\.[^.]+$/, "");
      }
    } catch (err) { info.textContent = "Fehler: " + (err.message || err); }
  });

  root.querySelector("#go").addEventListener("click", async () => {
    const name = root.querySelector("#set-name").value.trim() || "Mathe-Aufgaben";
    const instr = root.querySelector("#instr").value.trim();
    const text = (fileText || root.querySelector("#text").value).trim();
    if (text.length < 10) { alert("Bitte eine Datei laden oder Text einfügen."); return; }

    const prog = root.querySelector("#prog");
    const bar = root.querySelector("#bar");
    const info = root.querySelector("#info");
    const go = root.querySelector("#go");
    prog.style.display = "block";
    go.disabled = true;

    try {
      info.textContent = "Phase 1: Aufgaben extrahieren…";
      const tasks = await extractMathTasks(text, instr, {}, (c, t, p) => {
        info.textContent = `Phase 1: ${p} (${c}/${t})`;
        bar.style.width = `${(c / (t * 2)) * 100}%`;
      });
      if (!tasks.length) { info.textContent = "Keine Aufgaben gefunden."; go.disabled = false; return; }

      const solved = await solveMathTasks(tasks, instr, {}, (c, t, p) => {
        info.textContent = `Phase 2: ${p} (${c}/${t})`;
        bar.style.width = `${50 + (c / (t * 2)) * 100}%`;
      });

      bar.style.width = "100%";
      info.textContent = `✅ ${solved.length} Aufgaben extrahiert und gelöst!`;
      const set = { name, instructions: instr, tasks: solved, created: new Date().toISOString() };
      const all = await loadMathTasks();
      all.push(set);
      await saveMathTasks(all);
      setTimeout(() => showStagePicker(root, set), 700);
    } catch (err) {
      info.textContent = "Fehler: " + (err.message || err);
      go.disabled = false;
    }
  });
}

// ── Stage picker ──
function showStagePicker(root, set) {
  const tasks = set.tasks || [];
  let html = `
    <div class="topbar">
      <button class="btn btn-ghost btn-sm" id="back">← Zurück</button>
      <h2 style="margin:0">📐 ${esc(set.name || "Mathe")}</h2>
    </div>
    <p style="color:var(--text-light)">${tasks.length} Aufgaben · Wähle eine Stufe:</p>
    <div class="grid-2">`;
  for (let s = 1; s <= 4; s++) {
    html += `<div class="grid-card stage-card" data-stage="${s}" style="cursor:pointer">
      <div class="icon">${STAGE_ICONS[s]}</div>
      <div class="title">Stufe ${s}: ${STAGE_NAMES[s]}</div>
      <div class="desc">${STAGE_DESCS[s]}</div>
    </div>`;
  }
  html += `</div>
    <button class="btn btn-secondary btn-block" id="more" style="margin-top:14px">🤖 Mehr Aufgaben generieren</button>
    <div class="section-title">Aufgaben-Übersicht</div>`;
  tasks.slice(0, 25).forEach((t, i) => {
    html += `<div class="quiz-row"><div class="quiz-info">
      <small>${i + 1}. ${esc((t.text || "").slice(0, 90))}${t.formula_name ? " · " + esc(t.formula_name) : ""}</small>
    </div></div>`;
  });
  root.innerHTML = html;
  root.querySelector("#back").addEventListener("click", () => render(root));
  root.querySelectorAll("[data-stage]").forEach((el) => {
    el.addEventListener("click", () => runStage(root, set, parseInt(el.dataset.stage)));
  });
  root.querySelector("#more").addEventListener("click", () => showGenerateMore(root, set));
}

async function showGenerateMore(root, set) {
  const tasks = set.tasks || [];
  if (!tasks.length) return;
  const idx = prompt(`Von welcher Aufgabe sollen ähnliche erstellt werden? (1-${tasks.length})`, "1");
  if (idx == null) return;
  const i = Math.max(0, Math.min(tasks.length - 1, parseInt(idx) - 1 || 0));
  const countStr = prompt("Wie viele neue Aufgaben?", "5");
  if (countStr == null) return;
  const count = Math.max(1, Math.min(20, parseInt(countStr) || 5));

  const overlay = document.createElement("div");
  overlay.className = "empty";
  overlay.textContent = "Generiere & prüfe Aufgaben…";
  root.prepend(overlay);
  try {
    const example = { text: tasks[i].text, given: tasks[i].given, sought: tasks[i].sought, result_text: tasks[i].result_text };
    const fresh = await generateSimilarTasks(example, count, {}, true);
    // Solve the new tasks so they are practiceable with calc_chain.
    const solved = await solveMathTasks(fresh, set.instructions || "");
    set.tasks = tasks.concat(solved);
    const all = await loadMathTasks();
    const pos = all.findIndex((s) => s.name === set.name && s.created === set.created);
    if (pos >= 0) all[pos] = set; else all.push(set);
    await saveMathTasks(all);
    showStagePicker(root, set);
  } catch (err) {
    overlay.textContent = "Fehler: " + (err.message || err);
  }
}

// ── Run a stage over all tasks ──
function runStage(root, set, stage) {
  const tasks = [...(set.tasks || [])].sort(() => Math.random() - 0.5);
  const state = { idx: 0, correct: 0, total: 0 };

  function showTask(idx) {
    if (idx >= tasks.length) { showEnd(root, set, state); return; }
    const task = tasks[idx];
    root.innerHTML = `
      <div class="topbar">
        <button class="btn btn-ghost btn-sm" id="quit">← Beenden</button>
        <h2 style="margin:0">${STAGE_ICONS[stage]} Stufe ${stage}</h2>
      </div>
      <div class="file-track" style="margin-bottom:10px"><div class="file-fill" style="width:${(idx / tasks.length) * 100}%"></div></div>
      <p style="font-weight:600">Aufgabe ${idx + 1}/${tasks.length}</p>
      <div class="card"><p>${mathEsc(task.text || "")}</p></div>
      <div id="stage-area"></div>`;
    root.querySelector("#quit").addEventListener("click", () => showStagePicker(root, set));
    const area = root.querySelector("#stage-area");
    const next = () => { state.idx++; showTask(state.idx); };
    runChain(area, task, stage, state, set, next);
  }
  showTask(0);
}

// ── Calc-chain walker shared by stages 1, 2, 4 ──
function runChain(area, task, stage, state, set, doneFn) {
  let chain = task.calc_chain;
  if (!chain || !chain.length) chain = asSingleStep(task);
  const computed = {};
  let allOk = true;

  function showStep(si) {
    if (si >= chain.length) {
      state.total++;
      if (allOk) state.correct++;
      recordResult(task, allOk, set.name);
      const final = task.final_result_text || (chain[chain.length - 1].result_text || "");
      area.innerHTML = `<div class="card ${allOk ? "feedback correct" : ""}">
        <strong>${allOk ? "✅ Alle Schritte richtig!" : "Endergebnis"}: </strong>${mathEsc(String(final))}</div>`;
      setTimeout(doneFn, 1600);
      return;
    }
    const step = chain[si];
    const multi = chain.length > 1;
    const label = multi ? `Rechenschritt ${si + 1}/${chain.length}` : "Rechnung";
    const resSym = step.result_symbol || "?";
    const resUnit = step.result_unit ? ` [${step.result_unit}]` : "";
    const inputs = step.inputs || [];

    // Stage-specific formula presentation
    let formulaHtml = "";
    if (stage === 1 && step.formula_latex) {
      formulaHtml = `<div style="margin:6px 0">${mathEsc("$" + step.formula_latex + "$")}</div>`;
    } else if (stage === 2 && step.formula_latex) {
      const blanked = step.formula_latex.replace(/\{\{(\w+)\}\}/g, "\\boxed{?}");
      formulaHtml = `<div style="margin:6px 0">${mathEsc("$" + blanked + "$")}</div>`;
    }

    // Stage 4 = linear input only (no per-variable fields)
    let inputsHtml = "";
    if (stage !== 4 && inputs.length) {
      inputsHtml = `<div class="var-inputs">` + inputs.map((inp, k) => {
        const sym = inp.symbol || `x${k}`;
        const unit = inp.unit ? ` [${inp.unit}]` : "";
        const fromStep = inp.from_step;
        const labelTxt = stage === 2 ? `□ ${k + 1}${unit}` : `${sym}${unit}${fromStep ? ` (aus Schritt ${fromStep})` : ""}`;
        return `<div class="var-row"><label>${esc(labelTxt)} =</label>
          <input class="input var-in" data-sym="${esc(sym)}" data-from="${fromStep || ""}" placeholder="Wert"></div>`;
      }).join("") + `</div>`;
    } else if (stage === 4 && inputs.length) {
      const given = inputs.map((inp) => {
        const v = (inp.from_step && computed[inp.symbol] != null) ? computed[inp.symbol] : inp.value;
        return `${inp.symbol} = ${v}`;
      }).join(", ");
      inputsHtml = `<p style="color:var(--primary);font-weight:600">Gegeben: ${esc(given)}</p>`;
    }

    area.innerHTML = `
      <div class="card">
        <h4>${STAGE_ICONS[stage]} ${label}${step.description ? ": " + esc(step.description) : ""}</h4>
        ${formulaHtml}
        ${inputsHtml}
        <label style="margin-top:8px;font-weight:600">Ergebnis: ${esc(resSym)}${esc(resUnit)} =</label>
        <input class="input" id="result-in" placeholder="${esc(resSym)} = ?">
        <div id="hint-box" style="margin-top:8px"></div>
        <div id="fb" style="margin-top:8px"></div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-primary" id="check">✓ Prüfen</button>
          ${stage === 4 ? `<button class="btn btn-warning" id="hint">💡 Hinweis</button>` : ""}
        </div>
      </div>`;

    const resultIn = area.querySelector("#result-in");

    // Math keyboard
    import("../math-keyboard.js").then(({ createMathKeyboard }) => {
      const kbContainer = area.querySelector("#hint-box").parentElement;
      const kbTarget = document.createElement("div");
      kbTarget.style.cssText = "margin-top:4px";
      kbContainer.insertBefore(kbTarget, area.querySelector("#hint-box"));
      const kb = createMathKeyboard(kbTarget, resultIn);
      area.querySelectorAll(".var-in").forEach(el => {
        el.addEventListener("focus", () => kb.setTarget(el));
      });
      resultIn.addEventListener("focus", () => kb.setTarget(resultIn));
    });

    resultIn.focus();

    // Stage 4 staged hint cascade
    if (stage === 4) {
      const levels = [];
      if (step.formula_name) levels.push(`💡 Formel: ${step.formula_name}`);
      if (step.formula_latex) levels.push(`🧩 Struktur: ${step.formula_latex}`);
      if (step.linear_notation) levels.push(`✍️ Lösungsweg: ${step.linear_notation}`);
      else if (step.result_text) levels.push(`✍️ Lösung: ${step.result_text}`);
      let lvl = 0;
      const hintBtn = area.querySelector("#hint");
      hintBtn?.addEventListener("click", () => {
        if (lvl >= levels.length) return;
        area.querySelector("#hint-box").innerHTML = `<small style="color:var(--info)">${mathEsc(levels[lvl])}</small>`;
        lvl++;
        if (lvl >= levels.length) hintBtn.disabled = true;
        else hintBtn.textContent = `💡 Mehr Hilfe (${lvl}/${levels.length})`;
      });
    }

    function check() {
      let stepOk = true;
      area.querySelectorAll(".var-in").forEach((el) => {
        const sym = el.dataset.sym;
        const from = el.dataset.from;
        const inp = inputs.find((x) => (x.symbol || "") === sym);
        let expected = inp ? inp.value : null;
        if (from && computed[sym] != null) expected = computed[sym];
        if (expected != null && !validateNumeric(el.value, expected)) { el.style.borderColor = "var(--danger)"; stepOk = false; }
        else el.style.borderColor = "var(--success)";
      });
      const resNums = step.result_numeric || [];
      const resText = step.result_text || "";
      const ok = checkAnswer(resultIn.value, resNums, resText);
      resultIn.style.borderColor = ok ? "var(--success)" : "var(--danger)";
      if (!ok) stepOk = false;
      if (!stepOk) allOk = false;
      if (resNums.length) computed[resSym] = resNums[0];
      area.querySelector("#fb").innerHTML = stepOk
        ? `<small style="color:var(--success)">✅ Richtig! ${mathEsc(resText)}</small>`
        : `<small style="color:var(--danger)">❌ Lösung: ${mathEsc(resText)}</small>`;
      area.querySelector("#check").disabled = true;
      setTimeout(() => showStep(si + 1), 1500);
    }
    area.querySelector("#check").addEventListener("click", check);
    resultIn.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
  }

  // Stage 3 = name the formula(s) first, then run as stage 2
  if (stage === 3) {
    const names = [];
    for (const st of chain) { if (st.formula_name && !names.includes(st.formula_name)) names.push(st.formula_name); }
    if (!names.length) { runChainAs(area, task, 2, state, set, doneFn); return; }
    let fi = 0;
    function askName() {
      if (fi >= names.length) { runChainAs(area, task, 2, state, set, doneFn); return; }
      const correctName = names[fi];
      area.innerHTML = `<div class="card">
        <h4>🧠 Welche Formel wird benötigt? ${names.length > 1 ? `(${fi + 1}/${names.length})` : ""}</h4>
        ${task.topic ? `<small style="color:var(--text-light)">Thema: ${esc(task.topic)}</small>` : ""}
        <input class="input" id="name-in" placeholder="Formelname…" style="margin-top:8px">
        <div id="fb" style="margin-top:8px"></div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-primary" id="check">✓ Prüfen</button>
          <button class="btn btn-warning" id="skip">⏭ Überspringen</button>
        </div></div>`;
      const inEl = area.querySelector("#name-in");
      inEl.focus();
      const fuzzy = (u, c) => {
        u = u.trim().toLowerCase(); c = c.trim().toLowerCase();
        return u && c && (u === c || u.includes(c) || c.includes(u));
      };
      const proceed = () => { fi++; askName(); };
      area.querySelector("#check").addEventListener("click", () => {
        if (fuzzy(inEl.value, correctName)) {
          area.querySelector("#fb").innerHTML = `<small style="color:var(--success)">✅ Richtig!</small>`;
          setTimeout(proceed, 700);
        } else {
          area.querySelector("#fb").innerHTML = `<small style="color:var(--danger)">❌ Tipp: ${esc(correctName.slice(0, 3))}…</small>`;
          inEl.style.borderColor = "var(--danger)";
        }
      });
      area.querySelector("#skip").addEventListener("click", () => {
        area.querySelector("#fb").innerHTML = `<small style="color:var(--warning)">Formel: ${esc(correctName)}</small>`;
        setTimeout(proceed, 1000);
      });
      inEl.addEventListener("keydown", (e) => { if (e.key === "Enter") area.querySelector("#check").click(); });
    }
    askName();
    return;
  }

  showStep(0);
}

// Helper so stage 3 can re-run the chain in stage-2 mode after naming.
function runChainAs(area, task, stage, state, set, doneFn) {
  runChain(area, task, stage, state, set, doneFn);
}

// ── End screen ──
function showEnd(root, set, state) {
  const pct = state.total ? Math.round((state.correct / state.total) * 100) : 0;
  const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "💪";
  root.innerHTML = `
    <div class="card" style="text-align:center;border:2px solid var(--primary)">
      <h2>${emoji} Ergebnis</h2>
      <p style="font-size:1.4rem;color:var(--primary)">${state.correct} / ${state.total} richtig (${pct}%)</p>
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn-primary" id="again">🔄 Nochmal</button>
      <button class="btn btn-secondary" id="home">🏠 Zurück</button>
    </div>`;
  root.querySelector("#again").addEventListener("click", () => showStagePicker(root, set));
  root.querySelector("#home").addEventListener("click", () => render(root));
}
