import { navigate } from "../router.js";
import { addCoins, saveGameScore } from "../store.js";
import { mathEsc } from "../utils.js";

// Mathe-Solver – Lösungsweg-Puzzle (wie im Mockup): quadratische Gleichungen
// ax² + bx + c = 0 Schritt für Schritt mit der ABC-Formel lösen.
// 4 Schritte: Koeffizienten → Diskriminante → Wurzel → Lösungen.

const PUZZLES_PER_GAME = 5;
const STEP_TIME_BONUS = 20; // Sekunden für vollen Zeitbonus pro Schritt

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Erzeugt eine quadratische Gleichung mit ganzzahligen Lösungen (schöne Wurzel).
function makePuzzle() {
  const a = randInt(1, 2);
  let r1 = randInt(-8, 8), r2 = randInt(-8, 8);
  if (r1 === r2) r2 = r1 + (r1 >= 0 ? -1 : 1); // zwei verschiedene Lösungen
  const b = -a * (r1 + r2);
  const c = a * r1 * r2;
  const D = b * b - 4 * a * c;          // = a²(r1-r2)²  ≥ 0
  const sqrtD = Math.round(Math.sqrt(D));
  const xs = [(-b + sqrtD) / (2 * a), (-b - sqrtD) / (2 * a)].sort((p, q) => p - q);
  return { a, b, c, D, sqrtD, xs };
}

function fmtTerm(coef, varStr, first) {
  if (coef === 0) return "";
  const sign = coef < 0 ? "-" : (first ? "" : "+");
  const abs = Math.abs(coef);
  const num = (abs === 1 && varStr) ? "" : String(abs);
  return `${sign} ${num}${varStr} `;
}

function equationTex(p) {
  let s = "";
  s += fmtTerm(p.a, "x^2", true);
  s += fmtTerm(p.b, "x", s.trim() === "");
  s += fmtTerm(p.c, "", s.trim() === "");
  return `${s.trim()} = 0`;
}

export async function render(root) {
  const session = {
    puzzles: Array.from({ length: PUZZLES_PER_GAME }, makePuzzle),
    idx: 0,
    step: 0,        // 0..3
    score: 0,
    stepStart: Date.now(),
  };

  renderStep(root, session);
}

function num(root, sel) {
  const v = parseFloat((root.querySelector(sel)?.value || "").replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
}

function renderStep(root, s) {
  const p = s.puzzles[s.idx];
  const totalSteps = 4;
  const stepLabels = ["Koeffizienten", "Diskriminante", "Wurzel ziehen", "Lösungen"];
  const pct = Math.round(((s.idx * totalSteps + s.step) / (s.puzzles.length * totalSteps)) * 100);
  s.stepStart = Date.now();

  let body = "";
  if (s.step === 0) {
    body = `<small style="color:var(--text-light)">Lies die Koeffizienten aus der Gleichung ab (Form ax² + bx + c = 0):</small>
      <div class="ms-coef-row">
        ${coefBox("a (vor x²)", "ms-a")}
        ${coefBox("b (vor x)", "ms-b")}
        ${coefBox("c (Konstante)", "ms-c")}
      </div>`;
  } else if (s.step === 1) {
    body = `<small style="color:var(--text-light)">Berechne die Diskriminante:</small>
      <div class="ms-formula">D = b² − 4·a·c = ${p.b}² − 4·(${p.a})·(${p.c})</div>
      <div class="ms-coef-row">${coefBox("D", "ms-d")}</div>`;
  } else if (s.step === 2) {
    body = `<small style="color:var(--text-light)">Ziehe die Wurzel aus der Diskriminante D = ${p.D}:</small>
      <div class="ms-formula">√D = √${p.D}</div>
      <div class="ms-coef-row">${coefBox("√D", "ms-sqrt")}</div>`;
  } else {
    body = `<small style="color:var(--text-light)">Setze in die ABC-Formel ein: x = (−b ± √D) / (2a)</small>
      <div class="ms-formula">x = (−(${p.b}) ± ${p.sqrtD}) / (2·${p.a})</div>
      <div class="ms-coef-row">${coefBox("x₁", "ms-x1")}${coefBox("x₂", "ms-x2")}</div>
      <small style="color:var(--text-light)">Reihenfolge egal.</small>`;
  }

  root.innerHTML = `
    <div class="top-bar"><button class="back-btn" id="ms-back">‹ Zurück</button></div>
    <div class="ms-head">
      <span class="ms-timer" id="ms-timer">0:00</span>
      <span>Aufgabe <strong>${s.idx + 1}/${s.puzzles.length}</strong> · Schritt <strong>${s.step + 1}/${totalSteps}</strong></span>
      <span class="badge-score">⭐ ${s.score}</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>

    <div class="card" style="margin-top:12px;border-left:3px solid var(--primary)">
      <small style="color:var(--primary)">Aufgabe</small>
      <h3 style="margin-top:4px">Löse: <span>${mathEsc("$" + equationTex(p) + "$")}</span></h3>
    </div>

    <div class="section-title">${stepLabels[s.step]}</div>
    <div class="step-chain">
      ${stepLabels.map((lbl, i) => `<div class="step-node ${i < s.step ? "step-ok" : i === s.step ? "step-active" : ""}">
        <strong>${i < s.step ? "✓ " : i === s.step ? "→ " : ""}Schritt ${i + 1}:</strong> ${lbl}
      </div>`).join("")}
    </div>

    <div class="card">${body}</div>
    <div id="ms-feedback" class="ms-feedback"></div>
    <button class="btn btn-primary btn-block" id="ms-confirm" style="margin-top:8px">Bestätigen →</button>`;

  root.querySelector("#ms-back").addEventListener("click", () => navigate("games"));

  // Laufender Timer (nur Anzeige des aktuellen Schritts)
  const timerEl = root.querySelector("#ms-timer");
  const tick = setInterval(() => {
    if (!document.body.contains(timerEl)) { clearInterval(tick); return; }
    const sec = Math.floor((Date.now() - s.stepStart) / 1000);
    timerEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }, 1000);

  root.querySelector("#ms-confirm").addEventListener("click", () => {
    clearInterval(tick);
    checkStep(root, s);
  });
  root.querySelector(".input, .ms-input")?.focus();
}

function coefBox(label, id) {
  return `<div class="ms-coef">
    <small>${label}</small>
    <input type="text" inputmode="numeric" class="input ms-input" id="${id}">
  </div>`;
}

function checkStep(root, s) {
  const p = s.puzzles[s.idx];
  let correct = false;
  let expected = "";

  if (s.step === 0) {
    correct = num(root, "#ms-a") === p.a && num(root, "#ms-b") === p.b && num(root, "#ms-c") === p.c;
    expected = `a = ${p.a}, b = ${p.b}, c = ${p.c}`;
  } else if (s.step === 1) {
    correct = num(root, "#ms-d") === p.D;
    expected = `D = ${p.D}`;
  } else if (s.step === 2) {
    correct = num(root, "#ms-sqrt") === p.sqrtD;
    expected = `√D = ${p.sqrtD}`;
  } else {
    const x1 = num(root, "#ms-x1"), x2 = num(root, "#ms-x2");
    const got = [x1, x2].sort((a, b) => a - b);
    correct = Math.abs(got[0] - p.xs[0]) < 1e-6 && Math.abs(got[1] - p.xs[1]) < 1e-6;
    expected = `x₁ = ${p.xs[0]}, x₂ = ${p.xs[1]}`;
  }

  const fb = root.querySelector("#ms-feedback");
  const confirmBtn = root.querySelector("#ms-confirm");
  const elapsed = (Date.now() - s.stepStart) / 1000;

  if (correct) {
    const bonus = Math.max(0, Math.round(STEP_TIME_BONUS - elapsed));
    const gained = 50 + bonus;
    s.score += gained;
    fb.className = "ms-feedback ok";
    fb.textContent = `✓ Richtig! +${gained} Punkte (${bonus} Zeitbonus)`;
  } else {
    fb.className = "ms-feedback bad";
    fb.textContent = `✗ Falsch. Richtig wäre: ${expected}`;
  }
  root.querySelectorAll(".ms-input").forEach(i => { i.disabled = true; });

  confirmBtn.textContent = "Weiter →";
  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.replaceWith(newBtn);
  newBtn.addEventListener("click", () => advance(root, s));
}

function advance(root, s) {
  s.step++;
  if (s.step >= 4) { s.step = 0; s.idx++; }
  if (s.idx >= s.puzzles.length) return finish(root, s);
  renderStep(root, s);
}

async function finish(root, s) {
  const coins = Math.floor(s.score / 20);
  try { await addCoins(coins, "math-solver"); } catch (_) {}
  try { await saveGameScore("math-solver", { points: s.score, coins }); } catch (_) {}

  root.innerHTML = `
    <div class="game-over">
      <div style="font-size:3rem">🧮</div>
      <h2>Geschafft!</h2>
      <p style="font-size:1.4rem;font-weight:700;color:var(--primary)">⭐ ${s.score} Punkte</p>
      <p>🪙 +${coins} Münzen</p>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn btn-primary" id="ms-again">Nochmal</button>
        <button class="btn btn-ghost" id="ms-home">Zu den Games</button>
      </div>
    </div>`;
  root.querySelector("#ms-again").addEventListener("click", () => render(root));
  root.querySelector("#ms-home").addEventListener("click", () => navigate("games"));
}
