// Service Worker：オンライン時は常に最新を取得し、オフライン時はキャッシュを使う。
// アプリを更新したら、ファイル一覧を変えたときだけ CACHE の番号を上げる。
const CACHE = 'pachi-memo-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/calc.js',
  './js/db.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(request, { cache: 'no-cache' }), NETWORK_TIMEOUT_MS);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const index = await cache.match('./index.html');
      if (index) return index;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});
