const CACHE = "minesweeper-v9";
const PREFIX = "minesweeper-";
const ASSETS = [
  "./",
  "./index.html",
  "./assets/style.css",
  "./src/app.js",
  "./src/board-view.js",
  "./src/engine.js",
  "./src/restart-guard.js",
  "./src/solver.js",
  "./src/generator.js",
  "./src/generator-worker.js",
  "./src/generation-client.js",
  "./src/service-worker.js",
  "./sw.js",
  "./manifest.webmanifest",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(new URL("./", self.location).pathname)
  )
    return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try {
        return await fetch(event.request);
      } catch (error) {
        if (event.request.mode === "navigate")
          return cache.match("./index.html");
        throw error;
      }
    }),
  );
});
