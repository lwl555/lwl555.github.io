/* 暖记 service worker —— 让网站（含 App 内 WebView）断网也能打开、离线记账 */
const CACHE = 'warmledger-v1';
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
  if (url.origin !== self.location.origin) return; // 只缓存本站，supabase 请求放行

  // 页面导航：网络优先，失败回退缓存（保证联网拿到最新、断网仍可用）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        var cp = r.clone();
        caches.open(CACHE).then(function (c) { c.put('index.html', cp); });
        return r;
      }).catch(function () { return caches.match('index.html'); })
    );
    return;
  }

  // 静态资源：缓存优先，后台回填网络
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (r) {
        var cp = r.clone();
        caches.open(CACHE).then(function (c) { c.put(req, cp); });
        return r;
      });
    })
  );
});
