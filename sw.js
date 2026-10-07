'use strict';
const BUILD_VERSION = 'r6-css28-fix23-p53';
const CACHE_PREFIX = 'bleach-soul-clash-shell-';
const CACHE_NAME = CACHE_PREFIX + BUILD_VERSION;
const ROOT = new URL('./', self.location.href);
const INDEX = new URL('index.html', ROOT).href;
const localFiles = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
async function matchesBuild(response) {
  if (!response.ok) return false;
  const copy = response.clone(), reader = copy.body?.getReader();
  const marker = "const BUILD_VERSION = '" + BUILD_VERSION + "';";
  if (!reader) return (await copy.text()).slice(0, 16384).includes(marker);
  const decoder = new TextDecoder();let prefix = '';
  try {
    while (prefix.length < 16384) {
      const {done, value} = await reader.read();
      if (done) break;
      prefix += decoder.decode(value.subarray(0, 16384 - prefix.length), {stream: true});
      if (prefix.includes(marker)) return true;
    }
    return false;
  } finally {
    // Do not wait for cancellation of a tee while the original response is unread.
    void reader.cancel().catch(() => {});
  }
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(INDEX, {cache: 'no-store'});
    if (!await matchesBuild(response)) throw new Error('Build and offline cache versions differ');
    const cache = await caches.open(CACHE_NAME);
    await cache.put(INDEX, response);
    await Promise.all(localFiles.map(async file => {
      const url = new URL(file, ROOT).href;
      const asset = await fetch(url, {cache: 'no-store'});
      if (asset.ok) await cache.put(url, asset);
    }));
    // Do not call skipWaiting: finish existing games before activating an update.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin) return;
  const shell = url.pathname === ROOT.pathname || url.pathname === new URL(INDEX).pathname;
  if (shell) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request, {cache: 'no-cache'});
        if (!response.ok) throw new Error('Offline shell HTTP ' + response.status);
        // An older worker can serve the new online HTML, but must not overwrite
        // its own offline snapshot with a different build.
        if (await matchesBuild(response)) await cache.put(INDEX, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(INDEX);
        if (cached) return cached;
        throw error;
      }
    })());
  } else if (localFiles.some(file => url.pathname === new URL(file, ROOT).pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(url.href);
      return cached || fetch(event.request);
    })());
  }
  // Room signalling, game actions and third-party requests are never cached.
});
