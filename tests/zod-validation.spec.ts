import { test, expect, createSessionViaApi } from "./fixtures";

test("Zod session validation returns structured 400 issues @zod-security", async ({ request }) => {
  const session = await createSessionViaApi(request, "Zod structured validation guard");
  const response = await request.patch(`/api/sessions/${session.id}`, {
    data: { name: 42 },
  });
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.message).toBe("Invalid request body");
  expect(Array.isArray(body.errors)).toBe(true);
  expect(body.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: ["name"], message: expect.any(String) }),
  ]));
});
