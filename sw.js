/**
 * Service worker: makes the game installable and playable with no network.
 *
 * Everything the game needs is already local — three.js is vendored and every
 * texture is generated at runtime — so a complete precache is a few hundred
 * kilobytes and buys a genuinely offline game rather than a shell that then
 * fails to load its assets on a train.
 *
 * The list below and the cache name are written by tools/precache.mjs. The
 * cache name is a hash of the precached contents, so editing any asset changes
 * it and every installed copy updates; there is no version to remember to bump.
 * Run that script after changing any file the browser loads — the verification
 * suite fails if the list has drifted.
 */

/* GENERATED:BEGIN */
const CACHE = 'xm30-4eb9d6728573';
const ASSETS = [
  './',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './index.html',
  './inspect.html',
  './manifest.webmanifest',
  './src/config.js',
  './src/game/audio.js',
  './src/game/driving.js',
  './src/game/effects.js',
  './src/game/enemies.js',
  './src/game/graphics.js',
  './src/game/gunnery.js',
  './src/game/hud.js',
  './src/game/input.js',
  './src/game/mobile.js',
  './src/game/perception.js',
  './src/game/settings.js',
  './src/game/touch.js',
  './src/game/views.js',
  './src/inspect.js',
  './src/main.js',
  './src/model/figures.js',
  './src/model/geo.js',
  './src/model/hull.js',
  './src/model/materials.js',
  './src/model/running-gear.js',
  './src/model/turret.js',
  './src/model/vehicle-model.js',
  './src/spec/xm30.js',
  './src/world/buildings.js',
  './src/world/props.js',
  './src/world/world.js',
  './styles/hud.css',
  './vendor/three/three.core.min.js',
  './vendor/three/three.module.min.js',
];
/* GENERATED:END */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is atomic — one bad entry rejects the whole install, which is the
    // behaviour we want rather than a half-cached game that fails offline.
    await cache.addAll(ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE && key.startsWith('xm30-')) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations go to the network first so a deployed update is picked up as
  // soon as there is a connection, and fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./')) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Everything else is cache-first: these are hashed into the cache name, so a
  // hit is always the right version and going to the network would only cost
  // latency.
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      return Response.error();
    }
  })());
});

// Lets the page ask the waiting worker to take over immediately.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
