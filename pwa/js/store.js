const DB_NAME = "lerntrainer";
const DB_VERSION = 1;
const STORE = "kv";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

export async function loadFsrs() {
  return (await get("fsrs")) ?? {};
}
export async function saveFsrs(data) {
  await set("fsrs", data);
}

export async function logAnswer(correct) {
  const stats = await loadStats();
  const today = new Date().toISOString().slice(0, 10);
  const day = stats[today] ?? { answered: 0, correct: 0 };
  day.answered++;
  if (correct) day.correct++;
  stats[today] = day;
  await saveStats(stats);
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
