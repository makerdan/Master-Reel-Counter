import { expect, test } from "@playwright/test";
import { parsePublishableKey } from "@clerk/shared/keys";
import { setupClerkTestingToken } from "@clerk/testing/playwright";

const expectedFrontendHost = parsePublishableKey(
  process.env.VITE_CLERK_PUBLISHABLE_KEY,
)?.frontendApi;

test("real preview loads Clerk JavaScript over valid HTTPS with bounded CSP", async ({
  browser,
  baseURL,
}) => {
  expect(expectedFrontendHost, "VITE_CLERK_PUBLISHABLE_KEY must be valid").toBeTruthy();
  expect(baseURL, "preview origin must be configured").toBeTruthy();

  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  if (process.env.CLERK_TESTING_TOKEN) {
    await setupClerkTestingToken({
      context,
      options: { frontendApiUrl: expectedFrontendHost },
    });
  }
  const page = await context.newPage();
  const scriptResponses: Array<{
    protocol: string;
    host: string;
    path: string;
    status: number;
    contentType: string;
  }> = [];
  const failures: string[] = [];
  const pageErrors: string[] = [];

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.endsWith("/dist/clerk.browser.js")) {
      scriptResponses.push({
        protocol: url.protocol,
        host: url.host,
        path: url.pathname,
        status: response.status(),
        contentType: response.headers()["content-type"] ?? "",
      });
    }
  });
  page.on("requestfailed", (request) => {
    failures.push(`${new URL(request.url()).pathname} ${request.failure()?.errorText}`);
  });
  page.on("pageerror", (error) => pageErrors.push(error.name));

  const documentResponse = await page.goto("/sign-in");
  expect(documentResponse?.status()).toBe(200);
  const policy = documentResponse?.headers()["content-security-policy"] ?? "";
  const scriptDirective = policy
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("script-src "));
  expect(scriptDirective).toBe(
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://frontend-api.clerk.dev https://*.clerk.accounts.dev https://challenges.cloudflare.com https://*.protect.clerk.com",
  );

  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & {
        Clerk?: { loaded?: boolean };
      }).Clerk?.loaded === true,
    undefined,
    { timeout: 30_000 },
  );
  const sessionState = await page.evaluate(() => {
    const clerk = (
      globalThis as typeof globalThis & {
        Clerk?: { loaded?: boolean; session?: unknown };
      }
    ).Clerk;
    return { loaded: clerk?.loaded === true, hasSession: Boolean(clerk?.session) };
  });

  expect(scriptResponses.length).toBeGreaterThanOrEqual(1);
  for (const response of scriptResponses) {
    expect(response.protocol).toBe("https:");
    expect(response.host).toBe(expectedFrontendHost);
  }
  const loadedScriptResponses = scriptResponses.filter(
    (response) => response.status === 200,
  );
  expect(loadedScriptResponses).toHaveLength(1);
  expect(loadedScriptResponses[0].path).toMatch(
    /^\/npm\/@clerk\/clerk-js@[^/]+\/dist\/clerk\.browser\.js$/,
  );
  expect(loadedScriptResponses[0].contentType).toMatch(
    /^(?:application|text)\/javascript\b/i,
  );
  expect(
    scriptResponses
      .filter((response) => response.status !== 200)
      .every((response) => [301, 302, 307, 308].includes(response.status)),
  ).toBe(true);
  expect(sessionState).toEqual({ loaded: true, hasSession: false });
  expect(failures).toEqual([]);
  expect(pageErrors).toEqual([]);
  await expect(page.getByRole("button", { name: /google/i })).toBeVisible();

  await context.close();
});