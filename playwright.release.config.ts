import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { validateProductionBaseUrl } from "./scripts/validate-production-base-url.mjs";

const target = validateProductionBaseUrl();
const isPublishedReadOnly =
  process.env.RELEASE_SMOKE_PUBLISHED_READ_ONLY === "1";
const candidateHost = process.env.RELEASE_SMOKE_CANDIDATE_HOST;
const candidateTlsPort = Number(process.env.RELEASE_SMOKE_CANDIDATE_TLS_PORT);
const isInternalCandidate =
  !isPublishedReadOnly &&
  process.env.RELEASE_SMOKE_INTERNAL_CANDIDATE === "1" &&
  target.protocol === "https:" &&
  Boolean(candidateHost) &&
  target.hostname === candidateHost &&
  Number.isInteger(candidateTlsPort) &&
  candidateTlsPort > 0;
if (
  !isInternalCandidate &&
  (target.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(target.hostname))
) {
  throw new Error("PRODUCTION_BASE_URL must be a public HTTPS deployment.");
}

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

const chromiumExecutable = findChromium();

export default defineConfig({
  testDir: "./tests/release",
  testMatch: isInternalCandidate
    ? ["managed-clerk-auth.spec.ts", "google-clerk-auth.spec.ts"]
    : ["published-auth-read-only.spec.ts"],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  reporter: "line",
  use: {
    baseURL: target.origin,
    ignoreHTTPSErrors: isInternalCandidate,
    // Native traces include cookies and request payloads. The smoke attaches a
    // bounded path-only browser trace instead.
    trace: "off",
    // Authenticated release pages must never be retained as screenshots.
    screenshot: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "managed-clerk-production",
      use: {
        ...devices["Desktop Chrome"],
        ...(
          chromiumExecutable || isInternalCandidate
            ? {
                launchOptions: {
                  ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
                  ...(isInternalCandidate
                    ? {
                        args: [
                          `--host-resolver-rules=MAP ${target.hostname}:443 127.0.0.1:${candidateTlsPort}`,
                        ],
                      }
                    : {}),
                },
              }
            : {}
        ),
      },
    },
  ],
});