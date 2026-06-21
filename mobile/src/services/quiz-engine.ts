import type { Question, QuestionType, AnswerResult, QuestionProgress } from "../types/quiz";

export function checkAnswer(question: Question, userInput: any): AnswerResult {
  const qt = question.question_type;

  switch (qt) {
    case "single_choice":
      return checkSingleChoice(question, userInput as number);
    case "multiple_choice":
      return checkMultipleChoice(question, userInput as number[]);
    case "free_text":
      return checkFreeText(question, userInput as string);
    case "fill_blank":
      return checkFillBlank(question, userInput as string[]);
    case "drag_drop":
      return checkDragDrop(question, userInput as Record<string, string>);
    case "math_formula":
      return checkMathFormula(question, userInput as string);
    default:
      return { question_id: question.id, is_correct: false, score: 0, max_score: question.points, user_answer: String(userInput), correct_answer: "" };
  }
}

function checkSingleChoice(q: Question, selected: number): AnswerResult {
  const correctIdx = q.options.findIndex((o) => o.is_correct);
  const isCorrect = selected === correctIdx;
  return {
    question_id: q.id,
    is_correct: isCorrect,
    score: isCorrect ? q.points : 0,
    max_score: q.points,
    user_answer: q.options[selected]?.text ?? "",
    correct_answer: q.options[correctIdx]?.text ?? "",
  };
}

function checkMultipleChoice(q: Question, selected: number[]): AnswerResult {
  const correctSet = new Set(q.options.map((o, i) => (o.is_correct ? i : -1)).filter((i) => i >= 0));
  const selectedSet = new Set(selected);
  const isCorrect = correctSet.size === selectedSet.size && [...correctSet].every((i) => selectedSet.has(i));
  const correct = [...correctSet].filter((i) => selectedSet.has(i)).length;
  const wrong = [...selectedSet].filter((i) => !correctSet.has(i)).length;
  const score = isCorrect ? q.points : Math.max(0, (correct / Math.max(correctSet.size, 1)) * q.points - wrong * 0.5);

  return {
    question_id: q.id,
    is_correct: isCorrect,
    score: Math.round(score * 10) / 10,
    max_score: q.points,
    user_answer: selected.map((i) => q.options[i]?.text).join(", "),
    correct_answer: [...correctSet].map((i) => q.options[i]?.text).join(", "),
  };
}

function checkFreeText(q: Question, answer: string): AnswerResult {
  const isCorrect = answer.trim().toLowerCase() === q.correct_text.trim().toLowerCase();
  return {
    question_id: q.id,
    is_correct: isCorrect,
    score: isCorrect ? q.points : 0,
    max_score: q.points,
    user_answer: answer,
    correct_answer: q.correct_text,
  };
}

function checkFillBlank(q: Question, answers: string[]): AnswerResult {
  let correct = 0;
  for (let i = 0; i < Math.min(answers.length, q.blanks.length); i++) {
    if (answers[i].trim().toLowerCase() === q.blanks[i].trim().toLowerCase()) correct++;
  }
  const total = Math.max(q.blanks.length, 1);
  const isCorrect = correct === total;
  return {
    question_id: q.id,
    is_correct: isCorrect,
    score: Math.round(((correct / total) * q.points) * 10) / 10,
    max_score: q.points,
    user_answer: answers.join(" | "),
    correct_answer: q.blanks.join(" | "),
  };
}

function checkDragDrop(q: Question, assignments: Record<string, string>): AnswerResult {
  let correct = 0;
  for (const pair of q.drag_drop_pairs) {
    if (assignments[pair.target] === pair.source) correct++;
  }
  const total = Math.max(q.drag_drop_pairs.length, 1);
  const isCorrect = correct === total;
  return {
    question_id: q.id,
    is_correct: isCorrect,
    score: Math.round(((correct / total) * q.points) * 10) / 10,
    max_score: q.points,
    user_answer: JSON.stringify(assignments),
    correct_answer: JSON.stringify(Object.fromEntries(q.drag_drop_pairs.map((p) => [p.target, p.source]))),
  };
}

function normalizeMath(expr: string): string {
  let e = expr.trim();
  if (e.startsWith("$$") && e.endsWith("$$")) e = e.slice(2, -2);
  else if (e.startsWith("$") && e.endsWith("$")) e = e.slice(1, -1);
  e = e.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "(($1)/($2))");
  e = e.replace(/[{} ]/g, "");
  e = e.replace(/\\cdot|\\times/g, "*");
  e = e.replace(/\\left|\\right/g, "");
  e = e.replace(/\\sqrt/g, "Math.sqrt");
  e = e.replace(/\\pi/g, String(Math.PI));
  e = e.replace(/\^/g, "**");
  return e.toLowerCase();
}

function evalMath(expr: string): number | null {
  try {
    const cleaned = normalizeMath(expr);
    if (!/^[0-9.+\-*/() mathsqrpi]+$/i.test(cleaned)) return null;
    return Function(`"use strict"; return (${cleaned})`)();
  } catch {
    return null;
  }
}

function checkMathFormula(q: Question, answer: string): AnswerResult {
  if (!answer?.trim()) {
    return { question_id: q.id, is_correct: false, score: 0, max_score: q.points, user_answer: "", correct_answer: q.correct_formula };
  }
  if (normalizeMath(answer) === normalizeMath(q.correct_formula)) {
    return { question_id: q.id, is_correct: true, score: q.points, max_score: q.points, user_answer: answer, correct_answer: q.correct_formula };
  }
  const tol = q.tolerance > 0 ? q.tolerance : 0.001;
  const uv = evalMath(answer);
  const cv = evalMath(q.correct_formula);
  if (uv !== null && cv !== null) {
    const isCorrect = cv === 0 ? Math.abs(uv) < tol : Math.abs(uv - cv) / Math.max(Math.abs(cv), 1e-10) < tol;
    if (isCorrect) {
      return { question_id: q.id, is_correct: true, score: q.points, max_score: q.points, user_answer: answer, correct_answer: q.correct_formula };
    }
  }
  return { question_id: q.id, is_correct: false, score: 0, max_score: q.points, user_answer: answer, correct_answer: q.correct_formula };
}

export function updateProgress(
  progress: Record<string, QuestionProgress>,
  questionId: string,
  correct: boolean
): Record<string, QuestionProgress> {
  const p = progress[questionId] ?? { question_id: questionId, box: 1, times_correct: 0, times_wrong: 0, last_seen: "" };
  p.last_seen = new Date().toISOString();
  if (correct) {
    p.times_correct++;
    p.box = Math.min(5, p.box + 1);
  } else {
    p.times_wrong++;
    p.box = Math.max(1, p.box - 1);
  }
  return { ...progress, [questionId]: p };
}
