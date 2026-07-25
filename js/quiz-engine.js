export function checkAnswer(question, userInput) {
  // points absichern, damit Scores nie NaN werden
  if (typeof question.points !== "number" || !(question.points > 0)) question.points = 1;
  switch (question.question_type) {
    case "single_choice": return checkSingle(question, userInput);
    case "multiple_choice": return checkMultiple(question, userInput);
    case "free_text": return checkFreeText(question, userInput);
    case "fill_blank": return checkFillBlank(question, userInput);
    case "drag_drop": return checkDragDrop(question, userInput);
    case "drag_category": return checkDragCategory(question, userInput);
    case "math_formula": return checkMath(question, userInput);
    case "diagram_label": return checkDiagramLabel(question, userInput);
    case "mark_image": return checkMarkImage(question, userInput);
    case "key_points": return checkKeyPoints(question, userInput);
    default:
      return { question_id: question.id, is_correct: false, score: 0, max_score: question.points, user_answer: String(userInput), correct_answer: "" };
  }
}

function checkSingle(q, selected) {
  const options = q.options ?? [];
  const correctIdx = options.findIndex((o) => o.is_correct);
  const ok = selected === correctIdx;
  return { question_id: q.id, is_correct: ok, score: ok ? q.points : 0, max_score: q.points,
    user_answer: options[selected]?.text ?? "", correct_answer: options[correctIdx]?.text ?? "" };
}

function checkMultiple(q, selected) {
  const options = q.options ?? [];
  const correctSet = new Set(options.map((o, i) => o.is_correct ? i : -1).filter((i) => i >= 0));
  const selSet = new Set(selected ?? []);
  const ok = correctSet.size > 0 && correctSet.size === selSet.size && [...correctSet].every((i) => selSet.has(i));
  const hits = [...correctSet].filter((i) => selSet.has(i)).length;
  const wrong = [...selSet].filter((i) => !correctSet.has(i)).length;
  const score = ok ? q.points : Math.max(0, (hits / Math.max(correctSet.size, 1)) * q.points - wrong * 0.5);
  return { question_id: q.id, is_correct: ok, score: Math.round(score * 10) / 10, max_score: q.points,
    user_answer: (selected ?? []).map((i) => options[i]?.text).join(", "),
    correct_answer: [...correctSet].map((i) => options[i]?.text).join(", ") };
}

// Normalisiert Antworttext: trim, lowercase, Mehrfach-Leerzeichen + Satzzeichen am Rand weg
function normText(s) {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/^[.,;:!?]+|[.,;:!?]+$/g, "");
}

function stripLatexText(s) {
  return normText(s)
    .replace(/\$\$[\s\S]*?\$\$/g, m => m.slice(2, -2))
    .replace(/\$([^$]+)\$/g, (_, t) => t)
    .replace(/\\(?:frac|sqrt|text|mathrm|mathbf)\{([^}]*)\}/g, "$1")
    .replace(/[\\{}^_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Levenshtein-Distanz (für kleine Tippfehler-Toleranz)
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// Vergleicht eine Antwort gegen eine Lösung – akzeptiert mehrere mit ';' getrennte
// Lösungen und erlaubt kleine Tippfehler (1 Zeichen ab Länge 5, 2 ab Länge 9).
// Exportiert, damit quiz.js dieselbe Tippfehler-/Synonym-Toleranz für die
// Live-Prüfung einzelner Stichpunkt-Nennungen wiederverwenden kann.
export function answerMatches(answer, correct) {
  const a = normText(answer);
  if (a === "") return false;
  const aStripped = stripLatexText(answer);
  const candidates = String(correct ?? "").split(";").map(normText).filter(Boolean);
  for (const c of candidates) {
    if (a === c) return true;
    const allowed = c.length >= 9 ? 2 : c.length >= 5 ? 1 : 0;
    if (allowed > 0 && levenshtein(a, c) <= allowed) return true;
    const cStripped = stripLatexText(c);
    if (aStripped && cStripped && aStripped === cStripped) return true;
    if (allowed > 0 && aStripped && cStripped && levenshtein(aStripped, cStripped) <= allowed) return true;
  }
  return false;
}

function checkFreeText(q, answer) {
  const ok = answerMatches(answer, q.correct_text);
  return { question_id: q.id, is_correct: ok, score: ok ? q.points : 0, max_score: q.points,
    user_answer: answer ?? "", correct_answer: q.correct_text ?? "" };
}

function checkFillBlank(q, answers) {
  const blanks = q.blanks ?? [];
  const ans = answers ?? [];
  let hits = 0;
  for (let i = 0; i < Math.min(ans.length, blanks.length); i++) {
    if (answerMatches(ans[i], blanks[i])) hits++;
  }
  const total = Math.max(blanks.length, 1);
  const ok = hits === total;
  return { question_id: q.id, is_correct: ok, score: Math.round((hits / total) * q.points * 10) / 10,
    max_score: q.points, user_answer: ans.join(" | "), correct_answer: blanks.join(" | ") };
}

// "Stichpunkte": userInput ist ein Array bereits als gefunden erkannter
// Indizes (Live-Abgleich passiert in quiz.js über answerMatches, Versuch für
// Versuch — hier wird nur noch die Endpunktzahl aus dem Endstand berechnet).
function checkKeyPoints(q, foundIndices) {
  const keyPoints = q.key_points ?? [];
  const found = new Set(Array.isArray(foundIndices) ? foundIndices : []);
  const total = Math.max(keyPoints.length, 1);
  const hits = [...found].filter((i) => i >= 0 && i < keyPoints.length).length;
  const ok = hits === total;
  const label = (kp) => String(kp ?? "").split(";")[0].trim();
  const userAnswer = keyPoints.filter((_, i) => found.has(i)).map(label).join(", ");
  const correctAnswer = keyPoints.map(label).join(", ");
  return { question_id: q.id, is_correct: ok, score: Math.round((hits / total) * q.points * 10) / 10,
    max_score: q.points, user_answer: userAnswer, correct_answer: correctAnswer };
}

function checkDragDrop(q, assignments) {
  const pairs = q.drag_drop_pairs ?? [];
  const asg = assignments ?? {};
  let hits = 0;
  for (const pair of pairs) {
    if (asg[pair.target] === pair.source) hits++;
  }
  const total = Math.max(pairs.length, 1);
  const ok = hits === total;
  return { question_id: q.id, is_correct: ok, score: Math.round((hits / total) * q.points * 10) / 10,
    max_score: q.points, user_answer: JSON.stringify(asg),
    correct_answer: JSON.stringify(Object.fromEntries(pairs.map((p) => [p.target, p.source]))) };
}

function checkDragCategory(q, assignments) {
  const pairs = q.drag_drop_pairs ?? [];
  const asg = assignments ?? {};
  let hits = 0;
  for (const pair of pairs) {
    const assigned = asg[pair.source];
    if (assigned === pair.target) hits++;
  }
  const total = Math.max(pairs.length, 1);
  const ok = hits === total;
  const correctMap = {};
  for (const p of pairs) correctMap[p.source] = p.target;
  return { question_id: q.id, is_correct: ok, score: Math.round((hits / total) * q.points * 10) / 10,
    max_score: q.points, user_answer: JSON.stringify(asg),
    correct_answer: JSON.stringify(correctMap) };
}

function normMath(expr) {
  let e = (expr ?? "").trim();
  if (e.startsWith("$$") && e.endsWith("$$")) e = e.slice(2, -2);
  else if (e.startsWith("$") && e.endsWith("$")) e = e.slice(1, -1);
  e = e.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "(($1)/($2))");
  // \sqrt{...} VOR dem Brace-Removal zu Math.sqrt(...) konvertieren, sonst
  // wären die Klammern weg (\sqrt{16} -> Math.sqrt16, ungültig).
  e = e.replace(/\\sqrt\{([^}]*)\}/g, "Math.sqrt($1)");
  e = e.replace(/[{} ]/g, "").replace(/\\cdot|\\times/g, "*");
  e = e.replace(/\\left|\\right/g, "").replace(/\\sqrt/g, "Math.sqrt");
  e = e.replace(/\\pi/g, String(Math.PI)).replace(/\^/g, "**");
  return e.toLowerCase();
}

function evalMath(expr) {
  try {
    const c = normMath(expr);
    // Sicherheits-Whitelist: normMath lowercased alles, sodass nur Ziffern,
    // Operatoren, Klammern und die Buchstaben {m,a,t,h,s,q,r,p,i} verbleiben.
    // Bezeichner wie fetch/window sind so nicht bildbar -> keine Code-Injektion.
    // Längenschutz gegen ressourcenfressende Riesenausdrücke (z. B. 9**9**9...).
    if (c.length > 200) return null;
    if (!/^[0-9.+\-*/() mathsqrpi]+$/i.test(c)) return null;
    // normMath lowercased auch das injizierte "Math.sqrt" zu "math.sqrt"
    // (undefiniert). Case NACH der Whitelist wiederherstellen, damit sqrt
    // numerisch ausgewertet wird statt über Stringgleichheit abzufallen.
    const safe = c.replace(/\bmath\.sqrt\b/g, "Math.sqrt");
    return Function(`"use strict"; return (${safe});`)();
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
  const formula = q.correct_formula ?? "";
  if (!answer?.trim())
    return { question_id: q.id, is_correct: false, score: 0, max_score: q.points, user_answer: "", correct_answer: formula };
  if (formula && normMath(answer) === normMath(formula))
    return { question_id: q.id, is_correct: true, score: q.points, max_score: q.points, user_answer: answer, correct_answer: formula };
  const tol = q.tolerance > 0 ? q.tolerance : 0.001;
  const uv = evalMath(answer), cv = evalMath(formula);
  if (uv !== null && cv !== null) {
    const ok = cv === 0 ? Math.abs(uv) < tol : Math.abs(uv - cv) / Math.max(Math.abs(cv), 1e-10) < tol;
    if (ok) return { question_id: q.id, is_correct: true, score: q.points, max_score: q.points, user_answer: answer, correct_answer: formula };
  }
  return { question_id: q.id, is_correct: false, score: 0, max_score: q.points, user_answer: answer, correct_answer: formula };
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
    // Adaptives Quiz: Wrong-Queue + Joker-System
    this.wrongQueue = [];          // Frage-IDs, die falsch beantwortet wurden
    this.attempts = {};            // { questionId: { count, userAnswers: [{answer,isCorrect}] } }
    this.appliedJokers = new Set(); // Frage-IDs mit bereits verbrauchtem Joker
    this.hints = {};              // { questionId: "Hint-Text" }
    this.explanations = {};       // { questionId: "KI-Erklärung warum falsch" }
    this._stage = "main";         // "main" | "revisit" | "done"
    this._mainDone = false;
    if (mode !== "exam") this.shuffle();
  }
  shuffle() {
    for (let i = this.questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.questions[i], this.questions[j]] = [this.questions[j], this.questions[i]];
    }
  }
  get current() { return this.questions[this.currentIndex] ?? null; }
  get finished() { return this._stage === "done"; }
  get progress() {
    if (this._stage === "done") return 1;
    return this.questions.length ? (this.currentIndex / this.questions.length) : 0;
  }
  get stage() { return this._stage; }
  get totalScore() { return Object.values(this.answers).reduce((s, a) => s + a.score, 0); }
  get maxScore() { return this.questions.reduce((s, q) => s + q.points, 0); }

  getAttempt(qid) { return this.attempts[qid]?.count ?? 0; }
  getUserAnswers(qid) { return this.attempts[qid]?.userAnswers ?? []; }

  submit(answer) {
    const q = this.current;
    if (!q) return null;
    const result = checkAnswer(q, answer);
    this.answers[q.id] = result;

    if (!this.attempts[q.id]) this.attempts[q.id] = { count: 0, userAnswers: [] };
    this.attempts[q.id].count++;
    this.attempts[q.id].userAnswers.push({ answer, isCorrect: result.is_correct });

    if (!result.is_correct && !this.wrongQueue.includes(q.id)) {
      this.wrongQueue.push(q.id);
    }
    if (result.is_correct) {
      this.wrongQueue = this.wrongQueue.filter(id => id !== q.id);
    }
    if (this.mode !== "single" || this._stage !== "main") this._advance();
    return result;
  }

  markWrong(questionId, userAnswer) {
    if (!this.attempts[questionId]) this.attempts[questionId] = { count: 0, userAnswers: [] };
    if (!this.wrongQueue.includes(questionId)) this.wrongQueue.push(questionId);
    if (userAnswer !== undefined) {
      this.attempts[questionId].userAnswers.push({ answer: userAnswer, isCorrect: false });
    }
  }

  setQuestionData(questionId, data) {
    if (data.hint) this.hints[questionId] = data.hint;
    if (data.explanation) this.explanations[questionId] = data.explanation;
  }

  /** Joker anwenden. Gibt {type, questionId, detail} zurück oder null falls kein Joker verfügbar. */
  applyJoker(questionId) {
    if (this.appliedJokers.has(questionId)) return null;
    const q = this.questions.find(q => q.id === questionId);
    if (!q) return null;

    const wrongAnswers = this.getUserAnswers(questionId).filter(a => !a.isCorrect);
    const lastWrong = wrongAnswers[wrongAnswers.length - 1];
    const userInput = lastWrong?.answer;
    const joker = { type: q.question_type, questionId };

    switch (q.question_type) {
      case "single_choice": {
        const wrongIdx = typeof userInput === "number" ? userInput : parseInt(userInput);
        if (!isNaN(wrongIdx) && q.options?.[wrongIdx] && !q.options[wrongIdx].is_correct) {
          q._jokerDisabledOption = wrongIdx;
          joker.detail = `"${q.options[wrongIdx].text}" ausgegraut`;
        }
        break;
      }
      case "multiple_choice": {
        const selected = Array.isArray(userInput) ? userInput : [];
        const disabled = [], preChecked = [];
        for (let i = 0; i < (q.options || []).length; i++) {
          if (!q.options[i].is_correct && selected.includes(i)) disabled.push(i);
          if (q.options[i].is_correct && !selected.includes(i)) preChecked.push(i);
        }
        q._jokerDisabledOptions = disabled;
        q._jokerPreCheckedOptions = preChecked;
        joker.detail = `${disabled.length} falsche ausgegraut, ${preChecked.length} richtige vor-markiert`;
        break;
      }
      case "free_text": {
        const correct = (q.correct_text || "").split(";")[0].trim();
        if (correct) {
          q._jokerFreeTextHint = `${correct[0]}… (${correct.length} Zeichen)`;
          joker.detail = q._jokerFreeTextHint;
        }
        break;
      }
      case "fill_blank": {
        const prevAnswers = Array.isArray(userInput) ? userInput : [];
        const blanks = q.blanks || [];
        const prefilled = {};
        for (let i = 0; i < Math.min(prevAnswers.length, blanks.length); i++) {
          if (prevAnswers[i] && !answerMatches(prevAnswers[i], blanks[i])) {
            prefilled[i] = prevAnswers[i];
          }
        }
        q._jokerPrefilledBlanks = prefilled;
        joker.detail = `${Object.keys(prefilled).length} Lücke(n) vorausgefüllt`;
        break;
      }
      case "drag_drop": {
        const asg = (typeof userInput === "string" ? JSON.parse(userInput) : userInput) || {};
        const pairs = q.drag_drop_pairs || [];
        const locked = {};
        for (const pair of pairs) {
          if (asg[pair.target] && asg[pair.target] !== pair.source) {
            locked[pair.target] = pair.source;
          }
        }
        q._jokerLockedPairs = locked;
        joker.detail = `${Object.keys(locked).length} Paar(e) fixiert`;
        break;
      }
      case "drag_category": {
        const asg = (typeof userInput === "string" ? JSON.parse(userInput) : userInput) || {};
        const pairs = q.drag_drop_pairs || [];
        const locked = {};
        for (const pair of pairs) {
          if (asg[pair.source] && asg[pair.source] !== pair.target) {
            locked[pair.source] = pair.target;
          }
        }
        q._jokerLockedPairs = locked;
        joker.detail = `${Object.keys(locked).length} Kategorie(n) fixiert`;
        break;
      }
      case "math_formula": {
        q._jokerShowTolerance = true;
        joker.detail = "Toleranz: ±" + (q.tolerance || 0.001);
        break;
      }
      case "diagram_label": {
        q._jokerHighlightZones = true;
        joker.detail = "Ziel-Zonen hervorgehoben";
        break;
      }
      case "mark_image": {
        q._jokerShowRegion = true;
        joker.detail = "Ziel-Region markiert";
        break;
      }
      default: return null;
    }
    this.appliedJokers.add(questionId);
    return joker;
  }

  /** Nächste Frage: main → revisit → done */
  _advance() {
    if (this._stage === "main") {
      this.currentIndex++;
      if (this.currentIndex >= this.questions.length) {
        if (this.wrongQueue.length > 0) {
          this._mainDone = true;
          this._stage = "revisit";
          this.currentIndex = this.questions.findIndex(q => q.id === this.wrongQueue[0]);
        } else {
          this._stage = "done";
        }
      }
    } else if (this._stage === "revisit") {
      const remaining = this.wrongQueue.filter(qid => this.getAttempt(qid) < 4);
      if (remaining.length === 0) { this._stage = "done"; return; }
      const currentQid = this.current?.id;
      const currentPos = remaining.indexOf(currentQid);
      const nextQid = currentPos >= 0 && currentPos < remaining.length - 1
        ? remaining[currentPos + 1] : remaining[0];
      this.currentIndex = this.questions.findIndex(q => q.id === nextQid);
    }
  }

  skipToNext() { if (this._stage === "revisit") this._advance(); else this.currentIndex++; }
  next() { this.currentIndex = Math.min(this.currentIndex + 1, this.questions.length); }
  prev() { this.currentIndex = Math.max(0, this.currentIndex - 1); }
}
