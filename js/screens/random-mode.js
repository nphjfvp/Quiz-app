import { loadQuizzes } from "../store.js";
import { navigate } from "../router.js";
import { esc } from "../utils.js";

// Globaler Zufalls-Modus: mischt Fragen aus ALLEN Quizzen zu einer Lernrunde.
// Baut ein synthetisches Quiz und startet die normale Quiz-Engine (mode "single").
// Da der Fortschritt pro Frage-ID gespeichert wird, aktualisiert das die echten
// Leitner-/FSRS-Daten der jeweiligen Quellfragen.
export async function render(root) {
  const quizzes = await loadQuizzes();
  const all = [];
  for (const quiz of quizzes) {
    for (const q of (quiz.questions || [])) all.push(q);
  }

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="section-title">🎲 Zufalls-Modus</div>`;

  if (all.length < 1) {
    html += `<div class="empty">Noch keine Fragen vorhanden.<br>Erstelle zuerst ein Quiz.</div>`;
    root.innerHTML = html;
    root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
    return;
  }

  const max = all.length;
  const def = Math.min(20, max);
  html += `<div class="card">
    <p style="margin:0 0 12px;color:var(--text-light);font-size:0.9rem">
      Mischt zufällige Fragen aus allen ${quizzes.length} Quizzen (${max} Fragen gesamt).
    </p>
    <div class="input-group">
      <label>Anzahl Fragen</label>
      <input type="number" id="rand-count" class="input" min="1" max="${max}" value="${def}">
      <div class="num-q-presets">
        ${[10, 20, 30, 50].filter(n => n <= max).map(n => `<button type="button" class="num-preset" data-n="${n}">${n}</button>`).join("")}
        <button type="button" class="num-preset" data-n="${max}">Alle (${max})</button>
      </div>
    </div>
    <button class="btn btn-primary btn-lg btn-block" id="rand-start">Starten</button>
  </div>`;

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));

  const countInput = root.querySelector("#rand-count");
  root.querySelectorAll(".num-preset").forEach(b =>
    b.addEventListener("click", () => { countInput.value = b.dataset.n; }));

  root.querySelector("#rand-start").addEventListener("click", () => {
    let n = parseInt(countInput.value, 10);
    if (!Number.isFinite(n) || n < 1) n = def;
    n = Math.min(max, n);
    // Fisher-Yates-Shuffle, dann die ersten n Fragen
    const pool = [...all];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const questions = pool.slice(0, n);
    const quiz = { id: "random", name: "🎲 Zufalls-Quiz", questions };
    navigate("quiz", { quiz, mode: "single" });
  });
}
