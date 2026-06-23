// Shared helpers for the mini-games: turn arbitrary quiz questions into a
// simple, fast-playable form. Types that can't be represented as a quick
// "pick an option" or "type the answer" challenge are dropped, so a game
// never shows a broken/meaningless question.

function norm(s) {
  return (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");
}

// Returns { prompt, image, kind: "choice"|"text", options:[{text,correct}], accept:[..] }
// or null if the question can't be played as a quick challenge.
export function normalizeQuestion(q) {
  if (!q) return null;
  const image = q.image || q.image_data || null;
  // PWA stores the question text in `question_text`; fall back to text/title.
  const prompt = (q.question_text || q.text || q.title || "").trim();
  const type = q.question_type;

  if (type === "single_choice" || type === "multiple_choice") {
    const options = (q.options || [])
      .filter(o => (o.text ?? "").toString().trim().length > 0)
      .map(o => ({ text: o.text, correct: !!o.is_correct }));
    if (options.length < 2 || !options.some(o => o.correct)) return null;
    const correctCount = options.filter(o => o.correct).length;
    // multiple_choice with >1 correct → must pick all correct; otherwise single pick
    const kind = (type === "multiple_choice" && correctCount > 1) ? "multi" : "choice";
    return { prompt: prompt || "Wähle die richtige Antwort", image, kind, options, accept: [] };
  }

  if (type === "free_text") {
    const accept = (q.correct_text || "").split(/[;|]/).map(norm).filter(Boolean);
    if (!accept.length) return null;
    return { prompt: prompt || "Beantworte die Frage", image, kind: "text", options: [], accept };
  }

  if (type === "fill_blank") {
    const accept = (q.blanks || []).map(norm).filter(Boolean);
    if (!accept.length) return null;
    // Make sure a blank marker is visible in the prompt
    let p = prompt;
    if (!/_{2,}|\[\.\.\.\]|…/.test(p)) p = p + "  ( ___ )";
    return { prompt: p, image, kind: "text", options: [], accept };
  }

  if (type === "math_formula") {
    const accept = [norm(q.correct_formula)].filter(Boolean);
    if (!accept.length) return null;
    return { prompt: prompt || "Gib die Formel/Lösung ein", image, kind: "text", options: [], accept };
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
  if (n.kind === "text") return 3;
  if (n.options.length >= 4) return 2;
  return 1;
}

// Multi-select correctness: the selected set must exactly match the correct set.
export function checkMulti(options, selectedIdx) {
  const correct = options.map((o, i) => (o.correct ? i : -1)).filter(i => i >= 0).sort((a, b) => a - b);
  const sel = [...selectedIdx].sort((a, b) => a - b);
  return sel.length === correct.length && sel.every((v, k) => v === correct[k]);
}

export function checkText(accept, value) {
  const v = norm(value);
  if (!v) return false;
  return accept.some(a => a === v || (a.length > 3 && a.includes(v)) || (v.length > 3 && v.includes(a)));
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
