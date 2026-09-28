import { defineConfig, devices } from "@playwright/test";
import { getBrowserProjectCoverage } from "./scripts/lib/browser-project-coverage.mjs";

const configuredPort = process.env.PORT;
const TEST_PORT =
  configuredPort && /^\d+$/.test(configuredPort) ? Number(configuredPort) : Number.NaN;
if (!Number.isInteger(TEST_PORT) || TEST_PORT < 1 || TEST_PORT > 65535) {
  throw new Error("Playwright requires PORT to be set to an integer from 1 to 65535.");
}
const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${TEST_PORT}`;

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
const { webkitEnabled } = getBrowserProjectCoverage(process.env);
export default defineConfig({
  testDir: "./tests",
  testIgnore: ["release/**"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // Playwright clears outputDir at startup; keep it apart from earlier step reports.
  outputDir: "test-results/playwright-artifacts",
  reporter: [
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/failure-gate/playwright.json" }],
  ],
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    storageState: "tests/.auth/user.json",
    extraHTTPHeaders: {
      "x-replit-e2e": "1",
    },
    trace: "on-first-retry",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      grepInvert: /@mobile-image-orientation/,
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
    {
      name: "mobile-chromium",
      grep: /@mobile-image-orientation/,
      use: {
        ...devices["Pixel 5"],
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
    ...(webkitEnabled
      ? [{
          name: "mobile-webkit",
          grep: /@mobile-image-orientation/,
          use: {
            ...devices["iPhone 13"],
          },
        }]
      : []),
  ],
  webServer: {
    command: "npm run dev",
    url: `${BASE_URL}/api/healthz`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
