import { route, navigate } from "./router.js";
import { render as homeScreen } from "./screens/home.js";
import { render as quizScreen } from "./screens/quiz.js";
import { render as resultsScreen } from "./screens/results.js";
import { render as settingsScreen } from "./screens/settings.js";
import { render as myQuizzesScreen } from "./screens/my-quizzes.js";
import { render as quizModesScreen } from "./screens/quiz-modes.js";
import { render as dailyScreen } from "./screens/daily.js";
import { render as statsScreen } from "./screens/stats.js";
import { loadSettings } from "./store.js";
import { setAccount, signIn } from "./firebase-sync.js";

// Register screens
route("home", homeScreen);
route("quiz", quizScreen);
route("results", resultsScreen);
route("settings", settingsScreen);
route("my-quizzes", myQuizzesScreen);
route("quiz-modes", quizModesScreen);
route("daily", dailyScreen);
route("stats", statsScreen);
route("sync", settingsScreen);

// Boot
async function init() {
  // Restore account session
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

  // Register service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/Quiz-app/sw.js").catch(() => {});
  }

  // Navigate to initial screen
  const hash = location.hash.slice(1);
  navigate(hash || "home");
}

init();
