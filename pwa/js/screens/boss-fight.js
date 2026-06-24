import { loadQuizzes, loadProgress, addCoins, saveGameScore } from "../store.js";
import { buildPlayable, shuffle, checkText, checkTextSmart, checkMultiText, buildFeedbackHtml, attachFeedbackListeners } from "../games-util.js";
import { navigate } from "../router.js";
import { mathEsc } from "../utils.js";

export async function render(root) {
  const [quizzes, progress] = await Promise.all([loadQuizzes(), loadProgress()]);
  const allQs = quizzes.flatMap(q => q.questions || []);

  const scored = allQs.map(q => {
    const p = progress[q.id];
    let difficulty = 0;
    if (p) {
      difficulty = p.times_wrong - p.times_correct;
      if (p.box <= 1) difficulty += 3;
      else if (p.box <= 2) difficulty += 1;
    } else {
      difficulty = 2;
    }
    return { q, difficulty };
  });
  scored.sort((a, b) => b.difficulty - a.difficulty);

  const hardest = scored.slice(0, 20).map(s => s.q);
  const playable = buildPlayable(hardest);
  if (playable.length < 3) {
    root.innerHTML = `<div style="padding:30px 20px;text-align:center"><h3>Zu wenige schwierige Fragen</h3><p>Beantworte erst einige Quizze.</p><button class="btn btn-primary" id="b">← Zurück</button></div>`;
    root.querySelector("#b").addEventListener("click", () => navigate("games"));
    return;
  }

  const BOSS_HP = playable.length * 20;
  const PLAYER_HP = 100;
  let bossHp = BOSS_HP;
  let playerHp = PLAYER_HP;
  let qIdx = 0;
  let totalScore = 0;
  let combo = 0;
  const log = [];

  function renderBattle() {
    if (bossHp <= 0) { victory(); return; }
    if (playerHp <= 0) { defeat(); return; }
    if (qIdx >= playable.length) { victory(); return; }

    const q = playable[qIdx];
    const bossPercent = Math.max(0, bossHp / BOSS_HP * 100);
    const playerPercent = Math.max(0, playerHp / PLAYER_HP * 100);

    let html = `<div class="boss-arena">
      <div class="boss-sprite">
        <div class="boss-icon">${bossHp > BOSS_HP * 0.3 ? "👹" : "😵"}</div>
        <div class="boss-name">Boss</div>
        <div class="boss-bar"><div class="boss-bar-fill" style="width:${bossPercent}%"></div></div>
        <div class="boss-hp-text">${bossHp}/${BOSS_HP} HP</div>
      </div>
      <div class="boss-vs">⚔️</div>
      <div class="boss-sprite player">
        <div class="boss-icon">🧙</div>
        <div class="boss-name">Du</div>
        <div class="boss-bar player-bar"><div class="boss-bar-fill player-fill" style="width:${playerPercent}%"></div></div>
        <div class="boss-hp-text">${playerHp}/${PLAYER_HP} HP</div>
      </div>
    </div>
    <div class="boss-combo">${combo >= 2 ? `🔥 ${combo}x Combo` : ""}</div>
    <div class="boss-question">${mathEsc(q.prompt)}</div>`;

    if (q.kind === "choice") {
      html += `<div class="boss-options">`;
      const opts = shuffle([...q.options]);
      opts.forEach((o, i) => {
        html += `<button class="boss-opt" data-correct="${o.correct}">${mathEsc(o.text)}</button>`;
      });
      html += `</div>`;
    } else if (q.kind === "multi_text") {
      html += `<div class="speed-multi">` +
        q.blanks.map((_, i) =>
          `<input type="text" class="input speed-input" data-blank="${i}" placeholder="Lücke ${i + 1}..."${i === 0 ? " autofocus" : ""}>`
        ).join("") +
        `<button class="btn btn-primary" id="boss-submit">⚔️ Angriff!</button></div>`;
    } else {
      html += `<div class="speed-input-row">
        <input type="text" class="input speed-input" id="boss-ans" placeholder="Antwort..." autofocus>
        <button class="btn btn-primary" id="boss-submit">⚔️ Angriff!</button>
      </div>`;
    }

    root.innerHTML = html;

    if (q.kind === "choice") {
      root.querySelectorAll(".boss-opt").forEach(btn => {
        btn.addEventListener("click", () => {
          const correct = btn.dataset.correct === "true";
          btn.classList.add(correct ? "correct" : "wrong");
          root.querySelectorAll(".boss-opt").forEach(b => b.disabled = true);
          resolveAttack(q, correct, btn.textContent);
        });
      });
    } else {
      const sub = root.querySelector("#boss-submit");
      const inputs = q.kind === "multi_text"
        ? [...root.querySelectorAll(".speed-input[data-blank]")]
        : [root.querySelector("#boss-ans")];
      const submit = async () => {
        const vals = inputs.map(i => i.value.trim());
        if (vals.some(v => !v)) return;
        inputs.forEach(i => i.disabled = true);
        sub.disabled = true;
        let correct, val;
        if (q.kind === "multi_text") {
          correct = checkMultiText(q.blanks, vals);
          val = vals.join(", ");
        } else {
          val = vals[0];
          correct = checkText(q.accept, val);
          if (!correct) {
            sub.textContent = "🤖 …";
            const res = await checkTextSmart(q.prompt, q.accept, val);
            correct = res.correct;
          }
        }
        resolveAttack(q, correct, val);
      };
      sub.addEventListener("click", submit);
      inputs.forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") submit(); }));
      inputs[0].focus();
    }
  }

  function resolveAttack(q, correct, userAnswer) {
    log.push({ q, correct, userAnswer });
    qIdx++;
    if (correct) {
      combo++;
      const dmg = 20 + (combo >= 5 ? 15 : combo >= 3 ? 10 : 0);
      bossHp -= dmg;
      totalScore += dmg;
      showHit(true, dmg);
    } else {
      combo = 0;
      const dmg = 15 + Math.floor(Math.random() * 10);
      playerHp -= dmg;
      showHit(false, dmg);
    }
  }

  function showHit(playerAttacks, dmg) {
    const msg = playerAttacks
      ? `⚔️ Du triffst den Boss! -${dmg} HP`
      : `💥 Der Boss trifft dich! -${dmg} HP`;
    const msgEl = document.createElement("div");
    msgEl.className = `boss-hit-msg ${playerAttacks ? "player-hit" : "boss-hit"}`;
    msgEl.textContent = msg;
    root.appendChild(msgEl);
    setTimeout(() => { msgEl.remove(); renderBattle(); }, 1000);
  }

  function victory() {
    const coins = Math.floor(totalScore / 3);
    let html = `<div class="speed-result">
      <h2>🏆 Boss besiegt!</h2>
      <div class="speed-final-score">⭐ ${totalScore} Punkte</div>
      <div class="speed-stats">
        <div>${log.filter(e => e.correct).length}/${log.length} richtig</div>
        <div>❤️ ${playerHp} HP übrig</div>
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
    addCoins(coins, "boss-fight");
    saveGameScore("boss-fight", { points: totalScore, coins });
    root.querySelector("#retry").addEventListener("click", () => render(root));
    root.querySelector("#back").addEventListener("click", () => navigate("games"));
  }

  function defeat() {
    const coins = Math.floor(totalScore / 5);
    let html = `<div class="speed-result">
      <h2>💀 Niederlage!</h2>
      <p style="color:var(--text-light)">Der Boss hat noch ${bossHp} HP übrig. Lerne weiter und versuche es nochmal!</p>
      <div class="speed-stats">
        <div>${log.filter(e => e.correct).length}/${log.length} richtig</div>
        <div>⭐ ${totalScore} Punkte</div>
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
    addCoins(coins, "boss-fight");
    saveGameScore("boss-fight", { points: totalScore, coins });
    root.querySelector("#retry").addEventListener("click", () => render(root));
    root.querySelector("#back").addEventListener("click", () => navigate("games"));
  }

  renderBattle();
}
