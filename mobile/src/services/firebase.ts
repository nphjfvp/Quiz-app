import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Quiz, QuestionProgress, DailyState } from "../types/quiz";

const firebaseConfig = {
  apiKey: "AIzaSyBzslbApoDz0UWusBpS10DEGWY7cvIUK5s",
  authDomain: "quiz-test-37d87.firebaseapp.com",
  projectId: "quiz-test-37d87",
  storageBucket: "quiz-test-37d87.firebasestorage.app",
  messagingSenderId: "800484076229",
  appId: "1:800484076229:web:1f2088ec15354a1ab2deac",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

// ── Sync-Code: geteilter Schluessel ueber alle Geraete ──
const SYNC_CODE_KEY = "lerntrainer_sync_code";
let cachedCode: string | null = null;

function sanitizeCode(code: string): string {
  return (code || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

export async function getSyncCode(): Promise<string> {
  if (cachedCode !== null) return cachedCode;
  cachedCode = (await AsyncStorage.getItem(SYNC_CODE_KEY)) ?? "";
  return cachedCode;
}

export async function setSyncCode(code: string): Promise<void> {
  cachedCode = sanitizeCode(code);
  await AsyncStorage.setItem(SYNC_CODE_KEY, cachedCode);
}

export function isConfigured(): boolean {
  return !firebaseConfig.apiKey.startsWith("YOUR_");
}

export async function hasSyncCode(): Promise<boolean> {
  return sanitizeCode(await getSyncCode()).length > 0;
}

// Dokument synced/{code}/data/{name} mit einem String-Feld "payload".
async function dataDocRef(name: string) {
  const code = sanitizeCode(await getSyncCode());
  if (!code) return null;
  return doc(db, "synced", code, "data", name);
}

async function pushPayload(name: string, data: unknown): Promise<void> {
  const ref = await dataDocRef(name);
  if (!ref) return;
  await setDoc(ref, { payload: JSON.stringify(data) });
}

async function pullPayload<T>(name: string): Promise<T | null> {
  const ref = await dataDocRef(name);
  if (!ref) return null;
  const snap = await getDoc(ref);
  if (snap.exists() && typeof snap.data().payload === "string") {
    try {
      return JSON.parse(snap.data().payload) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export async function syncQuizzes(quizzes: Quiz[]): Promise<void> {
  await pushPayload("quizzes", quizzes);
}

export async function fetchQuizzes(): Promise<Quiz[] | null> {
  return pullPayload<Quiz[]>("quizzes");
}

export async function syncProgress(
  progress: Record<string, QuestionProgress>
): Promise<void> {
  await pushPayload("progress", progress);
}

export async function fetchProgress(): Promise<Record<string, QuestionProgress> | null> {
  return pullPayload<Record<string, QuestionProgress>>("progress");
}

export async function syncDailyState(state: DailyState): Promise<void> {
  await pushPayload("daily", state);
}

export async function fetchDailyState(): Promise<DailyState | null> {
  return pullPayload<DailyState>("daily");
}
