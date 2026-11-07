const CACHE = 'taisce-v0.32';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './js/analytics.js',
  './js/auth.js',
  './js/backup.js',
  './js/blocks.js',
  './js/config.js',
  './js/dropbox.js',
  './js/editor.js',
  './js/errors.js',
  './js/format.js',
  './js/history.js',
  './js/images.js',
  './js/links.js',
  './js/markdown.js',
  './js/mock.js',
  './js/paste.js',
  './js/paths.js',
  './js/pdf.js',
  './js/recents.js',
  './js/save.js',
  './js/share.js',
  './js/templates.js',
  './js/theme-boot.js',
  './js/theme.js',
  './js/ui.js',
  './vendor/count.js',
  './vendor/fonts/caveat-600.woff2',
  './vendor/marked.esm.js',
  './vendor/purify.es.mjs',
  './docs/',
  './docs/index.html',
  './docs/privacy.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Network-first: notes must never be served stale. The cache is the offline
// fallback for the shell, never for file content.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, fresh.clone());
          if (request.mode === 'navigate') await cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = (await caches.match('./index.html')) || (await caches.match('./'));
          if (shell) return shell;
        }
        throw new Error('offline');
      }
    })(),
  );
});
