import { loadQuizzes, addCoins, saveGameScore, loadProfile } from "../store.js";
import { navigate } from "../router.js";
import { esc, mathEsc } from "../utils.js";
import { buildPlayable, checkText, checkTextSmart, checkMulti, checkMultiText, shuffle, buildFeedbackHtml, attachFeedbackListeners } from "../games-util.js";
import { getGameSkin } from "../shop-catalog.js";
// Note: local burst() stays (sets particle `size`, which draw() relies on);
// canvas-util's burst does not set size, so it must not be imported here.
import { lerp, addFloater, roundRectPath, roundRectFill, roundRectStroke, strokePath } from "../canvas-util.js";

const CANVAS_W = 360, CANVAS_H = 560;
const TILE = 40;
const COLS = Math.floor(CANVAS_W / TILE);
const ROWS = Math.floor(CANVAS_H / TILE);

const PATH = buildPath();
function buildPath() {
  const p = [];
  let row = 0, col = 0, dir = 1;
  while (row < ROWS) {
    p.push({ col, row });
    if ((dir === 1 && col >= COLS - 1) || (dir === -1 && col <= 0)) {
      row++;
      if (row < ROWS) p.push({ col, row });
      dir *= -1;
    } else {
      col += dir;
    }
  }
  return p;
}

const DIFF_LABEL = { 1: "Leicht", 2: "Mittel", 3: "Schwer" };
const DIFF_COLOR = { 1: "#22c55e", 2: "#f59e0b", 3: "#ef4444" };

// Bloons-style balloon colors by remaining HP fraction tier
const BLOON_TIERS = ["#e11d48", "#3b82f6", "#22c55e", "#eab308", "#ec4899", "#1e293b"];

// Shared abort state so the router can kill the game loop on navigation
let _activeState = null;

export async function render(root) {
  // Kill any leftover game from a previous mount
  if (_activeState) { _activeState.gameOver = true; _activeState = null; }

  const quizzes = await loadQuizzes();
  if (!quizzes.length) {
    root.innerHTML = `<div class="screen-empty"><p>Erstelle zuerst ein Quiz!</p>
      <button class="btn-cta" id="td-empty-back">Zurück</button></div>`;
    root.querySelector("#td-empty-back").addEventListener("click", () => navigate("home"));
    return () => {};
  }

  root.innerHTML = `
    <div class="td-setup">
      <h2>🏰 Tower Defense</h2>
      <p>Verteidige deine Basis und überstehe alle Wellen, um zu gewinnen! Schwere Fragen richten mehr Schaden an.</p>
      <div class="td-quiz-select">
        <label>Quiz wählen:</label>
        <select id="td-quiz">
          ${quizzes.map((q, i) => `<option value="${i}">${esc(q.name)} (${q.questions?.length || 0})</option>`).join("")}
        </select>
      </div>
      <div class="td-difficulty">
        <label>Schwierigkeit:</label>
        <div class="td-diff-btns">
          <button class="td-diff active" data-diff="easy">Leicht</button>
          <button class="td-diff" data-diff="normal">Normal</button>
          <button class="td-diff" data-diff="hard">Schwer</button>
        </div>
      </div>
      <button class="btn-cta td-start" id="td-start">⚔️ Spiel starten</button>
      <button class="btn-secondary" id="td-back">← Zurück</button>
    </div>`;

  let difficulty = "easy";
  root.querySelectorAll(".td-diff").forEach(b => {
    b.addEventListener("click", () => {
      root.querySelectorAll(".td-diff").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      difficulty = b.dataset.diff;
    });
  });
  root.querySelector("#td-back").addEventListener("click", () => navigate("games"));
  root.querySelector("#td-start").addEventListener("click", () => {
    const qi = parseInt(root.querySelector("#td-quiz").value);
    startGame(root, quizzes[qi], difficulty);
  });

  return () => { if (_activeState) { _activeState.gameOver = true; _activeState = null; } };
}

async function startGame(root, quiz, difficulty) {
  const questions = shuffle(buildPlayable(quiz.questions));
  if (!questions.length) {
    root.innerHTML = `<div class="screen-empty">
      <p>Dieses Quiz hat keine für Spiele geeigneten Fragen.</p>
      <p style="font-size:0.85rem">Geeignet sind Single/Multiple Choice, Freitext, Lückentext und Formel-Fragen.</p>
      <button class="btn-cta" id="td-noq-back">← Zurück</button></div>`;
    root.querySelector("#td-noq-back").addEventListener("click", () => navigate("tower-defense"));
    return;
  }

  const diffSettings = {
    easy:   { speed: 0.28, spawnRate: 6500, hpBase: 5, hpScale: 1.3, baseHP: 20, towerDmg: 0.5, towerRate: 900, goalWaves: 12 },
    normal: { speed: 0.42, spawnRate: 5000, hpBase: 6, hpScale: 1.7, baseHP: 15, towerDmg: 0.5, towerRate: 1000, goalWaves: 16 },
    hard:   { speed: 0.58, spawnRate: 3800, hpBase: 8, hpScale: 2.2, baseHP: 10, towerDmg: 0.4, towerRate: 1100, goalWaves: 20 },
  };
  const cfg = diffSettings[difficulty];

  const state = {
    enemies: [], towers: [], projectiles: [], particles: [], floaters: [],
    baseHP: cfg.baseHP, maxHP: cfg.baseHP,
    score: 0, coins: 0, wave: 0, kills: 0, qIndex: 0,
    gameOver: false, won: false, paused: false, currentQ: null, answering: false,
    lastSpawn: performance.now() - cfg.spawnRate, spawnRate: cfg.spawnRate, cfg, questions, comboCount: 0,
    goalWaves: cfg.goalWaves, log: [], towerPalette: ["#1cb487", "#06b6d4"],
  };

  try {
    const profile = await loadProfile();
    const skin = getGameSkin("tower-defense", profile.gameSkins);
    if (skin) state.towerPalette = skin.palette;
  } catch (_) {}
  _activeState = state;

  root.innerHTML = `
    <div class="td-game">
      <div class="td-hud">
        <div class="td-hud-item"><span>❤️</span> <span id="td-hp">${state.baseHP}</span></div>
        <div class="td-hud-item">🪙 <span id="td-coins">0</span></div>
        <div class="td-hud-item">💀 <span id="td-kills">0</span></div>
        <div class="td-hud-item">🌊 <span id="td-wave">0</span>/${state.goalWaves}</div>
        <div class="td-hud-item td-score">⭐ <span id="td-score">0</span></div>
      </div>
      <div class="td-canvas-wrap">
        <canvas id="td-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
        <div class="td-combo" id="td-combo" style="display:none">🔥 Combo x<span id="td-combo-n">0</span></div>
      </div>
      <div class="td-question-area" id="td-qa" style="display:none">
        <div class="td-q-head">
          <span class="td-q-diff" id="td-qdiff"></span>
          <span class="td-q-reward" id="td-qreward"></span>
        </div>
        <div class="td-q-text" id="td-qtext"></div>
        <div class="td-options" id="td-opts"></div>
      </div>
    </div>`;

  const canvas = root.querySelector("#td-canvas");
  const ctx = canvas.getContext("2d");
  const qa = root.querySelector("#td-qa");
  const qtext = root.querySelector("#td-qtext");
  const opts = root.querySelector("#td-opts");
  const comboEl = root.querySelector("#td-combo");

  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = CANVAS_W + "px";
  canvas.style.height = CANVAS_H + "px";
  ctx.scale(dpr, dpr);

  placeTowers(state);

  let animId, lastTime = 0;

  function gameLoop(ts) {
    if (state.gameOver || !root.isConnected) return;
    const dt = Math.min(ts - lastTime, 50);
    lastTime = ts;
    if (!state.paused) {
      update(state, dt, ts, cfg);
      updateHUD(state, root);
    }
    draw(ctx, state);
    if (state.baseHP <= 0 && !state.gameOver) { endGame(state, root, false); return; }
    // Win: survived all waves and the field is clear
    if (!state.gameOver && state.wave >= state.goalWaves && !state.enemies.some(e => e.hp > 0)) {
      endGame(state, root, true); return;
    }
    animId = requestAnimationFrame(mainLoop);
  }

  function spawnEnemy(ts) {
    if (state.gameOver || state.paused) return;
    if (state.wave >= state.goalWaves) return; // reached the goal: no more waves
    if (ts - state.lastSpawn > state.spawnRate) {
      state.lastSpawn = ts;
      state.wave++;
      const hp = Math.round(cfg.hpBase + state.wave * cfg.hpScale);
      state.enemies.push({
        progress: 0, hp, maxHp: hp,
        speed: cfg.speed + Math.random() * 0.08,
        x: PATH[0].col * TILE + TILE / 2,
        y: PATH[0].row * TILE + TILE / 2,
        hit: 0, wobble: Math.random() * Math.PI * 2,
      });
      if (!state.answering) showQuestion(state, root);
    }
  }

  function mainLoop(ts) {
    spawnEnemy(ts);
    gameLoop(ts);
  }

  lastTime = performance.now();
  animId = requestAnimationFrame(mainLoop);

  // Tap empty tile to build a tower (costs 15 coins)
  canvas.addEventListener("click", (e) => {
    if (state.gameOver) return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / TILE);
    const row = Math.floor((e.clientY - rect.top) / TILE);
    if (PATH.some(p => p.col === col && p.row === row)) return;
    if (state.towers.some(t => t.col === col && t.row === row)) return;
    if (state.coins >= 15) {
      state.coins -= 15;
      addTower(state, col, row, state.towerPalette[1]);
      addFloater(state, col * TILE + TILE / 2, row * TILE + TILE / 2, "-15 🪙", "#f59e0b");
    } else {
      addFloater(state, col * TILE + TILE / 2, row * TILE + TILE / 2, "15 🪙 nötig", "#ef4444");
    }
  });

  // Return cleanup so the router can stop the game loop on navigation
  return () => { state.gameOver = true; cancelAnimationFrame(animId); };
}

function showQuestion(state, root) {
  const qa = root.querySelector("#td-qa");
  const qtext = root.querySelector("#td-qtext");
  const opts = root.querySelector("#td-opts");
  if (state.qIndex >= state.questions.length) { state.qIndex = 0; shuffle(state.questions); }
  const q = state.questions[state.qIndex++];
  state.currentQ = q;
  state.answering = true;

  const diff = q.diff || 1;
  root.querySelector("#td-qdiff").textContent = DIFF_LABEL[diff];
  root.querySelector("#td-qdiff").style.background = DIFF_COLOR[diff];
  root.querySelector("#td-qreward").textContent = `💥 ${3 * diff} Schaden · 🪙 ${2 * diff}`;

  qtext.innerHTML = "";
  if (q.image) {
    const img = document.createElement("img");
    img.src = q.image;
    img.className = "td-q-img";
    qtext.appendChild(img);
  }
  const txt = document.createElement("div");
  txt.innerHTML = mathEsc(q.prompt);
  qtext.appendChild(txt);
  opts.innerHTML = "";

  const answer = (ok, userAnswer, feedback) => handleAnswer(state, ok, diff, root, userAnswer, feedback);

  if (q.kind === "choice") {
    shuffle([...q.options]).forEach((o) => {
      const btn = document.createElement("button");
      btn.className = "td-opt";
      btn.innerHTML = mathEsc(o.text);
      btn.addEventListener("click", () => answer(!!o.correct, o.text));
      opts.appendChild(btn);
    });
  } else if (q.kind === "multi") {
    const shuffled = shuffle([...q.options]);
    const selected = new Set();
    const hint = document.createElement("div");
    hint.className = "td-multi-hint";
    hint.textContent = "Mehrere richtig — alle auswählen, dann bestätigen";
    opts.appendChild(hint);
    shuffled.forEach((o, i) => {
      const btn = document.createElement("button");
      btn.className = "td-opt td-opt-multi";
      btn.innerHTML = mathEsc(o.text);
      btn.addEventListener("click", () => {
        if (selected.has(i)) { selected.delete(i); btn.classList.remove("selected"); }
        else { selected.add(i); btn.classList.add("selected"); }
      });
      opts.appendChild(btn);
    });
    const confirm = document.createElement("button");
    confirm.className = "td-opt td-submit td-multi-confirm";
    confirm.textContent = "✓ Bestätigen";
    confirm.addEventListener("click", () => {
      const chosen = shuffled.filter((_, i) => selected.has(i));
      answer(checkMulti(q.options, chosen.map(o => q.options.indexOf(o))), chosen.map(o => o.text).join(", "));
    });
    opts.appendChild(confirm);
  } else if (q.kind === "multi_text") {
    addMultiTextInput(opts, q.blanks, (values) => {
      const ok = checkMultiText(q.blanks, values);
      answer(ok, values.join(", "));
    });
  } else {
    addTextInput(opts, async (val) => {
      const localOk = checkText(q.accept, val);
      if (localOk) { answer(true, val); return; }
      const result = await checkTextSmart(q.prompt, q.accept, val);
      answer(result.correct, val, result.feedback);
    });
  }
  qa.style.display = "block";
}

function addTextInput(opts, onSubmit) {
  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "td-input";
  inp.placeholder = "Antwort eingeben…";
  const btn = document.createElement("button");
  btn.className = "td-opt td-submit";
  btn.textContent = "✓";
  btn.addEventListener("click", () => onSubmit(inp.value));
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") onSubmit(inp.value); });
  opts.appendChild(inp);
  opts.appendChild(btn);
  setTimeout(() => inp.focus(), 50);
}

function addMultiTextInput(opts, blanks, onSubmit) {
  const inputs = [];
  blanks.forEach((_, i) => {
    const row = document.createElement("div");
    row.className = "td-blank-row";
    const label = document.createElement("span");
    label.className = "td-blank-label";
    label.textContent = `Lücke ${i + 1}:`;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "td-input";
    inp.placeholder = `Lücke ${i + 1}…`;
    inputs.push(inp);
    row.appendChild(label);
    row.appendChild(inp);
    opts.appendChild(row);
  });
  const btn = document.createElement("button");
  btn.className = "td-opt td-submit";
  btn.textContent = "✓ Bestätigen";
  btn.addEventListener("click", () => onSubmit(inputs.map(i => i.value)));
  inputs[inputs.length - 1]?.addEventListener("keydown", (e) => { if (e.key === "Enter") onSubmit(inputs.map(i => i.value)); });
  opts.appendChild(btn);
  setTimeout(() => inputs[0]?.focus(), 50);
}

function handleAnswer(state, correct, diff, root, userAnswer = "", aiFeedback = null) {
  state.answering = false;
  if (state.currentQ) state.log.push({ q: state.currentQ, correct, userAnswer, aiFeedback });
  root.querySelector("#td-qa").style.display = "none";
  const comboEl = root.querySelector("#td-combo");

  if (correct) {
    state.comboCount++;
    const comboMult = 1 + Math.min(state.comboCount - 1, 4) * 0.25; // up to x2
    const dmg = 3 * diff * comboMult;
    const earnedCoins = Math.round(2 * diff * comboMult);
    state.coins += earnedCoins;
    state.score += Math.round(10 * diff * comboMult);

    if (state.comboCount >= 2) {
      comboEl.style.display = "block";
      root.querySelector("#td-combo-n").textContent = state.comboCount;
      comboEl.classList.add("td-combo-pop");
      setTimeout(() => comboEl.classList.remove("td-combo-pop"), 300);
    }

    // Cannon shot at the lead enemy (furthest along path)
    const lead = state.enemies.filter(e => e.hp > 0).sort((a, b) => b.progress - a.progress)[0];
    if (lead) {
      lead.hp -= dmg;
      lead.hit = 8;
      addFloater(state, lead.x, lead.y - 18, `-${Math.round(dmg)}`, "#22d3ee");
      burst(state, lead.x, lead.y, "#22d3ee", 8);
    }
  } else {
    state.comboCount = 0;
    comboEl.style.display = "none";
    state.baseHP -= 1;
    const lastP = PATH[PATH.length - 1];
    burst(state, lastP.col * TILE + TILE / 2, lastP.row * TILE + TILE / 2, "#ef4444", 6);
  }

  if (state.baseHP <= 0) return;
  setTimeout(() => {
    if (!state.gameOver && !state.answering && state.enemies.some(e => e.hp > 0)) {
      showQuestion(state, root);
    }
  }, 900);
}

async function endGame(state, root, won) {
  state.gameOver = true;
  state.won = won;
  // Win bonus rewards holding the line to the end
  const winBonus = won ? 25 : 0;
  const earned = Math.floor(state.score / 10) + winBonus;
  await addCoins(earned, "tower-defense");
  await saveGameScore("tower-defense", { points: state.score, coins: earned, won });

  const wrap = root.querySelector(".td-game");
  if (!wrap) return;
  const over = document.createElement("div");
  over.className = "td-gameover td-gameover-scroll";
  over.innerHTML = `
    <h2>${won ? "🏆 Gewonnen!" : "💀 Basis gefallen"}</h2>
    <p class="td-go-sub">${won
      ? `Du hast alle ${state.goalWaves} Wellen überstanden!`
      : `Du hast Welle ${state.wave} von ${state.goalWaves} erreicht.`}</p>
    <div class="td-go-stats">
      <div>⭐ Score: <strong>${state.score}</strong></div>
      <div>💀 Kills: <strong>${state.kills}</strong></div>
      <div>🌊 Welle: <strong>${state.wave}/${state.goalWaves}</strong></div>
      <div>🪙 Verdient: <strong>${earned}</strong>${winBonus ? ` (+${winBonus} Bonus)` : ""}</div>
    </div>
    ${buildFeedbackHtml(state.log)}
    <div class="td-go-actions">
      <button class="btn-cta" id="td-retry">🔄 Nochmal</button>
      <button class="btn-secondary" id="td-home">← Zurück</button>
    </div>`;
  wrap.appendChild(over);
  over.querySelector("#td-retry").addEventListener("click", () => navigate("tower-defense"));
  over.querySelector("#td-home").addEventListener("click", () => navigate("games"));
  attachFeedbackListeners(over, state.log);
}

function update(state, dt, ts, cfg) {
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    e.progress += e.speed * (dt / 1000) * 2;
    e.wobble += dt / 200;
    const idx = Math.floor(e.progress);
    if (idx >= PATH.length - 1) {
      // Leak damage scales with the balloon's toughness (bigger = more dangerous)
      const leak = 1 + Math.floor(e.maxHp / 12);
      e.hp = 0; e.reached = true;
      state.baseHP -= leak;
      const lastP = PATH[PATH.length - 1];
      addFloater(state, lastP.col * TILE + TILE / 2, lastP.row * TILE + TILE / 2 - 16, `-${leak} ❤️`, "#ef4444");
      burst(state, lastP.col * TILE + TILE / 2, lastP.row * TILE + TILE / 2, "#ef4444", 8);
      continue;
    }
    const frac = e.progress - idx;
    const a = PATH[idx], b = PATH[Math.min(idx + 1, PATH.length - 1)];
    e.x = lerp(a.col * TILE + TILE / 2, b.col * TILE + TILE / 2, frac);
    e.y = lerp(a.row * TILE + TILE / 2, b.row * TILE + TILE / 2, frac);
    if (e.hit > 0) e.hit--;
  }

  state.enemies = state.enemies.filter(e => {
    if (e.hp <= 0) {
      if (!e.reached) {
        state.kills++;
        state.score += 5;
        state.coins += 1;
        burst(state, e.x, e.y, "#f59e0b", 6);
      }
      return false;
    }
    return true;
  });

  for (const t of state.towers) {
    t.cooldown = Math.max(0, t.cooldown - dt);
    if (t.cooldown > 0) continue;
    const target = state.enemies
      .filter(e => e.hp > 0 && Math.hypot(e.x - t.x, e.y - t.y) <= t.range)
      .sort((a, b) => b.progress - a.progress)[0];
    if (target) {
      t.cooldown = t.fireRate;
      const ang = Math.atan2(target.y - t.y, target.x - t.x);
      state.projectiles.push({ x: t.x, y: t.y, target, dmg: t.dmg, angle: ang });
    }
  }

  state.projectiles = state.projectiles.filter(p => {
    if (!p.target || p.target.hp <= 0) return false;
    p.angle = Math.atan2(p.target.y - p.y, p.target.x - p.x);
    p.x = lerp(p.x, p.target.x, 0.25);
    p.y = lerp(p.y, p.target.y, 0.25);
    if (Math.hypot(p.x - p.target.x, p.y - p.target.y) < 8) {
      p.target.hp -= p.dmg;
      p.target.hit = 6;
      burst(state, p.x, p.y, "#fde047", 4);
      return false;
    }
    return true;
  });

  state.particles = state.particles.filter(p => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life--; p.size *= 0.95;
    return p.life > 0;
  });
  state.floaters = state.floaters.filter(f => { f.y -= 0.6; f.life--; return f.life > 0; });
}

function draw(ctx, state) {
  const isDark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const now = performance.now();

  drawArena(ctx, isDark, now);

  // Path as a worn battle road across the arena floor
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const pts = PATH.map(p => ({ x: p.col * TILE + TILE / 2, y: p.row * TILE + TILE / 2 }));
  // dark outline / trench
  ctx.strokeStyle = isDark ? "#1a120b" : "#7a5a34";
  ctx.lineWidth = TILE * 0.82;
  strokePath(ctx, pts);
  // sandy road
  ctx.strokeStyle = isDark ? "#4a3a26" : "#d9b888";
  ctx.lineWidth = TILE * 0.62;
  strokePath(ctx, pts);
  // lighter center scuff
  ctx.strokeStyle = isDark ? "#5c4830" : "#e8cfa3";
  ctx.lineWidth = TILE * 0.3;
  ctx.globalAlpha = 0.6;
  strokePath(ctx, pts);
  ctx.globalAlpha = 1;

  // Base (fortress) at the end of the road
  const lastP = pts[pts.length - 1];
  drawBase(ctx, lastP.x, lastP.y, state, now);

  // Towers (cannon turrets)
  for (const t of state.towers) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? "rgba(34,211,238,0.05)" : "rgba(28,180,135,0.06)";
    ctx.fill();
    // ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(t.x, t.y + 13, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
    // stone platform
    ctx.fillStyle = isDark ? "#3a4452" : "#9aa6b4";
    ctx.beginPath(); ctx.arc(t.x, t.y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = isDark ? "#2a323d" : "#7e8b9a";
    ctx.beginPath(); ctx.arc(t.x, t.y, 14, 0.2 * Math.PI, 0.8 * Math.PI); ctx.lineTo(t.x, t.y); ctx.fill();
    // turret body
    ctx.fillStyle = t.color;
    ctx.beginPath(); ctx.arc(t.x, t.y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath(); ctx.arc(t.x - 2.5, t.y - 2.5, 3, 0, Math.PI * 2); ctx.fill();
    // barrel aimed at nearest enemy in range
    const tgt = state.enemies
      .filter(e => e.hp > 0 && Math.hypot(e.x - t.x, e.y - t.y) <= t.range)
      .sort((a, b) => b.progress - a.progress)[0];
    const ang = tgt ? Math.atan2(tgt.y - t.y, tgt.x - t.x) : (t.aim || -Math.PI / 2);
    t.aim = ang;
    ctx.strokeStyle = isDark ? "#1f2730" : "#4b5563";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(t.x + Math.cos(ang) * 16, t.y + Math.sin(ang) * 16);
    ctx.stroke();
  }

  // Enemies as bloons
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const frac = e.hp / e.maxHp;
    const tier = Math.min(BLOON_TIERS.length - 1, Math.floor((1 - frac) * BLOON_TIERS.length));
    const baseColor = e.hit > 0 ? "#ffffff" : BLOON_TIERS[tier];
    const r = 12 + (e.maxHp > 20 ? 3 : 0);
    const wob = Math.sin(e.wobble) * 1.5;

    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.ellipse(e.x, e.y + r + 3, r * 0.7, 3, 0, 0, Math.PI * 2); ctx.fill();

    // balloon body
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.ellipse(e.x + wob, e.y, r * 0.85, r, 0, 0, Math.PI * 2);
    ctx.fill();
    // highlight
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath(); ctx.ellipse(e.x + wob - r * 0.3, e.y - r * 0.3, r * 0.22, r * 0.32, -0.5, 0, Math.PI * 2); ctx.fill();
    // knot
    ctx.fillStyle = baseColor;
    ctx.beginPath(); ctx.moveTo(e.x + wob - 3, e.y + r); ctx.lineTo(e.x + wob + 3, e.y + r); ctx.lineTo(e.x + wob, e.y + r + 4); ctx.fill();

    // HP bar
    const barW = 22;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(e.x - barW / 2, e.y - r - 8, barW, 4);
    ctx.fillStyle = frac > 0.5 ? "#22c55e" : frac > 0.25 ? "#f59e0b" : "#ef4444";
    ctx.fillRect(e.x - barW / 2, e.y - r - 8, barW * frac, 4);
  }

  // Projectiles (arrows)
  for (const p of state.projectiles) {
    const a = p.angle || 0;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(a);
    // shaft
    ctx.strokeStyle = "#92400e";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(6, 0); ctx.stroke();
    // arrowhead
    ctx.fillStyle = "#fde047";
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(4, -4);
    ctx.lineTo(4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#a16207"; ctx.lineWidth = 1;
    ctx.stroke();
    // fletching
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-7, -3);
    ctx.lineTo(-6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-7, 3);
    ctx.lineTo(-6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Particles
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life / 30);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Floating text
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const f of state.floaters) {
    ctx.globalAlpha = Math.max(0, f.life / 40);
    ctx.fillStyle = f.color;
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  // Base HP bar
  const hpPct = Math.max(0, state.baseHP / state.maxHP);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, CANVAS_H - 6, CANVAS_W, 6);
  ctx.fillStyle = hpPct > 0.5 ? "#22c55e" : hpPct > 0.25 ? "#f59e0b" : "#ef4444";
  ctx.fillRect(0, CANVAS_H - 6, CANVAS_W * hpPct, 6);
}

// --- Arena: stone floor inside a walled coliseum with corner torches ---
function drawArena(ctx, isDark, now) {
  // Outer arena wall (stone ring)
  const wall = isDark ? "#2b2620" : "#6b5d4f";
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // brick courses on the wall border
  ctx.strokeStyle = isDark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  for (let y = 0; y < CANVAS_H; y += 14) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    const off = (Math.floor(y / 14) % 2) * 14;
    for (let x = off; x < CANVAS_W; x += 28) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 14); ctx.stroke();
    }
  }

  // Spectator crowd packed into the thin wall border (frames the whole pit)
  const crowdCols = ["#e2725b", "#5b8def", "#46b46e", "#e0b341", "#b06fd4", "#d96fa3", "#dcdcdc"];
  const pad = 12;
  let ci = 0;
  const dot = (x, y) => {
    const bob = Math.sin(now / 260 + ci) * 0.8;
    ctx.fillStyle = crowdCols[ci++ % crowdCols.length];
    ctx.beginPath(); ctx.arc(x, y + bob, 2.3, 0, Math.PI * 2); ctx.fill();
  };
  for (let x = 5; x < CANVAS_W - 3; x += 9) { dot(x, 5); dot(x + 4, 10); }       // top
  for (let x = 5; x < CANVAS_W - 3; x += 9) { dot(x, CANVAS_H - 10); dot(x + 4, CANVAS_H - 5); } // bottom
  for (let y = 16; y < CANVAS_H - 14; y += 9) { dot(5, y); dot(CANVAS_W - 5, y); }  // sides

  // Inner arena floor (inset sand pit)
  const floor1 = isDark ? "#3a3024" : "#cdb288";
  const floor2 = isDark ? "#332b20" : "#c2a679";
  roundRectFill(ctx, pad, pad, CANVAS_W - pad * 2, CANVAS_H - pad * 2, 14, floor1);
  // sand grid texture
  ctx.save();
  roundRectPath(ctx, pad, pad, CANVAS_W - pad * 2, CANVAS_H - pad * 2, 14);
  ctx.clip();
  ctx.fillStyle = floor2;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if ((r + c) % 2 === 0) ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
  // faint concentric arena rings
  ctx.strokeStyle = isDark ? "rgba(0,0,0,0.12)" : "rgba(120,90,50,0.14)";
  ctx.lineWidth = 2;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(CANVAS_W / 2, CANVAS_H / 2, 50 * i, 70 * i, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Inner wall shadow (depth)
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 3;
  roundRectPath(ctx, pad, pad, CANVAS_W - pad * 2, CANVAS_H - pad * 2, 14);
  ctx.stroke();

  // Corner torches with flickering flames
  const flick = 0.7 + Math.sin(now / 90) * 0.15 + Math.random() * 0.1;
  const corners = [[pad + 4, pad + 4], [CANVAS_W - pad - 4, pad + 4],
                   [pad + 4, CANVAS_H - pad - 4], [CANVAS_W - pad - 4, CANVAS_H - pad - 4]];
  for (const [cx, cy] of corners) {
    // glow
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26 * flick);
    g.addColorStop(0, "rgba(255,170,60,0.55)");
    g.addColorStop(1, "rgba(255,170,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, 26 * flick, 0, Math.PI * 2); ctx.fill();
    // sconce
    ctx.fillStyle = isDark ? "#1c1813" : "#3a3026";
    ctx.beginPath(); ctx.arc(cx, cy + 2, 4, 0, Math.PI * 2); ctx.fill();
    // flame
    ctx.fillStyle = "#fb923c";
    ctx.beginPath(); ctx.ellipse(cx, cy - 3, 3.2, 6 * flick, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fde047";
    ctx.beginPath(); ctx.ellipse(cx, cy - 2, 1.6, 3.5 * flick, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBase(ctx, x, y, state, now) {
  const hpPct = Math.max(0, state.baseHP / state.maxHP);
  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(x, y + 15, 20, 6, 0, 0, Math.PI * 2); ctx.fill();
  // keep walls
  const wallC = hpPct > 0.5 ? "#94a3b8" : hpPct > 0.25 ? "#cbb38a" : "#d98a8a";
  roundRectFill(ctx, x - 17, y - 13, 34, 28, 4, wallC);
  // battlements
  ctx.fillStyle = "#64748b";
  for (let i = 0; i < 4; i++) ctx.fillRect(x - 17 + i * 9, y - 18, 5, 6);
  // gate
  ctx.fillStyle = "#475569";
  roundRectFill(ctx, x - 6, y - 2, 12, 17, 4, "#475569");
  // banner (waves with hp)
  const sway = Math.sin(now / 300) * 2;
  ctx.fillStyle = hpPct > 0.25 ? "#0d9488" : "#ef4444";
  ctx.beginPath();
  ctx.moveTo(x, y - 18); ctx.lineTo(x + 10 + sway, y - 22); ctx.lineTo(x + 10 + sway, y - 14);
  ctx.lineTo(x, y - 12); ctx.fill();
  ctx.strokeStyle = "#334155"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, y - 24); ctx.lineTo(x, y - 8); ctx.stroke();
}


function burst(state, x, y, color, n) {
  for (let i = 0; i < n; i++) {
    state.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 - 1,
      life: 25, color, size: 3 + Math.random() * 2,
    });
  }
}

function updateHUD(state, root) {
  const set = (id, v) => { const el = root.querySelector(id); if (el) el.textContent = v; };
  set("#td-hp", Math.max(0, state.baseHP));
  set("#td-coins", state.coins);
  set("#td-kills", state.kills);
  set("#td-wave", Math.min(state.wave, state.goalWaves));
  set("#td-score", state.score);
}

function addTower(state, col, row, color) {
  state.towers.push({
    col, row,
    x: col * TILE + TILE / 2, y: row * TILE + TILE / 2,
    range: TILE * 2.5, cooldown: 0, fireRate: state.cfg.towerRate,
    dmg: state.cfg.towerDmg, color,
  });
}

function placeTowers(state) {
  [{ col: 2, row: 1 }, { col: 6, row: 3 }, { col: 2, row: 5 }]
    .filter(p => !PATH.some(pp => pp.col === p.col && pp.row === p.row))
    .forEach(p => addTower(state, p.col, p.row, state.towerPalette[0]));
}
