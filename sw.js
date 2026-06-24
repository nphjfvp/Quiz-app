const CACHE = "lerntrainer-v40";
// Relative Pfade – werden relativ zum SW-Standort aufgelöst (funktioniert unter / und /Quiz-app/)
const ASSETS = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/store.js",
  "js/utils.js",
  "js/quiz-engine.js",
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
  "js/games-util.js",
  "js/blackout.js",
  "manifest.json",
];

self.addEventListener("install", (e) => {
  // addAll bricht ab, wenn EINE Datei fehlt – einzeln cachen ist robuster
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(ASSETS.map((a) => c.add(a)))
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
    e.respondWith(
      fetch(e.request)
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
