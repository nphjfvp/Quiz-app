import { loadFormulaSheets, saveFormulaSheets, trackRecent } from "../store.js";
import { navigate } from "../router.js";
import { esc, mathEsc, uid } from "../utils.js";
import { generateFormulaSheet, deriveFormulaExplanations, deriveFormulaByVariable, formulaPhotoToLatex } from "../ai-service.js";

// Formelsammlung: KI-generierte & manuelle Formelsammlungen.
// Sheet-Form: { id, name, subject, body, formulas } – body ist Freitext,
// formulas ist structured [{name, formula, variables[], explanation?}]
export async function render(root, params = {}) {
  const sheets = await loadFormulaSheets();

  if (params.sheetId) {
    const sheet = sheets.find(s => s.id === params.sheetId);
    if (sheet) return showView(root, sheet);
  }
  if (params.edit) return showEdit(root, sheets, params.sheetId);
  if (params.generate) return showGenerator(root);
  if (params.sheetId && params.derived === "explain") {
    const sheet = sheets.find(s => s.id === params.sheetId);
    if (sheet) return showDerived(root, sheet, "explain");
  }
  if (params.sheetId && params.derived === "bysolved") {
    const sheet = sheets.find(s => s.id === params.sheetId);
    if (sheet) return showDerived(root, sheet, "bysolved");
  }

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="list-header">
      <div class="section-title" style="margin:0">📋 Formelsammlung</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="ki-gen-btn">🤖 KI-Generator</button>
        <button class="btn btn-ghost btn-sm" id="new-btn">+ Neu</button>
      </div>
    </div>
    <p style="color:var(--text-light);font-size:0.88rem;margin:0 0 12px">
      Sammle wichtige Formeln pro Fach. Per KI aus Text/PDF generieren oder manuell anlegen.
    </p>`;

  if (!sheets.length) {
    html += `<div class="empty">Noch keine Formelsammlungen.<br>Nutze den KI-Generator oder lege manuell eine an!</div>`;
  } else {
    for (const s of sheets) {
      const hasFormulas = (s.formulas && s.formulas.length > 0);
      const count = hasFormulas ? s.formulas.length : (s.body || "").split("\n").filter(l => l.trim()).length;
      html += `<div class="quiz-row" data-open="${s.id}">
        <div class="quiz-accent" style="background:var(--primary)"></div>
        <div class="quiz-info">
          <h4>${esc(s.name)}</h4>
          <small>${s.subject ? esc(s.subject) + " · " : ""}${count} Formel(n)${hasFormulas ? " (strukturiert)" : ""}</small>
        </div>
        ${hasFormulas ? `<button class="btn-icon btn-icon-sm" data-derive="${s.id}" data-mode="explain" title="Formeln + Erklärung">📝</button>
        <button class="btn-icon btn-icon-sm" data-derive="${s.id}" data-mode="bysolved" title="Nach Variable umstellen">🔄</button>` : ""}
        <button class="btn-icon btn-icon-sm" data-edit="${s.id}">✏️</button>
        <button class="btn-icon btn-icon-sm" data-del="${s.id}">🗑️</button>
        <span class="row-chev">›</span>
      </div>`;
    }
  }

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelector("#ki-gen-btn").addEventListener("click", () => showGenerator(root));
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
  root.querySelectorAll("[data-derive]").forEach(b =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const mode = b.dataset.mode;
      const s = sheets.find(x => x.id === b.dataset.derive);
      if (s) showDerived(root, s, mode);
    }));
}

// ── KI Generator ───────────────────────────────────────────────────────────

async function showGenerator(root) {
  let generatedFormulas = null;

  function renderGen() {
    let html = `<button class="back-btn" id="gen-back">‹ Zurück</button>
      <div class="section-title">🤖 KI-Formelsammlung</div>
      <div class="card" style="padding:14px">

      <div class="input-group">
        <label>Lerntext oder PDF hochladen</label>
        <textarea id="fs-gen-text" class="textarea input" rows="8" placeholder="Skript, Vorlesungsmitschrift, Formelsammlung als Text einfügen…"></textarea>
        <div style="margin-top:6px">
          <input type="file" id="fs-gen-file" accept=".txt,.pdf,.tex" class="input" style="padding:8px">
          <small class="file-hint">.txt, .pdf oder .tex (PDF-Text wird extrahiert)</small>
        </div>
        <div style="margin-top:6px">
          <input type="file" id="fs-gen-photo" accept="image/*" class="input" style="padding:8px">
          <small class="file-hint">📷 Foto von Formeln (Vision → LaTeX)</small>
        </div>
      </div>

      <div class="input-group">
        <label>Fach / Name für die Sammlung</label>
        <input type="text" id="fs-gen-name" class="input" placeholder="z.B. Analysis 1, Physik Mechanik">
      </div>

      <div class="input-group">
        <details>
          <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-light)">⚙️ Eigener Prompt (optional)</summary>
          <input type="text" id="fs-gen-prompt" class="input" placeholder="z.B. Nur Formeln aus Kapitel 3, nur Integralrechnung…" style="margin-top:6px">
          <small class="file-hint">Steuert, welche Formeln extrahiert werden. Leer = alle Formeln.</small>
        </details>
      </div>

      <div id="fs-gen-err" class="error-box" style="display:none"></div>
      <button class="btn btn-primary btn-block" id="fs-gen-btn">🤖 Formeln generieren</button>
    </div>`;

    if (generatedFormulas && generatedFormulas.length) {
      html += `<div class="card" style="padding:14px;margin-top:12px">
        <div style="font-weight:600;margin-bottom:10px">✅ ${generatedFormulas.length} Formeln extrahiert</div>`;
      for (const f of generatedFormulas) {
        html += `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="font-weight:600;font-size:0.9rem">${esc(f.name)}</div>
          <div style="font-size:1.1rem;margin:4px 0">${mathEsc(f.formula)}</div>
          ${f.variables?.length ? `<div style="font-size:0.75rem;color:var(--text-light)">${f.variables.map(v => esc(v.symbol) + ": " + esc(v.description)).join(" · ")}</div>` : ""}
        </div>`;
      }
      html += `<button class="btn btn-primary btn-block" id="fs-gen-save" style="margin-top:10px">💾 Formelsammlung speichern</button>
      </div>`;
    }

    root.innerHTML = html;

    root.querySelector("#gen-back").addEventListener("click", () => render(root));

    root.querySelector("#fs-gen-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const textArea = root.querySelector("#fs-gen-text");
      if (file.name.endsWith(".pdf")) {
        textArea.value = "⏳ Extrahiere PDF-Text…";
        try {
          const { getPdfText } = await import("../utils.js");
          const text = await getPdfText(file);
          textArea.value = text || "";
        } catch (err) {
          textArea.value = "❌ PDF konnte nicht gelesen werden.";
        }
      } else {
        const reader = new FileReader();
        reader.onload = () => { textArea.value = reader.result; };
        reader.readAsText(file);
      }
    });

    root.querySelector("#fs-gen-photo").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const errBox = root.querySelector("#fs-gen-err");
      errBox.style.display = "none";
      const textArea = root.querySelector("#fs-gen-text");
      textArea.value = "⏳ Extrahiere Formeln aus Foto…";
      try {
        const reader = new FileReader();
        const base64 = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const formulas = await formulaPhotoToLatex(base64);
        if (formulas.length) {
          textArea.value = formulas.map(f => `${f.name}: ${f.formula}`).join("\n");
        } else {
          textArea.value = "❌ Keine Formeln erkannt. Bitte versuche ein klareres Foto.";
        }
      } catch (err) {
        textArea.value = "❌ Fehler: " + (err.message || "Vision nicht verfügbar");
      }
    });

    root.querySelector("#fs-gen-btn")?.addEventListener("click", async () => {
      const text = root.querySelector("#fs-gen-text").value.trim();
      if (!text || text.startsWith("⏳")) return;
      const btn = root.querySelector("#fs-gen-btn");
      const errBox = root.querySelector("#fs-gen-err");
      btn.textContent = "⏳ Generiere…";
      btn.disabled = true;
      errBox.style.display = "none";
      try {
        const customPrompt = root.querySelector("#fs-gen-prompt")?.value?.trim() || "";
        generatedFormulas = await generateFormulaSheet(text, { customPrompt });
        renderGen();
      } catch (err) {
        errBox.textContent = err.message || "Fehler bei der Generierung";
        errBox.style.display = "block";
        btn.textContent = "🤖 Formeln generieren";
        btn.disabled = false;
      }
    });

    root.querySelector("#fs-gen-save")?.addEventListener("click", async () => {
      const name = root.querySelector("#fs-gen-name").value.trim() || "KI-Formelsammlung";
      const sheets = await loadFormulaSheets();
      const body = generatedFormulas.map(f => `${f.name}: ${f.formula}`).join("\n");
      const sheet = { id: uid(), name, subject: "", body, formulas: generatedFormulas };
      await saveFormulaSheets([...sheets, sheet]);
      render(root);
    });
  }

  renderGen();
}

// ── Derived Views ──────────────────────────────────────────────────────────

async function showDerived(root, sheet, mode) {
  const formulas = sheet.formulas;
  if (!formulas || !formulas.length) {
    render(root);
    return;
  }

  let derivedData = null;
  const isExplain = mode === "explain";

  function renderDerived() {
    let html = `<button class="back-btn" id="der-back">‹ Zurück</button>
      <div class="section-title">${isExplain ? "📝 Formeln + Erklärung" : "🔄 Nach Variable umgestellt"}</div>
      <p style="color:var(--text-light);font-size:0.85rem;margin:0 0 10px">
        Aus: ${esc(sheet.name)}${derivedData ? ` · ${derivedData.length} Einträge` : ""}
      </p>`;

    if (!derivedData) {
      html += `<div class="card" style="padding:20px;text-align:center">
        <p style="color:var(--text-light)">KI-generierte Ansicht wird einmalig erstellt…</p>
        <button class="btn btn-primary" id="der-gen-btn">🤖 Jetzt generieren</button>
        <div id="der-err" class="error-box" style="display:none;margin-top:8px"></div>
      </div>`;
    } else if (isExplain) {
      html += `<div class="card">`;
      for (const f of derivedData) {
        html += `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div><strong>${esc(f.name)}</strong></div>
          <div style="font-size:1.1rem;margin:4px 0">${mathEsc(f.formula)}</div>
          <div style="font-size:0.8rem;color:var(--text-light)">${esc(f.explanation || "")}</div>
        </div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="card">`;
      for (const f of derivedData) {
        html += `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div><strong>${esc(f.name)}</strong> <span style="color:var(--primary);font-size:0.75rem">→ ${esc(f.solvedFor || "")}</span></div>
          <div style="font-size:1.1rem;margin:4px 0">${mathEsc(f.formula)}</div>
        </div>`;
      }
      html += `</div>`;
    }

    html += `<button class="btn btn-ghost btn-block" id="der-save" style="margin-top:10px">💾 Als neue Formelsammlung speichern</button>`;

    root.innerHTML = html;

    root.querySelector("#der-back").addEventListener("click", () => {
      showView(root, sheet);
    });

    root.querySelector("#der-gen-btn")?.addEventListener("click", async () => {
      const btn = root.querySelector("#der-gen-btn");
      const errBox = root.querySelector("#der-err");
      btn.textContent = "⏳ Generiere…";
      btn.disabled = true;
      try {
        if (isExplain) {
          derivedData = await deriveFormulaExplanations(formulas);
        } else {
          derivedData = await deriveFormulaByVariable(formulas);
        }
        renderDerived();
      } catch (err) {
        errBox.textContent = err.message || "Fehler";
        errBox.style.display = "block";
        btn.textContent = "🤖 Jetzt generieren";
        btn.disabled = false;
      }
    });

    root.querySelector("#der-save")?.addEventListener("click", async () => {
      if (!derivedData) return;
      const sheets = await loadFormulaSheets();
      const suffix = isExplain ? " (mit Erklärung)" : " (nach Variable)";
      const bodyLines = isExplain
        ? derivedData.map(f => `${f.name}: ${f.formula} — ${f.explanation || ""}`)
        : derivedData.map(f => `${f.name} [${f.solvedFor}]: ${f.formula}`);
      const newSheet = {
        id: uid(),
        name: sheet.name + suffix,
        subject: sheet.subject || "",
        body: bodyLines.join("\n"),
        formulas: derivedData,
      };
      await saveFormulaSheets([...sheets, newSheet]);
      render(root);
    });
  }

  renderDerived();
}

// ── View ───────────────────────────────────────────────────────────────────

function showView(root, sheet) {
  trackRecent("formula", sheet.id, sheet.name);
  const hasFormulas = sheet.formulas && sheet.formulas.length > 0;
  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="list-header">
      <div class="section-title" style="margin:0">${esc(sheet.name)}</div>
      ${hasFormulas ? `<div style="display:flex;gap:4px">
        <button class="btn btn-ghost btn-sm" id="derive-explain">📝 Erklärungen</button>
        <button class="btn btn-ghost btn-sm" id="derive-bysolved">🔄 Umstellen</button>
      </div>` : ""}
    </div>
    ${sheet.subject ? `<p style="color:var(--text-light);font-size:0.85rem;margin:0 0 12px">${esc(sheet.subject)}</p>` : ""}`;

  if (hasFormulas) {
    html += `<div class="card">`;
    for (const f of sheet.formulas) {
      html += `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="font-weight:600;font-size:0.9rem">${esc(f.name)}</div>
        <div style="font-size:1.1rem;margin:4px 0">${mathEsc(f.formula)}</div>
        ${f.variables?.length ? `<div style="font-size:0.75rem;color:var(--text-light)">${f.variables.map(v => esc(v.symbol) + ": " + esc(v.description)).join(" · ")}</div>` : ""}
      </div>`;
    }
    html += `</div>`;
  } else {
    const body = (sheet.body || "").split("\n").filter(l => l.trim());
    html += `<div class="card">`;
    if (!body.length) {
      html += `<div class="empty">Keine Formeln eingetragen.</div>`;
    } else {
      html += body.map(l => `<div class="formula-sheet-body" style="padding:8px 0;border-bottom:1px solid var(--border)">${mathEsc(l)}</div>`).join("");
    }
    html += `</div>`;
  }

  html += `<div style="display:flex;gap:8px;margin-top:10px">
    <button class="btn btn-ghost btn-block" id="edit-btn">✏️ Bearbeiten</button>
    <button class="btn btn-ghost btn-block" id="pdf-btn">📥 PDF</button>
    <button class="btn btn-ghost btn-block" id="tex-btn">📄 .tex</button>
  </div>`;

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => render(root));
  root.querySelector("#edit-btn").addEventListener("click", async () => {
    const sheets = await loadFormulaSheets();
    showEdit(root, sheets, sheet.id);
  });
  root.querySelector("#pdf-btn").addEventListener("click", () => {
    exportSheetAsPdf(sheet);
  });
  root.querySelector("#tex-btn").addEventListener("click", () => {
    downloadTexSheet(sheet);
  });
  root.querySelector("#derive-explain")?.addEventListener("click", () => showDerived(root, sheet, "explain"));
  root.querySelector("#derive-bysolved")?.addEventListener("click", () => showDerived(root, sheet, "bysolved"));
}

// ── Edit ───────────────────────────────────────────────────────────────────

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
  root.querySelector("#back-btn").addEventListener("click", () => render(root));
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
    render(root);
  });
}

// ── PDF Export ────────────────────────────────────────────────────────────

function exportSheetAsPdf(sheet) {
  const hasFormulas = sheet.formulas && sheet.formulas.length > 0;
  let bodyHtml = "";
  if (hasFormulas) {
    for (const f of sheet.formulas) {
      bodyHtml += `<div style="margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">
        <div style="font-weight:600;font-size:0.95rem">${esc(f.name)}</div>
        <div style="font-size:1.15rem;margin:4px 0">${esc(f.formula)}</div>
        ${f.variables?.length ? `<div style="font-size:0.8rem;color:#666">${f.variables.map(v => esc(v.symbol) + ": " + esc(v.description)).join(" · ")}</div>` : ""}
        ${f.explanation ? `<div style="font-size:0.8rem;color:#555;margin-top:2px">${esc(f.explanation)}</div>` : ""}
      </div>`;
    }
  } else {
    const lines = (sheet.body || "").split("\n").filter(l => l.trim());
    bodyHtml = lines.map(l => `<div style="margin-bottom:6px;font-size:1rem">${esc(l)}</div>`).join("");
  }

  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) { alert("Pop-up blockiert – bitte erlauben für PDF-Export."); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(sheet.name)}</title>
    <link rel="stylesheet" href="lib/katex/katex.min.css">
    <script src="lib/katex/katex.min.js"><\/script>
    <script src="lib/katex/contrib/auto-render.min.js"><\/script>
    <style>body{font-family:system-ui,sans-serif;max-width:700px;margin:30px auto;padding:0 20px;color:#1a1a1a}
      h1{font-size:1.4rem;margin-bottom:4px}h2{font-size:0.9rem;color:#666;font-weight:400;margin-bottom:20px}
      @media print{body{margin:0;padding:10px}}</style></head><body>
    <h1>${esc(sheet.name)}</h1>${sheet.subject ? `<h2>${esc(sheet.subject)}</h2>` : ""}
    ${bodyHtml}
    <script>renderMathInElement(document.body,{delimiters:[{left:"\\\\(",right:"\\\\)",display:false},{left:"$$",right:"$$",display:true},{left:"\\\\[",right:"\\\\]",display:true}]});setTimeout(()=>window.print(),800);<\/script></body></html>`);
  w.document.close();
}

// ── .tex Export ───────────────────────────────────────────────────────────

function downloadTexSheet(sheet) {
  const hasFormulas = sheet.formulas && sheet.formulas.length > 0;
  const lines = [];
  lines.push("\\documentclass[12pt,a4paper]{article}");
  lines.push("\\usepackage[utf8]{inputenc}");
  lines.push("\\usepackage{amsmath,amssymb}");
  lines.push("\\usepackage{geometry}");
  lines.push("\\geometry{margin=2cm}");
  lines.push("\\usepackage{hyperref}");
  lines.push("");
  lines.push("\\begin{document}");
  lines.push("");
  lines.push(`\\title{${(sheet.name || "Formelsammlung").replace(/_/g, "\\_")}}`);
  if (sheet.subject) lines.push(`\\author{${sheet.subject.replace(/_/g, "\\_")}}`);
  lines.push("\\date{\\today}");
  lines.push("\\maketitle");
  lines.push("");

  if (hasFormulas) {
    lines.push("\\section*{Formeln}");
    for (const f of sheet.formulas) {
      const safeName = (f.name || "").replace(/_/g, "\\_");
      // Remove \\( and \\) wrappers if present
      const cleanFormula = (f.formula || "").replace(/^\\\(/, "").replace(/\\\)$/, "");
      lines.push(`\\subsection*{${safeName}}`);
      lines.push(`\\[${cleanFormula}\\]`);
      if (f.variables?.length) {
        lines.push("\\begin{itemize}");
        for (const v of f.variables) {
          const vSymbol = (v.symbol || "").replace(/_/g, "\\_");
          const vDesc = (v.description || "").replace(/_/g, "\\_");
          lines.push(`  \\item $\\text{${vSymbol}}$ — ${vDesc}`);
        }
        lines.push("\\end{itemize}");
      }
      if (f.explanation) {
        lines.push("");
        lines.push((f.explanation || "").replace(/_/g, "\\_"));
      }
      lines.push("");
    }
  } else {
    lines.push("\\section*{Formeln}");
    const bodyLines = (sheet.body || "").split("\n").filter(l => l.trim());
    for (const line of bodyLines) {
      // Strip \\( \\) wrappers for display math
      const clean = line.replace(/^\\\(/, "").replace(/\\\)$/, "");
      lines.push(`\\[${clean}\\]`);
      lines.push("");
    }
  }

  lines.push("");
  lines.push("\\end{document}");

  const content = lines.join("\n");
  const filename = (sheet.name || "formelsammlung").replace(/[^a-zA-Z0-9äöüÄÖÜß_\- ]/g, "_") + ".tex";

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
