import { loadQuizzes, addCoins, saveGameScore } from "../store.js";
import { navigate } from "../router.js";
import { esc, mathEsc } from "../utils.js";
import { buildPlayable, checkText, checkTextSmart, checkMulti, checkMultiText, shuffle, buildFeedbackHtml, attachFeedbackListeners } from "../games-util.js";

const CANVAS_W = 360, CANVAS_H = 420;
const TOWER_Y = CANVAS_H - 36;     // player fortress (bottom)
const CPU_TOWER_Y = 34;            // computer fortress (top, PvC mode)
const ENEMY_START_Y = 50;

// Difficulty controls how fast enemies advance and (in PvC) how clever the AI is.
const QB_DIFF = {
  easy:   { label: "Leicht", enemySpeed: 0.10, lvlSpeed: 0.004, hpBase: 16, hpScale: 8,  dmgBase: 6,  dmgScale: 2, aiAcc: 0.40, cpuHP: 80 },
  normal: { label: "Normal", enemySpeed: 0.16, lvlSpeed: 0.006, hpBase: 18, hpScale: 10, dmgBase: 8,  dmgScale: 3, aiAcc: 0.62, cpuHP: 100 },
  hard:   { label: "Schwer", enemySpeed: 0.24, lvlSpeed: 0.008, hpBase: 22, hpScale: 12, dmgBase: 10, dmgScale: 4, aiAcc: 0.82, cpuHP: 120 },
};

let _activeState = null;

export async function render(root) {
  if (_activeState) { _activeState.gameOver = true; _activeState = null; }

  const quizzes = await loadQuizzes();
  if (!quizzes.length) {
    root.innerHTML = `<div class="screen-empty"><p>Erstelle zuerst ein Quiz!</p>
      <button class="btn-cta" id="qb-empty-back">Zurück</button></div>`;
    root.querySelector("#qb-empty-back").addEventListener("click", () => navigate("home"));
    return () => {};
  }

  root.innerHTML = `
    <div class="td-setup">
      <h2>⚔️ Quiz Battle</h2>
      <p>Ziehe die richtige Antwort ins Feld — dein Held greift an. Falsche Antworten machen den Gegner stärker.</p>
      <div class="td-quiz-select">
        <label>Quiz wählen:</label>
        <select id="qb-quiz">
          ${quizzes.map((q, i) => `<option value="${i}">${esc(q.name)} (${q.questions?.length || 0})</option>`).join("")}
        </select>
      </div>
      <div class="td-difficulty">
        <label>Schwierigkeit (Gegner-Tempo):</label>
        <div class="td-diff-btns">
          <button class="td-diff active" data-diff="easy">Leicht</button>
          <button class="td-diff" data-diff="normal">Normal</button>
          <button class="td-diff" data-diff="hard">Schwer</button>
        </div>
      </div>
      <div class="td-difficulty">
        <label>Modus:</label>
        <div class="td-diff-btns">
          <button class="qb-mode active" data-mode="classic">🏰 Verteidigung</button>
          <button class="qb-mode" data-mode="pvc">🤖 Duell vs. KI</button>
        </div>
        <small class="qb-mode-desc" id="qb-mode-desc">Überstehe & besiege 5 Gegner.</small>
      </div>
      <button class="btn-cta td-start" id="qb-start">⚔️ Kampf starten</button>
      <button class="btn-secondary" id="qb-back">← Zurück</button>
    </div>`;

  let difficulty = "easy", mode = "classic";
  root.querySelectorAll(".td-diff").forEach(b => {
    b.addEventListener("click", () => {
      root.querySelectorAll(".td-diff").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      difficulty = b.dataset.diff;
    });
  });
  const desc = root.querySelector("#qb-mode-desc");
  root.querySelectorAll(".qb-mode").forEach(b => {
    b.addEventListener("click", () => {
      root.querySelectorAll(".qb-mode").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      mode = b.dataset.mode;
      desc.textContent = mode === "pvc"
        ? "Die KI bekommt dieselben Fragen. Eure Kämpfer treffen sich in der Mitte!"
        : "Überstehe & besiege 5 Gegner.";
    });
  });

  root.querySelector("#qb-back").addEventListener("click", () => navigate("games"));
  root.querySelector("#qb-start").addEventListener("click", () => {
    const qi = parseInt(root.querySelector("#qb-quiz").value);
    startBattle(root, quizzes[qi], difficulty, mode);
  });

  return () => { if (_activeState) { _activeState.gameOver = true; _activeState = null; } };
}

function startBattle(root, quiz, difficulty, mode) {
  const questions = shuffle(buildPlayable(quiz.questions));
  if (!questions.length) {
    root.innerHTML = `<div class="screen-empty">
      <p>Dieses Quiz hat keine für Spiele geeigneten Fragen.</p>
      <p style="font-size:0.85rem">Geeignet sind Single/Multiple Choice, Freitext, Lückentext und Formel-Fragen.</p>
      <button class="btn-cta" id="qb-noq-back">← Zurück</button></div>`;
    root.querySelector("#qb-noq-back").addEventListener("click", () => navigate("quiz-battle"));
    return;
  }

  const cfg = QB_DIFF[difficulty] || QB_DIFF.easy;
  const state = {
    mode, cfg, difficulty,
    towerHP: 100, towerMax: 100,
    cpuHP: cfg.cpuHP, cpuMax: cfg.cpuHP,
    heroes: [], foes: [], particles: [], floaters: [],
    enemy: null, enemyLevel: 1, cpuLevel: 1, correctTotal: 0,
    score: 0, coins: 0, kills: 0, qIndex: 0,
    gameOver: false, won: false, currentQ: null, currentDiff: 1, locked: false,
    goalKills: 5, log: [], questions,
  };
  _activeState = state;

  const hud = mode === "pvc"
    ? `<div class="td-hud">
        <div class="td-hud-item"><span>🏰</span> <span id="qb-hp">100</span></div>
        <div class="td-hud-item">🤖 <span id="qb-cpuhp">${state.cpuMax}</span></div>
        <div class="td-hud-item td-score">⭐ <span id="qb-score">0</span></div>
      </div>`
    : `<div class="td-hud">
        <div class="td-hud-item"><span>🏰</span> <span id="qb-hp">100</span></div>
        <div class="td-hud-item">💀 <span id="qb-kills">0</span>/${state.goalKills}</div>
        <div class="td-hud-item">⚔️ Lvl <span id="qb-lvl">1</span></div>
        <div class="td-hud-item td-score">⭐ <span id="qb-score">0</span></div>
      </div>`;

  root.innerHTML = `
    <div class="qb-game">
      ${hud}
      <div class="qb-canvas-wrap">
        <canvas id="qb-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
        <div class="qb-cpu-pop" id="qb-cpu"></div>
      </div>
      <div class="qb-question">
        <div class="td-q-head">
          <span class="td-q-diff" id="qb-qdiff"></span>
          <span class="td-q-reward" id="qb-hint">Antwort nach oben ziehen ⬆</span>
        </div>
        <div class="td-q-text" id="qb-qtext"></div>
        <div class="qb-cards" id="qb-cards"></div>
      </div>
    </div>`;

  const canvas = root.querySelector("#qb-canvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = CANVAS_W + "px";
  canvas.style.height = CANVAS_H + "px";
  ctx.scale(dpr, dpr);

  if (mode === "classic") spawnEnemy(state);
  showQuestion(state, root, canvas);

  let lastTime = performance.now();
  function loop(ts) {
    if (state.gameOver || !root.isConnected) return;
    const dt = Math.min(ts - lastTime, 50);
    lastTime = ts;
    update(state, dt);
    updateHUD(state, root);
    draw(ctx, state);
    if (state.towerHP <= 0) { endGame(state, root, false); return; }
    if (mode === "pvc" ? state.cpuHP <= 0 : state.kills >= state.goalKills) { endGame(state, root, true); return; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function spawnEnemy(state) {
  const c = state.cfg;
  const lvl = state.enemyLevel;
  state.enemy = {
    x: CANVAS_W / 2, y: ENEMY_START_Y,
    hp: c.hpBase + lvl * c.hpScale, maxHp: c.hpBase + lvl * c.hpScale,
    armor: Math.min(0.6, (lvl - 1) * 0.08),
    dmg: c.dmgBase + lvl * c.dmgScale,
    speed: c.enemySpeed + lvl * c.lvlSpeed,
    size: 18 + Math.min(22, lvl * 2),
    level: lvl, hit: 0, attackCd: 0, wob: 0,
  };
}

// PvC: spawn a computer fighter that marches DOWN toward the player's tower.
function spawnFoe(state) {
  const c = state.cfg;
  const lvl = state.cpuLevel;
  state.foes.push({
    x: CANVAS_W / 2 + (Math.random() - 0.5) * 50, y: CPU_TOWER_Y + 16,
    hp: c.hpBase + lvl * 6, maxHp: c.hpBase + lvl * 6,
    dmg: c.dmgBase + lvl * 2, speed: c.enemySpeed,
    size: 13 + Math.min(8, lvl), level: lvl, hit: 0, attackCd: 0, wob: Math.random() * 6,
  });
}

function showQuestion(state, root, canvas) {
  if (state.qIndex >= state.questions.length) { state.qIndex = 0; shuffle(state.questions); }
  const q = state.questions[state.qIndex++];
  state.currentQ = q;
  state.currentDiff = q.diff || 1;
  state.locked = false;

  root.querySelector("#qb-qdiff").textContent = ["", "Leicht", "Mittel", "Schwer"][state.currentDiff];
  root.querySelector("#qb-qdiff").style.background = ["", "#22c55e", "#f59e0b", "#ef4444"][state.currentDiff];
  const qtextEl = root.querySelector("#qb-qtext");
  qtextEl.innerHTML = "";
  if (q.image) {
    const img = document.createElement("img");
    img.src = q.image;
    img.className = "td-q-img";
    qtextEl.appendChild(img);
  }
  const txt = document.createElement("div");
  txt.innerHTML = mathEsc(q.prompt);
  qtextEl.appendChild(txt);
  const cards = root.querySelector(“#qb-cards”);
  cards.innerHTML = “”;

  const commit = (ok, userAnswer = “”, aiFeedback = null) => {
    if (state.locked) return;
    state.locked = true;
    if (state.currentQ) state.log.push({ q: state.currentQ, correct: ok, userAnswer, aiFeedback });
    onAnswer(state, ok, root);
    if (state.mode === “pvc”) cpuTurn(state, root);
    const ongoing = !state.gameOver && state.towerHP > 0
      && (state.mode === “pvc” ? state.cpuHP > 0 : state.kills < state.goalKills);
    if (ongoing) setTimeout(() => showQuestion(state, root, canvas), 950);
  };

  if (q.kind === “choice”) {
    shuffle([...q.options]).forEach((o) => {
      const card = document.createElement(“div”);
      card.className = “qb-card”;
      card.innerHTML = mathEsc(o.text);
      makeDraggable(card, canvas, () => commit(!!o.correct, o.text));
      cards.appendChild(card);
    });
  } else if (q.kind === “multi”) {
    const shuffled = shuffle([...q.options]);
    const selected = new Set();
    const hint = document.createElement(“div”);
    hint.className = “qb-multi-hint”;
    hint.textContent = “Mehrere richtig — antippen zum Wählen, dann „Angreifen” ziehen”;
    cards.appendChild(hint);
    shuffled.forEach((o, i) => {
      const card = document.createElement(“div”);
      card.className = “qb-card qb-card-select”;
      card.innerHTML = mathEsc(o.text);
      card.addEventListener(“click”, () => {
        if (selected.has(i)) { selected.delete(i); card.classList.remove(“selected”); }
        else { selected.add(i); card.classList.add(“selected”); }
        attackCard.textContent = `⚔️ Angreifen (${selected.size})`;
      });
      cards.appendChild(card);
    });
    const attackCard = document.createElement(“div”);
    attackCard.className = “qb-card qb-attack-card”;
    attackCard.textContent = “⚔️ Angreifen (0)”;
    makeDraggable(attackCard, canvas, () => {
      const chosen = shuffled.filter((_, i) => selected.has(i));
      commit(checkMulti(q.options, chosen.map(o => q.options.indexOf(o))), chosen.map(o => o.text).join(“, “));
    });
    cards.appendChild(attackCard);
  } else if (q.kind === “multi_text”) {
    const inputs = [];
    q.blanks.forEach((_, i) => {
      const row = document.createElement(“div”);
      row.className = “td-blank-row”;
      const label = document.createElement(“span”);
      label.className = “td-blank-label”;
      label.textContent = `Lücke ${i + 1}:`;
      const inp = document.createElement(“input”);
      inp.type = “text”; inp.className = “td-input”; inp.placeholder = `Lücke ${i + 1}…`;
      inputs.push(inp);
      row.appendChild(label); row.appendChild(inp);
      cards.appendChild(row);
    });
    const btn = document.createElement(“button”);
    btn.className = “td-opt td-submit”;
    btn.textContent = “⚔️ Bestätigen”;
    btn.addEventListener(“click”, () => {
      const vals = inputs.map(i => i.value);
      commit(checkMultiText(q.blanks, vals), vals.join(“, “));
    });
    inputs[inputs.length - 1]?.addEventListener(“keydown”, (e) => { if (e.key === “Enter”) btn.click(); });
    cards.appendChild(btn);
    setTimeout(() => inputs[0]?.focus(), 50);
  } else {
    const inp = document.createElement(“input”);
    inp.type = “text”;
    inp.className = “td-input”;
    inp.placeholder = “Antwort eingeben…”;
    const btn = document.createElement(“button”);
    btn.className = “td-opt td-submit”;
    btn.textContent = “⚔️”;
    const check = async () => {
      const localOk = checkText(q.accept, inp.value);
      if (localOk) { commit(true, inp.value); return; }
      const result = await checkTextSmart(q.prompt, q.accept, inp.value);
      commit(result.correct, inp.value, result.feedback);
    };
    btn.addEventListener(“click”, check);
    inp.addEventListener(“keydown”, (e) => { if (e.key === “Enter”) check(); });
    const wrap = document.createElement(“div”);
    wrap.className = “qb-text-row”;
    wrap.appendChild(inp); wrap.appendChild(btn);
    cards.appendChild(wrap);
    setTimeout(() => inp.focus(), 50);
  }
}

// Drag a card; release over the canvas (battlefield) to play it. Tap also plays.
function makeDraggable(card, canvas, onPlay) {
  let dragging = false, ghost = null, startX = 0, startY = 0, moved = false;

  const onDown = (e) => {
    e.preventDefault();
    dragging = true; moved = false;
    const pt = point(e);
    startX = pt.x; startY = pt.y;
    ghost = card.cloneNode(true);
    ghost.classList.add("qb-card-ghost");
    document.body.appendChild(ghost);
    moveGhost(pt.x, pt.y);
    card.classList.add("qb-card-dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const moveGhost = (x, y) => {
    if (ghost) { ghost.style.left = x + "px"; ghost.style.top = y + "px"; }
  };
  const onMove = (e) => {
    if (!dragging) return;
    const pt = point(e);
    if (Math.hypot(pt.x - startX, pt.y - startY) > 8) moved = true;
    moveGhost(pt.x, pt.y);
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    const pt = point(e);
    if (ghost) { ghost.remove(); ghost = null; }
    card.classList.remove("qb-card-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const rect = canvas.getBoundingClientRect();
    const overField = pt.x >= rect.left && pt.x <= rect.right && pt.y >= rect.top && pt.y <= rect.bottom;
    if (overField || !moved) onPlay();
  };
  card.addEventListener("pointerdown", onDown);
}

function point(e) {
  return { x: e.clientX, y: e.clientY };
}

// The computer answers the same question; correctness depends on difficulty.
function cpuTurn(state, root) {
  const correct = Math.random() < state.cfg.aiAcc;
  const pop = root.querySelector("#qb-cpu");
  if (correct) {
    spawnFoe(state);
    state.cpuLevel = Math.min(9, 1 + Math.floor(state.correctTotal / 2));
    if (pop) {
      pop.className = "qb-cpu-pop qb-cpu-ok show";
      pop.textContent = "🤖 " + (state.currentQ?.answerText || "Richtig!");
    }
  } else if (pop) {
    pop.className = "qb-cpu-pop qb-cpu-bad show";
    pop.textContent = "🤖 ✗";
  }
  if (pop) setTimeout(() => pop.classList.remove("show"), 2200);
}

function onAnswer(state, correct, root) {
  if (correct) {
    state.correctTotal++;
    const diff = state.currentDiff;
    state.heroes.push({
      x: CANVAS_W / 2 + (Math.random() - 0.5) * 40, y: TOWER_Y - 10,
      hp: 30 + diff * 15, maxHp: 30 + diff * 15,
      dmg: 6 + diff * 4, speed: 0.14, size: 12 + diff * 3,
      attackCd: 0, diff,
    });
    state.score += 10 * diff;
    addFloater(state, CANVAS_W / 2, TOWER_Y - 30, `+Held (Lvl ${diff})`, "#22c55e");
  }

  if (state.mode === "pvc") {
    // In duel mode a wrong answer simply means no new hero this round.
    if (!correct) addFloater(state, CANVAS_W / 2, TOWER_Y - 30, "✗ Kein Held", "#ef4444");
    return;
  }

  // Classic mode: escalation / punishment around the single relentless enemy
  const enemy = state.enemy;
  if (correct) {
    if (state.correctTotal % 3 === 0 && enemy) {
      enemy.armor = Math.min(0.7, enemy.armor + 0.06);
      enemy.size += 3;
      enemy.maxHp += 8; enemy.hp += 8;
      addFloater(state, enemy.x, enemy.y - enemy.size - 10, "Gegner verstärkt!", "#ef4444");
    }
  } else if (enemy) {
    enemy.level++;
    enemy.size += 4;
    enemy.armor = Math.min(0.8, enemy.armor + 0.1);
    enemy.dmg += 4;
    enemy.maxHp += 10; enemy.hp = Math.min(enemy.maxHp, enemy.hp + 10);
    enemy.hit = 0;
    addFloater(state, enemy.x, enemy.y - enemy.size - 10, `⬆ Lvl ${enemy.level}`, "#ef4444");
    burst(state, enemy.x, enemy.y, "#ef4444", 10);
    if (state.heroes.length) {
      state.heroes.sort((a, b) => (a.y - b.y));
      const victim = state.heroes[0];
      burst(state, victim.x, victim.y, "#94a3b8", 8);
      state.heroes.shift();
      enemy.dmg += 2;
    } else {
      state.towerHP -= enemy.dmg;
      addFloater(state, CANVAS_W / 2, TOWER_Y - 20, `-${enemy.dmg}`, "#ef4444");
    }
  }
}

function update(state, dt) {
  if (state.mode === "pvc") updatePvc(state, dt);
  else updateClassic(state, dt);

  state.particles = state.particles.filter(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life--; p.size *= 0.95; return p.life > 0; });
  state.floaters = state.floaters.filter(f => { f.y -= 0.6; f.life--; return f.life > 0; });
}

function updateClassic(state, dt) {
  const e = state.enemy;
  if (e) {
    e.wob += dt / 200;
    if (e.hit > 0) e.hit--;
    const engaged = state.heroes.find(h => Math.abs(h.y - e.y) < e.size + h.size + 4 && Math.abs(h.x - e.x) < e.size + h.size);
    if (engaged) {
      e.attackCd -= dt;
      if (e.attackCd <= 0) { e.attackCd = 700; engaged.hp -= e.dmg; burst(state, engaged.x, engaged.y, "#ef4444", 4); }
    } else {
      e.y += e.speed * dt * 0.1;
      if (e.y >= TOWER_Y - e.size) {
        state.towerHP -= e.dmg;
        addFloater(state, CANVAS_W / 2, TOWER_Y - 20, `-${e.dmg}`, "#ef4444");
        burst(state, CANVAS_W / 2, TOWER_Y, "#ef4444", 8);
        e.y = ENEMY_START_Y;
      }
    }
    if (e.hp <= 0) {
      state.kills++;
      state.score += 25 * e.level;
      state.coins += 3 * e.level;
      burst(state, e.x, e.y, "#fbbf24", 14);
      addFloater(state, e.x, e.y, `Besiegt! +${3 * e.level}🪙`, "#fbbf24");
      state.enemyLevel = e.level + 1;
      spawnEnemy(state);
    }
  }
  for (const h of state.heroes) {
    if (h.attackCd > 0) h.attackCd -= dt;
    if (e && Math.abs(h.y - e.y) < e.size + h.size + 4 && Math.abs(h.x - e.x) < e.size + h.size) {
      if (h.attackCd <= 0) {
        h.attackCd = 600;
        const dmg = h.dmg * (1 - e.armor);
        e.hp -= dmg; e.hit = 6;
        addFloater(state, e.x + (Math.random() - 0.5) * 12, e.y - e.size, `-${Math.round(dmg)}`, "#22d3ee");
      }
    } else {
      h.y -= h.speed * dt * 0.1 + h.speed;
      if (e) h.x = lerp(h.x, e.x, 0.02);
    }
  }
  state.heroes = state.heroes.filter(h => h.hp > 0 && h.y > -20);
}

function updatePvc(state, dt) {
  // Heroes march up toward the CPU fortress; foes march down toward the player.
  for (const h of state.heroes) { if (h.attackCd > 0) h.attackCd -= dt; if (h.hit > 0) h.hit--; }
  for (const f of state.foes) { if (f.attackCd > 0) f.attackCd -= dt; if (f.hit > 0) f.hit--; f.wob += dt / 200; }

  const inRange = (a, b) => Math.abs(a.y - b.y) < a.size + b.size + 4 && Math.abs(a.x - b.x) < a.size + b.size + 6;

  // Heroes
  for (const h of state.heroes) {
    const foe = nearest(h, state.foes);
    if (foe && inRange(h, foe)) {
      if (h.attackCd <= 0) {
        h.attackCd = 600;
        foe.hp -= h.dmg; foe.hit = 6;
        addFloater(state, foe.x, foe.y - foe.size, `-${Math.round(h.dmg)}`, "#22d3ee");
      }
    } else {
      h.y -= h.speed * dt * 0.1 + h.speed * 0.5;
      if (foe) h.x = lerp(h.x, foe.x, 0.03);
      if (h.y <= CPU_TOWER_Y + 12) {
        state.cpuHP -= 12;
        addFloater(state, h.x, CPU_TOWER_Y + 20, "-12", "#22d3ee");
        burst(state, h.x, CPU_TOWER_Y + 14, "#22d3ee", 8);
        h.hp = 0;
      }
    }
  }
  // Foes
  for (const f of state.foes) {
    const hero = nearest(f, state.heroes);
    if (hero && inRange(f, hero)) {
      if (f.attackCd <= 0) {
        f.attackCd = 650;
        hero.hp -= f.dmg; hero.hit = 6;
        addFloater(state, hero.x, hero.y - hero.size, `-${Math.round(f.dmg)}`, "#ef4444");
      }
    } else {
      f.y += f.speed * dt * 0.1 + f.speed * 0.5;
      if (hero) f.x = lerp(f.x, hero.x, 0.03);
      if (f.y >= TOWER_Y - 12) {
        state.towerHP -= f.dmg;
        addFloater(state, f.x, TOWER_Y - 18, `-${f.dmg}`, "#ef4444");
        burst(state, f.x, TOWER_Y - 6, "#ef4444", 8);
        f.hp = 0;
      }
    }
  }

  // Remove dead, award score/coins for foes the player destroyed
  state.foes = state.foes.filter(f => {
    if (f.hp <= 0 && f.y > CPU_TOWER_Y + 13) { // died in the field, not at our gate
      if (f.y < TOWER_Y - 12) { state.score += 8; state.coins += 1; burst(state, f.x, f.y, "#fbbf24", 8); }
      return false;
    }
    return f.hp > 0;
  });
  state.heroes = state.heroes.filter(h => h.hp > 0);
}

function nearest(unit, list) {
  let best = null, bd = Infinity;
  for (const o of list) {
    const d = Math.hypot(o.x - unit.x, o.y - unit.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function draw(ctx, state) {
  const isDark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const now = performance.now();
  const pvc = state.mode === "pvc";

  // ── Arena background ──────────────────────────────────────────────
  const wallC = isDark ? "#2b2620" : "#6b5d4f";
  ctx.fillStyle = wallC;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.strokeStyle = isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1;
  for (let y = 0; y < CANVAS_H; y += 12) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    const off = (Math.floor(y / 12) % 2) * 14;
    for (let x = off; x < CANVAS_W; x += 28) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 12); ctx.stroke(); }
  }

  // Spectators
  const crowdCols = ["#e2725b", "#5b8def", "#46b46e", "#e0b341", "#b06fd4", "#d96fa3", "#dcdcdc"];
  let ci = 0;
  const dot = (x, y) => {
    const bob = Math.sin(now / 260 + ci) * 0.7;
    ctx.fillStyle = crowdCols[ci++ % crowdCols.length];
    ctx.beginPath(); ctx.arc(x, y + bob, 2.2, 0, Math.PI * 2); ctx.fill();
  };
  for (let x = 5; x < CANVAS_W - 3; x += 8) { dot(x, 5); dot(x + 4, 10); }
  for (let x = 5; x < CANVAS_W - 3; x += 8) { dot(x, CANVAS_H - 9); dot(x + 4, CANVAS_H - 4); }
  for (let y = 16; y < CANVAS_H - 14; y += 8) { dot(4, y); dot(CANVAS_W - 4, y); }

  // Sand floor
  const pad = 12;
  const floor1 = isDark ? "#3a3024" : "#cdb288";
  const floor2 = isDark ? "#332b20" : "#c2a679";
  roundRectFill(ctx, pad, pad, CANVAS_W - pad * 2, CANVAS_H - pad * 2, 10, floor1);
  ctx.save();
  roundRectClip(ctx, pad, pad, CANVAS_W - pad * 2, CANVAS_H - pad * 2, 10);
  ctx.fillStyle = floor2;
  for (let r = 0; r < Math.ceil(CANVAS_H / 30); r++)
    for (let c = 0; c < Math.ceil(CANVAS_W / 30); c++)
      if ((r + c) % 2 === 0) ctx.fillRect(c * 30, r * 30, 30, 30);

  const midY = CANVAS_H / 2;
  ctx.fillStyle = isDark ? "rgba(200,50,50,0.08)" : "rgba(220,80,80,0.10)";
  ctx.fillRect(pad, pad, CANVAS_W - pad * 2, midY - pad);
  ctx.fillStyle = isDark ? "rgba(50,100,200,0.08)" : "rgba(80,120,220,0.10)";
  ctx.fillRect(pad, midY, CANVAS_W - pad * 2, CANVAS_H - pad - midY);
  ctx.strokeStyle = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.moveTo(pad + 8, midY); ctx.lineTo(CANVAS_W - pad - 8, midY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "16px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = isDark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.7)";
  ctx.beginPath(); ctx.arc(CANVAS_W / 2, midY, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillText("⚔️", CANVAS_W / 2, midY);
  ctx.strokeStyle = isDark ? "rgba(0,0,0,0.08)" : "rgba(120,90,50,0.10)";
  ctx.lineWidth = 1.5;
  for (let i = 1; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(CANVAS_W / 2, midY, 45 * i, 55 * i, 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();

  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 3;
  roundRectStroke(ctx, pad, pad, CANVAS_W - pad * 2, CANVAS_H - pad * 2, 10);

  // Torches
  const flick = 0.7 + Math.sin(now / 90) * 0.15 + Math.random() * 0.1;
  const corners = [[pad + 3, pad + 3], [CANVAS_W - pad - 3, pad + 3],
                   [pad + 3, CANVAS_H - pad - 3], [CANVAS_W - pad - 3, CANVAS_H - pad - 3]];
  for (const [cx, cy] of corners) {
    const gl = ctx.createRadialGradient(cx, cy, 2, cx, cy, 22 * flick);
    gl.addColorStop(0, "rgba(255,170,60,0.5)");
    gl.addColorStop(1, "rgba(255,170,60,0)");
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(cx, cy, 22 * flick, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = isDark ? "#1c1813" : "#3a3026";
    ctx.beginPath(); ctx.arc(cx, cy + 2, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fb923c";
    ctx.beginPath(); ctx.ellipse(cx, cy - 2, 2.8, 5.5 * flick, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fde047";
    ctx.beginPath(); ctx.ellipse(cx, cy - 1, 1.4, 3 * flick, 0, 0, Math.PI * 2); ctx.fill();
  }

  // ── Player fortress (bottom) ──────────────────────────────────────
  drawFortress(ctx, CANVAS_W / 2, TOWER_Y, state.towerHP / state.towerMax, "#3b82f6", now, false);

  // ── CPU fortress (top, PvC only) ──────────────────────────────────
  if (pvc) drawFortress(ctx, CANVAS_W / 2, CPU_TOWER_Y, state.cpuHP / state.cpuMax, "#dc2626", now, true);

  // Heroes
  for (const h of state.heroes) drawFighter(ctx, h, false, isDark);

  // PvC foes
  if (pvc) for (const f of state.foes) drawFighter(ctx, f, true, isDark);

  // Classic single enemy
  if (!pvc && state.enemy) drawBoss(ctx, state.enemy, isDark);

  // Particles & floaters
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life / 30);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const f of state.floaters) {
    ctx.globalAlpha = Math.max(0, f.life / 40);
    ctx.fillStyle = f.color; ctx.font = "bold 12px sans-serif";
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawFortress(ctx, x, y, hpFrac, baseColor, now, flip) {
  const tp = Math.max(0, hpFrac);
  const dir = flip ? -1 : 1;
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath(); ctx.ellipse(x, y + 18 * dir, 28, 6, 0, 0, Math.PI * 2); ctx.fill();
  const keepC = tp > 0.5 ? baseColor : tp > 0.25 ? "#d97706" : "#dc2626";
  roundRectFill(ctx, x - 24, y - 10, 48, 30, 6, keepC);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  for (let i = 0; i < 4; i++) ctx.fillRect(x - 22 + i * 12, flip ? y + 13 : y - 16, 7, 7);
  ctx.fillStyle = "#1e293b";
  roundRectFill(ctx, x - 5, y + 2, 10, 14, 3, "#1e293b");
  const sway = Math.sin(now / 300) * 2;
  ctx.fillStyle = tp > 0.25 ? (flip ? "#ef4444" : "#0d9488") : "#ef4444";
  const by = flip ? y + 16 : y - 16;
  ctx.beginPath();
  ctx.moveTo(x, by); ctx.lineTo(x + 10 + sway, by - 4 * dir);
  ctx.lineTo(x + 10 + sway, by + 4 * dir); ctx.lineTo(x, by + 2 * dir); ctx.fill();
  ctx.strokeStyle = "#334155"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, flip ? y + 20 : y - 22); ctx.lineTo(x, flip ? y + 6 : y - 6); ctx.stroke();
  // HP bar
  const barY = flip ? y - 18 : y - 26;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(x - 30, barY, 60, 5);
  ctx.fillStyle = tp > 0.5 ? "#22c55e" : tp > 0.25 ? "#f59e0b" : "#ef4444";
  ctx.fillRect(x - 30, barY, 60 * tp, 5);
}

function drawFighter(ctx, u, isFoe, isDark) {
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath(); ctx.ellipse(u.x, u.y + u.size * 0.7, u.size * 0.6, 3, 0, 0, Math.PI * 2); ctx.fill();
  let bodyC;
  if (isFoe) bodyC = u.hit > 0 ? "#ffffff" : "#ef4444";
  else bodyC = u.hit > 0 ? "#ffffff" : (["#60a5fa", "#34d399", "#a78bfa"][(u.diff || 1) - 1] || "#60a5fa");
  ctx.fillStyle = bodyC;
  ctx.beginPath(); ctx.arc(u.x, u.y, u.size, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath(); ctx.arc(u.x - u.size * 0.3, u.y - u.size * 0.3, u.size * 0.35, 0, Math.PI * 2); ctx.fill();
  // weapon points toward the enemy side
  const dir = isFoe ? 1 : -1;
  ctx.strokeStyle = isFoe ? "#7f1d1d" : "#e2e8f0"; ctx.lineWidth = 2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(u.x, u.y + u.size * 0.3 * dir); ctx.lineTo(u.x, u.y + (u.size + 6) * dir); ctx.stroke();
  ctx.fillStyle = isFoe ? "#1e293b" : "#fde047";
  ctx.beginPath();
  ctx.moveTo(u.x - 3, u.y + (u.size + 6) * dir); ctx.lineTo(u.x + 3, u.y + (u.size + 6) * dir);
  ctx.lineTo(u.x, u.y + (u.size + 4) * dir); ctx.fill();
  // hp
  const hpp = u.hp / u.maxHp;
  const barY = u.y - u.size - (isFoe ? 8 : 10);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(u.x - 10, barY, 20, 3);
  ctx.fillStyle = isFoe ? "#fb7185" : "#22c55e";
  ctx.fillRect(u.x - 10, barY, 20 * hpp, 3);
}

function drawBoss(ctx, e, isDark) {
  const wob = Math.sin(e.wob) * 2;
  const ex = e.x + wob;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(ex, e.y + e.size * 0.8, e.size * 0.7, 5, 0, 0, Math.PI * 2); ctx.fill();
  if (e.level >= 3) {
    const eg = ctx.createRadialGradient(ex, e.y, e.size * 0.3, ex, e.y, e.size * 1.6);
    eg.addColorStop(0, `rgba(239,68,68,${0.1 + e.level * 0.03})`);
    eg.addColorStop(1, "rgba(239,68,68,0)");
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.arc(ex, e.y, e.size * 1.6, 0, Math.PI * 2); ctx.fill();
  }
  if (e.armor > 0) {
    ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 2 + e.armor * 6;
    ctx.beginPath(); ctx.arc(ex, e.y, e.size + 3, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = e.hit > 0 ? "#ffffff" : `hsl(${Math.max(0, 350 - e.level * 12)}, 70%, ${isDark ? 45 : 50}%)`;
  ctx.beginPath(); ctx.arc(ex, e.y, e.size, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath(); ctx.arc(ex + 2, e.y + 3, e.size * 0.7, 0, Math.PI * 2); ctx.fill();
  ctx.font = `${Math.round(e.size)}px sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(e.level > 5 ? "👹" : e.level > 3 ? "👿" : "👾", ex, e.y + 1);
  if (e.level >= 2) {
    ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    const hs = Math.min(e.size * 0.6, 14);
    ctx.beginPath(); ctx.moveTo(ex - e.size * 0.5, e.y - e.size * 0.6); ctx.lineTo(ex - e.size * 0.8, e.y - e.size * 0.6 - hs); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex + e.size * 0.5, e.y - e.size * 0.6); ctx.lineTo(ex + e.size * 0.8, e.y - e.size * 0.6 - hs); ctx.stroke();
  }
  ctx.fillStyle = "#1e293b";
  ctx.beginPath(); ctx.arc(ex + e.size * 0.7, e.y - e.size * 0.7, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "bold 9px sans-serif";
  ctx.fillText(e.level, ex + e.size * 0.7, e.y - e.size * 0.7);
  const hp = e.hp / e.maxHp;
  const bw = e.size * 2.2;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(ex - bw / 2, e.y - e.size - 12, bw, 5);
  ctx.fillStyle = hp > 0.5 ? "#22c55e" : hp > 0.25 ? "#f59e0b" : "#ef4444";
  ctx.fillRect(ex - bw / 2, e.y - e.size - 12, bw * hp, 5);
}

async function endGame(state, root, won) {
  if (state.gameOver) return;
  state.gameOver = true;
  state.won = won;
  const winBonus = won ? 25 : 0;
  const earned = Math.floor(state.score / 10) + state.coins + winBonus;
  await addCoins(earned, "quiz-battle");
  await saveGameScore("quiz-battle", { points: state.score, coins: earned, won });
  const wrap = root.querySelector(".qb-game");
  if (!wrap) return;
  const pvc = state.mode === "pvc";
  const title = won ? (pvc ? "🏆 KI besiegt!" : "🏆 Sieg!") : "🏰 Turm zerstört!";
  const sub = pvc
    ? (won ? "Du hast die gegnerische Festung zerstört!" : "Die KI hat deine Festung zerstört.")
    : (won ? `Du hast alle ${state.goalKills} Gegner besiegt!` : `Du hast ${state.kills} von ${state.goalKills} Gegnern besiegt.`);
  const statLine = pvc
    ? `<div>🏰 Deine Festung: <strong>${Math.max(0, Math.round(state.towerHP))}</strong></div>
       <div>🤖 KI-Festung: <strong>${Math.max(0, Math.round(state.cpuHP))}</strong></div>`
    : `<div>💀 Besiegt: <strong>${state.kills}/${state.goalKills}</strong></div>
       <div>⚔️ Gegner-Level: <strong>${state.enemy?.level || 1}</strong></div>`;
  const over = document.createElement("div");
  over.className = "td-gameover td-gameover-scroll";
  over.innerHTML = `
    <h2>${title}</h2>
    <p class="td-go-sub">${sub}</p>
    <div class="td-go-stats">
      <div>⭐ Score: <strong>${state.score}</strong></div>
      ${statLine}
      <div>🪙 Verdient: <strong>${earned}</strong>${winBonus ? ` (+${winBonus} Bonus)` : ""}</div>
    </div>
    ${buildFeedbackHtml(state.log)}
    <div class="td-go-actions">
      <button class="btn-cta" id="qb-retry">🔄 Nochmal</button>
      <button class="btn-secondary" id="qb-home">← Zurück</button>
    </div>`;
  wrap.appendChild(over);
  over.querySelector("#qb-retry").addEventListener("click", () => navigate("quiz-battle"));
  over.querySelector("#qb-home").addEventListener("click", () => navigate("games"));
  attachFeedbackListeners(over, state.log);
}

function updateHUD(state, root) {
  const set = (id, v) => { const el = root.querySelector(id); if (el) el.textContent = v; };
  set("#qb-hp", Math.max(0, Math.round(state.towerHP)));
  set("#qb-score", state.score);
  if (state.mode === "pvc") {
    set("#qb-cpuhp", Math.max(0, Math.round(state.cpuHP)));
  } else {
    set("#qb-kills", state.kills);
    set("#qb-lvl", state.enemy?.level || 1);
  }
}

function burst(state, x, y, color, n) {
  for (let i = 0; i < n; i++)
    state.particles.push({ x, y, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 - 1, life: 25, color, size: 3 + Math.random() * 2 });
}
function addFloater(state, x, y, text, color) { state.floaters.push({ x, y, text, color, life: 45 }); }
function lerp(a, b, t) { return a + (b - a) * t; }
function roundRectFill(ctx, x, y, w, h, r, fill) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
function roundRectClip(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.clip();
}
function roundRectStroke(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.stroke();
}
