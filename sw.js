/**
 * sw.js
 * Versão v70.9 - Com Módulos 'rotas-geografia.js' e 'rotas-odometro.js' Registados
 * Faz: Controla a cache offline de todos os recursos ativos da aplicação.
 */

const CACHE_NAME = 'classificapack-v71';

const ASSETS = [
  './',
  'index.html',
  'config.js',
  'js/main.js',
  'js/state.js',
  'js/storage.js',
  'js/motoristas.js',
  'js/setores.js',
  'js/geografia-data.js',
  'js/geografia-mafra.js',
  'js/geografia-sintra.js',
  'js/voz.js',
  'js/triagem.js',
  'js/rotas.js',
  'js/rotas-geografia.js', // Módulo 1: Geografia
  'js/rotas-odometro.js',  // Módulo 2: Odómetro
  'js/maps.js',
  'js/pwa.js',
  'js/ui.js',
  'js/navigation.js',
  'js/ui-menu.js',
  'partials/triagem.html',
  'partials/motoristas.html',
  'partials/setores.html',
  'partials/rotas.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
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
            console.log('[Service Worker] A remover cache antiga obsoleta:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('maps.googleapis') || e.request.url.includes('google') || e.request.url.includes('firebase') || e.request.url.includes('firestore')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});