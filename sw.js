/* ============================================================
   LifeCre8 — Service Worker (sw.js) v1.0.1
   - Uses relative paths so it works when hosted from /assets/
   - App-shell caching only (no third-party embeds)
   ============================================================ */

const SW_VERSION = 'v1.0.1';
const SHELL_CACHE = `lifecre8-shell-${SW_VERSION}`;

// Use relative URLs: these resolve within the SW scope (e.g., /assets/)
const PRECACHE_URLS = [
  './',               // index.html (scope root)
  './index.html',
  './404.html',
  './manifest.json',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './css/style.css',
  './js/main.js'
];

const STATIC_EXTENSIONS = ['.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'];

const isSameOrigin = (url) => self.location.origin === url.origin;

function isHtml(req) {
  return req.mode === 'navigate' ||
         (req.headers.get('accept') || '').includes('text/html');
}
function isStaticAsset(url) {
  const p = url.pathname.toLowerCase();
  return STATIC_EXTENSIONS.some(ext => p.endsWith(ext));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('lifecre8-shell-') && k !== SHELL_CACHE)
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
    // inform page listeners (optional)
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED' }));
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // HTML → network-first
  if (isHtml(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match('./index.html');
      }
    })());
    return;
  }

  // Same-origin static assets → cache-first
  if (isSameOrigin(url) && isStaticAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  // Everything else: let the browser handle it
});
