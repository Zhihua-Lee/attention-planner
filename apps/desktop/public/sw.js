const CACHE_NAME = 'attention-planner-pwa-v6';
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon.png', '/logo.png'];
const STATIC_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'manifest', 'worker']);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// A cached HTML body under a script/style URL (an SPA fallback for a missing
// hashed chunk) would permanently break that page with "Importing a module
// script failed", so only successful non-HTML responses are cacheable.
function isCacheableAssetResponse(res) {
  if (!res || !res.ok) return false;
  const contentType = res.headers.get('content-type') || '';
  return !contentType.includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // OAuth responses contain one-time authorization material in the URL and
  // must be handled only by MSAL's dedicated, non-cacheable redirect bridge.
  if (url.pathname === '/redirect' || url.pathname === '/redirect.html') return;

  // Navigations go network-first so a redeploy is picked up on the next load;
  // the cached shell is only an offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone)).catch(() => undefined);
          }
          return res;
        })
        .catch(async () => {
          const fallback = (await caches.match('/index.html')) || (await caches.match('/'));
          return fallback || Response.error();
        }),
    );
    return;
  }

  // Only static assets are served from the cache. Everything else (API calls,
  // sync data on same-origin deployments) always goes to the network.
  const isStaticAsset = url.pathname.startsWith('/assets/')
    || STATIC_DESTINATIONS.has(req.destination)
    || PRECACHE_URLS.includes(url.pathname);
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        if (isCacheableAssetResponse(res)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => undefined);
        }
        return res;
      });
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = {};
  }
  const target = typeof payload?.data?.url === 'string' && payload.data.url.startsWith('/')
    ? payload.data.url
    : '/?view=now';
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Attention Planner', {
      badge: payload.badge || '/icon.png',
      body: payload.body || '你有一个到期提醒',
      data: { url: target },
      icon: payload.icon || '/icon.png',
      tag: payload.tag || 'attention-planner-reminder',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = typeof event.notification.data?.url === 'string'
    && event.notification.data.url.startsWith('/')
    ? event.notification.data.url
    : '/?view=now';
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(async (clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        if ('navigate' in existing) await existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
