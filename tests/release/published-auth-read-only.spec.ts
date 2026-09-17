import { expect, test } from "@playwright/test";
import { CLERK_PROXY_PATH } from "../../shared/clerk-config";
import { resolveClerkEnvironmentPublishableKey } from "../../shared/clerk-config";

const requiredEnvironment = [
  "PRODUCTION_BASE_URL",
  "CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
] as const;

function requirePublishedEnvironment(): void {
  const missing = requiredEnvironment.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Published read-only Clerk verification is missing required environment variables: ${missing.join(", ")}`,
    );
  }
  if (process.env.RELEASE_SMOKE_INTERNAL_CANDIDATE === "1") {
    throw new Error("Published read-only Clerk verification cannot run in candidate mode");
  }
  if (process.env.RELEASE_SMOKE_PUBLISHED_READ_ONLY !== "1") {
    throw new Error("Published Clerk verification requires the read-only release wrapper");
  }
  for (const name of ["DATABASE_URL", "RELEASE_SMOKE_DATABASE_URL", "RELEASE_PUBLICATION_DATABASE_URL", "CLERK_SECRET_KEY"]) {
    if (process.env[name]) {
      throw new Error(`Published read-only Clerk verification refuses privileged ${name}`);
    }
  }
  resolveClerkEnvironmentPublishableKey({
    serverPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    clientPublishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY,
  });
}

test("published managed Clerk and Google boundaries are reachable without fixture writes", async ({
  page,
}) => {
  requirePublishedEnvironment();
  const baseURL = new URL(process.env.PRODUCTION_BASE_URL!).origin;
  const proxyResponses: number[] = [];

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === baseURL && url.pathname.startsWith(CLERK_PROXY_PATH)) {
      proxyResponses.push(response.status());
    }
  });

  const anonymousAuth = await page.request.get("/api/auth/user");
  expect(anonymousAuth.status()).toBe(401);

  await page.goto("/settings");
  await expect(page.getByTestId("button-login")).toBeVisible();
  await page.getByTestId("button-login").click();
  await expect(
    page.getByRole("button", { name: /google/i }),
    "Published Clerk sign-in must expose the configured Google provider",
  ).toBeVisible();
  expect(
    proxyResponses.some((status) => status >= 200 && status < 400),
    "Published Clerk browser traffic must pass through the live same-origin proxy",
  ).toBe(true);
});