import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (import.meta.hot) {
  import.meta.hot.on("vite:beforeFullReload", () => {
    window.location.reload();
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_API_CACHE" });
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

createRoot(document.getElementById("root")!).render(<App />);
