const CACHE_NAME = "reel-counter-v1";
const LEGACY_API_CACHE_PREFIX = "reel-counter-api-";
const STATIC_ASSETS = [
  "/",
  "/favicon.png",
  "/manifest.json",
  "/icon-192.svg",
  "/icon-512.svg",
];

function isProtectedRead(url) {
  const u = new URL(url);
  return (
    u.origin === self.location.origin &&
    (u.pathname.startsWith("/api/") ||
      u.pathname.startsWith("/uploads/") ||
      u.pathname.startsWith("/objects/"))
  );
}

function isOwnedStaticAsset(url) {
  const u = new URL(url);
  return (
    u.origin === self.location.origin &&
    (u.pathname.startsWith("/assets/") ||
      STATIC_ASSETS.includes(u.pathname))
  );
}

function hasExpectedAssetContentType(request, response) {
  const pathname = new URL(request.url).pathname;
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";

  if (pathname.endsWith(".js")) {
    return (
      contentType.includes("javascript") ||
      contentType.includes("ecmascript")
    );
  }
  if (pathname.endsWith(".css")) return contentType.includes("text/css");
  if (pathname.endsWith(".json")) return contentType.includes("json");
  if (pathname.endsWith(".svg")) return contentType.includes("image/svg+xml");
  if (pathname.match(/\.(png|jpg|jpeg|ico)$/)) {
    return contentType.startsWith("image/");
  }
  if (pathname.match(/\.(woff2?|ttf|eot)$/)) {
    return (
      contentType.startsWith("font/") ||
      contentType.includes("application/font") ||
      contentType.includes("application/vnd.ms-fontobject")
    );
  }
  return pathname === "/" && contentType.includes("text/html");
}

function canCacheAsset(request, response) {
  return (
    response.ok &&
    !isProtectedRead(request.url) &&
    isOwnedStaticAsset(request.url) &&
    hasExpectedAssetContentType(request, response)
  );
}

async function clearInvalidLegacyScripts() {
  const shellCache = await caches.open(CACHE_NAME);
  const requests = await shellCache.keys();
  await Promise.all(
    requests
      .filter((request) => new URL(request.url).pathname.endsWith(".js"))
      .map(async (request) => {
        const response = await shellCache.match(request);
        if (!response || !canCacheAsset(request, response)) {
          await shellCache.delete(request);
        }
      })
  );
}

async function clearProtectedCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(LEGACY_API_CACHE_PREFIX))
      .map((key) => caches.delete(key))
  );

  const shellCache = await caches.open(CACHE_NAME);
  const requests = await shellCache.keys();
  await Promise.all(
    requests
      .filter((request) => isProtectedRead(request.url))
      .map((request) => shellCache.delete(request))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && !k.startsWith(LEGACY_API_CACHE_PREFIX))
          .map((k) => caches.delete(k))
      );
      await clearProtectedCaches();
      await clearInvalidLegacyScripts();
      await self.clients.claim();
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_API_CACHE") {
    const cleanup = clearProtectedCaches();
    event.waitUntil(cleanup);
    if (event.ports[0]) {
      cleanup.then(
        () => event.ports[0].postMessage({ ok: true }),
        () => event.ports[0].postMessage({ ok: false })
      );
    }
  }
});

function isNavigationRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" && request.headers.get("accept")?.includes("text/html"))
  );
}

function cachePublicResponse(request, response) {
  if (!canCacheAsset(request, response)) return Promise.resolve();
  return caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(request, response))
    .catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  if (isProtectedRead(request.url)) {
    const path = new URL(request.url).pathname;
    const responsePromise = fetch(request, { cache: "no-store" });
    event.respondWith(
      responsePromise.catch(() =>
        path.startsWith("/api/")
          ? new Response('{"error":"offline"}', {
              status: 503,
              headers: { "Content-Type": "application/json" },
            })
          : new Response("", { status: 503 })
      )
    );
    return;
  }

  if (isNavigationRequest(request)) {
    const networkResponse = fetch(request).then((response) => ({
      response,
      cacheResponse: response.clone(),
    }));
    event.waitUntil(
      networkResponse.then(
        ({ cacheResponse }) => cachePublicResponse(request, cacheResponse),
        () => {},
      ),
    );
    event.respondWith(
      networkResponse
        .then(({ response }) => response)
        .catch(() => caches.match("/").then((r) => r || new Response("Offline", { status: 503 })))
    );
    return;
  }

  if (isOwnedStaticAsset(request.url)) {
    const responsePromise = caches.match(request).then((cached) => {
      if (cached) return { response: cached, cacheResponse: null };
      return fetch(request).then((response) => ({
        response,
        cacheResponse: response.clone(),
      }));
    });
    event.waitUntil(
      responsePromise.then(({ cacheResponse }) =>
        cacheResponse ? cachePublicResponse(request, cacheResponse) : undefined,
      ).catch(() => {}),
    );
    event.respondWith(
      responsePromise
        .then(({ response }) => response)
        .catch(() => new Response("", { status: 503 }))
    );
    return;
  }

});
