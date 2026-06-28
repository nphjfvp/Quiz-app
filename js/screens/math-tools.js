import { navigate } from "../router.js";
import { esc, mathEsc } from "../utils.js";
import { askTutor } from "../ai-service.js";

// Mathe-Tools Hub: Funktionsplotter, Einheiten-Checker, Formel-Explorer, Herleitungen
// Routed from app.js as lazy import

export async function render(root, params = {}) {
  let activeTool = params.tool || "";

  function renderUI() {
    let html = `<button class="back-btn" id="mt-back">‹ Zurück</button>
      <div class="section-title">🧮 Mathe-Tools</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${["plotter","units","explorer","derive","socratic"].map(t => `
          <button class="btn btn-sm ${activeTool === t ? "btn-primary" : "btn-ghost"}" data-tool="${t}">${
            t === "plotter" ? "📈 Plotter" : t === "units" ? "⚖️ Einheiten" : t === "explorer" ? "🎚️ Explorer" : t === "derive" ? "📐 Herleitungen" : "🏛️ Sokrates"
          }</button>`).join("")}
      </div>`;

    if (activeTool === "plotter") { root.innerHTML = html; initPlotter(root); }
    else if (activeTool === "units") { root.innerHTML = html; initUnits(root); }
    else if (activeTool === "explorer") { root.innerHTML = html; initExplorer(root); }
    else if (activeTool === "derive") { root.innerHTML = html; initDerive(root); }
    else {
      html += `<div class="card" style="text-align:center;padding:20px">Wähle ein Tool oben aus.</div>`;
      root.innerHTML = html;
    }

    root.querySelector("#mt-back").addEventListener("click", () => navigate("home"));
    root.querySelectorAll("[data-tool]").forEach(b =>
      b.addEventListener("click", () => {
        activeTool = b.dataset.tool;
        if (activeTool === "socratic") { navigate("socratic", { mode: "math" }); return; }
        renderUI();
      }));
  }

  renderUI();
}

// ── Function Plotter ──────────────────────────────────────────────────────

function initPlotter(root) {
  const html = `<div class="card" style="padding:14px">
    <label>Funktion f(x) =</label>
    <div style="display:flex;gap:8px;margin-top:4px">
      <input type="text" id="plot-fn" class="input" placeholder="z.B. sin(x), x^2 - 4, 1/x" style="flex:1">
      <button class="btn btn-primary" id="plot-btn">Zeichnen</button>
    </div>
    <small class="file-hint">Math.js-Syntax: sin(x), cos(x), sqrt(x), abs(x), exp(x), log(x), PI, E</small>
    <canvas id="plot-canvas" style="width:100%;height:300px;margin-top:8px;border:1px solid var(--border);border-radius:8px"></canvas>
    <div id="plot-err" class="error-box" style="display:none;margin-top:4px"></div>
  </div>`;
  root.innerHTML += html;

  // Load math.js once
  let mathJs = null;
  import("https://cdnjs.cloudflare.com/ajax/libs/mathjs/13.0.0/math.min.js")
    .then(m => { mathJs = m; }).catch(() => {});

  root.querySelector("#plot-btn")?.addEventListener("click", () => {
    const fnStr = root.querySelector("#plot-fn").value.trim();
    if (!fnStr) return;
    const canvas = root.querySelector("#plot-canvas");
    const ctx = canvas.getContext("2d");
    const errBox = root.querySelector("#plot-err");
    errBox.style.display = "none";

    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = 600;
    ctx.scale(2, 2);
    const w = rect.width, h = 300;
    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#e5e7eb";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    // Axes
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

    if (!mathJs) {
      errBox.textContent = "math.js lädt noch oder konnte nicht geladen werden.";
      errBox.style.display = "block";
      return;
    }
    try {
      const compiled = mathJs.compile(fnStr);
      const fn = (x) => compiled.evaluate({ x });

      const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#3b82f6";
      ctx.strokeStyle = primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let first = true;
      const scaleX = w / 10;
      const scaleY = h / 10;
      for (let px = 0; px < w; px += 1) {
        const x = (px - w/2) / scaleX;
        try {
          const y = fn(x);
          if (!isFinite(y)) { first = true; continue; }
          const py = h/2 - y * scaleY;
          if (py < -100 || py > h + 100) { first = true; continue; }
          if (first) { ctx.moveTo(px, py); first = false; }
          else ctx.lineTo(px, py);
        } catch { first = true; }
      }
      ctx.stroke();

      // Label
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#1a1a1a";
      ctx.font = "12px sans-serif";
      ctx.fillText(`f(x) = ${fnStr}`, 8, 16);
    } catch (e) {
      errBox.textContent = "Fehler: " + e.message;
      errBox.style.display = "block";
    }
  });
}

// ── Unit Checker ──────────────────────────────────────────────────────────

function initUnits(root) {
  const html = `<div class="card" style="padding:14px">
    <label>Physikalische Größe / Einheit prüfen</label>
    <div style="display:flex;gap:8px;margin-top:4px">
      <input type="text" id="units-input" class="input" placeholder="z.B. kg * m / s^2, N, J/s, V*A" style="flex:1">
      <button class="btn btn-primary" id="units-check">Prüfen</button>
    </div>
    <div id="units-result" style="margin-top:10px;font-size:0.9rem"></div>
  </div>`;
  root.innerHTML += html;

  root.querySelector("#units-check")?.addEventListener("click", async () => {
    const input = root.querySelector("#units-input").value.trim();
    const resultEl = root.querySelector("#units-result");
    if (!input) return;
    resultEl.innerHTML = "⏳ Prüfe…";
    try {
      const res = await askTutor(
        `Prüfe die Einheit: "${input}". Ist das eine korrekte Einheit? Welche physikalische Größe wird damit gemessen? Antworte kurz in 2-3 Sätzen auf Deutsch.`,
        "", [], { model: "deepseek/deepseek-chat" }
      );
      resultEl.textContent = res;
    } catch (e) {
      resultEl.textContent = "❌ Fehler: " + (e.message || "Unbekannt");
    }
  });
}

// ── Formula Explorer ──────────────────────────────────────────────────────

function initExplorer(root) {
  const html = `<div class="card" style="padding:14px">
    <label>Formel (LaTeX)</label>
    <div style="display:flex;gap:8px;margin-top:4px">
      <input type="text" id="expl-formula" class="input" placeholder="z.B. U = R * I, E = m * c^2" style="flex:1">
      <button class="btn btn-primary" id="expl-load">Laden</button>
    </div>
    <div id="expl-sliders" style="margin-top:10px"></div>
    <div id="expl-result" style="margin-top:8px;font-size:1.2rem;font-weight:600;min-height:24px"></div>
  </div>`;
  root.innerHTML += html;

  root.querySelector("#expl-load")?.addEventListener("click", () => {
    const formula = root.querySelector("#expl-formula").value.trim();
    if (!formula) return;
    const slidersDiv = root.querySelector("#expl-sliders");
    const resultDiv = root.querySelector("#expl-result");

    // Extract single-letter variables (skip digits, "e", "PI")
    const varMatches = formula.match(/[a-zA-Z_]\w*/g) || [];
    const vars = [...new Set(varMatches)]
      .filter(v => v.length === 1 && v.toLowerCase() !== "e" && isNaN(v));

    if (vars.length < 1) {
      slidersDiv.innerHTML = "<p style='color:var(--text-light)'>Keine Variablen zum Einstellen gefunden. Nutze einfache Variablen wie a, b, x, y.</p>";
      return;
    }

    const values = {};
    for (const v of vars) values[v] = 1;

    function updateResult() {
      let expr = formula;
      for (const [v, val] of Object.entries(values)) {
        expr = expr.replace(new RegExp(`\\b${v}\\b`, "g"), val);
      }
      try {
        // Safety: only allow math-safe characters (digits, operators, parens, whitespace, dot)
        if (expr.length > 200 || /[^0-9+\-*/().%\s^]/.test(expr)) {
          resultDiv.textContent = "Ungültiger Ausdruck";
          resultDiv.style.color = "var(--danger)";
          return;
        }
        const result = Function(`"use strict"; return (${expr});`)();
        if (!isFinite(result)) throw new Error("not finite");
        resultDiv.textContent = `= ${result}`;
        resultDiv.style.color = "var(--text)";
      } catch {
        resultDiv.textContent = "Berechnungsfehler";
        resultDiv.style.color = "var(--danger)";
      }
    }

    let slidersHtml = "";
    for (const v of vars) {
      slidersHtml += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="width:20px;font-weight:600">${esc(v)}</span>
        <input type="range" class="expl-slider" data-var="${esc(v)}" min="0" max="100" value="50" step="1" style="flex:1">
        <span class="expl-val" data-var="${esc(v)}" style="width:40px;text-align:right;font-size:0.85rem">50</span>
      </div>`;
    }
    slidersDiv.innerHTML = slidersHtml;

    slidersDiv.querySelectorAll(".expl-slider").forEach(slider => {
      slider.addEventListener("input", () => {
        const v = slider.dataset.var;
        const rawVal = parseInt(slider.value);
        values[v] = rawVal;
        slidersDiv.querySelector(`.expl-val[data-var="${v}"]`).textContent = rawVal;
        updateResult();
      });
    });

    updateResult();
  });
}

// ── Step-by-Step Derivations ──────────────────────────────────────────────

function initDerive(root) {
  const html = `<div class="card" style="padding:14px">
    <label>Formel zum Herleiten</label>
    <div style="display:flex;gap:8px;margin-top:4px">
      <input type="text" id="derive-fn" class="input" placeholder="z.B. pq-Formel, Ableitung von x^n, Satz des Pythagoras" style="flex:1">
      <button class="btn btn-primary" id="derive-btn">Herleiten</button>
    </div>
    <div id="derive-result" style="margin-top:10px;font-size:0.9rem;line-height:1.6"></div>
  </div>`;
  root.innerHTML += html;

  root.querySelector("#derive-btn")?.addEventListener("click", async () => {
    const input = root.querySelector("#derive-fn").value.trim();
    const resultEl = root.querySelector("#derive-result");
    if (!input) return;
    resultEl.innerHTML = "⏳ Leite her…";
    try {
      const res = await askTutor(
        `Leite folgendes Schritt für Schritt her: ${input}. Erkläre jeden Schritt kurz und verständlich. Nutze LaTeX für Formeln (Inline mit \\\\(...\\\\)).`,
        "", [], { model: "deepseek/deepseek-chat" }
      );
      resultEl.innerHTML = mathEsc(res);
    } catch (e) {
      resultEl.textContent = "❌ Fehler: " + (e.message || "");
    }
  });
}
