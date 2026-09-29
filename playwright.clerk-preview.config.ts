import { defineConfig } from "@playwright/test";
import { execSync } from "node:child_process";

function findChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    return execSync("which chromium", { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function localPreviewOrigin(): string {
  if (process.env.TEST_BASE_URL) return process.env.TEST_BASE_URL;
  const configuredPort = process.env.PORT;
  const port =
    configuredPort && /^\d+$/.test(configuredPort) ? Number(configuredPort) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Local Clerk preview testing requires PORT to be set to a valid port.");
  }
  return `http://127.0.0.1:${port}`;
}

const previewOrigin = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : localPreviewOrigin();
const chromiumExecutable = findChromium();

export default defineConfig({
  testDir: "./tests",
  // This command is bootstrap-only: fixture-backed sign-in tests run under
  // playwright.config.ts, whose global setup creates their disposable account.
  testMatch: ["clerk-bootstrap-recovery.spec.ts", "clerk-preview-bootstrap.spec.ts"],
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: previewOrigin,
    ...(chromiumExecutable
      ? { launchOptions: { executablePath: chromiumExecutable } }
      : {}),
  },
});