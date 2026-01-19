/* Versioned cache. Bump CACHE_VERSION when you change files. */
const CACHE_VERSION = 'solitaire-v3';
const CORE = [
  './',
  './index.html?v=1',
  './style.css?v=1',
  './app.js?v=1',
  './manifest.webmanifest?v=1',
  './assets/mlb/mlb.json' // optional (will 404 if missing; that's fine)
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req, { ignoreSearch: false });
    if (cached) return cached;

    try{
      const fresh = await fetch(req);
      // Cache same-origin assets
      const url = new URL(req.url);
      if (url.origin === location.origin && fresh.ok){
        cache.put(req, fresh.clone());
      }
      return fresh;
    }catch(_e){
      // Offline fallback: try root
      return (await cache.match('./index.html?v=1')) || new Response('Offline', { status: 200 });
    }
  })());
});
