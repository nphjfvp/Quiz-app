const DB_NAME = "lerntrainer";
const DB_VERSION = 1;
const STORE = "kv";

let _dbPromise = null;

function openDB() {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB blocked"));
    });
  }
  return _dbPromise;
}

async function get(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function set(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Löscht ALLE Keys (kompletter Reset) — erfasst auch künftige Store-Keys. */
export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadQuizzes() {
  return (await get("quizzes")) ?? [];
}
export async function saveQuizzes(quizzes) {
  await set("quizzes", quizzes);
}

export async function loadProgress() {
  return (await get("progress")) ?? {};
}
export async function saveProgress(progress) {
  await set("progress", progress);
}

export async function loadSettings() {
  return (await get("settings")) ?? {};
}
export async function saveSettings(settings) {
  await set("settings", settings);
}

export async function loadDailyState() {
  return (await get("daily")) ?? null;
}
export async function saveDailyState(state) {
  await set("daily", state);
}

export async function loadMarked() {
  return (await get("marked")) ?? [];
}
export async function saveMarked(ids) {
  await set("marked", ids);
}

export async function loadStats() {
  return (await get("stats")) ?? {};
}
export async function saveStats(stats) {
  await set("stats", stats);
}

export async function loadErrorDiary() {
  return (await get("error_diary")) ?? [];
}
export async function saveErrorDiary(diary) {
  await set("error_diary", diary);
}

export async function loadFolders() {
  return (await get("folders")) ?? [];
}
export async function saveFolders(folders) {
  await set("folders", folders);
}

export async function loadFormulaSheets() {
  return (await get("formula_sheets")) ?? [];
}
export async function saveFormulaSheets(sheets) {
  await set("formula_sheets", sheets);
}

export async function loadFsrs() {
  return (await get("fsrs")) ?? {};
}
export async function saveFsrs(data) {
  await set("fsrs", data);
}

// ── Coin / Game Economy ──
export async function loadCoins() {
  return (await get("coins")) ?? { balance: 0, earned: 0, spent: 0, history: [] };
}
export async function saveCoins(data) {
  await set("coins", data);
}
export async function addCoins(amount, source) {
  const data = await loadCoins();
  data.balance += amount;
  data.earned += amount;
  data.history.push({ amount, source, ts: Date.now() });
  if (data.history.length > 200) data.history = data.history.slice(-200);
  await saveCoins(data);
  return data.balance;
}
export async function spendCoins(amount, item) {
  const data = await loadCoins();
  if (data.balance < amount) return false;
  data.balance -= amount;
  data.spent += amount;
  data.history.push({ amount: -amount, source: item, ts: Date.now() });
  await saveCoins(data);
  return true;
}

// ── Game High Scores ──
export async function loadGameScores() {
  return (await get("game_scores")) ?? {};
}
export async function saveGameScore(game, score) {
  const scores = await loadGameScores();
  if (!scores[game]) scores[game] = { best: 0, plays: 0, totalCoins: 0 };
  scores[game].plays++;
  scores[game].totalCoins += score.coins || 0;
  if (score.points > (scores[game].best || 0)) scores[game].best = score.points;
  await set("game_scores", scores);
}

export async function logAnswer(correct) {
  const stats = await loadStats();
  const today = new Date().toISOString().slice(0, 10);
  const day = stats[today] ?? { answered: 0, correct: 0 };
  day.answered++;
  if (correct) day.correct++;
  stats[today] = day;
  await saveStats(stats);

  // Tageszeit-Erfolge (Nachteule/Frühaufsteher): Die Stats-Keys tragen keine
  // Uhrzeit, daher wird der Unlock-Flag direkt beim Antworten gesetzt.
  const h = new Date().getHours();
  if (h >= 23 || h < 7) {
    const ach = await loadAchievements();
    const flag = h >= 23 ? "night_owl_unlocked" : "early_bird_unlocked";
    if (!ach[flag]) { ach[flag] = true; await saveAchievements(ach); }
  }
}

export function getStreak(stats) {
  const days = Object.keys(stats).sort();
  if (!days.length) return { current: 0, max: 0 };
  const today = new Date().toISOString().slice(0, 10);
  let current = 0;
  const d = new Date(today);
  while (stats[d.toISOString().slice(0, 10)]) {
    current++;
    d.setDate(d.getDate() - 1);
  }
  if (!current) {
    d.setTime(new Date(today).getTime());
    d.setDate(d.getDate() - 1);
    while (stats[d.toISOString().slice(0, 10)]) {
      current++;
      d.setDate(d.getDate() - 1);
    }
  }
  let max = 0, s = 1;
  for (let i = 1; i < days.length; i++) {
    const diff = (new Date(days[i]) - new Date(days[i - 1])) / 86400000;
    if (diff === 1) s++;
    else { max = Math.max(max, s); s = 1; }
  }
  max = Math.max(max, s);
  return { current, max };
}

// ── Player Profile (Shop / Avatar / House) ──
const DEFAULT_PROFILE = {
  house: { level: 0 },
  owned: {
    skin_light: true, skin_pale: true, skin_medium: true, skin_dark: true,
    top_tee: true, face_default: true, hat_none: true, acc_none: true,
    bg_none: true, theme_default: true,
  },
  equipped: {
    skin: "skin_light", top: "top_tee", face: "face_default",
    hat: "hat_none", accessory: "acc_none", bg: "bg_none", theme: "theme_default",
  },
};
export async function loadProfile() {
  const p = await get("profile");
  if (!p) return structuredClone(DEFAULT_PROFILE);
  return {
    ...DEFAULT_PROFILE, ...p,
    house: { ...DEFAULT_PROFILE.house, ...(p.house || {}) },
    owned: { ...DEFAULT_PROFILE.owned, ...(p.owned || {}) },
    equipped: { ...DEFAULT_PROFILE.equipped, ...(p.equipped || {}) },
  };
}
export async function saveProfile(profile) {
  await set("profile", profile);
}

// ── Achievements ──
export async function loadAchievements() {
  return (await get("achievements")) ?? {};
}
export async function saveAchievements(data) {
  await set("achievements", data);
}

// ── Recents ──
// { type: "quiz"|"formula"|"plan"|"daily"|"tutor", id, name, ts }
export async function loadRecents() {
  const val = await get("recents");
  return Array.isArray(val) ? val : [];
}

// Sequential queue to prevent read-modify-write race between concurrent trackRecent calls
let _recentsQueue = Promise.resolve();
export async function trackRecent(type, id, name) {
  _recentsQueue = _recentsQueue.then(async () => {
    const recents = await loadRecents();
    const filtered = recents.filter(r => !(r.type === type && r.id === id));
    filtered.unshift({ type, id, name, ts: Date.now() });
    await set("recents", filtered.slice(0, 20));
  });
  return _recentsQueue;
}

// ── Math task sets (Formel-Training / Scaffolding) ──
export async function loadMathTasks() {
  return (await get("math_tasks")) ?? [];
}
export async function saveMathTasks(sets) {
  await set("math_tasks", sets);
}

// ── Study Materials ──
export async function loadMaterials() {
  return (await get("materials")) ?? {};
}
export async function saveMaterials(data) {
  await set("materials", data);
}
export async function saveMaterial(quizId, material) {
  const m = await loadMaterials();
  m[quizId] = material;
  await set("materials", m);
}
export async function getMaterial(quizId) {
  const m = await loadMaterials();
  return m[quizId] ?? null;
}

// ── KI-Memory ──
export async function loadMemory() {
  return (await get("memory_text")) ?? "";
}
export async function saveMemory(text) {
  await set("memory_text", String(text ?? ""));
}
export async function loadMemoryEntries() {
  return (await get("memory_entries")) ?? [];
}
export async function saveMemoryEntries(entries) {
  await set("memory_entries", entries);
}
export function createMemoryEntry(category, text, topic = "", source = "auto") {
  return {
    id: crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    category,
    text,
    source,
    topic,
    created: new Date().toISOString(),
  };
}
export async function addMemoryEntry(entry) {
  const entries = await loadMemoryEntries();
  entries.push(entry);
  if (entries.length > 200) entries.splice(0, entries.length - 200);
  await saveMemoryEntries(entries);
}
export async function deleteMemoryEntry(entryId) {
  let entries = await loadMemoryEntries();
  entries = entries.filter(e => e.id !== entryId);
  await saveMemoryEntries(entries);
}
export async function getFullMemoryPrompt() {
  const parts = [];
  const freetext = await loadMemory();
  if (freetext.trim()) parts.push(freetext.trim());
  const entries = await loadMemoryEntries();
  if (entries.length) {
    const byCat = {};
    for (const e of entries) {
      if (!byCat[e.category]) byCat[e.category] = [];
      byCat[e.category].push(e.topic ? `${e.text} (Thema: ${e.topic})` : e.text);
    }
    const labels = { weakness: "Schwächen", strength: "Stärken", preference: "Vorlieben", fact: "Fakten", custom: "Notizen" };
    for (const [cat, items] of Object.entries(byCat)) {
      parts.push(`${labels[cat] || cat}: ${items.join("; ")}`);
    }
  }
  return parts.length ? `[Persönliches Benutzerprofil]\n${parts.join("\n")}\n[/Profil]` : "";
}

// ── Study Plans ─────────────────────────────────────────────────────────────
export async function loadStudyPlans() {
  return (await get("study_plans")) ?? [];
}
export async function saveStudyPlans(data) {
  await set("study_plans", data);
}

// ── Quick Actions ──
export async function loadQuickActions() {
  return (await get("quick_actions")) ?? [];
}
export async function saveQuickActions(actions) {
  await set("quick_actions", actions);
}
