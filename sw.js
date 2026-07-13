// sw.js (Versão v21)
const CACHE_NAME = 'classificapack-v21';

// Lista de todos os ficheiros ativos da arquitetura modular para guardar em cache
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
      // Guarda em cache os novos ficheiros
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          // Elimina as caches antigas (v20, v19, etc.) para libertar espaço e atualizar a aplicação
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Ignora o cache para chamadas de mapas em tempo real da Google
  if (e.request.url.includes('maps.googleapis') || e.request.url.includes('google')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      // Devolve o ficheiro guardado se estiver offline, ou vai buscar à rede se estiver online
      return cachedResponse || fetch(e.request);
    })
  );
});