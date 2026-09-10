import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (import.meta.hot) {
  import.meta.hot.on("vite:beforeFullReload", () => {
    window.location.reload();
  });
}

if ("serviceWorker" in navigator) {
  // Also perform the cleanup from the page context. A direct logout redirect
  // may reach this document while the worker is updating or before it claims
  // the page, so relying on a worker message alone can leave legacy protected
  // CacheStorage entries behind.
  void caches.keys().then(async (keys) => {
    await Promise.all(
      keys
        .filter((key) => key.startsWith("reel-counter-api-"))
        .map((key) => caches.delete(key)),
    );
    const shellCache = await caches.open("reel-counter-v1");
    const protectedRequests = (await shellCache.keys()).filter((request) => {
      const url = new URL(request.url);
      return (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/uploads/") ||
        url.pathname.startsWith("/objects/")
      );
    });
    await Promise.all(protectedRequests.map((request) => shellCache.delete(request)));
  }).catch(() => {});
  navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_API_CACHE" });
  // A direct logout redirect can reload the app before the newly active
  // worker is exposed as navigator.serviceWorker.controller. Send the same
  // cleanup after ready so protected caches cannot survive that transition.
  navigator.serviceWorker.ready
    .then((registration) => {
      registration.active?.postMessage({ type: "CLEAR_API_CACHE" });
    })
    .catch(() => {});
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

createRoot(document.getElementById("root")!).render(<App />);
