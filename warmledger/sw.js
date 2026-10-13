/* 暖记 service worker —— 让网站（含 App 内 WebView）断网也能打开、离线记账。
   策略：本站 GET 一律「网络优先」，成功即回填缓存；断网时回退缓存，保证离线可用且更新立即可见。 */
const CACHE = 'warmledger-v2';
const ASSETS = ['index.html', 'app.js', 'style.css'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ASSETS);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 只处理本站，supabase 请求放行

  e.respondWith(
    fetch(req).then(function (r) {
      var cp = r.clone();
      caches.open(CACHE).then(function (c) { c.put(req, cp); });
      return r;
    }).catch(function () { return caches.match(req); })
  );
});
