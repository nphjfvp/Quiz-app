import { loadQuizzes, addCoins, saveGameScore } from "../store.js";
import { navigate } from "../router.js";
import { esc } from "../utils.js";
import { buildPlayable, checkText, checkMulti, shuffle } from "../games-util.js";

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

function lerp(a, b, t) { return a + (b - a) * t; }

const DIFF_LABEL = { 1: "Leicht", 2: "Mittel", 3: "Schwer" };
const DIFF_COLOR = { 1: "#22c55e", 2: "#f59e0b", 3: "#ef4444" };

// Bloons-style balloon colors by remaining HP fraction tier
const BLOON_TIERS = ["#e11d48", "#3b82f6", "#22c55e", "#eab308", "#ec4899", "#1e293b"];

export async function render(root) {
  const quizzes = await loadQuizzes();
  if (!quizzes.length) {
    root.innerHTML = `<div class="screen-empty"><p>Erstelle zuerst ein Quiz!</p>
      <button class="btn-cta" id="td-empty-back">Zurück</button></div>`;
    root.querySelector("#td-empty-back").addEventListener("click", () => navigate("home"));
    return;
  }

  root.innerHTML = `
    <div class="td-setup">
      <h2>🏰 Tower Defense</h2>
      <p>Verteidige deine Basis! Schwere Fragen richten mehr Schaden an.</p>
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
    easy:   { speed: 0.28, spawnRate: 6500, hpBase: 5, hpScale: 1.3, baseHP: 20, towerDmg: 0.5, towerRate: 900 },
    normal: { speed: 0.42, spawnRate: 5000, hpBase: 6, hpScale: 1.7, baseHP: 15, towerDmg: 0.5, towerRate: 1000 },
    hard:   { speed: 0.58, spawnRate: 3800, hpBase: 8, hpScale: 2.2, baseHP: 10, towerDmg: 0.4, towerRate: 1100 },
  };
  const cfg = diffSettings[difficulty];

  const state = {
    enemies: [], towers: [], projectiles: [], particles: [], floaters: [],
    baseHP: cfg.baseHP, maxHP: cfg.baseHP,
    score: 0, coins: 0, wave: 0, kills: 0, qIndex: 0,
    gameOver: false, paused: false, currentQ: null, answering: false,
    lastSpawn: 0, spawnRate: cfg.spawnRate, cfg, questions, comboCount: 0,
  };

  root.innerHTML = `
    <div class="td-game">
      <div class="td-hud">
        <div class="td-hud-item"><span>❤️</span> <span id="td-hp">${state.baseHP}</span></div>
        <div class="td-hud-item">🪙 <span id="td-coins">0</span></div>
        <div class="td-hud-item">💀 <span id="td-kills">0</span></div>
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
    if (state.gameOver) return;
    const dt = Math.min(ts - lastTime, 50);
    lastTime = ts;
    if (!state.paused) {
      update(state, dt, ts, cfg);
      updateHUD(state, root);
    }
    draw(ctx, state);
    if (state.baseHP <= 0 && !state.gameOver) { endGame(state, root); return; }
    animId = requestAnimationFrame(mainLoop);
  }

  function spawnEnemy(ts) {
    if (state.gameOver || state.paused) return;
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
      addTower(state, col, row, "#06b6d4");
      addFloater(state, col * TILE + TILE / 2, row * TILE + TILE / 2, "-15 🪙", "#f59e0b");
    } else {
      addFloater(state, col * TILE + TILE / 2, row * TILE + TILE / 2, "15 🪙 nötig", "#ef4444");
    }
  });
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
  txt.textContent = q.prompt;
  qtext.appendChild(txt);
  opts.innerHTML = "";

  const answer = (ok) => handleAnswer(state, ok, diff, root);

  if (q.kind === "choice") {
    shuffle([...q.options]).forEach((o) => {
      const btn = document.createElement("button");
      btn.className = "td-opt";
      btn.textContent = o.text;
      btn.addEventListener("click", () => answer(!!o.correct));
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
      btn.textContent = o.text;
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
      answer(checkMulti(q.options, chosen.map(o => q.options.indexOf(o))));
    });
    opts.appendChild(confirm);
  } else {
    addTextInput(opts, (val) => answer(checkText(q.accept, val)));
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

function handleAnswer(state, correct, diff, root) {
  state.answering = false;
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

async function endGame(state, root) {
  state.gameOver = true;
  const earned = Math.floor(state.score / 10);
  await addCoins(earned, "tower-defense");
  await saveGameScore("tower-defense", { points: state.score, coins: earned });

  const wrap = root.querySelector(".td-game");
  if (!wrap) return;
  const over = document.createElement("div");
  over.className = "td-gameover";
  over.innerHTML = `
    <h2>💀 Game Over!</h2>
    <div class="td-go-stats">
      <div>⭐ Score: <strong>${state.score}</strong></div>
      <div>💀 Kills: <strong>${state.kills}</strong></div>
      <div>🌊 Welle: <strong>${state.wave}</strong></div>
      <div>🪙 Verdient: <strong>${earned}</strong> Münzen</div>
    </div>
    <button class="btn-cta" id="td-retry">🔄 Nochmal</button>
    <button class="btn-secondary" id="td-home">← Zurück</button>`;
  wrap.appendChild(over);
  over.querySelector("#td-retry").addEventListener("click", () => navigate("tower-defense"));
  over.querySelector("#td-home").addEventListener("click", () => navigate("home"));
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
      state.projectiles.push({ x: t.x, y: t.y, target, dmg: t.dmg });
    }
  }

  state.projectiles = state.projectiles.filter(p => {
    if (!p.target || p.target.hp <= 0) return false;
    p.x = lerp(p.x, p.target.x, 0.25);
    p.y = lerp(p.y, p.target.y, 0.25);
    if (Math.hypot(p.x - p.target.x, p.y - p.target.y) < 8) {
      p.target.hp -= p.dmg;
      p.target.hit = 6;
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

  // Grass background
  const grass = isDark ? "#0f2a1e" : "#8fd19e";
  const grass2 = isDark ? "#123524" : "#7ec48d";
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // subtle checker
  ctx.fillStyle = grass2;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if ((r + c) % 2 === 0) ctx.fillRect(c * TILE, r * TILE, TILE, TILE);

  // Path as a thick rounded track
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const pts = PATH.map(p => ({ x: p.col * TILE + TILE / 2, y: p.row * TILE + TILE / 2 }));
  ctx.strokeStyle = isDark ? "#3b2f23" : "#caa472";
  ctx.lineWidth = TILE * 0.8;
  strokePath(ctx, pts);
  ctx.strokeStyle = isDark ? "#5a4632" : "#e0c89a";
  ctx.lineWidth = TILE * 0.6;
  strokePath(ctx, pts);

  // Base (home)
  const lastP = pts[pts.length - 1];
  drawRoundRect(ctx, lastP.x - 16, lastP.y - 16, 32, 32, 8, "#ef4444");
  ctx.font = "18px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("🏰", lastP.x, lastP.y);

  // Towers (monkey-style)
  for (const t of state.towers) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? "rgba(34,211,238,0.04)" : "rgba(28,180,135,0.05)";
    ctx.fill();
    // base shadow
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.ellipse(t.x, t.y + 13, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = t.color;
    ctx.beginPath(); ctx.arc(t.x, t.y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.arc(t.x, t.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#000";
    ctx.fillText("🎯", t.x, t.y + 1);
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

  // Projectiles (darts)
  for (const p of state.projectiles) {
    ctx.fillStyle = "#fde047";
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#a16207"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.stroke();
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

function strokePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function drawRoundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
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

function addFloater(state, x, y, text, color) {
  state.floaters.push({ x, y, text, color, life: 40 });
}

function updateHUD(state, root) {
  const set = (id, v) => { const el = root.querySelector(id); if (el) el.textContent = v; };
  set("#td-hp", Math.max(0, state.baseHP));
  set("#td-coins", state.coins);
  set("#td-kills", state.kills);
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
    .forEach(p => addTower(state, p.col, p.row, "#1cb487"));
}
