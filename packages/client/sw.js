/**
 * The game's service worker (registered by src/infrastructure/pwa/registerServiceWorker.js).
 * It makes the game installable (with app.webmanifest) and lets the last
 * version played open without a network, without ever keeping a player on an
 * old version:
 * - network first: while the server answers, every file comes from it (an
 *   unchanged file is a cheap 304, see the server's ETag), so a reload after a
 *   deploy always gets the new version;
 * - each file fetched is kept, and served only when the network fails;
 * - the API, the WebSocket and other sites are not its business.
 * A server error (502 during a deploy: nginx's maintenance page) goes through
 * as it is: only a network failure falls back to the copy.
 * Changing what it does: change CACHE too, so the old copies go.
 */

const CACHE = "magic8-offline-v1";

self.addEventListener("install", () => {
  // Nothing to prepare: the new worker takes over at once (it never serves stale files, so there is no version to protect).
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (isGameFile(event.request)) {
    event.respondWith(networkFirst(event));
  }
});

/** @param {Request} request */
function isGameFile(request) {
  if (request.method !== "GET" || request.headers.has("range")) {
    return false;
  }
  const url = new URL(request.url);
  return url.origin === self.location.origin && !url.pathname.startsWith("/api/") && url.pathname !== "/ws";
}

/** @param {FetchEvent} event */
async function networkFirst(event) {
  const { request } = event;
  try {
    const response = await fetch(request);
    // Only a success is kept (an opaque or failed answer is not ok).
    if (response.ok) {
      event.waitUntil(keep(request, response.clone()));
    }
    return response;
  } catch (error) {
    // Offline: the copy kept, and for a page the game's own (opened from the home screen with a query string, say).
    const cached = (await caches.match(request)) ?? (request.mode === "navigate" ? await caches.match("/") : undefined);
    if (cached === undefined) {
      throw error;
    }
    return cached;
  }
}

/**
 * Keeps the copy, unless the one kept is already this version of the file.
 * @param {Request} request
 * @param {Response} response
 */
async function keep(request, response) {
  const cache = await caches.open(CACHE);
  const tag = response.headers.get("etag");
  const kept = tag === null ? undefined : await cache.match(request);
  if (kept !== undefined && kept.headers.get("etag") === tag) {
    return;
  }
  await cache.put(request, response);
}
