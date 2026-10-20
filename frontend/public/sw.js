// Cache only a public reconnect page. Never cache app HTML, API responses, tokens, or meeting content.
const CACHE = 'intellmeet-offline-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/offline.html')));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('intellmeet-offline-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    event.request.mode !== 'navigate' ||
    url.origin !== self.location.origin ||
    /^\/(api|health|socket\.io|webhooks)(\/|$)/.test(url.pathname)
  )
    return;
  event.respondWith(
    fetch(event.request).catch(
      async () => (await caches.match('/offline.html')) || Response.error(),
    ),
  );
});
