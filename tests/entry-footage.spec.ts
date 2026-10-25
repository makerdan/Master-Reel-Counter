import { test, expect, createSessionViaApi } from "./fixtures";

test("entry validation retains nullable fields, footage edits and string conductors", async ({ page, request }) => {
  const session = await createSessionViaApi(request, `Validation compatibility ${Date.now()}`);
  const body = { aisle: "A", section: "1", footage: null, conductors: "3", reelTag: null, wireType: null, gauge: null, notes: null };
  const response = await request.post(`/api/sessions/${session.id}/entries`, { data: body });
  expect(response.ok(), await response.text()).toBe(true);
  const entry = await response.json();
  expect(entry).toMatchObject(body);
  const updated = await request.patch(`/api/entries/${entry.id}`, { data: { footage: 250, conductors: "4" } });
  expect(updated.ok(), await updated.text()).toBe(true);
  expect(await updated.json()).toMatchObject({ footage: 250, conductors: "4" });
  const invalid = await request.patch(`/api/entries/${entry.id}`, { data: { footage: "invalid" } });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).errors.footage.length).toBeGreaterThan(0);
  await page.goto(`/session/${session.id}`);
  const welcome = page.getByRole("dialog", { name: "Welcome to Master Reel Counter" });
  if (await welcome.isVisible()) await welcome.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Aisle A - Section 1, 1 entry, collapsed", exact: true }).click();
  await expect(page.locator(`[data-testid="row-entry-${entry.id}"]`)).toBeVisible();
});
