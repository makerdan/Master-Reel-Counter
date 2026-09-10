import { createSessionViaApi, expect, test } from "./fixtures";

let createdSessionId: number;

test.describe.serial("E2E session fixture cleanup", () => {
  test("tracks every session created through the shared helper", async ({ request }) => {
    const session = await createSessionViaApi(
      request,
      `Fixture Cleanup Guard ${Date.now()}`,
    );
    createdSessionId = session.id;

    const response = await request.get(`/api/sessions/${createdSessionId}`);
    expect(response.ok()).toBe(true);
  });

  test("permanently removes the prior test's tracked session", async ({ request }) => {
    const response = await request.get(`/api/sessions/${createdSessionId}`);
    expect(response.status()).toBe(404);
  });
});