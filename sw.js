const CACHE = "minesweeper-v5";
const PREFIX = "minesweeper-";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./engine.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
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
