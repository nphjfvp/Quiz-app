export function checkAnswer(question, userInput) {
  switch (question.question_type) {
    case "single_choice": return checkSingle(question, userInput);
    case "multiple_choice": return checkMultiple(question, userInput);
    case "free_text": return checkFreeText(question, userInput);
    case "fill_blank": return checkFillBlank(question, userInput);
    case "drag_drop": return checkDragDrop(question, userInput);
    case "math_formula": return checkMath(question, userInput);
    case "diagram_label": return checkDiagramLabel(question, userInput);
    case "mark_image": return checkMarkImage(question, userInput);
    default:
      return { question_id: question.id, is_correct: false, score: 0, max_score: question.points, user_answer: String(userInput), correct_answer: "" };
  }
}

function checkSingle(q, selected) {
  const correctIdx = q.options.findIndex((o) => o.is_correct);
  const ok = selected === correctIdx;
  return { question_id: q.id, is_correct: ok, score: ok ? q.points : 0, max_score: q.points,
    user_answer: q.options[selected]?.text ?? "", correct_answer: q.options[correctIdx]?.text ?? "" };
}

function checkMultiple(q, selected) {
  const correctSet = new Set(q.options.map((o, i) => o.is_correct ? i : -1).filter((i) => i >= 0));
  const selSet = new Set(selected);
  const ok = correctSet.size === selSet.size && [...correctSet].every((i) => selSet.has(i));
  const hits = [...correctSet].filter((i) => selSet.has(i)).length;
  const wrong = [...selSet].filter((i) => !correctSet.has(i)).length;
  const score = ok ? q.points : Math.max(0, (hits / Math.max(correctSet.size, 1)) * q.points - wrong * 0.5);
  return { question_id: q.id, is_correct: ok, score: Math.round(score * 10) / 10, max_score: q.points,
    user_answer: selected.map((i) => q.options[i]?.text).join(", "),
    correct_answer: [...correctSet].map((i) => q.options[i]?.text).join(", ") };
}

function checkFreeText(q, answer) {
  const ok = answer.trim().toLowerCase() === q.correct_text.trim().toLowerCase();
  return { question_id: q.id, is_correct: ok, score: ok ? q.points : 0, max_score: q.points,
    user_answer: answer, correct_answer: q.correct_text };
}

function checkFillBlank(q, answers) {
  let hits = 0;
  for (let i = 0; i < Math.min(answers.length, q.blanks.length); i++) {
    if (answers[i].trim().toLowerCase() === q.blanks[i].trim().toLowerCase()) hits++;
  }
  const total = Math.max(q.blanks.length, 1);
  const ok = hits === total;
  return { question_id: q.id, is_correct: ok, score: Math.round((hits / total) * q.points * 10) / 10,
    max_score: q.points, user_answer: answers.join(" | "), correct_answer: q.blanks.join(" | ") };
}

function checkDragDrop(q, assignments) {
  let hits = 0;
  for (const pair of q.drag_drop_pairs) {
    if (assignments[pair.target] === pair.source) hits++;
  }
  const total = Math.max(q.drag_drop_pairs.length, 1);
  const ok = hits === total;
  return { question_id: q.id, is_correct: ok, score: Math.round((hits / total) * q.points * 10) / 10,
    max_score: q.points, user_answer: JSON.stringify(assignments),
    correct_answer: JSON.stringify(Object.fromEntries(q.drag_drop_pairs.map((p) => [p.target, p.source]))) };
}

function normMath(expr) {
  let e = expr.trim();
  if (e.startsWith("$$") && e.endsWith("$$")) e = e.slice(2, -2);
  else if (e.startsWith("$") && e.endsWith("$")) e = e.slice(1, -1);
  e = e.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "(($1)/($2))");
  e = e.replace(/[{} ]/g, "").replace(/\\cdot|\\times/g, "*");
  e = e.replace(/\\left|\\right/g, "").replace(/\\sqrt/g, "Math.sqrt");
  e = e.replace(/\\pi/g, String(Math.PI)).replace(/\^/g, "**");
  return e.toLowerCase();
}

function evalMath(expr) {
  try {
    const c = normMath(expr);
    if (!/^[0-9.+\-*/() mathsqrpi]+$/i.test(c)) return null;
    return Function(`"use strict"; return (${c})`)();
  } catch { return null; }
}

function checkDiagramLabel(q, placements) {
  const labels = q.diagram_labels || [];
  const tol = 0.13;
  let hits = 0;
  for (const lbl of labels) {
    const p = placements?.[lbl.label];
    if (p) {
      const dist = Math.sqrt((p.x - lbl.x) ** 2 + (p.y - lbl.y) ** 2);
      if (dist <= tol) hits++;
    }
  }
  const total = Math.max(labels.length, 1);
  const ok = hits === total;
  return { question_id: q.id, is_correct: ok, score: Math.round((hits / total) * q.points * 10) / 10,
    max_score: q.points, user_answer: JSON.stringify(placements),
    correct_answer: labels.map(l => `${l.label} (${l.x},${l.y})`).join(", ") };
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function checkMarkImage(q, click) {
  const regions = q.mark_regions || [];
  if (!click) return { question_id: q.id, is_correct: false, score: 0, max_score: q.points, user_answer: "", correct_answer: "Markierung im Bild" };
  let hit = false;
  for (const r of regions) {
    if (r.type === "circle") {
      const dist = Math.sqrt((click.x - r.x) ** 2 + (click.y - r.y) ** 2);
      if (dist <= r.radius) { hit = true; break; }
    } else if (r.type === "polygon" && r.points) {
      if (pointInPolygon(click.x, click.y, r.points)) { hit = true; break; }
    }
  }
  return { question_id: q.id, is_correct: hit, score: hit ? q.points : 0, max_score: q.points,
    user_answer: `(${click.x.toFixed(3)},${click.y.toFixed(3)})`, correct_answer: "Markierung im Bild" };
}

function checkMath(q, answer) {
  if (!answer?.trim())
    return { question_id: q.id, is_correct: false, score: 0, max_score: q.points, user_answer: "", correct_answer: q.correct_formula };
  if (normMath(answer) === normMath(q.correct_formula))
    return { question_id: q.id, is_correct: true, score: q.points, max_score: q.points, user_answer: answer, correct_answer: q.correct_formula };
  const tol = q.tolerance > 0 ? q.tolerance : 0.001;
  const uv = evalMath(answer), cv = evalMath(q.correct_formula);
  if (uv !== null && cv !== null) {
    const ok = cv === 0 ? Math.abs(uv) < tol : Math.abs(uv - cv) / Math.max(Math.abs(cv), 1e-10) < tol;
    if (ok) return { question_id: q.id, is_correct: true, score: q.points, max_score: q.points, user_answer: answer, correct_answer: q.correct_formula };
  }
  return { question_id: q.id, is_correct: false, score: 0, max_score: q.points, user_answer: answer, correct_answer: q.correct_formula };
}

export function updateProgress(progress, questionId, correct) {
  const p = progress[questionId] ?? { question_id: questionId, box: 1, times_correct: 0, times_wrong: 0, last_seen: "" };
  p.last_seen = new Date().toISOString();
  if (correct) { p.times_correct++; p.box = Math.min(5, p.box + 1); }
  else { p.times_wrong++; p.box = Math.max(1, p.box - 1); }
  return { ...progress, [questionId]: p };
}

export class QuizSession {
  constructor(questions, mode = "single") {
    this.questions = [...questions];
    this.mode = mode;
    this.currentIndex = 0;
    this.answers = {};
    if (mode !== "exam") this.shuffle();
  }
  shuffle() {
    for (let i = this.questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.questions[i], this.questions[j]] = [this.questions[j], this.questions[i]];
    }
  }
  get current() { return this.questions[this.currentIndex] ?? null; }
  get finished() { return this.currentIndex >= this.questions.length; }
  get progress() { return this.questions.length ? (this.currentIndex / this.questions.length) : 0; }
  get totalScore() { return Object.values(this.answers).reduce((s, a) => s + a.score, 0); }
  get maxScore() { return this.questions.reduce((s, q) => s + q.points, 0); }
  submit(answer) {
    const q = this.current;
    if (!q) return null;
    const result = checkAnswer(q, answer);
    this.answers[q.id] = result;
    if (this.mode !== "single") this.currentIndex++;
    return result;
  }
  next() { this.currentIndex = Math.min(this.currentIndex + 1, this.questions.length); }
  prev() { this.currentIndex = Math.max(0, this.currentIndex - 1); }
}
