import { route, navigate } from "./router.js";
import { render as homeScreen } from "./screens/home.js";
import { render as quizScreen } from "./screens/quiz.js";
import { render as resultsScreen } from "./screens/results.js";
import { render as settingsScreen } from "./screens/settings.js";
import { render as myQuizzesScreen } from "./screens/my-quizzes.js";
import { render as quizModesScreen } from "./screens/quiz-modes.js";
import { render as dailyScreen } from "./screens/daily.js";
import { render as statsScreen } from "./screens/stats.js";
import { render as editorScreen } from "./screens/editor.js";
import { render as aiGenerateScreen } from "./screens/ai-generate.js";
import { render as tutorScreen } from "./screens/tutor.js";
import { render as errorDiaryScreen } from "./screens/error-diary.js";
import { render as markedScreen } from "./screens/marked.js";
import { render as pomodoroScreen } from "./screens/pomodoro.js";
import { render as foldersScreen } from "./screens/folders.js";
import { render as clozeScreen } from "./screens/cloze.js";
import { loadSettings } from "./store.js";
import { setAccount } from "./firebase-sync.js";

route("home", homeScreen);
route("quiz", quizScreen);
route("results", resultsScreen);
route("settings", settingsScreen);
route("my-quizzes", myQuizzesScreen);
route("quiz-modes", quizModesScreen);
route("daily", dailyScreen);
route("stats", statsScreen);
route("sync", settingsScreen);
route("editor", editorScreen);
route("ai-generate", aiGenerateScreen);
route("tutor", tutorScreen);
route("error-diary", errorDiaryScreen);
route("marked", markedScreen);
route("pomodoro", pomodoroScreen);
route("folders", foldersScreen);
route("cloze", clozeScreen);
route("games", async (root) => { const m = await import("./screens/games.js"); return m.render(root); });
route("tower-defense", async (root) => { const m = await import("./screens/tower-defense.js"); return m.render(root); });
route("quiz-battle", async (root) => { const m = await import("./screens/quiz-battle.js"); return m.render(root); });

async function init() {
  const settings = await loadSettings();
  if (settings.accountEmail && settings.accountToken) {
    setAccount({
      email: settings.accountEmail,
      uid: settings.accountUid || "",
      idToken: settings.accountToken,
      refreshToken: settings.accountRefresh || "",
      expiresAt: settings.accountExpires || 0,
    });
  }

  if ("serviceWorker" in navigator) {
    // Relativer Pfad, damit der SW sowohl unter / als auch unter /Quiz-app/ lädt
    const swUrl = new URL("sw.js", document.baseURI).href;
    navigator.serviceWorker.register(swUrl).catch(() => {});
  }

  const hash = location.hash.slice(1);
  navigate(hash || "home");
}

init();
