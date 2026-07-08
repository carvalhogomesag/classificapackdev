// sw.js (Versão v16)
const CACHE_NAME = 'classificapack-v16';
const ASSETS = [
  '/',
  '/index.html',
  '/config.js',
  '/app.js',
  '/ui.js',
  '/storage.js',
  '/gestao.js',
  '/rotas.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Evitar caching de chamadas de API (como Google Maps ou geocodificação)
  if (e.request.url.includes('maps.googleapis') || e.request.url.includes('google')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});