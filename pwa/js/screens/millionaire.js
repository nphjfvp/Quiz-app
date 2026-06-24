import { loadQuizzes, loadProgress, addCoins, saveGameScore } from "../store.js";
import { buildPlayable, shuffle, checkText, buildFeedbackHtml, attachFeedbackListeners, difficultyOfNormalized, pickQuizSource } from "../games-util.js";
import { navigate } from "../router.js";
import { mathEsc } from "../utils.js";

const PRIZES = [
  { label: "50 €", pts: 1 }, { label: "100 €", pts: 2 }, { label: "200 €", pts: 3 },
  { label: "300 €", pts: 4 }, { label: "500 €", pts: 5 }, { label: "1.000 €", pts: 7 },
  { label: "2.000 €", pts: 9 }, { label: "4.000 €", pts: 12 }, { label: "8.000 €", pts: 15 },
  { label: "16.000 €", pts: 18 }, { label: "32.000 €", pts: 22 }, { label: "64.000 €", pts: 27 },
  { label: "125.000 €", pts: 33 }, { label: "500.000 €", pts: 40 }, { label: "1.000.000 €", pts: 50 },
];
const SAFE_LEVELS = [4, 9];

export async function render(root) {
  const chosen = await pickQuizSource(root, { title: "💰 Wer wird Millionär", subtitle: "Welches Quiz möchtest du üben?" });
  if (!chosen) return;
  let playable = buildPlayable(chosen).filter(q => q.kind === "choice");
  if (playable.length < 5) {
    root.innerHTML = `<div style="padding:30px 20px;text-align:center"><h3>Zu wenige Single/Multiple-Choice Fragen</h3><p>Mindestens 5 nötig.</p><button class="btn btn-primary" id="b">← Zurück</button></div>`;
    root.querySelector("#b").addEventListener("click", () => navigate("games"));
    return;
  }

  const easy = shuffle(playable.filter(q => difficultyOfNormalized(q) <= 1));
  const med = shuffle(playable.filter(q => difficultyOfNormalized(q) === 2));
  const hard = shuffle(playable.filter(q => difficultyOfNormalized(q) >= 3));
  const ordered = [...easy, ...med, ...hard].slice(0, 15);
  while (ordered.length < 15) ordered.push(...shuffle([...playable]).slice(0, 15 - ordered.length));

  let level = 0;
  let jokers = { fifty: true, audience: true, skip: true };
  let safeScore = 0;
  const log = [];

  function renderGame() {
    if (level >= 15) { win(); return; }
    const q = ordered[level];
    const prize = PRIZES[level];
    const isSafe = SAFE_LEVELS.includes(level);

    let opts = [...q.options];
    let eliminated = new Set();

    let html = `<div class="mill-header">
      <div class="mill-prize">${prize.label}</div>
      <div class="mill-level">Frage ${level + 1}/15</div>
    </div>
    <div class="mill-ladder">`;
    for (let i = 14; i >= 0; i--) {
      const cls = i === level ? "current" : i < level ? "done" : "";
      const safe = SAFE_LEVELS.includes(i) ? " safe" : "";
      html += `<div class="mill-step ${cls}${safe}">${PRIZES[i].label}</div>`;
    }
    html += `</div>
    <div class="mill-question">${mathEsc(q.prompt)}</div>
    <div class="mill-options" id="opts">`;
    opts.forEach((o, i) => {
      const letter = String.fromCharCode(65 + i);
      html += `<button class="mill-opt" data-idx="${i}"><span class="mill-letter">${letter}:</span> ${mathEsc(o.text)}</button>`;
    });
    html += `</div>
    <div class="mill-jokers">
      <button class="mill-joker${jokers.fifty ? "" : " used"}" id="j-fifty" ${jokers.fifty ? "" : "disabled"}>50:50</button>
      <button class="mill-joker${jokers.audience ? "" : " used"}" id="j-audience" ${jokers.audience ? "" : "disabled"}>📊 Publikum</button>
      <button class="mill-joker${jokers.skip ? "" : " used"}" id="j-skip" ${jokers.skip ? "" : "disabled"}>⏭ Überspringen</button>
    </div>`;

    root.innerHTML = html;

    root.querySelector("#j-fifty")?.addEventListener("click", () => {
      if (!jokers.fifty) return;
      jokers.fifty = false;
      const wrongOpts = opts.map((o, i) => ({ o, i })).filter(x => !x.o.correct);
      const toRemove = shuffle(wrongOpts).slice(0, Math.max(1, wrongOpts.length - 1));
      toRemove.forEach(x => eliminated.add(x.i));
      root.querySelectorAll(".mill-opt").forEach(btn => {
        if (eliminated.has(parseInt(btn.dataset.idx))) {
          btn.disabled = true;
          btn.classList.add("eliminated");
        }
      });
      root.querySelector("#j-fifty").disabled = true;
      root.querySelector("#j-fifty").classList.add("used");
    });

    root.querySelector("#j-audience")?.addEventListener("click", () => {
      if (!jokers.audience) return;
      jokers.audience = false;
      root.querySelector("#j-audience").disabled = true;
      root.querySelector("#j-audience").classList.add("used");
      const correctIdx = opts.findIndex(o => o.correct);
      const pcts = opts.map((_, i) => {
        if (eliminated.has(i)) return 0;
        if (i === correctIdx) return 50 + Math.floor(Math.random() * 30);
        return 5 + Math.floor(Math.random() * 15);
      });
      const total = pcts.reduce((a, b) => a + b, 0);
      const norm = pcts.map(p => Math.round(p / total * 100));
      const hint = document.createElement("div");
      hint.className = "mill-audience-result";
      hint.innerHTML = opts.map((o, i) => {
        const letter = String.fromCharCode(65 + i);
        return `<div class="mill-aud-bar"><span>${letter}</span><div class="mill-aud-fill" style="width:${norm[i]}%"></div><span>${norm[i]}%</span></div>`;
      }).join("");
      root.querySelector("#opts").after(hint);
    });

    root.querySelector("#j-skip")?.addEventListener("click", () => {
      if (!jokers.skip) return;
      jokers.skip = false;
      log.push({ q, correct: true, userAnswer: "(übersprungen)" });
      level++;
      if (SAFE_LEVELS.includes(level - 1)) safeScore = PRIZES[level - 1].pts;
      renderGame();
    });

    root.querySelectorAll(".mill-opt").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx);
        const correct = opts[idx].correct;
        root.querySelectorAll(".mill-opt").forEach(b => b.disabled = true);
        btn.classList.add(correct ? "correct" : "wrong");
        if (!correct) {
          const ci = opts.findIndex(o => o.correct);
          root.querySelectorAll(".mill-opt")[ci]?.classList.add("correct");
        }
        log.push({ q, correct, userAnswer: opts[idx].text });

        setTimeout(() => {
          if (correct) {
            if (SAFE_LEVELS.includes(level)) safeScore = PRIZES[level].pts;
            level++;
            renderGame();
          } else {
            gameOver();
          }
        }, 1200);
      });
    });
  }

  function gameOver() {
    const pts = safeScore;
    const coins = Math.floor(pts / 2);
    showEnd(`❌ Falsch! Du gehst mit ${PRIZES[SAFE_LEVELS.findLast(s => s < level) ?? -1]?.label || "0 €"} nach Hause.`, pts, coins);
  }

  function win() {
    const pts = PRIZES[14].pts;
    const coins = Math.floor(pts / 2);
    showEnd("🎉🎊 MILLIONÄR! Du hast alle 15 Fragen richtig!", pts, coins);
  }

  function showEnd(msg, pts, coins) {
    let html = `<div class="mill-end">
      <h2>${msg}</h2>
      <div class="speed-stats">
        <div>Erreicht: Frage ${level}/15</div>
        <div>⭐ ${pts} Punkte</div>
        <div>🪙 +${coins} Münzen</div>
      </div>
    </div>`;
    html += buildFeedbackHtml(log);
    html += `<div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-primary" id="retry" style="flex:1">🔄 Nochmal</button>
      <button class="btn btn-ghost" id="back" style="flex:1">← Zurück</button>
    </div>`;
    root.innerHTML = html;
    attachFeedbackListeners(root, log);
    addCoins(coins, "millionaire");
    saveGameScore("millionaire", { points: pts, coins });
    root.querySelector("#retry").addEventListener("click", () => render(root));
    root.querySelector("#back").addEventListener("click", () => navigate("games"));
  }

  renderGame();
}
