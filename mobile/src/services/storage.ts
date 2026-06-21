import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Quiz, QuestionProgress, DailyState } from "../types/quiz";
import * as firebase from "./firebase";

const KEYS = {
  quizzes: "lerntrainer_quizzes",
  progress: "lerntrainer_progress",
  settings: "lerntrainer_settings",
  daily: "lerntrainer_daily",
  marked: "lerntrainer_marked",
};

export async function loadQuizzes(): Promise<Quiz[]> {
  const raw = await AsyncStorage.getItem(KEYS.quizzes);
  return raw ? JSON.parse(raw) : [];
}

export async function saveQuizzes(quizzes: Quiz[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.quizzes, JSON.stringify(quizzes));
  if (firebase.isConfigured()) {
    firebase.syncQuizzes(quizzes).catch(() => {});
  }
}

export async function loadProgress(): Promise<Record<string, QuestionProgress>> {
  const raw = await AsyncStorage.getItem(KEYS.progress);
  return raw ? JSON.parse(raw) : {};
}

export async function saveProgress(
  progress: Record<string, QuestionProgress>
): Promise<void> {
  await AsyncStorage.setItem(KEYS.progress, JSON.stringify(progress));
  if (firebase.isConfigured()) {
    firebase.syncProgress(progress).catch(() => {});
  }
}

export async function loadSettings(): Promise<Record<string, any>> {
  const raw = await AsyncStorage.getItem(KEYS.settings);
  return raw ? JSON.parse(raw) : {};
}

export async function saveSettings(settings: Record<string, any>): Promise<void> {
  await AsyncStorage.setItem(KEYS.settings, JSON.stringify(settings));
}

export async function loadDailyState(): Promise<DailyState | null> {
  const raw = await AsyncStorage.getItem(KEYS.daily);
  return raw ? JSON.parse(raw) : null;
}

export async function saveDailyState(state: DailyState): Promise<void> {
  await AsyncStorage.setItem(KEYS.daily, JSON.stringify(state));
  if (firebase.isConfigured()) {
    firebase.syncDailyState(state).catch(() => {});
  }
}

export async function loadMarked(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEYS.marked);
  return raw ? JSON.parse(raw) : [];
}

export async function saveMarked(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.marked, JSON.stringify(ids));
}

export async function pullFromCloud(): Promise<boolean> {
  if (!firebase.isConfigured()) return false;
  try {
    const [cloudQuizzes, cloudProgress] = await Promise.all([
      firebase.fetchQuizzes(),
      firebase.fetchProgress(),
    ]);
    if (cloudQuizzes) {
      await AsyncStorage.setItem(KEYS.quizzes, JSON.stringify(cloudQuizzes));
    }
    if (cloudProgress) {
      await AsyncStorage.setItem(KEYS.progress, JSON.stringify(cloudProgress));
    }
    return true;
  } catch {
    return false;
  }
}
