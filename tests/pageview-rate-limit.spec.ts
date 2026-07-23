/**
 * @feature security
 * Guards the rate limit on POST /api/track/pageview.
 * This public, unauthenticated endpoint writes a DB row on every call; without
 * a rate limit any external actor can flood it to bloat page_views and degrade
 * DB performance. The test fires 65 rapid-fire requests and asserts that at
 * least one is rejected with HTTP 429.
 */
import { test, expect } from "./fixtures";

test.describe("pageview rate limit @security", () => {
  test("POST /api/track/pageview returns 429 after threshold", async ({
    request,
  }) => {
    const BURST = 65;
    const responses = await Promise.all(
      Array.from({ length: BURST }, () =>
        request.post("/api/track/pageview", {
          data: { path: "/test-rate-limit" },
          headers: { "Content-Type": "application/json" },
          // Don't throw on non-2xx — we want to inspect every status code.
          failOnStatusCode: false,
        }),
      ),
    );

    const statuses = responses.map((r) => r.status());
    const has429 = statuses.some((s) => s === 429);

    expect(
      has429,
      `Expected at least one 429 from ${BURST} rapid requests. Got: ${JSON.stringify(statuses)}`,
    ).toBe(true);
  });
});
