const CACHE = "lerntrainer-v112";
// Relative Pfade – werden relativ zum SW-Standort aufgelöst (funktioniert unter / und /Quiz-app/)
const ASSETS = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/store.js",
  "js/utils.js",
  "js/quiz-engine.js",
  "js/variant-adaptive.js",
  "js/fsrs.js",
  "js/firebase-sync.js",
  "js/ai-service.js",
  "js/router.js",
  "js/screens/home.js",
  "js/screens/quiz.js",
  "js/screens/results.js",
  "js/screens/settings.js",
  "js/screens/my-quizzes.js",
  "js/screens/quiz-modes.js",
  "js/screens/daily.js",
  "js/screens/stats.js",
  "js/screens/editor.js",
  "js/screens/ai-generate.js",
  "js/screens/tutor.js",
  "js/screens/error-diary.js",
  "js/screens/marked.js",
  "js/screens/pomodoro.js",
  "js/screens/folders.js",
  "js/screens/cloze.js",
  "js/screens/games.js",
  "js/screens/tower-defense.js",
  "js/screens/quiz-battle.js",
  "js/screens/achievements.js",
  "js/screens/sr-dashboard.js",
  "js/screens/study.js",
  "js/screens/speed-quiz.js",
  "js/screens/millionaire.js",
  "js/screens/hangman.js",
  "js/screens/boss-fight.js",
  "js/screens/socratic.js",
  "js/screens/scaffold.js",
  "js/screens/deep-learn.js",
  "js/screens/shop.js",
  "js/screens/random-mode.js",
  "js/screens/formula-sheets.js",
  "js/screens/image-editor.js",
  "js/screens/math-solver.js",
  "js/screens/study-plan.js",
  "js/screens/mock-exam.js",
  "js/screens/trick-mode.js",
  "js/screens/subjects.js",
  "js/screens/subject-hub.js",
  "js/screens/study-plans.js",
  "js/screens/bulk-edit.js",
  "js/screens/onboarding.js",
  "js/screens/exercise-mode.js",
  "js/screens/math-tools.js",
  "js/screens/search.js",
  "js/shop-catalog.js",
  "js/math-keyboard.js",
  "js/editable-formula.js",
  "js/games-util.js",
  "js/blackout.js",
  "js/canvas-util.js",
  "js/diagram.js",
  "js/html-export.js",
  "manifest.json",
  "lib/katex/katex.min.css",
  "lib/katex/katex.min.js",
  "lib/katex/fonts/KaTeX_AMS-Regular.woff2",
  "lib/katex/fonts/KaTeX_Caligraphic-Regular.woff2",
  "lib/katex/fonts/KaTeX_Caligraphic-Bold.woff2",
  "lib/katex/fonts/KaTeX_Fraktur-Regular.woff2",
  "lib/katex/fonts/KaTeX_Fraktur-Bold.woff2",
  "lib/katex/fonts/KaTeX_Main-Regular.woff2",
  "lib/katex/fonts/KaTeX_Main-Bold.woff2",
  "lib/katex/fonts/KaTeX_Main-Italic.woff2",
  "lib/katex/fonts/KaTeX_Main-BoldItalic.woff2",
  "lib/katex/fonts/KaTeX_Math-Italic.woff2",
  "lib/katex/fonts/KaTeX_Math-BoldItalic.woff2",
  "lib/katex/fonts/KaTeX_SansSerif-Regular.woff2",
  "lib/katex/fonts/KaTeX_SansSerif-Bold.woff2",
  "lib/katex/fonts/KaTeX_SansSerif-Italic.woff2",
  "lib/katex/fonts/KaTeX_Script-Regular.woff2",
  "lib/katex/fonts/KaTeX_Size1-Regular.woff2",
  "lib/katex/fonts/KaTeX_Size2-Regular.woff2",
  "lib/katex/fonts/KaTeX_Size3-Regular.woff2",
  "lib/katex/fonts/KaTeX_Size4-Regular.woff2",
  "lib/katex/fonts/KaTeX_Typewriter-Regular.woff2",
];

self.addEventListener("install", (e) => {
  // addAll bricht ab, wenn EINE Datei fehlt – einzeln cachen ist robuster
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(ASSETS.map((a) => c.add(new Request(a, { cache: "reload" }))))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.href.includes("openrouter.ai") || url.href.includes("googleapis.com")) return;

  // Network-first for HTML navigations and code/styles, so a new deploy always
  // loads a consistent, fresh module graph when online (no stale-mix bugs).
  // Falls back to cache when offline.
  const isCode = e.request.mode === "navigate" || /\.(js|css|html|json)$/.test(url.pathname);
  if (isCode) {
    // Bypass the browser HTTP cache for code so a fresh deploy always wins
    // (GitHub Pages sets a ~10min max-age that otherwise serves stale modules).
    e.respondWith(
      fetch(e.request, { cache: "no-cache" })
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then(
            (cached) => cached || (e.request.mode === "navigate" ? caches.match("index.html") : undefined)
          )
        )
    );
    return;
  }

  // Cache-first for other static assets (icons, images, fonts).
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
    )
  );
});
