// FSRS (Free Spaced Repetition Scheduler) – FSRS-4.5
// 1:1-Port von src/fsrs.py. Keine externen Abhängigkeiten.

// Default-Parameter (w0..w18, FSRS-4.5 Paper-Defaults)
const W = [
  0.4, 0.6, 2.4, 5.8,  // w0-w3: Initial-Stabilität für Again/Hard/Good/Easy
  4.93,  // w4: Difficulty Mean-Reversion
  0.94,  // w5: Difficulty-Multiplikator für Rating
  0.86,  // w6: Difficulty-Multiplikator für Delta
  0.01,  // w7: Stabilitäts-Basis nach Fehler
  1.49,  // w8: Stabilitäts-Exponent für D nach Fehler
  0.14,  // w9: Stabilitäts-Exponent für S nach Fehler
  0.94,  // w10: Stabilitäts-Faktor bei Erfolg
  2.18,  // w11: Stabilitäts-Exponent für D bei Erfolg
  0.05,  // w12: Stabilitäts-Exponent für S bei Erfolg
  0.34,  // w13: Stabilitäts-Decay für Retrievability
  1.26,  // w14: Stabilitäts-Wachstum bei Erfolg
  0.29,  // w15: Difficulty-Gewicht auf Stabilität (Hard-Penalty)
  2.61,  // w16: Stabilitäts-Skalierung bei Erfolg (Easy-Bonus)
  0.0,   // w17: reserviert
  0.0,   // w18: reserviert
];

export function newCard(questionId = "") {
  return {
    question_id: questionId,
    difficulty: 5.0,   // 1-10
    stability: 1.0,    // Tage
    reps: 0,
    lapses: 0,
    last_review: "",   // ISO-Timestamp
    scheduled_days: 1.0,
    elapsed_days: 0.0,
    state: "new",      // new, learning, review, relearning
  };
}

const REQUEST_RETENTION = 0.9;

function forgettingCurve(elapsedDays, stability) {
  if (stability <= 0) return 0.0;
  return Math.pow(1.0 + elapsedDays / (9.0 * stability), -1);
}

function initStability(rating) {
  return Math.max(0.1, W[rating - 1]);
}

function initDifficulty(rating) {
  const d = W[4] - Math.exp(W[5] * (rating - 1)) + 1;
  return Math.max(1.0, Math.min(10.0, d));
}

function nextDifficulty(d, rating) {
  const d0_3 = W[4] - Math.exp(W[5] * (3 - 1)) + 1;
  const newD = W[6] * d0_3 + (1.0 - W[6]) * (d - W[7] * (rating - 3));
  return Math.max(1.0, Math.min(10.0, newD));
}

function nextRecallStability(d, s, r, rating) {
  const hardPenalty = rating === 2 ? W[15] : 1.0;
  const easyBonus = rating === 4 ? W[16] : 1.0;
  const inner =
    Math.exp(W[10]) *
    (11.0 - d) *
    Math.pow(s, -W[11]) *
    (Math.exp(W[12] * (1.0 - r)) - 1.0) *
    hardPenalty *
    easyBonus;
  return Math.max(0.1, s * (inner + 1.0));
}

function nextForgetStability(d, s, r) {
  const newS =
    W[7] *
    Math.pow(d, -W[8]) *
    (Math.pow(s + 1.0, W[9]) - 1.0) *
    Math.exp(W[13] * (1.0 - r));
  return Math.max(0.1, newS);
}

function nextInterval(stability) {
  if (REQUEST_RETENTION <= 0 || REQUEST_RETENTION >= 1) return Math.max(1.0, stability);
  const interval = 9.0 * stability * (1.0 / REQUEST_RETENTION - 1.0);
  return Math.max(1.0, Math.round(interval * 10) / 10);
}

function applyAnswerTimeFactor(stability, answerTimeMs, rating) {
  if (answerTimeMs <= 0 || rating === 1) return stability;
  const baselineMs = 10000.0;
  const ratio = baselineMs / Math.max(answerTimeMs, 500.0);
  const factor = ratio < 1.0
    ? Math.max(0.9, Math.min(1.1, 0.9 + 0.2 * Math.min(ratio, 1.0)))
    : Math.max(0.9, Math.min(1.1, 1.0 + 0.1 * Math.min(ratio - 1.0, 1.0)));
  return stability * factor;
}

// Verarbeitet ein Review. rating: 1=Again, 2=Hard, 3=Good, 4=Easy.
// Gibt eine aktualisierte Kopie der Karte zurück.
export function review(cardIn, rating, answerTimeMs = 0, confidence = 0.5) {
  const card = { ...cardIn };
  rating = Math.max(1, Math.min(4, rating));
  confidence = Math.max(0.0, Math.min(1.0, confidence));
  const now = new Date();

  let elapsedDays = 0.0;
  if (card.last_review) {
    const last = new Date(card.last_review);
    elapsedDays = Math.max(0.0, (now - last) / 86400000);
  }

  card.elapsed_days = elapsedDays;
  card.last_review = now.toISOString();

  if (card.state === "new") {
    card.difficulty = initDifficulty(rating);
    card.stability = initStability(rating);
    card.reps = 1;
    card.state = "learning";
    if (rating === 1) card.lapses = 1;
  } else {
    const retrievability = forgettingCurve(elapsedDays, card.stability);
    card.difficulty = nextDifficulty(card.difficulty, rating);
    if (rating === 1) {
      card.stability = nextForgetStability(card.difficulty, card.stability, retrievability);
      card.lapses += 1;
      card.state = "relearning";
    } else {
      card.stability = nextRecallStability(card.difficulty, card.stability, retrievability, rating);
      card.state = "review";
    }
    card.reps += 1;
  }

  card.stability = applyAnswerTimeFactor(card.stability, answerTimeMs, rating);
  card.stability = card.stability * (0.8 + 0.4 * confidence);
  card.stability = Math.max(0.1, card.stability);
  card.difficulty = Math.max(1.0, Math.min(10.0, card.difficulty));
  card.scheduled_days = nextInterval(card.stability);

  return card;
}

// Aktuelle Recall-Wahrscheinlichkeit (0-1).
export function retrievability(card) {
  if (!card || card.state === "new" || !card.last_review) return 0.0;
  const last = new Date(card.last_review);
  const elapsed = Math.max(0.0, (Date.now() - last) / 86400000);
  return forgettingCurve(elapsed, card.stability);
}

// Tage bis zur nächsten Fälligkeit (negativ = überfällig). Neue Karten: 0 (sofort fällig).
export function daysUntilDue(card) {
  if (!card || card.state === "new" || !card.last_review) return 0;
  const last = new Date(card.last_review);
  const elapsed = (Date.now() - last) / 86400000;
  return (card.scheduled_days || 1) - elapsed;
}

// Leitet aus Korrektheit + optionalem Confidence-Level (1-4) ein FSRS-Rating ab.
export function ratingFromResult(isCorrect, confidence = 3) {
  if (isCorrect) return confidence >= 3 ? 4 : 3;
  return confidence >= 2 ? 2 : 1;
}
