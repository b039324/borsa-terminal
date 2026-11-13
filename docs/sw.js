// Servis çalışanı: uygulama kabuğunu önbelleğe alır (hızlı açılış, çevrimdışı iskelet).
// Veri istekleri (Worker, başka köken) asla önbelleğe alınmaz: fiyatlar ve portföy her zaman canlı gelir.
const VERSION = 'borsa-v2';
const SHELL = ['./', 'index.html', 'css/style.css', 'css/mobile.css', 'js/app.js', 'js/api.js', 'js/config.js', 'js/util.js', 'js/charts.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Worker/Yahoo istekleri doğrudan ağa
  // önce ağ, olmazsa önbellek: güncelleme yayınlanınca kullanıcı eski sürümde takılı kalmaz
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
  );
});
