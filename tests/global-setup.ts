import { chromium } from "@playwright/test";
import { mkdir } from "fs/promises";

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

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/tester-login`);
  await page.fill('[data-testid="input-display-name"]', TESTER_NAME);
  await page.fill('[data-testid="input-tester-password"]', TESTER_PASSWORD);
  await page.click('[data-testid="button-tester-login"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 20_000 });

  await mkdir("tests/.auth", { recursive: true });
  await context.storageState({ path: "tests/.auth/user.json" });
  await browser.close();
}

export default globalSetup;
