/**
 * sw.js
 * Faz: Controla o cache offline-first de todos os recursos estruturais da aplicação.
 *      Atualizado para a versão v60 para forçar a limpeza de caches antigas e descarregar 
 *      as novas correções de edição georreferenciada e CRUD autónomo de motoristas.
 */

const CACHE_NAME = 'classificapack-v60';

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
  'js/geografia-mafra.js',   // Cache offline-first
  'js/geografia-sintra.js',  // Cache offline-first
  'js/voz.js',
  'js/triagem.js',
  'js/rotas.js',
  'js/maps.js',
  'js/pwa.js',
  'js/ui.js',
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
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Ignora chamadas externas para recursos em nuvem que requerem rede ativa direta
  if (e.request.url.includes('maps.googleapis') || e.request.url.includes('google') || e.request.url.includes('firebase') || e.request.url.includes('firestore')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});