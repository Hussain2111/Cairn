// Service worker: makes the app usable offline once it has been loaded.
//
// Strategy is stale-while-revalidate for same-origin GETs. The cached copy
// answers immediately (so a plane, a tunnel or a dead wifi router is fine) and
// a fresh copy replaces it in the background. Bump CACHE_VERSION on release to
// evict the old shell.

const CACHE_VERSION = 'cairn-v2';

const SHELL = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.webmanifest',
  './styles/tokens.css',
  './styles/base.css',
  './styles/components.css',
  './src/app/main.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // A single failed asset must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: false });
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) return cached;
      const fresh = await network;
      if (fresh) return fresh;

      // Offline with nothing cached for this exact URL: fall back to the shell
      // so a deep link still opens the app rather than a browser error page.
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline and not cached.', { status: 503, headers: { 'content-type': 'text/plain' } });
    }),
  );
});
