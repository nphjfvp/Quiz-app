import { loadCoins, loadGameScores } from "../store.js";
import { navigate } from "../router.js";

export async function render(root) {
  const [coins, scores] = await Promise.all([loadCoins(), loadGameScores()]);

  const games = [
    {
      id: "tower-defense", icon: "🏰", title: "Tower Defense",
      desc: "Verteidige deine Basis!", unlocked: true,
      best: scores["tower-defense"]?.best || 0,
      plays: scores["tower-defense"]?.plays || 0,
    },
    {
      id: "quiz-battle", icon: "⚔️", title: "Quiz Battle",
      desc: "Kartenduell gegen KI", unlocked: false, cost: 0,
      best: 0, plays: 0, coming: true,
    },
    {
      id: "endless-runner", icon: "🏃", title: "Endless Runner",
      desc: "Lauf und antworte!", unlocked: false, cost: 0,
      best: 0, plays: 0, coming: true,
    },
    {
      id: "quiz-roulette", icon: "🎰", title: "Quiz Roulette",
      desc: "Drehe und gewinne!", unlocked: false, cost: 0,
      best: 0, plays: 0, coming: true,
    },
  ];

  let html = `
    <div class="coin-bar">
      <span class="coin-icon">🪙</span>
      <span class="coin-amount">${coins.balance}</span>
      <span style="color:var(--text-light);font-size:0.8rem;margin-left:auto">Gesamt verdient: ${coins.earned}</span>
    </div>
    <h2 style="margin-bottom:4px">🎮 Mini-Games</h2>
    <p style="color:var(--text-light);margin-bottom:16px;font-size:0.9rem">Lerne spielend — verdiene Münzen für richtige Antworten!</p>
    <div class="games-grid">`;

  for (const g of games) {
    const locked = !g.unlocked;
    html += `
      <div class="game-card ${locked ? "locked" : ""}" ${!locked ? `data-game="${g.id}"` : ""} style="position:relative">
        <div class="game-icon">${g.icon}</div>
        <div class="game-title">${g.title}</div>
        <div class="game-desc">${g.coming ? "Kommt bald!" : g.desc}</div>
        ${g.plays > 0 ? `<div style="margin-top:6px;font-size:0.75rem;color:var(--text-light)">
          Best: ⭐${g.best} · ${g.plays}x gespielt
        </div>` : ""}
      </div>`;
  }

  html += `</div>
    <button class="btn-secondary" id="games-back" style="margin-top:20px;width:100%">← Zurück</button>`;

  root.innerHTML = html;

  root.querySelectorAll("[data-game]").forEach(el => {
    el.addEventListener("click", () => navigate(el.dataset.game));
  });
  root.querySelector("#games-back").addEventListener("click", () => navigate("home"));
}
