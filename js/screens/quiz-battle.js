import { loadQuizzes, addCoins, saveGameScore } from "../store.js";
import { navigate } from "../router.js";
import { esc } from "../utils.js";
import { buildPlayable, checkText, checkTextSmart, checkMulti, shuffle, buildFeedbackHtml, attachFeedbackListeners } from "../games-util.js";

const CANVAS_W = 360, CANVAS_H = 420;
const TOWER_Y = CANVAS_H - 36;
const ENEMY_START_Y = 50;

export async function render(root) {
  const quizzes = await loadQuizzes();
  if (!quizzes.length) {
    root.innerHTML = `<div class="screen-empty"><p>Erstelle zuerst ein Quiz!</p>
      <button class="btn-cta" id="qb-empty-back">Zurück</button></div>`;
    root.querySelector("#qb-empty-back").addEventListener("click", () => navigate("home"));
    return;
  }

  root.innerHTML = `
    <div class="td-setup">
      <h2>⚔️ Quiz Battle</h2>
      <p>Ziehe die richtige Antwort ins Feld — dein Held greift den Gegner an. Besiege 5 Gegner, um zu gewinnen! Falsche Antworten machen den Gegner stärker.</p>
      <div class="td-quiz-select">
        <label>Quiz wählen:</label>
        <select id="qb-quiz">
          ${quizzes.map((q, i) => `<option value="${i}">${esc(q.name)} (${q.questions?.length || 0})</option>`).join("")}
        </select>
      </div>
      <button class="btn-cta td-start" id="qb-start">⚔️ Kampf starten</button>
      <button class="btn-secondary" id="qb-back">← Zurück</button>
    </div>`;

  root.querySelector("#qb-back").addEventListener("click", () => navigate("home"));
  root.querySelector("#qb-start").addEventListener("click", () => {
    const qi = parseInt(root.querySelector("#qb-quiz").value);
    startBattle(root, quizzes[qi]);
  });
}

function startBattle(root, quiz) {
  const questions = shuffle(buildPlayable(quiz.questions));
  if (!questions.length) {
    root.innerHTML = `<div class="screen-empty">
      <p>Dieses Quiz hat keine für Spiele geeigneten Fragen.</p>
      <p style="font-size:0.85rem">Geeignet sind Single/Multiple Choice, Freitext, Lückentext und Formel-Fragen.</p>
      <button class="btn-cta" id="qb-noq-back">← Zurück</button></div>`;
    root.querySelector("#qb-noq-back").addEventListener("click", () => navigate("quiz-battle"));
    return;
  }

  const state = {
    towerHP: 100, towerMax: 100,
    heroes: [], particles: [], floaters: [],
    enemy: null, enemyLevel: 1, correctTotal: 0,
    score: 0, coins: 0, kills: 0, qIndex: 0,
    gameOver: false, won: false, currentQ: null, currentDiff: 1, locked: false,
    goalKills: 5, log: [],
  };

  root.innerHTML = `
    <div class="qb-game">
      <div class="td-hud">
        <div class="td-hud-item"><span>🏰</span> <span id="qb-hp">100</span></div>
        <div class="td-hud-item">💀 <span id="qb-kills">0</span>/${state.goalKills}</div>
        <div class="td-hud-item">⚔️ Lvl <span id="qb-lvl">1</span></div>
        <div class="td-hud-item td-score">⭐ <span id="qb-score">0</span></div>
      </div>
      <div class="qb-canvas-wrap">
        <canvas id="qb-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
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

  spawnEnemy(state);
  showQuestion(state, root, canvas);

  let lastTime = performance.now();
  function loop(ts) {
    if (state.gameOver) return;
    const dt = Math.min(ts - lastTime, 50);
    lastTime = ts;
    update(state, dt);
    updateHUD(state, root);
    draw(ctx, state);
    if (state.towerHP <= 0) { endGame(state, root, false); return; }
    if (state.kills >= state.goalKills) { endGame(state, root, true); return; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function spawnEnemy(state) {
  const lvl = state.enemyLevel;
  state.enemy = {
    x: CANVAS_W / 2, y: ENEMY_START_Y,
    hp: 18 + lvl * 10, maxHp: 18 + lvl * 10,
    armor: Math.min(0.6, (lvl - 1) * 0.08),
    dmg: 8 + lvl * 3,
    speed: 0.10 + lvl * 0.006,
    size: 18 + Math.min(22, lvl * 2),
    level: lvl, hit: 0, attackCd: 0, wob: 0,
  };
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
  txt.textContent = q.prompt;
  qtextEl.appendChild(txt);
  const cards = root.querySelector("#qb-cards");
  cards.innerHTML = "";

  const commit = (ok, userAnswer = "", aiFeedback = null) => {
    if (state.locked) return;
    state.locked = true;
    if (state.currentQ) state.log.push({ q: state.currentQ, correct: ok, userAnswer, aiFeedback });
    onAnswer(state, ok, root);
    if (!state.gameOver && state.towerHP > 0 && state.kills < state.goalKills) {
      setTimeout(() => showQuestion(state, root, canvas), 850);
    }
  };

  if (q.kind === "choice") {
    shuffle([...q.options]).forEach((o) => {
      const card = document.createElement("div");
      card.className = "qb-card";
      card.textContent = o.text;
      makeDraggable(card, canvas, () => commit(!!o.correct, o.text));
      cards.appendChild(card);
    });
  } else if (q.kind === "multi") {
    const shuffled = shuffle([...q.options]);
    const selected = new Set();
    const hint = document.createElement("div");
    hint.className = "qb-multi-hint";
    hint.textContent = "Mehrere richtig — antippen zum Wählen, dann „Angreifen" ziehen";
    cards.appendChild(hint);
    shuffled.forEach((o, i) => {
      const card = document.createElement("div");
      card.className = "qb-card qb-card-select";
      card.textContent = o.text;
      card.addEventListener("click", () => {
        if (selected.has(i)) { selected.delete(i); card.classList.remove("selected"); }
        else { selected.add(i); card.classList.add("selected"); }
        attackCard.textContent = `⚔️ Angreifen (${selected.size})`;
      });
      cards.appendChild(card);
    });
    const attackCard = document.createElement("div");
    attackCard.className = "qb-card qb-attack-card";
    attackCard.textContent = "⚔️ Angreifen (0)";
    makeDraggable(attackCard, canvas, () => {
      const chosen = shuffled.filter((_, i) => selected.has(i));
      commit(checkMulti(q.options, chosen.map(o => q.options.indexOf(o))), chosen.map(o => o.text).join(", "));
    });
    cards.appendChild(attackCard);
  } else {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "td-input";
    inp.placeholder = "Antwort eingeben…";
    const btn = document.createElement("button");
    btn.className = "td-opt td-submit";
    btn.textContent = "⚔️";
    const check = async () => {
      const localOk = checkText(q.accept, inp.value);
      if (localOk) { commit(true, inp.value); return; }
      const result = await checkTextSmart(q.prompt, q.accept, inp.value);
      commit(result.correct, inp.value, result.feedback);
    };
    btn.addEventListener("click", check);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
    const wrap = document.createElement("div");
    wrap.className = "qb-text-row";
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

function onAnswer(state, correct, root) {
  const enemy = state.enemy;
  if (correct) {
    state.correctTotal++;
    const diff = state.currentDiff;
    // Spawn a hero scaled by difficulty
    state.heroes.push({
      x: CANVAS_W / 2 + (Math.random() - 0.5) * 40, y: TOWER_Y - 10,
      hp: 30 + diff * 15, maxHp: 30 + diff * 15,
      dmg: 6 + diff * 4, speed: 0.12, size: 12 + diff * 3,
      attackCd: 0, diff,
    });
    state.score += 10 * diff;
    addFloater(state, CANVAS_W / 2, TOWER_Y - 30, `+Held (Lvl ${diff})`, "#22c55e");
    // Escalation: every few correct answers the enemy grows tougher/bigger
    if (state.correctTotal % 3 === 0 && enemy) {
      enemy.armor = Math.min(0.7, enemy.armor + 0.06);
      enemy.size += 3;
      enemy.maxHp += 8; enemy.hp += 8;
      addFloater(state, enemy.x, enemy.y - enemy.size - 10, "Gegner verstärkt!", "#ef4444");
    }
  } else {
    // Enemy levels up: bigger, more armor, more damage; destroys nearest hero
    if (enemy) {
      enemy.level++;
      enemy.size += 4;
      enemy.armor = Math.min(0.8, enemy.armor + 0.1);
      enemy.dmg += 4;
      enemy.maxHp += 10; enemy.hp = Math.min(enemy.maxHp, enemy.hp + 10);
      enemy.hit = 0;
      addFloater(state, enemy.x, enemy.y - enemy.size - 10, `⬆ Lvl ${enemy.level}`, "#ef4444");
      burst(state, enemy.x, enemy.y, "#ef4444", 10);
      // Destroy nearest hero (enemy "takes its sword")
      if (state.heroes.length) {
        state.heroes.sort((a, b) => (a.y - b.y));
        const victim = state.heroes[0];
        burst(state, victim.x, victim.y, "#94a3b8", 8);
        state.heroes.shift();
        enemy.dmg += 2; // gets stronger from the kill
      } else {
        // No hero to destroy → hits the tower directly
        state.towerHP -= enemy.dmg;
        addFloater(state, CANVAS_W / 2, TOWER_Y - 20, `-${enemy.dmg}`, "#ef4444");
      }
    }
  }
}

function update(state, dt) {
  const e = state.enemy;
  if (e) {
    e.wob += dt / 200;
    if (e.hit > 0) e.hit--;
    // find nearest hero in front
    const engaged = state.heroes.find(h => Math.abs(h.y - e.y) < e.size + h.size + 4 && Math.abs(h.x - e.x) < e.size + h.size);
    if (engaged) {
      // fight in place
      e.attackCd -= dt;
      if (e.attackCd <= 0) {
        e.attackCd = 700;
        engaged.hp -= e.dmg;
        burst(state, engaged.x, engaged.y, "#ef4444", 4);
      }
    } else {
      e.y += e.speed * dt * 0.1 + e.speed; // advance toward tower
      if (e.y >= TOWER_Y - e.size) {
        state.towerHP -= e.dmg;
        addFloater(state, CANVAS_W / 2, TOWER_Y - 20, `-${e.dmg}`, "#ef4444");
        burst(state, CANVAS_W / 2, TOWER_Y, "#ef4444", 8);
        e.y = ENEMY_START_Y; // reset to top, keep stats (relentless)
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

  // Heroes march up and attack enemy
  for (const h of state.heroes) {
    if (h.attackCd > 0) h.attackCd -= dt;
    if (e && Math.abs(h.y - e.y) < e.size + h.size + 4 && Math.abs(h.x - e.x) < e.size + h.size) {
      if (h.attackCd <= 0) {
        h.attackCd = 600;
        const dmg = h.dmg * (1 - e.armor);
        e.hp -= dmg;
        e.hit = 6;
        addFloater(state, e.x + (Math.random() - 0.5) * 12, e.y - e.size, `-${Math.round(dmg)}`, "#22d3ee");
      }
    } else {
      h.y -= h.speed * dt * 0.1 + h.speed;
      if (e) h.x = lerp(h.x, e.x, 0.02);
    }
  }
  state.heroes = state.heroes.filter(h => h.hp > 0 && h.y > -20);

  state.particles = state.particles.filter(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life--; p.size *= 0.95; return p.life > 0; });
  state.floaters = state.floaters.filter(f => { f.y -= 0.6; f.life--; return f.life > 0; });
}

function draw(ctx, state) {
  const isDark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Arena background (top enemy zone red-ish, bottom your zone blue-ish)
  const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  if (isDark) { g.addColorStop(0, "#2a1020"); g.addColorStop(1, "#0b1120"); }
  else { g.addColorStop(0, "#ffe4e6"); g.addColorStop(1, "#dbeafe"); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // mid line
  ctx.strokeStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, CANVAS_H / 2); ctx.lineTo(CANVAS_W, CANVAS_H / 2); ctx.stroke();

  // Tower (your base)
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(CANVAS_W / 2, TOWER_Y + 16, 30, 7, 0, 0, Math.PI * 2); ctx.fill();
  drawRoundRect(ctx, CANVAS_W / 2 - 26, TOWER_Y - 8, 52, 30, 8, "#3b82f6");
  ctx.font = "20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("🏰", CANVAS_W / 2, TOWER_Y + 7);
  // tower HP bar
  const tp = Math.max(0, state.towerHP / state.towerMax);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(CANVAS_W / 2 - 30, TOWER_Y - 18, 60, 5);
  ctx.fillStyle = tp > 0.5 ? "#22c55e" : tp > 0.25 ? "#f59e0b" : "#ef4444";
  ctx.fillRect(CANVAS_W / 2 - 30, TOWER_Y - 18, 60 * tp, 5);

  // Heroes
  for (const h of state.heroes) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.ellipse(h.x, h.y + h.size * 0.7, h.size * 0.6, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ["#60a5fa", "#34d399", "#a78bfa"][h.diff - 1] || "#60a5fa";
    ctx.beginPath(); ctx.arc(h.x, h.y, h.size, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${h.size}px sans-serif`;
    ctx.fillText("🛡", h.x, h.y + 1);
    // hp
    const hp = h.hp / h.maxHp;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(h.x - 12, h.y - h.size - 6, 24, 3);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(h.x - 12, h.y - h.size - 6, 24 * hp, 3);
  }

  // Enemy
  const e = state.enemy;
  if (e) {
    const wob = Math.sin(e.wob) * 2;
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath(); ctx.ellipse(e.x, e.y + e.size * 0.8, e.size * 0.7, 5, 0, 0, Math.PI * 2); ctx.fill();
    // armor ring
    if (e.armor > 0) {
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 2 + e.armor * 6;
      ctx.beginPath(); ctx.arc(e.x + wob, e.y, e.size + 3, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = e.hit > 0 ? "#ffffff" : `hsl(${Math.max(0, 350 - e.level * 12)}, 70%, ${isDark ? 45 : 50}%)`;
    ctx.beginPath(); ctx.arc(e.x + wob, e.y, e.size, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${Math.round(e.size)}px sans-serif`;
    ctx.fillText(e.level > 5 ? "👹" : "👾", e.x + wob, e.y + 1);
    // hp bar
    const hp = e.hp / e.maxHp;
    const bw = e.size * 2.2;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(e.x - bw / 2, e.y - e.size - 9, bw, 5);
    ctx.fillStyle = hp > 0.5 ? "#22c55e" : hp > 0.25 ? "#f59e0b" : "#ef4444";
    ctx.fillRect(e.x - bw / 2, e.y - e.size - 9, bw * hp, 5);
  }

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
  const over = document.createElement("div");
  over.className = "td-gameover td-gameover-scroll";
  over.innerHTML = `
    <h2>${won ? "🏆 Sieg!" : "🏰 Turm zerstört!"}</h2>
    <p class="td-go-sub">${won
      ? `Du hast alle ${state.goalKills} Gegner besiegt!`
      : `Du hast ${state.kills} von ${state.goalKills} Gegnern besiegt.`}</p>
    <div class="td-go-stats">
      <div>⭐ Score: <strong>${state.score}</strong></div>
      <div>💀 Besiegt: <strong>${state.kills}/${state.goalKills}</strong></div>
      <div>⚔️ Gegner-Level: <strong>${state.enemy?.level || 1}</strong></div>
      <div>🪙 Verdient: <strong>${earned}</strong>${winBonus ? ` (+${winBonus} Bonus)` : ""}</div>
    </div>
    ${buildFeedbackHtml(state.log)}
    <div class="td-go-actions">
      <button class="btn-cta" id="qb-retry">🔄 Nochmal</button>
      <button class="btn-secondary" id="qb-home">← Zurück</button>
    </div>`;
  wrap.appendChild(over);
  over.querySelector("#qb-retry").addEventListener("click", () => navigate("quiz-battle"));
  over.querySelector("#qb-home").addEventListener("click", () => navigate("home"));
  attachFeedbackListeners(over, state.log);
}

function updateHUD(state, root) {
  const set = (id, v) => { const el = root.querySelector(id); if (el) el.textContent = v; };
  set("#qb-hp", Math.max(0, Math.round(state.towerHP)));
  set("#qb-kills", state.kills);
  set("#qb-lvl", state.enemy?.level || 1);
  set("#qb-score", state.score);
}

function burst(state, x, y, color, n) {
  for (let i = 0; i < n; i++)
    state.particles.push({ x, y, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 - 1, life: 25, color, size: 3 + Math.random() * 2 });
}
function addFloater(state, x, y, text, color) { state.floaters.push({ x, y, text, color, life: 45 }); }
function lerp(a, b, t) { return a + (b - a) * t; }
function drawRoundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
