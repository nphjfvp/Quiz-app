import { loadQuizzes, loadProgress, addCoins, saveGameScore } from "../store.js";
import { buildPlayable, shuffle, checkText, checkMultiText, buildFeedbackHtml, attachFeedbackListeners } from "../games-util.js";
import { navigate } from "../router.js";
import { mathEsc } from "../utils.js";

export async function render(root) {
  const quizzes = await loadQuizzes();
  const allQs = quizzes.flatMap(q => q.questions || []);
  const playable = shuffle(buildPlayable(allQs));
  if (!playable.length) {
    root.innerHTML = `<div style="padding:30px 20px;text-align:center"><h3>Keine Fragen verfügbar</h3><p>Erstelle zuerst ein Quiz.</p><button class="btn btn-primary" id="b">← Zurück</button></div>`;
    root.querySelector("#b").addEventListener("click", () => navigate("games"));
    return;
  }

  const GAME_TIME = 60;
  let timeLeft = GAME_TIME;
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let qIdx = 0;
  let answered = 0;
  let correctCount = 0;
  let timer = null;
  const log = [];

  root.innerHTML = `
    <div class="speed-hud">
      <div class="speed-timer" id="timer">⏱ ${GAME_TIME}s</div>
      <div class="speed-score" id="score">⭐ 0</div>
      <div class="speed-combo" id="combo"></div>
    </div>
    <div class="speed-progress"><div class="speed-bar" id="bar"></div></div>
    <div id="q-area" class="speed-q-area"></div>
  `;

  const timerEl = root.querySelector("#timer");
  const scoreEl = root.querySelector("#score");
  const comboEl = root.querySelector("#combo");
  const barEl = root.querySelector("#bar");
  const qArea = root.querySelector("#q-area");

  function startTimer() {
    timer = setInterval(() => {
      timeLeft--;
      timerEl.textContent = `⏱ ${timeLeft}s`;
      barEl.style.width = (timeLeft / GAME_TIME * 100) + "%";
      if (timeLeft <= 10) timerEl.classList.add("urgent");
      if (timeLeft <= 0) endGame();
    }, 1000);
  }

  function getMultiplier() {
    if (combo >= 10) return 4;
    if (combo >= 5) return 3;
    if (combo >= 3) return 2;
    return 1;
  }

  function showCombo() {
    const mult = getMultiplier();
    if (combo >= 2) {
      comboEl.textContent = `🔥 ${combo}x Combo (${mult}x)`;
      comboEl.classList.add("active");
    } else {
      comboEl.textContent = "";
      comboEl.classList.remove("active");
    }
  }

  function nextQuestion() {
    if (qIdx >= playable.length) qIdx = 0;
    const q = playable[qIdx];
    qIdx++;

    let html = `<div class="speed-prompt">${mathEsc(q.prompt)}</div>`;

    if (q.kind === "choice") {
      const opts = shuffle([...q.options]);
      html += `<div class="speed-options">`;
      opts.forEach((o, i) => {
        html += `<button class="speed-opt" data-idx="${i}" data-correct="${o.correct}">${mathEsc(o.text)}</button>`;
      });
      html += `</div>`;
    } else if (q.kind === "multi_text") {
      html += `<div class="speed-multi">` +
        q.blanks.map((_, i) =>
          `<input type="text" class="input speed-input" data-blank="${i}" placeholder="Lücke ${i + 1}..."${i === 0 ? " autofocus" : ""}>`
        ).join("") +
        `<button class="btn btn-primary" id="speed-submit">OK</button></div>`;
    } else if (q.kind === "text") {
      html += `<div class="speed-input-row">
        <input type="text" class="input speed-input" id="speed-ans" placeholder="Antwort..." autofocus>
        <button class="btn btn-primary" id="speed-submit">OK</button>
      </div>`;
    }

    qArea.innerHTML = html;

    if (q.kind === "choice") {
      qArea.querySelectorAll(".speed-opt").forEach(btn => {
        btn.addEventListener("click", () => {
          const correct = btn.dataset.correct === "true";
          handleAnswer(q, correct, btn.textContent);
          btn.classList.add(correct ? "correct" : "wrong");
          qArea.querySelectorAll(".speed-opt").forEach(b => b.disabled = true);
          setTimeout(nextQuestion, correct ? 300 : 800);
        });
      });
    } else {
      const sub = qArea.querySelector("#speed-submit");
      const inputs = q.kind === "multi_text"
        ? [...qArea.querySelectorAll(".speed-input[data-blank]")]
        : [qArea.querySelector("#speed-ans")];
      const submit = () => {
        const vals = inputs.map(i => i.value.trim());
        if (vals.some(v => !v)) return;
        let correct, val;
        if (q.kind === "multi_text") {
          correct = checkMultiText(q.blanks, vals);
          val = vals.join(", ");
        } else {
          correct = checkText(q.accept, vals[0]);
          val = vals[0];
        }
        handleAnswer(q, correct, val);
        inputs.forEach(i => { i.style.borderColor = correct ? "var(--success)" : "var(--danger)"; i.disabled = true; });
        sub.disabled = true;
        setTimeout(nextQuestion, correct ? 300 : 800);
      };
      sub.addEventListener("click", submit);
      inputs.forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") submit(); }));
      inputs[0].focus();
    }
  }

  function handleAnswer(q, correct, userAnswer) {
    answered++;
    if (correct) {
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      correctCount++;
      const pts = 10 * getMultiplier();
      score += pts;
      scoreEl.textContent = `⭐ ${score}`;
      timeLeft = Math.min(timeLeft + 2, GAME_TIME);
    } else {
      combo = 0;
    }
    showCombo();
    log.push({ q, correct, userAnswer });
  }

  function endGame() {
    clearInterval(timer);
    const coins = Math.floor(score / 5);

    let html = `<div class="speed-result">
      <h2>⏱ Zeit abgelaufen!</h2>
      <div class="speed-final-score">⭐ ${score} Punkte</div>
      <div class="speed-stats">
        <div>${answered} Fragen</div>
        <div>${correctCount} richtig (${answered ? Math.round(correctCount/answered*100) : 0}%)</div>
        <div>🔥 Max Combo: ${maxCombo}x</div>
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

    addCoins(coins, "speed-quiz");
    saveGameScore("speed-quiz", { points: score, coins });

    root.querySelector("#retry").addEventListener("click", () => render(root));
    root.querySelector("#back").addEventListener("click", () => navigate("games"));
  }

  startTimer();
  nextQuestion();
}
