const CACHE = "lerntrainer-v4";
const ASSETS = [
  "/Quiz-app/",
  "/Quiz-app/index.html",
  "/Quiz-app/css/app.css",
  "/Quiz-app/js/app.js",
  "/Quiz-app/js/store.js",
  "/Quiz-app/js/quiz-engine.js",
  "/Quiz-app/js/firebase-sync.js",
  "/Quiz-app/js/ai-service.js",
  "/Quiz-app/js/router.js",
  "/Quiz-app/js/screens/home.js",
  "/Quiz-app/js/screens/quiz.js",
  "/Quiz-app/js/screens/results.js",
  "/Quiz-app/js/screens/settings.js",
  "/Quiz-app/js/screens/my-quizzes.js",
  "/Quiz-app/js/screens/quiz-modes.js",
  "/Quiz-app/js/screens/daily.js",
  "/Quiz-app/js/screens/stats.js",
  "/Quiz-app/js/screens/editor.js",
  "/Quiz-app/js/screens/ai-generate.js",
  "/Quiz-app/js/screens/tutor.js",
  "/Quiz-app/js/screens/error-diary.js",
  "/Quiz-app/js/screens/marked.js",
  "/Quiz-app/js/screens/pomodoro.js",
  "/Quiz-app/js/screens/folders.js",
  "/Quiz-app/manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
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
