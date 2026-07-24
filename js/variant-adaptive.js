// Adaptive Schwierigkeits-Varianten: mehrere Quizze (aus generateDifficultyVariants
// im Import-Modus), die dieselben Fragen in aufsteigend schwereren Fragetypen
// enthalten (gleiche Reihenfolge/Anzahl, verknüpft über quiz.variantGroup +
// quiz.variantLevel). Dieses Modul wählt pro Frage-Index die aktuell passende
// Stufe (statt alle Level gemischt zu zeigen) und befördert eine Frage ins
// nächste Level, sobald sie "grün" ist (Box ≥ GREEN_BOX_THRESHOLD).
import { loadVariantProgress, saveVariantProgress } from "./store.js";

export const GREEN_BOX_THRESHOLD = 3; // Box-Farben: 1 rot, 2 orange, 3 grün, 4/5 blau/türkis

/** Gruppiert eine Quiz-Liste nach variantGroup; jede Gruppe nach variantLevel sortiert. */
export function groupVariantQuizzes(quizzes) {
  const groups = new Map();
  for (const q of quizzes) {
    if (!q.variantGroup) continue;
    if (!groups.has(q.variantGroup)) groups.set(q.variantGroup, []);
    groups.get(q.variantGroup).push(q);
  }
  for (const arr of groups.values()) arr.sort((a, b) => (a.variantLevel ?? 0) - (b.variantLevel ?? 0));
  return groups;
}

/**
 * Baut für EINE Variantengruppe (levelQuizzes, aufsteigend sortiert) die Liste
 * der aktuell zu zeigenden Fragen — pro Index genau eine, auf dem Level, das
 * der bisherige Fortschritt vorsieht (Standard: Level 0, die leichteste Stufe).
 */
export async function buildAdaptiveQuestions(levelQuizzes) {
  if (!levelQuizzes.length) return [];
  const variantGroup = levelQuizzes[0].variantGroup;
  const count = levelQuizzes[0].questions.length;
  const maxLevel = levelQuizzes.length - 1;
  const typeLabels = levelQuizzes.map(q => q.variantTypeLabel || "");
  const progress = await loadVariantProgress();

  const out = [];
  for (let i = 0; i < count; i++) {
    const rec = progress[`${variantGroup}:${i}`] || { level: 0, box: 1 };
    const level = Math.min(rec.level ?? 0, maxLevel);
    const src = levelQuizzes[level]?.questions?.[i];
    if (!src) continue;
    out.push({
      ...src,
      // Eigene ID pro (Gruppe, Index) statt der Level-spezifischen Frage-ID —
      // so bleibt z.B. das Markieren/Fehler-Tagebuch über Level-Wechsel stabil.
      id: `${variantGroup}:${i}`,
      _variantGroup: variantGroup,
      _variantIndex: i,
      _variantLevel: level,
      _variantMaxLevel: maxLevel,
      _variantTypeLabels: typeLabels,
      _variantBox: rec.box ?? 1,
    });
  }
  return out;
}

/**
 * Nach einer Antwort: Box fortschreiben (wie Leitner), bei Erreichen von
 * "grün" (und sofern noch nicht auf der schwersten Stufe) ins nächste Level
 * befördern — Box startet dort wieder frisch bei 1.
 */
export async function recordVariantAnswer(question, correct) {
  if (question._variantGroup == null) return null;
  const progress = await loadVariantProgress();
  const key = `${question._variantGroup}:${question._variantIndex}`;
  const rec = progress[key] || { level: question._variantLevel ?? 0, box: 1, times_correct: 0, times_wrong: 0 };

  if (correct) { rec.times_correct = (rec.times_correct || 0) + 1; rec.box = Math.min(5, (rec.box || 1) + 1); }
  else { rec.times_wrong = (rec.times_wrong || 0) + 1; rec.box = Math.max(1, (rec.box || 1) - 1); }

  let promoted = false;
  let newTypeLabel = null;
  const maxLevel = question._variantMaxLevel ?? 0;
  if (rec.box >= GREEN_BOX_THRESHOLD && rec.level < maxLevel) {
    rec.level += 1;
    rec.box = 1;
    promoted = true;
    newTypeLabel = question._variantTypeLabels?.[rec.level] || "";
  }

  progress[key] = rec;
  await saveVariantProgress(progress);
  return { promoted, newLevel: rec.level, newTypeLabel, maxLevel, mastered: rec.level >= maxLevel && rec.box >= GREEN_BOX_THRESHOLD };
}

/** Fortschritts-Zahlen einer Variantengruppe für Anzeigen (z.B. im Ordner). */
export async function countVariantMastery(levelQuizzes) {
  if (!levelQuizzes.length) return { total: 0, green: 0, mastered: 0 };
  const variantGroup = levelQuizzes[0].variantGroup;
  const count = levelQuizzes[0].questions.length;
  const maxLevel = levelQuizzes.length - 1;
  const progress = await loadVariantProgress();
  let green = 0, mastered = 0;
  for (let i = 0; i < count; i++) {
    const rec = progress[`${variantGroup}:${i}`];
    if (!rec) continue;
    if ((rec.box ?? 1) >= GREEN_BOX_THRESHOLD) {
      green++;
      if (rec.level >= maxLevel) mastered++;
    }
  }
  return { total: count, green, mastered };
}
