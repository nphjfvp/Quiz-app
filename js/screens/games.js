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
      desc: "Helden vs. Gegner", unlocked: true,
      best: scores["quiz-battle"]?.best || 0,
      plays: scores["quiz-battle"]?.plays || 0,
    },
    {
      id: "speed-quiz", icon: "⚡", title: "Speed-Quiz",
      desc: "60 Sek, Combo-Multiplikator!", unlocked: true,
      best: scores["speed-quiz"]?.best || 0,
      plays: scores["speed-quiz"]?.plays || 0,
    },
    {
      id: "millionaire", icon: "💰", title: "Wer wird Millionär",
      desc: "15 Fragen, 3 Joker", unlocked: true,
      best: scores["millionaire"]?.best || 0,
      plays: scores["millionaire"]?.plays || 0,
    },
    {
      id: "hangman", icon: "💀", title: "Galgenmännchen",
      desc: "Errate den Begriff!", unlocked: true,
      best: scores["hangman"]?.best || 0,
      plays: scores["hangman"]?.plays || 0,
    },
    {
      id: "boss-fight", icon: "👹", title: "Boss-Kampf",
      desc: "Besiege deine Schwächen!", unlocked: true,
      best: scores["boss-fight"]?.best || 0,
      plays: scores["boss-fight"]?.plays || 0,
    },
  ];

  let html = `
    <div class="coin-bar">
      <span class="coin-icon">🪙</span>
      <span class="coin-amount">${coins.balance}</span>
      <button class="btn btn-primary btn-sm" id="games-shop" style="margin-left:auto">🛍️ Shop</button>
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
  root.querySelector("#games-shop")?.addEventListener("click", () => navigate("shop"));
}
