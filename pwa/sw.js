const CACHE = "lerntrainer-v20";
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
  if (e.request.url.includes("openrouter.ai") || e.request.url.includes("googleapis.com")) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
