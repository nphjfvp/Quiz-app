import { loadQuizzes, addCoins, saveGameScore } from "../store.js";
import { buildPlayable, shuffle } from "../games-util.js";
import { navigate } from "../router.js";
import { mathEsc } from "../utils.js";

export async function render(root) {
  const quizzes = await loadQuizzes();
  const allQs = quizzes.flatMap(q => q.questions || []);
  let playable = buildPlayable(allQs).filter(q => q.kind === "text" && q.accept[0]?.length >= 3 && q.accept[0]?.length <= 30);
  playable = shuffle(playable);
  if (playable.length < 3) {
    root.innerHTML = `<div style="padding:30px 20px;text-align:center"><h3>Zu wenige Freitext-Fragen</h3><p>Mindestens 3 mit kurzer Antwort nötig.</p><button class="btn btn-primary" id="b">← Zurück</button></div>`;
    root.querySelector("#b").addEventListener("click", () => navigate("games"));
    return;
  }

  const MAX_ROUNDS = Math.min(10, playable.length);
  const MAX_WRONG = 7;
  let round = 0;
  let totalScore = 0;
  let totalCorrect = 0;

  function startRound() {
    if (round >= MAX_ROUNDS) { showFinal(); return; }
    const q = playable[round];
    const answer = (q.answerText || q.accept[0] || "").trim();
    const letters = answer.toUpperCase().split("");
    const unique = [...new Set(letters.filter(c => /[A-ZÄÖÜß0-9]/i.test(c)))];
    let revealed = new Set();
    let wrong = 0;
    let guessed = new Set();
    round++;

    function renderHangman() {
      const display = letters.map(c => {
        if (!/[A-ZÄÖÜß0-9]/i.test(c)) return c;
        return revealed.has(c) ? c : "_";
      }).join(" ");

      const parts = ["head", "body", "left-arm", "right-arm", "left-leg", "right-leg", "face"];
      let hangmanSvg = `<svg viewBox="0 0 120 140" class="hangman-svg">
        <line x1="20" y1="135" x2="100" y2="135" stroke="currentColor" stroke-width="3"/>
        <line x1="40" y1="135" x2="40" y2="15" stroke="currentColor" stroke-width="3"/>
        <line x1="40" y1="15" x2="80" y2="15" stroke="currentColor" stroke-width="3"/>
        <line x1="80" y1="15" x2="80" y2="30" stroke="currentColor" stroke-width="3"/>`;
      if (wrong >= 1) hangmanSvg += `<circle cx="80" cy="40" r="10" fill="none" stroke="currentColor" stroke-width="2"/>`;
      if (wrong >= 2) hangmanSvg += `<line x1="80" y1="50" x2="80" y2="85" stroke="currentColor" stroke-width="2"/>`;
      if (wrong >= 3) hangmanSvg += `<line x1="80" y1="58" x2="65" y2="72" stroke="currentColor" stroke-width="2"/>`;
      if (wrong >= 4) hangmanSvg += `<line x1="80" y1="58" x2="95" y2="72" stroke="currentColor" stroke-width="2"/>`;
      if (wrong >= 5) hangmanSvg += `<line x1="80" y1="85" x2="65" y2="105" stroke="currentColor" stroke-width="2"/>`;
      if (wrong >= 6) hangmanSvg += `<line x1="80" y1="85" x2="95" y2="105" stroke="currentColor" stroke-width="2"/>`;
      if (wrong >= 7) {
        hangmanSvg += `<circle cx="76" cy="37" r="1.5" fill="currentColor"/>`;
        hangmanSvg += `<circle cx="84" cy="37" r="1.5" fill="currentColor"/>`;
        hangmanSvg += `<path d="M75 44 Q80 41 85 44" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
      }
      hangmanSvg += `</svg>`;

      const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789".split("");
      const keyboard = alpha.map(c => {
        const cls = guessed.has(c) ? (revealed.has(c) ? "correct" : "wrong") : "";
        return `<button class="hm-key ${cls}" data-c="${c}" ${guessed.has(c) ? "disabled" : ""}>${c}</button>`;
      }).join("");

      const won = unique.every(c => revealed.has(c));
      const lost = wrong >= MAX_WRONG;

      let html = `<div class="hm-header">
        <span>Runde ${round}/${MAX_ROUNDS}</span>
        <span>❤️ ${MAX_WRONG - wrong}</span>
        <span>⭐ ${totalScore}</span>
      </div>
      <div class="hm-prompt">${mathEsc(q.prompt)}</div>
      <div class="hm-figure">${hangmanSvg}</div>
      <div class="hm-word">${display}</div>`;

      if (won || lost) {
        if (won) { totalScore += 10; totalCorrect++; }
        html += `<div class="hm-result ${won ? "won" : "lost"}">
          ${won ? "✅ Richtig!" : `❌ Leider falsch! Antwort: <strong>${mathEsc(answer)}</strong>`}
        </div>
        <button class="btn btn-primary" id="hm-next" style="width:100%;margin-top:12px">Weiter →</button>`;
      } else {
        html += `<div class="hm-keyboard">${keyboard}</div>
        <button class="btn btn-ghost" id="hm-solve" style="width:100%;margin-top:8px;font-size:0.85rem">Auflösen</button>`;
      }

      root.innerHTML = html;

      if (!won && !lost) {
        root.querySelectorAll(".hm-key:not([disabled])").forEach(btn => {
          btn.addEventListener("click", () => {
            const c = btn.dataset.c;
            guessed.add(c);
            if (unique.includes(c)) { revealed.add(c); }
            else { wrong++; }
            renderHangman();
          });
        });
        root.querySelector("#hm-solve")?.addEventListener("click", () => {
          wrong = MAX_WRONG;
          renderHangman();
        });
      } else {
        root.querySelector("#hm-next")?.addEventListener("click", startRound);
      }
    }

    renderHangman();
  }

  function showFinal() {
    const coins = totalScore;
    let html = `<div class="speed-result">
      <h2>🎯 Galgenmännchen beendet!</h2>
      <div class="speed-final-score">⭐ ${totalScore} Punkte</div>
      <div class="speed-stats">
        <div>${totalCorrect}/${MAX_ROUNDS} erraten</div>
        <div>🪙 +${coins} Münzen</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-primary" id="retry" style="flex:1">🔄 Nochmal</button>
      <button class="btn btn-ghost" id="back" style="flex:1">← Zurück</button>
    </div>`;
    root.innerHTML = html;
    addCoins(coins, "hangman");
    saveGameScore("hangman", { points: totalScore, coins });
    root.querySelector("#retry").addEventListener("click", () => render(root));
    root.querySelector("#back").addEventListener("click", () => navigate("games"));
  }

  startRound();
}
