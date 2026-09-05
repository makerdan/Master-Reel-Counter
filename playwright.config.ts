import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";

// In NixOS/Replit the bundled Playwright browser may not be available; fall
// back to the system Chromium installed via Nix if the env var is not already
// set.  The Nix store path may change between builds so we resolve it at
// runtime via `which chromium`.
import { execSync } from "child_process";
function findChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    return execSync("which chromium", { encoding: "utf-8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}
const chromiumExecutable = findChromium();

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  globalSetup: "./tests/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    storageState: "tests/.auth/user.json",
    trace: "on-first-retry",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
  ],
  webServer: {
    command: "node scripts/free-ports.mjs 5000 && npm run dev",
    url: `${BASE_URL}/api/healthz`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
