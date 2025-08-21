const CACHE_NAME = 'field-app-cache-v2';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './libs/ol.js',
  './libs/ol.css',
  './libs/proj4.js',
  './libs/dexie.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
