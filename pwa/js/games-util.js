// Shared helpers for the mini-games: turn arbitrary quiz questions into a
// simple, fast-playable form. Types that can't be represented as a quick
// "pick an option" or "type the answer" challenge are dropped, so a game
// never shows a broken/meaningless question.

// Source picker shown before a game starts. Lets the player choose which
// quiz/Klausur to practise (or all of them). Resolves to the chosen
// questions array, or null if the player went back.
export async function pickQuizSource(root, opts = {}) {
  const { title = "🎮 Spiel", subtitle = "Was möchtest du üben?" } = opts;
  const { loadQuizzes } = await import("./store.js");
  const { navigate } = await import("./router.js");
  const esc = (s) => (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const quizzes = await loadQuizzes();
  if (!quizzes.length) {
    root.innerHTML = `<div style="padding:30px 20px;text-align:center"><h3>Keine Quizze vorhanden</h3>
      <p>Erstelle zuerst ein Quiz.</p>
      <button class="btn btn-primary" id="gs-back">← Zurück</button></div>`;
    root.querySelector("#gs-back").addEventListener("click", () => navigate("games"));
    return null;
  }

  const allQs = quizzes.flatMap(q => q.questions || []);
  return new Promise((resolve) => {
    let html = `<div class="game-setup">
      <h2 class="game-setup-title">${esc(title)}</h2>
      <p class="game-setup-sub">${esc(subtitle)}</p>
      <div class="game-setup-list">
        <button class="game-src-btn game-src-all" data-idx="all">
          <span class="game-src-name">🌐 Alle Quizze</span>
          <span class="game-src-meta">${allQs.length} Fragen</span>
        </button>`;
    quizzes.forEach((q, i) => {
      const n = (q.questions || []).length;
      html += `<button class="game-src-btn" data-idx="${i}"${n === 0 ? " disabled" : ""}>
        <span class="game-src-name">${esc(q.name || "Quiz")}</span>
        <span class="game-src-meta">${n} Fragen</span>
      </button>`;
    });
    html += `</div>
      <button class="btn-secondary" id="gs-back" style="margin-top:16px;width:100%">← Zurück</button>
    </div>`;
    root.innerHTML = html;

    root.querySelectorAll(".game-src-btn").forEach(btn => {
      if (btn.disabled) return;
      btn.addEventListener("click", () => {
        const idx = btn.dataset.idx;
        resolve(idx === "all" ? allQs : (quizzes[+idx].questions || []));
      });
    });
    root.querySelector("#gs-back").addEventListener("click", () => {
      navigate("games"); resolve(null);
    });
  });
}

function norm(s) {
  return (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");
}

function stripLatex(s) {
  return norm(s)
    .replace(/\$\$[\s\S]*?\$\$/g, m => m.slice(2, -2))
    .replace(/\$([^$]+)\$/g, (_, t) => t)
    .replace(/\\(?:frac|sqrt|text|mathrm|mathbf)\{([^}]*)\}/g, "$1")
    .replace(/[\\{}^_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns { prompt, image, kind: "choice"|"text", options:[{text,correct}], accept:[..] }
// or null if the question can't be played as a quick challenge.
export function normalizeQuestion(q) {
  if (!q) return null;
  const image = q.image || q.image_data || null;
  // PWA stores the question text in `question_text`; fall back to text/title.
  const prompt = (q.question_text || q.text || q.title || "").trim();
  const type = q.question_type;
  const explanation = (q.explanation || "").trim();

  if (type === "single_choice" || type === "multiple_choice") {
    const options = (q.options || [])
      .filter(o => (o.text ?? "").toString().trim().length > 0)
      .map(o => ({ text: o.text, correct: !!o.is_correct }));
    if (options.length < 2 || !options.some(o => o.correct)) return null;
    const correctCount = options.filter(o => o.correct).length;
    // multiple_choice with >1 correct → must pick all correct; otherwise single pick
    const kind = (type === "multiple_choice" && correctCount > 1) ? "multi" : "choice";
    const answerText = options.filter(o => o.correct).map(o => o.text).join(", ");
    return { prompt: prompt || "Wähle die richtige Antwort", image, kind, options, accept: [], explanation, answerText };
  }

  if (type === "free_text") {
    const accept = (q.correct_text || "").split(/[;|]/).map(norm).filter(Boolean);
    if (!accept.length) return null;
    return { prompt: prompt || "Beantworte die Frage", image, kind: "text", options: [], accept, explanation, answerText: q.correct_text || accept[0] };
  }

  if (type === "fill_blank") {
    const blanks = (q.blanks || []).filter(b => norm(b));
    if (!blanks.length) return null;
    if (blanks.length === 1) {
      let p = prompt;
      if (!/_{2,}|\[\.\.\.\]|…/.test(p)) p = p + "  ( ___ )";
      return { prompt: p, image, kind: "text", options: [], accept: [norm(blanks[0])], explanation, answerText: blanks[0] };
    }
    let p = prompt;
    if (!/_{2,}|\[\.\.\.\]|…/.test(p)) p = p + "  (" + blanks.map((_, i) => `Lücke ${i + 1}`).join(", ") + ")";
    return { prompt: p, image, kind: "multi_text", blanks, options: [], accept: blanks.map(norm), explanation, answerText: blanks.join(", ") };
  }

  if (type === "math_formula") {
    const accept = [norm(q.correct_formula)].filter(Boolean);
    if (!accept.length) return null;
    return { prompt: prompt || "Gib die Formel/Lösung ein", image, kind: "text", options: [], accept, explanation, answerText: q.correct_formula || "" };
  }

  // drag_drop, diagram_label, mark_image: need special interaction → skip
  return null;
}

export function buildPlayable(questions) {
  const out = [];
  for (const q of (questions || [])) {
    const n = normalizeQuestion(q);
    if (n) { n.diff = difficultyOf(q); out.push(n); }
  }
  return out;
}

// Difficulty 1 (easy) .. 3 (hard)
export function difficultyOf(q) {
  let d = 1;
  const type = q.question_type;
  if (type === "free_text" || type === "math_formula") d = 3;
  else if (type === "multiple_choice" || type === "fill_blank") d = 2;
  else if (type === "single_choice") d = (q.options?.length || 0) >= 4 ? 2 : 1;
  if ((q.points || 1) >= 3) d = Math.max(d, 3);
  else if ((q.points || 1) === 2) d = Math.max(d, 2);
  return d;
}

// For a normalized item we keep difficulty by computing from its shape.
export function difficultyOfNormalized(n) {
  if (n.kind === "text" || n.kind === "multi_text") return 3;
  if (n.options.length >= 4) return 2;
  return 1;
}

// Multi-select correctness: the selected set must exactly match the correct set.
export function checkMulti(options, selectedIdx) {
  const correct = options.map((o, i) => (o.correct ? i : -1)).filter(i => i >= 0).sort((a, b) => a - b);
  const sel = [...selectedIdx].sort((a, b) => a - b);
  return sel.length === correct.length && sel.every((v, k) => v === correct[k]);
}

export function checkMultiText(blanks, values) {
  if (blanks.length !== values.length) return false;
  return blanks.every((b, i) => checkText([norm(b)], values[i]));
}

// Levenshtein edit distance between two strings.
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// How many typos to tolerate for a given target length: longer answers may
// have a small spelling slip without being wrong. Short answers must be exact.
function typoTolerance(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  if (len <= 12) return 2;
  return 3;
}

// Fuzzy equality: identical after normalizing, or within the typo tolerance.
function fuzzyEqual(a, b) {
  if (a === b) return true;
  const tol = typoTolerance(Math.max(a.length, b.length));
  if (tol === 0) return false;
  // Length difference alone can already exceed the tolerance.
  if (Math.abs(a.length - b.length) > tol) return false;
  return editDistance(a, b) <= tol;
}

export function checkText(accept, value) {
  const v = norm(value);
  if (!v) return false;
  const vStripped = stripLatex(value);
  return accept.some(a => {
    if (a === v || (a.length > 3 && a.includes(v)) || (v.length > 3 && v.includes(a))) return true;
    const aStripped = stripLatex(a);
    if (aStripped === vStripped) return true;
    if (aStripped.length > 3 && aStripped.includes(vStripped)) return true;
    if (vStripped.length > 3 && vStripped.includes(aStripped)) return true;
    // Tolerate minor spelling mistakes (typos) on the whole answer.
    if (fuzzyEqual(a, v) || fuzzyEqual(aStripped, vStripped)) return true;
    return false;
  });
}

// AI-enhanced text check: first tries local match, then falls back to AI.
// Returns a Promise<{correct, feedback?}>.
export async function checkTextSmart(question, accept, value) {
  const localOk = checkText(accept, value);
  if (localOk) return { correct: true, feedback: null };
  // If the user typed something non-trivial, ask AI
  const v = norm(value);
  if (!v || v.length < 2) return { correct: false, feedback: null };
  try {
    const { checkFreeTextAI } = await import("./ai-service.js");
    const result = await checkFreeTextAI(question, value, accept);
    if (result) return result;
  } catch { /* no API key or network error — fall back to local */ }
  return { correct: false, feedback: null };
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escHtml(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mathEscLocal(s) {
  const escaped = escHtml(s);
  if (!escaped.includes("$") || typeof window.katex === "undefined") return escaped;
  const LATEX_RE = /(\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?\$)/g;
  return escaped.replace(LATEX_RE, (m) => {
    const display = m.startsWith("$$");
    const tex = display ? m.slice(2, -2) : m.slice(1, -1);
    try { return window.katex.renderToString(tex, { displayMode: display, throwOnError: false }); }
    catch { return m; }
  });
}

const DIFF_NAMES = { 1: "Leicht", 2: "Mittel", 3: "Schwer" };

// Build an end-of-game feedback report from an answer log.
// log: [{ q (normalized question), correct: bool, userAnswer: string }]
// Returns an HTML string: accuracy, per-difficulty breakdown, and a review of
// the wrong answers with the correct solution + explanation.
export function buildFeedbackHtml(log) {
  if (!log || !log.length) {
    return `<div class="game-feedback"><p>Keine Fragen beantwortet.</p></div>`;
  }
  const total = log.length;
  const correct = log.filter(e => e.correct).length;
  const pct = Math.round((correct / total) * 100);

  // Per-difficulty accuracy → shows where the difficulties were
  const byDiff = { 1: { c: 0, t: 0 }, 2: { c: 0, t: 0 }, 3: { c: 0, t: 0 } };
  for (const e of log) {
    const d = e.q.diff || 1;
    byDiff[d].t++;
    if (e.correct) byDiff[d].c++;
  }
  const diffRows = [1, 2, 3].filter(d => byDiff[d].t > 0).map(d => {
    const { c, t } = byDiff[d];
    const p = Math.round((c / t) * 100);
    const color = p >= 70 ? "#22c55e" : p >= 40 ? "#f59e0b" : "#ef4444";
    return `<div class="fb-diff-row">
      <span class="fb-diff-name">${DIFF_NAMES[d]}</span>
      <div class="fb-bar"><div class="fb-bar-fill" style="width:${p}%;background:${color}"></div></div>
      <span class="fb-diff-val">${c}/${t}</span>
    </div>`;
  }).join("");

  // The questions that gave trouble (wrong answers), most-difficult first
  const wrong = log.filter(e => !e.correct).sort((a, b) => (b.q.diff || 1) - (a.q.diff || 1));
  let reviewHtml = "";
  if (wrong.length) {
    reviewHtml = `<h3 class="fb-h3">📌 Das solltest du dir nochmal anschauen</h3>
      <div class="fb-review">` +
      wrong.map((e, i) => {
        const q = e.q;
        const ua = (e.userAnswer ?? "").toString().trim();
        const hasExplanation = !!(q.explanation || e.aiFeedback);
        const explText = q.explanation || e.aiFeedback || "";
        return `<div class="fb-item fb-item-d${q.diff || 1}">
          <div class="fb-q">${mathEscLocal(q.prompt)}</div>
          ${ua ? `<div class="fb-ua">Deine Antwort: <span>${mathEscLocal(ua)}</span></div>` : ""}
          <div class="fb-ca">✅ Richtig: <span>${mathEscLocal(q.answerText || "—")}</span></div>
          ${hasExplanation ? `<div class="fb-ex">💡 ${escHtml(explText)}</div>` : ""}
          ${!hasExplanation ? `<button class="fb-explain-btn" data-idx="${i}">💡 Erklärung laden</button>
            <div class="fb-ex fb-ex-ai" id="fb-ex-${i}" style="display:none"></div>` : ""}
        </div>`;
      }).join("") +
      `</div>`;
  } else {
    reviewHtml = `<p class="fb-perfect">🎉 Alles richtig beantwortet — keine Schwachstellen!</p>`;
  }

  // A short, motivating summary line
  let verdict;
  if (pct >= 90) verdict = "Hervorragend! Du beherrschst den Stoff.";
  else if (pct >= 70) verdict = "Solide! Ein paar Punkte noch festigen.";
  else if (pct >= 50) verdict = "Auf gutem Weg — wiederhole die markierten Fragen.";
  else verdict = "Hier steckt noch Lernpotenzial. Schau dir die Lösungen an!";

  return `<div class="game-feedback">
    <div class="fb-score-ring" style="--p:${pct}">
      <div class="fb-score-num">${pct}%</div>
      <div class="fb-score-sub">${correct}/${total} richtig</div>
    </div>
    <p class="fb-verdict">${verdict}</p>
    <h3 class="fb-h3">📊 Nach Schwierigkeit</h3>
    <div class="fb-diffs">${diffRows}</div>
    ${reviewHtml}
  </div>`;
}

// Call AFTER inserting the feedback HTML into the DOM.
// Wires up the "💡 Erklärung laden" buttons.
export function attachFeedbackListeners(container, log) {
  const wrong = (log || []).filter(e => !e.correct);
  container.querySelectorAll(".fb-explain-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const e = wrong[idx];
      if (!e) return;
      btn.textContent = "⏳ Lädt…";
      btn.disabled = true;
      try {
        const { quickExplain } = await import("./ai-service.js");
        const text = await quickExplain(e.q.prompt, e.q.answerText || "", e.userAnswer || "");
        const box = container.querySelector(`#fb-ex-${idx}`);
        if (text && box) {
          box.textContent = "💡 " + text;
          box.style.display = "block";
        }
        btn.style.display = "none";
      } catch {
        btn.textContent = "❌ Fehler — nochmal?";
        btn.disabled = false;
      }
    });
  });
}
