import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
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
const auth = getAuth(app);

export function isConfigured(): boolean {
  return !firebaseConfig.apiKey.startsWith("YOUR_");
}

export async function ensureAuth(): Promise<string | null> {
  if (!isConfigured()) return null;
  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    return auth.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

export async function syncQuizzes(quizzes: Quiz[]): Promise<void> {
  const uid = await ensureAuth();
  if (!uid) return;
  const ref = doc(db, "users", uid, "data", "quizzes");
  await setDoc(ref, { quizzes: quizzes.map((q) => JSON.parse(JSON.stringify(q))) });
}

export async function fetchQuizzes(): Promise<Quiz[] | null> {
  const uid = await ensureAuth();
  if (!uid) return null;
  const ref = doc(db, "users", uid, "data", "quizzes");
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data().quizzes as Quiz[];
  }
  return null;
}

export async function syncProgress(
  progress: Record<string, QuestionProgress>
): Promise<void> {
  const uid = await ensureAuth();
  if (!uid) return;
  const ref = doc(db, "users", uid, "data", "progress");
  await setDoc(ref, { progress });
}

export async function fetchProgress(): Promise<Record<string, QuestionProgress> | null> {
  const uid = await ensureAuth();
  if (!uid) return null;
  const ref = doc(db, "users", uid, "data", "progress");
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data().progress as Record<string, QuestionProgress>;
  }
  return null;
}

export async function syncDailyState(state: DailyState): Promise<void> {
  const uid = await ensureAuth();
  if (!uid) return;
  const ref = doc(db, "users", uid, "data", "daily");
  await setDoc(ref, state);
}

export async function fetchDailyState(): Promise<DailyState | null> {
  const uid = await ensureAuth();
  if (!uid) return null;
  const ref = doc(db, "users", uid, "data", "daily");
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as DailyState) : null;
}
