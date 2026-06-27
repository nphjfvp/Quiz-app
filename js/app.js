import { route, navigate, setScreenTab, handleTabClick } from "./router.js";
import { setLatexEnabled } from "./utils.js";
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

// ── Route registration ─────────────────────────────────────────────────
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
route("achievements", async (root) => { const m = await import("./screens/achievements.js"); return m.render(root); });
route("sr-dashboard", async (root) => { const m = await import("./screens/sr-dashboard.js"); return m.render(root); });
route("study", async (root, params) => { const m = await import("./screens/study.js"); return m.render(root, params); });
route("games", async (root) => { const m = await import("./screens/games.js"); return m.render(root); });
route("tower-defense", async (root) => { const m = await import("./screens/tower-defense.js"); return m.render(root); });
route("quiz-battle", async (root) => { const m = await import("./screens/quiz-battle.js"); return m.render(root); });
route("speed-quiz", async (root) => { const m = await import("./screens/speed-quiz.js"); return m.render(root); });
route("millionaire", async (root) => { const m = await import("./screens/millionaire.js"); return m.render(root); });
route("hangman", async (root) => { const m = await import("./screens/hangman.js"); return m.render(root); });
route("boss-fight", async (root) => { const m = await import("./screens/boss-fight.js"); return m.render(root); });
route("socratic", async (root, params) => { const m = await import("./screens/socratic.js"); return m.render(root, params); });
route("scaffold", async (root, params) => { const m = await import("./screens/scaffold.js"); return m.render(root, params); });
route("deep-learn", async (root, params) => { const m = await import("./screens/deep-learn.js"); return m.render(root, params); });
route("shop", async (root) => { const m = await import("./screens/shop.js"); return m.render(root); });

// ── Screen → Tab mapping ───────────────────────────────────────────────
// 🏠 Home
setScreenTab("home", "home");
setScreenTab("daily", "home");
setScreenTab("shop", "home");

// 📚 Lernen
setScreenTab("my-quizzes", "lernen");
setScreenTab("quiz-modes", "lernen");
setScreenTab("quiz", "lernen");
setScreenTab("results", "lernen");
setScreenTab("editor", "lernen");
setScreenTab("ai-generate", "lernen");
setScreenTab("folders", "lernen");
setScreenTab("sr-dashboard", "lernen");
setScreenTab("study", "lernen");
setScreenTab("cloze", "lernen");
setScreenTab("scaffold", "lernen");
setScreenTab("deep-learn", "lernen");
setScreenTab("socratic", "lernen");
setScreenTab("tutor", "lernen");
setScreenTab("marked", "lernen");

// 🎮 Games
setScreenTab("games", "games");
setScreenTab("tower-defense", "games");
setScreenTab("quiz-battle", "games");
setScreenTab("speed-quiz", "games");
setScreenTab("millionaire", "games");
setScreenTab("hangman", "games");
setScreenTab("boss-fight", "games");

// 📊 Stats
setScreenTab("stats", "stats");
setScreenTab("achievements", "stats");
setScreenTab("error-diary", "stats");

// ⚙️ Settings
setScreenTab("settings", "settings");
setScreenTab("sync", "settings");
setScreenTab("pomodoro", "settings");

async function init() {
  const settings = await loadSettings();

  // LaTeX toggle – once at boot so renderMath runs sync.
  setLatexEnabled(settings.latexEnabled ?? true);

  // Apply the player's chosen theme-skin accent (Shop) before first render.
  try {
    const { loadProfile } = await import("./store.js");
    const { applyThemeSkin } = await import("./shop-catalog.js");
    const profile = await loadProfile();
    applyThemeSkin(profile.equipped?.theme || "theme_default");
  } catch (_) { /* shop optional */ }

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

  // Wire tab bar
  const tabBar = document.getElementById("tab-bar");
  if (tabBar) {
    tabBar.querySelectorAll("button[data-tab]").forEach((b) =>
      b.addEventListener("click", () => handleTabClick(b.dataset.tab)));
  }

  const hash = location.hash.slice(1);
  navigate(hash || "home");
}

init();
