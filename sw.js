// 9. sw.js
const CACHE_NAME = 'gbc-davao-v2';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './styles.css',
  './app.js',
  './admin.js',
  './davao-data.js',
  './firebase-config.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});