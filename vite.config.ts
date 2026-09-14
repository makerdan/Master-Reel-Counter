import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

function isClerkBootstrapLoadError(error: Error): boolean {
  return /failed_to_load_clerk_js|Failed to load Clerk JS/i.test(
    `${error.name}: ${error.message}`,
  );
}

export default defineConfig({
  plugins: [
    react(),
    // ClerkFailed renders the user-facing recovery state for this expected
    // provider lifecycle failure. Do not cover it with the dev overlay, which
    // would block the retry control and turn a recoverable outage into a
    // runtime error screen.
    runtimeErrorOverlay({
      filter: (error) => !isClerkBootstrapLoadError(error),
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
