import { loadQuizzes, saveQuizzes, loadProgress, saveProgress, loadDailyState, saveDailyState, loadStats, saveStats, loadFsrs, saveFsrs } from "./store.js";

const CONFIG = {
  apiKey: "AIzaSyBzslbApoDz0UWusBpS10DEGWY7cvIUK5s",
  projectId: "quiz-test-37d87",
};
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}/databases/(default)/documents`;
const AUTH_BASE = "https://identitytoolkit.googleapis.com/v1/accounts";
const TOKEN_BASE = "https://securetoken.googleapis.com/v1/token";

let _account = null;

export function getAccount() { return _account; }
export function setAccount(acc) { _account = acc; }

export async function signIn(email, password) {
  const r = await fetch(`${AUTH_BASE}:signInWithPassword?key=${CONFIG.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || "Login failed"); }
  const data = await r.json();
  _account = { email: data.email, uid: data.localId, idToken: data.idToken,
    refreshToken: data.refreshToken, expiresAt: Date.now() + parseInt(data.expiresIn) * 1000 };
  return _account;
}

export async function signUp(email, password) {
  const r = await fetch(`${AUTH_BASE}:signUp?key=${CONFIG.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || "Signup failed"); }
  const data = await r.json();
  _account = { email: data.email, uid: data.localId, idToken: data.idToken,
    refreshToken: data.refreshToken, expiresAt: Date.now() + parseInt(data.expiresIn) * 1000 };
  return _account;
}

export async function refreshToken() {
  if (!_account?.refreshToken) return;
  const r = await fetch(`${TOKEN_BASE}?key=${CONFIG.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${_account.refreshToken}`,
  });
  if (!r.ok) throw new Error("Token refresh failed");
  const data = await r.json();
  _account.idToken = data.id_token;
  _account.refreshToken = data.refresh_token;
  _account.expiresAt = Date.now() + parseInt(data.expires_in) * 1000;
}

let _refreshPromise = null;
async function ensureToken() {
  if (!_account) return null;
  if (_account.expiresAt - Date.now() < 60000) {
    // Promise-Lock: parallele Sync-Aufrufe teilen sich EINEN Refresh, statt
    // gleichzeitig zwei Refresh-Requests zu feuern (Firebase rotiert das
    // Refresh-Token — Doppel-Refresh kann Tokens gegenseitig invalidieren).
    if (!_refreshPromise) {
      _refreshPromise = refreshToken().finally(() => { _refreshPromise = null; });
    }
    await _refreshPromise;
  }
  return _account.idToken;
}

// Liest eine Fehlermeldung aus einer Firestore-Antwort (best-effort).
async function safeErr(r) {
  try { const e = await r.json(); return e.error?.message || r.statusText || `HTTP ${r.status}`; }
  catch { return r.statusText || `HTTP ${r.status}`; }
}

async function fsGet(path) {
  const token = await ensureToken();
  if (!token) return null;
  const r = await fetch(`${FS_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return null; // noch keine Daten vorhanden – kein Fehler
  if (!r.ok) throw new Error(`Sync-Lesen fehlgeschlagen: ${await safeErr(r)}`);
  const doc = await r.json();
  const payload = doc.fields?.payload?.stringValue;
  return payload ? JSON.parse(payload) : null;
}

async function fsPut(path, data) {
  const token = await ensureToken();
  if (!token) throw new Error("Nicht eingeloggt.");
  // Firestore-Dokumente sind auf ~1 MB begrenzt. Zu große Nutzlasten wurden
  // zuvor still verworfen (fsPut prüfte r.ok gar nicht) -> jetzt klarer Fehler.
  const payload = JSON.stringify(data);
  if (payload.length > 900_000) {
    throw new Error(`Daten zu groß für Cloud-Sync (${Math.round(payload.length / 1024)} KB). Bitte Quiz-Sammlung aufteilen.`);
  }
  const r = await fetch(`${FS_BASE}/${path}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { payload: { stringValue: payload } } }),
  });
  if (!r.ok) throw new Error(`Sync-Schreiben fehlgeschlagen: ${await safeErr(r)}`);
}

function syncPath(name) {
  return _account ? `synced/acc_${_account.uid}/data/${name}` : null;
}

export async function pushAll() {
  if (!_account) return;
  const [quizzes, progress, daily, stats, fsrs] = await Promise.all([
    loadQuizzes(), loadProgress(), loadDailyState(), loadStats(), loadFsrs(),
  ]);
  await Promise.all([
    fsPut(syncPath("quizzes"), quizzes),
    fsPut(syncPath("progress"), progress),
    daily ? fsPut(syncPath("daily"), daily) : Promise.resolve(),
    fsPut(syncPath("stats"), stats),
    fsPut(syncPath("fsrs"), fsrs),
    // Metadaten für den Pull-Schutz: Zeitstempel + Umfang des Cloud-Stands.
    fsPut(syncPath("meta"), { updatedAt: Date.now(), quizCount: quizzes.length }),
  ]);
}

/** Liest die Cloud-Metadaten (Zeitstempel/Umfang), ohne etwas zu überschreiben. */
export async function getCloudMeta() {
  if (!_account) return null;
  try { return await fsGet(syncPath("meta")); } catch { return null; }
}

export async function pullAll() {
  if (!_account) return false;
  const [quizzes, progress, daily, stats, fsrs] = await Promise.all([
    fsGet(syncPath("quizzes")), fsGet(syncPath("progress")),
    fsGet(syncPath("daily")), fsGet(syncPath("stats")), fsGet(syncPath("fsrs")),
  ]);
  if (quizzes) await saveQuizzes(quizzes);
  if (progress) await saveProgress(progress);
  if (daily) await saveDailyState(daily);
  if (stats) await saveStats(stats);
  if (fsrs) await saveFsrs(fsrs);
  return !!(quizzes || progress);
}

// Sync-Code fallback (legacy, for users not logged in)
export async function pullBySyncCode(code) {
  if (!code) return false;
  const base = `synced/${code}/data`;
  const token = await ensureToken();
  // Sync-code works without auth too (public read in Firestore rules)
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const r = await fetch(`${FS_BASE}/${base}/quizzes`, { headers });
    if (!r.ok) return false;
    const doc = await r.json();
    const payload = doc.fields?.payload?.stringValue;
    if (payload) await saveQuizzes(JSON.parse(payload));
    return true;
  } catch { return false; }
}
