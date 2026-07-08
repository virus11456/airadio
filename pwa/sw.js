// Minimal service worker — shell cache only. Audio is streamed from server,
// not cached here (size + freshness).
const CACHE = 'claudio-shell-v44';
const SHELL = ['/', '/index.html', '/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only handle same-origin GET. Bypass /api, /stream, /audio (live data).
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/stream') || url.pathname.startsWith('/audio')) return;

  // Shell = NETWORK-FIRST. Cache-first kept serving stale UI for days after
  // deploys (users had to double-refresh or re-install). Fresh shell when
  // online, cached shell only as the offline fallback.
  const isShell = e.request.mode === 'navigate' || SHELL.includes(url.pathname);
  if (isShell) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Immutable-ish assets (covers, icons): cache-first is correct.
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        // Cache successes only. Caching a 404 (cover not generated yet)
        // froze that miss forever — the real art never showed up.
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached)
    )
  );
});
