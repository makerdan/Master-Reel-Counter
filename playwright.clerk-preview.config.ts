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

const previewOrigin = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : process.env.TEST_BASE_URL || "http://127.0.0.1:5000";
const chromiumExecutable = findChromium();

export default defineConfig({
  testDir: "./tests",
  testMatch: "clerk-*.spec.ts",
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