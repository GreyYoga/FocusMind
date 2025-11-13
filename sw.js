const CACHE_NAME = 'secretary-v4'; // ОБЯЗАТЕЛЬНО МЕНЯЕМ ВЕРСИЮ
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 1. Установка SW
self.addEventListener('install', (e) => {
  // Эта строка заставляет новый SW активироваться немедленно, не ожидая закрытия вкладок
  self.skipWaiting(); 
  
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 2. Активация
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
    }).then(() => {
      // Эта строка заставляет SW начать контролировать все открытые вкладки СРАЗУ ЖЕ
      return self.clients.claim();
    })
  );
});

// 3. Перехват запросов
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});