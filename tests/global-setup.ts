import { chromium } from "@playwright/test";
import { mkdir } from "fs/promises";
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

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";
export const TESTER_PASSWORD =
  process.env.TEST_TESTER_PASSWORD || "playwright-test-pw-1234";
export const TESTER_NAME = "PlaywrightBot";

async function waitForServer(url: string, maxMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server at ${url} did not become ready within ${maxMs}ms`);
}

async function globalSetup() {
  await waitForServer(BASE_URL);

  const seedRes = await fetch(`${BASE_URL}/api/__test__/seed-tester-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: TESTER_PASSWORD }),
  });
  if (!seedRes.ok) {
    const text = await seedRes.text();
    throw new Error(
      `Failed to seed tester password (${seedRes.status}): ${text}`,
    );
  }

  const chromiumExecutable = findChromium();
  const browser = await chromium.launch(
    chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
  );
  const context = await browser.newContext();
  const page = await context.newPage();

  // Log in as the real owner via a test-only endpoint so all e2e tests run
  // with full owner permissions (create, delete, trash sessions, etc.).
  const loginRes = await context.request.post(`${BASE_URL}/api/__test__/owner-login`);
  if (!loginRes.ok()) {
    const text = await loginRes.text();
    throw new Error(`Failed to owner-login (${loginRes.status()}): ${text}`);
  }
  await page.goto(`${BASE_URL}/`);
  await page.waitForURL(`${BASE_URL}/`, { timeout: 20_000 });

  await mkdir("tests/.auth", { recursive: true });
  await context.storageState({ path: "tests/.auth/user.json" });
  await browser.close();
}

export default globalSetup;
