import { loadQuizzes, addCoins, saveGameScore } from "../store.js";
import { navigate } from "../router.js";
import { esc } from "../utils.js";

const CANVAS_W = 360, CANVAS_H = 560;
const TILE = 40;
const COLS = Math.floor(CANVAS_W / TILE);
const ROWS = Math.floor(CANVAS_H / TILE);

// Path the enemies walk (zigzag down the field)
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

function lerp(a, b, t) { return a + (b - a) * t; }

export async function render(root) {
  const quizzes = await loadQuizzes();
  if (!quizzes.length) {
    root.innerHTML = `<div class="screen-empty"><p>Erstelle zuerst ein Quiz!</p>
      <button class="btn-cta" onclick="location.hash='home'">Zurück</button></div>`;
    return;
  }

  // Quiz selection
  root.innerHTML = `
    <div class="td-setup">
      <h2>🏰 Tower Defense</h2>
      <p>Verteidige deine Basis! Richtige Antworten feuern Türme ab.</p>
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
  root.querySelector("#td-back").addEventListener("click", () => navigate("home"));
  root.querySelector("#td-start").addEventListener("click", () => {
    const qi = parseInt(root.querySelector("#td-quiz").value);
    startGame(root, quizzes[qi], difficulty);
  });
}

function startGame(root, quiz, difficulty) {
  const questions = shuffle([...(quiz.questions || [])]);
  if (!questions.length) return;

  const diffSettings = {
    easy:   { speed: 0.3, spawnRate: 6000, hp: 1, baseHP: 20, coinsPerKill: 3, towerDmg: 1 },
    normal: { speed: 0.5, spawnRate: 4500, hp: 2, baseHP: 15, coinsPerKill: 5, towerDmg: 1 },
    hard:   { speed: 0.7, spawnRate: 3000, hp: 3, baseHP: 10, coinsPerKill: 8, towerDmg: 1 },
  };
  const cfg = diffSettings[difficulty];

  const state = {
    enemies: [],
    towers: [],
    projectiles: [],
    particles: [],
    baseHP: cfg.baseHP,
    maxHP: cfg.baseHP,
    score: 0,
    coins: 0,
    wave: 0,
    kills: 0,
    qIndex: 0,
    gameOver: false,
    paused: false,
    currentQ: null,
    answering: false,
    lastSpawn: 0,
    spawnRate: cfg.spawnRate,
    cfg,
    questions,
    comboCount: 0,
  };

  root.innerHTML = `
    <div class="td-game">
      <div class="td-hud">
        <div class="td-hud-item"><span class="td-hp-icon">❤️</span> <span id="td-hp">${state.baseHP}</span>/<span id="td-maxhp">${state.maxHP}</span></div>
        <div class="td-hud-item">🪙 <span id="td-coins">0</span></div>
        <div class="td-hud-item">💀 <span id="td-kills">0</span></div>
        <div class="td-hud-item td-score">⭐ <span id="td-score">0</span></div>
      </div>
      <canvas id="td-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
      <div class="td-question-area" id="td-qa" style="display:none">
        <div class="td-q-text" id="td-qtext"></div>
        <div class="td-options" id="td-opts"></div>
      </div>
      <div class="td-combo" id="td-combo" style="display:none">🔥 Combo x<span id="td-combo-n">0</span></div>
    </div>`;

  const canvas = root.querySelector("#td-canvas");
  const ctx = canvas.getContext("2d");
  const qa = root.querySelector("#td-qa");
  const qtext = root.querySelector("#td-qtext");
  const opts = root.querySelector("#td-opts");
  const comboEl = root.querySelector("#td-combo");

  // Adjust canvas for device pixel ratio
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = CANVAS_W + "px";
  canvas.style.height = CANVAS_H + "px";
  ctx.scale(dpr, dpr);

  // Place initial towers along the path
  placeTowers(state);

  let animId;
  let lastTime = 0;

  function gameLoop(ts) {
    if (state.gameOver) return;
    const dt = Math.min(ts - lastTime, 50);
    lastTime = ts;

    if (!state.paused) {
      update(state, dt, ts, cfg);
      updateHUD(state, root);
    }
    draw(ctx, state);
    animId = requestAnimationFrame(gameLoop);
  }

  // Spawn enemies on interval
  function spawnEnemy(ts) {
    if (state.gameOver || state.paused) return;
    if (ts - state.lastSpawn > state.spawnRate) {
      state.lastSpawn = ts;
      state.wave++;
      const hp = cfg.hp + Math.floor(state.wave / 5);
      state.enemies.push({
        pathIdx: 0, progress: 0, hp, maxHp: hp,
        speed: cfg.speed + Math.random() * 0.1,
        x: PATH[0].col * TILE + TILE / 2,
        y: PATH[0].row * TILE + TILE / 2,
        color: `hsl(${Math.random() * 360}, 70%, 55%)`,
        hit: 0,
      });

      // Show question when enemy appears
      if (!state.answering) {
        showQuestion(state, qtext, opts, qa, comboEl, root, cfg);
      }
    }
  }

  function mainLoop(ts) {
    spawnEnemy(ts);
    gameLoop(ts);
  }

  lastTime = performance.now();
  animId = requestAnimationFrame(mainLoop);

  // Touch/click on canvas to place tower
  canvas.addEventListener("click", (e) => {
    if (state.gameOver) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    // Don't place on path
    if (PATH.some(p => p.col === col && p.row === row)) return;
    if (state.towers.some(t => t.col === col && t.row === row)) return;
    if (state.coins >= 10) {
      state.coins -= 10;
      state.towers.push({
        col, row,
        x: col * TILE + TILE / 2,
        y: row * TILE + TILE / 2,
        range: TILE * 2.5,
        cooldown: 0,
        fireRate: 800,
        dmg: cfg.towerDmg,
        color: "#22d3ee",
        level: 1,
      });
    }
  });
}

function showQuestion(state, qtext, opts, qa, comboEl, root, cfg) {
  if (state.qIndex >= state.questions.length) {
    state.qIndex = 0;
    shuffle(state.questions);
  }
  const q = state.questions[state.qIndex++];
  state.currentQ = q;
  state.answering = true;
  state.paused = false;

  qtext.textContent = q.text || q.title || "Frage";
  opts.innerHTML = "";

  if (q.question_type === "single_choice" || q.question_type === "multiple_choice") {
    const options = q.options || [];
    options.forEach((o, i) => {
      const btn = document.createElement("button");
      btn.className = "td-opt";
      btn.textContent = o.text;
      btn.addEventListener("click", () => handleAnswer(state, o.is_correct, qa, comboEl, root, cfg));
      opts.appendChild(btn);
    });
  } else if (q.question_type === "free_text") {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "td-input";
    inp.placeholder = "Antwort eingeben...";
    const btn = document.createElement("button");
    btn.className = "td-opt td-submit";
    btn.textContent = "✓";
    btn.addEventListener("click", () => {
      const ans = inp.value.trim().toLowerCase();
      const correct = (q.correct_text || "").trim().toLowerCase();
      const ok = ans === correct || (ans.length > 2 && correct.includes(ans));
      handleAnswer(state, ok, qa, comboEl, root, cfg);
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
    opts.appendChild(inp);
    opts.appendChild(btn);
    inp.focus();
  } else if (q.question_type === "fill_blank") {
    const blanks = q.blanks || [];
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "td-input";
    inp.placeholder = "Lücke ausfüllen...";
    const btn = document.createElement("button");
    btn.className = "td-opt td-submit";
    btn.textContent = "✓";
    btn.addEventListener("click", () => {
      const ans = inp.value.trim().toLowerCase();
      const ok = blanks.some(b => b.trim().toLowerCase() === ans);
      handleAnswer(state, ok, qa, comboEl, root, cfg);
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
    opts.appendChild(inp);
    opts.appendChild(btn);
    inp.focus();
  } else {
    // Fallback: show as true/false
    const btn1 = document.createElement("button");
    btn1.className = "td-opt";
    btn1.textContent = "Weiter →";
    btn1.addEventListener("click", () => handleAnswer(state, true, qa, comboEl, root, cfg));
    opts.appendChild(btn1);
  }

  qa.style.display = "block";
}

function handleAnswer(state, correct, qa, comboEl, root, cfg) {
  state.answering = false;
  qa.style.display = "none";

  if (correct) {
    state.comboCount++;
    const multiplier = Math.min(state.comboCount, 5);
    const earned = cfg.coinsPerKill * multiplier;
    state.coins += earned;
    state.score += 10 * multiplier;

    // Combo display
    if (state.comboCount >= 2) {
      comboEl.style.display = "block";
      root.querySelector("#td-combo-n").textContent = state.comboCount;
      comboEl.classList.add("td-combo-pop");
      setTimeout(() => comboEl.classList.remove("td-combo-pop"), 300);
      setTimeout(() => { if (state.comboCount === parseInt(root.querySelector("#td-combo-n").textContent)) comboEl.style.display = "none"; }, 2000);
    }

    // Damage all enemies
    state.enemies.forEach(e => {
      e.hp -= 1;
      e.hit = 5;
    });

    // Particles
    for (let i = 0; i < 6; i++) {
      state.particles.push({
        x: CANVAS_W / 2, y: CANVAS_H / 2,
        vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4,
        life: 30, color: "#22d3ee", size: 4,
      });
    }
  } else {
    state.comboCount = 0;
    comboEl.style.display = "none";
    state.baseHP -= 1;

    // Red flash particles
    for (let i = 0; i < 4; i++) {
      state.particles.push({
        x: CANVAS_W / 2, y: CANVAS_H - 20,
        vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 3,
        life: 20, color: "#ef4444", size: 5,
      });
    }
  }

  if (state.baseHP <= 0) {
    endGame(state, root);
    return;
  }

  // Next question after short delay
  setTimeout(() => {
    if (!state.gameOver && !state.answering && state.enemies.length > 0) {
      const qa = root.querySelector("#td-qa");
      const qtext = root.querySelector("#td-qtext");
      const opts = root.querySelector("#td-opts");
      showQuestion(state, qtext, opts, qa, comboEl, root, cfg);
    }
  }, 1500);
}

async function endGame(state, root) {
  state.gameOver = true;
  const earned = Math.floor(state.score / 10);
  await addCoins(earned, "tower-defense");
  await saveGameScore("tower-defense", { points: state.score, coins: earned });

  root.querySelector(".td-game").innerHTML += `
    <div class="td-gameover">
      <h2>💀 Game Over!</h2>
      <div class="td-go-stats">
        <div>⭐ Score: <strong>${state.score}</strong></div>
        <div>💀 Kills: <strong>${state.kills}</strong></div>
        <div>🪙 Verdient: <strong>${earned}</strong> Münzen</div>
        <div>🔥 Beste Combo: <strong>${state.comboCount}</strong>x</div>
      </div>
      <button class="btn-cta" id="td-retry">🔄 Nochmal</button>
      <button class="btn-secondary" id="td-home">← Zurück</button>
    </div>`;

  root.querySelector("#td-retry")?.addEventListener("click", () => navigate("tower-defense"));
  root.querySelector("#td-home")?.addEventListener("click", () => navigate("home"));
}

function update(state, dt, ts, cfg) {
  // Move enemies along path
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    e.progress += e.speed * (dt / 1000) * 2;
    const idx = Math.floor(e.progress);
    if (idx >= PATH.length - 1) {
      e.hp = 0;
      state.baseHP -= 1;
      if (state.baseHP <= 0) return;
      continue;
    }
    const frac = e.progress - idx;
    const a = PATH[idx], b = PATH[Math.min(idx + 1, PATH.length - 1)];
    e.x = lerp(a.col * TILE + TILE / 2, b.col * TILE + TILE / 2, frac);
    e.y = lerp(a.row * TILE + TILE / 2, b.row * TILE + TILE / 2, frac);
    if (e.hit > 0) e.hit--;
  }

  // Remove dead enemies
  const before = state.enemies.length;
  state.enemies = state.enemies.filter(e => {
    if (e.hp <= 0) {
      state.kills++;
      state.score += 5;
      // Death particles
      for (let i = 0; i < 4; i++) {
        state.particles.push({
          x: e.x, y: e.y,
          vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3,
          life: 15, color: e.color, size: 3,
        });
      }
      return false;
    }
    return true;
  });

  // Tower shooting
  for (const t of state.towers) {
    t.cooldown = Math.max(0, t.cooldown - dt);
    if (t.cooldown > 0) continue;
    const target = state.enemies.find(e => {
      const dx = e.x - t.x, dy = e.y - t.y;
      return Math.sqrt(dx * dx + dy * dy) <= t.range && e.hp > 0;
    });
    if (target) {
      t.cooldown = t.fireRate;
      state.projectiles.push({
        x: t.x, y: t.y,
        tx: target.x, ty: target.y,
        speed: 5, dmg: t.dmg,
        target, progress: 0,
      });
    }
  }

  // Move projectiles
  state.projectiles = state.projectiles.filter(p => {
    p.progress += dt / 100;
    p.x = lerp(p.x, p.tx, 0.15);
    p.y = lerp(p.y, p.ty, 0.15);
    const dx = p.x - p.target.x, dy = p.y - p.target.y;
    if (Math.sqrt(dx * dx + dy * dy) < 8) {
      p.target.hp -= p.dmg;
      p.target.hit = 5;
      return false;
    }
    return p.progress < 30;
  });

  // Particles
  state.particles = state.particles.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    p.size *= 0.95;
    return p.life > 0;
  });
}

function draw(ctx, state) {
  const isDark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Background
  ctx.fillStyle = isDark ? "#0b1120" : "#f5fbf6";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Grid
  ctx.strokeStyle = isDark ? "#1a2540" : "#e3ece6";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= CANVAS_W; x += TILE) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
  }
  for (let y = 0; y <= CANVAS_H; y += TILE) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
  }

  // Path
  ctx.fillStyle = isDark ? "#1e293b" : "#e7f7f1";
  for (const p of PATH) {
    ctx.fillRect(p.col * TILE, p.row * TILE, TILE, TILE);
  }

  // Base
  ctx.fillStyle = "#ef4444";
  const lastP = PATH[PATH.length - 1];
  ctx.fillRect(lastP.col * TILE, lastP.row * TILE, TILE, TILE);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🏰", lastP.col * TILE + TILE / 2, lastP.row * TILE + TILE / 2);

  // Towers
  for (const t of state.towers) {
    // Range circle (subtle)
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? "rgba(34,211,238,0.05)" : "rgba(28,180,135,0.05)";
    ctx.fill();

    // Tower body
    ctx.fillStyle = t.color;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("⚡", t.x, t.y);
  }

  // Enemies
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const radius = 12;
    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + radius + 2, radius * 0.8, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = e.hit > 0 ? "#ffffff" : e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // HP bar
    const barW = 20, barH = 3;
    ctx.fillStyle = isDark ? "#243049" : "#ccc";
    ctx.fillRect(e.x - barW / 2, e.y - radius - 6, barW, barH);
    ctx.fillStyle = e.hp / e.maxHp > 0.5 ? "#22c55e" : e.hp / e.maxHp > 0.25 ? "#f59e0b" : "#ef4444";
    ctx.fillRect(e.x - barW / 2, e.y - radius - 6, barW * (e.hp / e.maxHp), barH);

    // Face
    ctx.fillStyle = "#fff";
    ctx.font = "10px sans-serif";
    ctx.fillText("👾", e.x, e.y + 1);
  }

  // Projectiles
  for (const p of state.projectiles) {
    ctx.fillStyle = "#ffd43b";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Particles
  for (const p of state.particles) {
    ctx.globalAlpha = p.life / 30;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // HP bar at bottom
  const hpPct = Math.max(0, state.baseHP / state.maxHP);
  const barY = CANVAS_H - 6;
  ctx.fillStyle = isDark ? "#1e293b" : "#e3ece6";
  ctx.fillRect(0, barY, CANVAS_W, 6);
  ctx.fillStyle = hpPct > 0.5 ? "#22c55e" : hpPct > 0.25 ? "#f59e0b" : "#ef4444";
  ctx.fillRect(0, barY, CANVAS_W * hpPct, 6);
}

function updateHUD(state, root) {
  const hp = root.querySelector("#td-hp");
  const coins = root.querySelector("#td-coins");
  const kills = root.querySelector("#td-kills");
  const score = root.querySelector("#td-score");
  if (hp) hp.textContent = Math.max(0, state.baseHP);
  if (coins) coins.textContent = state.coins;
  if (kills) kills.textContent = state.kills;
  if (score) score.textContent = state.score;
}

function placeTowers(state) {
  // Place 3 starter towers at strategic positions
  const positions = [
    { col: 2, row: 1 }, { col: 6, row: 3 }, { col: 2, row: 5 },
  ].filter(p => !PATH.some(pp => pp.col === p.col && pp.row === p.row));

  for (const pos of positions) {
    state.towers.push({
      col: pos.col, row: pos.row,
      x: pos.col * TILE + TILE / 2,
      y: pos.row * TILE + TILE / 2,
      range: TILE * 2.5,
      cooldown: 0,
      fireRate: 1000,
      dmg: state.cfg.towerDmg,
      color: "#1cb487",
      level: 1,
    });
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
