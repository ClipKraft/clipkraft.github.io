// Offline shell cache. Bump VERSION when files change.
const VERSION = 'ck-v10';
const SHELL = ['./', 'index.html', 'app.html', 'admin.html', 'js/admin.js', 'css/style.css?v=1.3.4', 'js/config.js', 'js/brand.js', 'js/app.js?v=1.3.4', 'js/banner.js?v=1.3.4', 'js/ai.js', 'js/store.js', 'js/engine.js', 'js/exporter.js', 'js/free.js', 'js/tts-worker.js', 'settings.json', 'vendor/mp4-muxer.mjs', 'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Network first so updates show up; cache as offline fallback.
  // no-cache: always check the server for a newer file (ETag), so a normal refresh gets the latest build.
  const fresh = e.request.mode === 'navigate' ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(new Request(e.request, { cache: 'no-cache' }));
  e.respondWith(fresh.then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
