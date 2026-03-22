const CACHE_NAME = "reel-counter-v1";
const API_CACHE_NAME = "reel-counter-api-v1";
const STATIC_ASSETS = [
  "/",
  "/favicon.png",
  "/manifest.json",
  "/icon-192.svg",
  "/icon-512.svg",
];

const CACHEABLE_SESSION_API = /^\/api\/sessions\/\d+($|\/entries$|\/photos$|\/pins$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== API_CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_API_CACHE") {
    caches.delete(API_CACHE_NAME);
  }
});

function isNavigationRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" && request.headers.get("accept")?.includes("text/html"))
  );
}

function isStaticAsset(url) {
  const u = new URL(url);
  const path = u.pathname;
  return (
    path.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|eot)$/) ||
    path.startsWith("/assets/") ||
    u.hostname === "fonts.googleapis.com" ||
    u.hostname === "fonts.gstatic.com"
  );
}

function isCacheableSessionApi(url) {
  const path = new URL(url).pathname;
  return CACHEABLE_SESSION_API.test(path);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match("/").then((r) => r || new Response("Offline", { status: 503 })))
    );
    return;
  }

  if (isStaticAsset(request.url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          }).catch(() => new Response("", { status: 503 }))
      )
    );
    return;
  }

  if (isCacheableSessionApi(request.url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) =>
              cached ||
              new Response('{"error":"offline"}', {
                status: 503,
                headers: { "Content-Type": "application/json" },
              })
          )
        )
    );
    return;
  }

  if (request.url.includes("/api/")) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response('{"error":"offline"}', {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }
});
