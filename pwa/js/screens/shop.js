import { loadProfile, saveProfile, loadCoins, spendCoins } from "../store.js";
import { navigate } from "../router.js";
import { esc } from "../utils.js";
import {
  CATALOG, SLOT_ORDER, SLOT_LABELS, findItem, renderAvatarSVG,
  HOUSE_LEVELS, renderHouseSVG, THEME_SKINS, applyThemeSkin, GAME_SKINS, HOUSE_DECOS,
} from "../shop-catalog.js";

let activeTab = "char";

export async function render(root) {
  const [profile, coins] = await Promise.all([loadProfile(), loadCoins()]);

  const rerender = () => render(root);

  let html = `<button class="back-btn" id="shop-back">‹ Zurück</button>
    <div class="shop-coinbar">
      <span class="coin-icon">🪙</span>
      <span class="coin-amount" id="shop-balance">${coins.balance}</span>
      <span class="shop-coinhint">Münzen — verdiene mehr beim Lernen & in Games</span>
    </div>
    <div class="shop-tabs">
      <button class="shop-tab ${activeTab === "char" ? "active" : ""}" data-tab="char">🧑 Charakter</button>
      <button class="shop-tab ${activeTab === "house" ? "active" : ""}" data-tab="house">🏠 Haus</button>
      <button class="shop-tab ${activeTab === "skins" ? "active" : ""}" data-tab="skins">🎨 Skins</button>
      <button class="shop-tab ${activeTab === "games" ? "active" : ""}" data-tab="games">🎮 Games</button>
    </div>
    <div id="shop-body">`;

  if (activeTab === "char") html += renderCharTab(profile);
  else if (activeTab === "house") html += renderHouseTab(profile, coins);
  else if (activeTab === "games") html += renderGamesTab(profile);
  else html += renderSkinsTab(profile);

  html += `</div>`;
  root.innerHTML = html;

  root.querySelector("#shop-back").addEventListener("click", () => navigate("home"));
  root.querySelectorAll(".shop-tab").forEach((b) =>
    b.addEventListener("click", () => { activeTab = b.dataset.tab; rerender(); }));

  // ── Buy / equip handlers (shared) ──
  root.querySelectorAll("[data-buy]").forEach((b) =>
    b.addEventListener("click", async () => {
      const { slot, id } = b.dataset;
      const item = slot === "theme" ? THEME_SKINS.find((t) => t.id === id) : findItem(slot, id);
      if (!item) return;
      const ok = await spendCoins(item.price, `shop:${id}`);
      if (!ok) { flash(b, "Zu wenig 🪙"); return; }
      const p = await loadProfile();
      p.owned[id] = true;
      p.equipped[slot] = id;
      await saveProfile(p);
      if (slot === "theme") applyThemeSkin(id);
      rerender();
    }));

  root.querySelectorAll("[data-equip]").forEach((b) =>
    b.addEventListener("click", async () => {
      const { slot, id } = b.dataset;
      const p = await loadProfile();
      p.equipped[slot] = id;
      await saveProfile(p);
      if (slot === "theme") applyThemeSkin(id);
      rerender();
    }));

  // ── Game skin buy/equip ──
  root.querySelectorAll("[data-buy-game]").forEach((b) =>
    b.addEventListener("click", async () => {
      const { game, id, price } = b.dataset;
      const ok = await spendCoins(parseInt(price), `shop:${id}`);
      if (!ok) { flash(b, "Zu wenig 🪙"); return; }
      const p = await loadProfile();
      p.owned[id] = true;
      if (!p.gameSkins) p.gameSkins = {};
      p.gameSkins[game] = id;
      await saveProfile(p);
      rerender();
    }));

  root.querySelectorAll("[data-equip-game]").forEach((b) =>
    b.addEventListener("click", async () => {
      const { game, id } = b.dataset;
      const p = await loadProfile();
      if (!p.gameSkins) p.gameSkins = {};
      p.gameSkins[game] = id;
      await saveProfile(p);
      rerender();
    }));

  // ── House decoration ──
  root.querySelectorAll("[data-deco-buy]").forEach((b) =>
    b.addEventListener("click", async () => {
      const { id, price } = b.dataset;
      const ok = await spendCoins(parseInt(price), `deco:${id}`);
      if (!ok) { flash(b, "Zu wenig 🪙"); return; }
      const p = await loadProfile();
      p.owned[id] = true;
      if (!p.house.decos) p.house.decos = [];
      p.house.decos.push(id);
      await saveProfile(p);
      rerender();
    }));

  root.querySelectorAll("[data-deco-place]").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = await loadProfile();
      if (!p.house.decos) p.house.decos = [];
      if (!p.house.decos.includes(b.dataset.id)) p.house.decos.push(b.dataset.id);
      await saveProfile(p);
      rerender();
    }));

  root.querySelectorAll("[data-deco-remove]").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = await loadProfile();
      p.house.decos = (p.house.decos || []).filter(d => d !== b.dataset.id);
      await saveProfile(p);
      rerender();
    }));

  // ── House upgrade ──
  root.querySelector("#house-upgrade")?.addEventListener("click", async () => {
    const next = HOUSE_LEVELS[profile.house.level + 1];
    if (!next) return;
    const ok = await spendCoins(next.price, `house:${next.level}`);
    const btn = root.querySelector("#house-upgrade");
    if (!ok) { flash(btn, "Zu wenig 🪙"); return; }
    const p = await loadProfile();
    p.house.level = next.level;
    await saveProfile(p);
    rerender();
  });
}

function flash(btn, msg) {
  const old = btn.textContent;
  btn.textContent = msg;
  btn.classList.add("shop-flash");
  setTimeout(() => { btn.textContent = old; btn.classList.remove("shop-flash"); }, 1200);
}

// ─── Tab: Charakter ──────────────────────────────────────────────────
function renderCharTab(profile) {
  let html = `<div class="avatar-preview">${renderAvatarSVG(profile.equipped, 150)}</div>`;
  for (const slot of SLOT_ORDER) {
    const items = CATALOG[slot] || [];
    html += `<div class="section-title">${SLOT_LABELS[slot]}</div>
      <div class="shop-row">`;
    for (const item of items) {
      const owned = !!profile.owned[item.id];
      const equipped = profile.equipped[slot] === item.id;
      html += shopItemCard(slot, item, owned, equipped, miniAvatar(slot, item, profile));
    }
    html += `</div>`;
  }
  return html;
}

// Small preview swatch for an item (avatar with just this item swapped in).
function miniAvatar(slot, item, profile) {
  const eq = { ...profile.equipped, [slot]: item.id };
  return renderAvatarSVG(eq, 56);
}

// ─── Tab: Haus ───────────────────────────────────────────────────────
function renderHouseTab(profile, coins) {
  const lvl = profile.house.level;
  const cur = HOUSE_LEVELS[lvl];
  const next = HOUSE_LEVELS[lvl + 1];
  const decos = profile.house.decos || [];
  let html = `<div class="house-preview">${renderHouseSVG(lvl, 200, decos)}
      <div class="house-name">${esc(cur.name)} · Stufe ${lvl}</div>
    </div>`;

  if (next) {
    const afford = coins.balance >= next.price;
    html += `<div class="card house-upgrade-card">
      <div class="house-up-preview">${renderHouseSVG(next.level, 90)}</div>
      <div style="flex:1">
        <div style="font-weight:600">Ausbau zu: ${esc(next.name)}</div>
        <div style="color:var(--text-light);font-size:0.85rem">Nächste Stufe freischalten</div>
      </div>
      <button class="btn btn-primary btn-sm" id="house-upgrade" ${afford ? "" : "disabled"}>🪙 ${next.price}</button>
    </div>`;
  } else {
    html += `<div class="card" style="text-align:center">🏰 Maximale Stufe erreicht!</div>`;
  }

  html += `<div class="section-title">Alle Stufen</div>`;
  for (const h of HOUSE_LEVELS) {
    const state = h.level < lvl ? "✓ Gebaut" : h.level === lvl ? "● Aktuell" : `🪙 ${h.price}`;
    const cls = h.level <= lvl ? "owned" : "";
    html += `<div class="house-level-row ${cls}">
      <div class="house-mini">${renderHouseSVG(h.level, 50)}</div>
      <span style="flex:1;font-weight:${h.level === lvl ? 600 : 400}">${esc(h.name)}</span>
      <span style="font-size:0.85rem;color:var(--text-light)">${state}</span>
    </div>`;
  }

  html += `<div class="section-title">Dekoration</div>
    <p style="color:var(--text-light);font-size:0.85rem;margin-bottom:10px">Verschönere dein Zuhause!</p>
    <div class="skins-grid">`;
  for (const d of HOUSE_DECOS) {
    const owned = !!profile.owned[d.id];
    const placed = decos.includes(d.id);
    html += `<div class="skin-card ${placed ? "equipped" : ""}">
      <div class="skin-swatch" style="background:var(--card-hover);display:flex;align-items:center;justify-content:center">
        <svg viewBox="0 0 120 100" width="70" height="58">${d.svg}</svg>
      </div>
      <div class="skin-name">${esc(d.name)}</div>
      ${placed
        ? `<button class="btn btn-ghost btn-sm" data-deco-remove data-id="${d.id}">Entfernen</button>`
        : owned
          ? `<button class="btn btn-ghost btn-sm" data-deco-place data-id="${d.id}">Platzieren</button>`
          : `<button class="btn btn-primary btn-sm" data-deco-buy data-id="${d.id}" data-price="${d.price}">🪙 ${d.price}</button>`}
    </div>`;
  }
  html += `</div>`;

  return html;
}

// ─── Tab: Skins (Theme-Akzentfarben) ─────────────────────────────────
function renderSkinsTab(profile) {
  let html = `<div class="section-title">App-Farbschema</div>
    <p style="color:var(--text-light);font-size:0.85rem;margin-bottom:10px">Verändert die Akzentfarbe der ganzen App.</p>
    <div class="skins-grid">`;
  for (const t of THEME_SKINS) {
    const owned = !!profile.owned[t.id];
    const equipped = profile.equipped.theme === t.id;
    const [p, , l] = t.palette;
    html += `<div class="skin-card ${equipped ? "equipped" : ""}">
      <div class="skin-swatch" style="background:linear-gradient(135deg, ${p}, ${l})"></div>
      <div class="skin-name">${esc(t.name)}</div>
      ${equipped
        ? `<span class="skin-badge">✓ Aktiv</span>`
        : owned
          ? `<button class="btn btn-ghost btn-sm" data-equip data-slot="theme" data-id="${t.id}">Anwenden</button>`
          : `<button class="btn btn-primary btn-sm" data-buy data-slot="theme" data-id="${t.id}">🪙 ${t.price}</button>`}
    </div>`;
  }
  html += `</div>`;
  return html;
}

// ─── Tab: Game Skins ─────────────────────────────────────────────────
function renderGamesTab(profile) {
  const gameSkins = profile.gameSkins || {};
  const gameGroups = {};
  for (const s of GAME_SKINS) {
    (gameGroups[s.game] ||= []).push(s);
  }
  const GAME_LABELS = { "tower-defense": "🏰 Tower Defense", "quiz-battle": "⚔️ Quiz Battle" };
  let html = `<p style="color:var(--text-light);font-size:0.85rem;margin-bottom:12px">Ändere Farben & Styles in Mini-Games.</p>`;
  for (const [game, skins] of Object.entries(gameGroups)) {
    html += `<div class="section-title">${GAME_LABELS[game] || game}</div><div class="skins-grid">`;
    for (const s of skins) {
      const owned = s.price === 0 || !!profile.owned[s.id];
      const equipped = (gameSkins[game] || skins[0].id) === s.id;
      const [c1, c2] = s.palette;
      html += `<div class="skin-card ${equipped ? "equipped" : ""}">
        <div class="skin-swatch" style="background:linear-gradient(135deg, ${c1}, ${c2})"></div>
        <div class="skin-name">${esc(s.name)}</div>
        ${equipped
          ? `<span class="skin-badge">✓ Aktiv</span>`
          : owned
            ? `<button class="btn btn-ghost btn-sm" data-equip-game data-game="${game}" data-id="${s.id}">Anwenden</button>`
            : `<button class="btn btn-primary btn-sm" data-buy-game data-game="${game}" data-id="${s.id}" data-price="${s.price}">🪙 ${s.price}</button>`}
      </div>`;
    }
    html += `</div>`;
  }
  return html;
}

// ─── Shared item card (avatar slots) ─────────────────────────────────
function shopItemCard(slot, item, owned, equipped, previewSVG) {
  return `<div class="shop-item ${equipped ? "equipped" : ""} ${owned ? "owned" : ""}">
    <div class="shop-item-preview">${previewSVG}</div>
    <div class="shop-item-name">${esc(item.name)}</div>
    ${equipped
      ? `<span class="shop-item-badge">✓</span>`
      : owned
        ? `<button class="shop-mini-btn" data-equip data-slot="${slot}" data-id="${item.id}">Anlegen</button>`
        : `<button class="shop-mini-btn buy" data-buy data-slot="${slot}" data-id="${item.id}">🪙 ${item.price}</button>`}
  </div>`;
}
