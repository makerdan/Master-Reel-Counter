import { expect, test } from "./fixtures";
import { clerk as clerkTesting } from "@clerk/testing/playwright";

test.describe("support help", () => {
  test("searchable help guide is available without hover-only controls", async ({ page }) => {
    await page.goto("/help");
    const search = page.getByTestId("input-help-search");
    await expect(search).toBeVisible();
    await search.fill("mobile");
    await expect(page.getByRole("heading", { name: "Capture with Mobile Flow" })).toBeVisible();
    await expect(search).toHaveAttribute("placeholder", /Search help|Search sessions/);
  });

  test("help chat renders a streamed answer in the Ask AI panel", async ({ page }) => {
    await page.route("**/api/help-chat", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'data: {"content":"Pins are placed from the Reel IDs tab."}',
          "",
          'data: {"done":true}',
          "",
        ].join("\n"),
      }),
    );

    await page.goto("/help");
    await page.getByTestId("input-help-chat").fill("How do I place pins?");
    await page.getByTestId("button-send-help-chat").click();

    await expect(page.getByTestId("chat-message-assistant-1")).toContainText(
      "Pins are placed from the Reel IDs tab.",
    );
  });

  test("help chat preserves the active identity transcript across navigation", async ({ page }) => {
    await page.route("**/api/help-chat", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'data: {"content":"This stays with the current identity."}',
          "",
          'data: {"done":true}',
          "",
        ].join("\n"),
      }),
    );

    await page.goto("/help");
    await page.getByTestId("input-help-chat").fill("Keep this for me");
    await page.getByTestId("button-send-help-chat").click();
    await expect(page.getByTestId("chat-message-assistant-1")).toContainText(
      "This stays with the current identity.",
    );

    await page.goto("/");
    await page.goto("/help");
    await expect(page.getByTestId("chat-message-user-0")).toContainText("Keep this for me");
    await expect(page.getByTestId("chat-message-assistant-1")).toContainText(
      "This stays with the current identity.",
    );
  });

  test("help chat trims oversized transcripts while restoring and streaming", async ({ page }) => {
    await page.route("**/api/help-chat", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'data: {"content":"The newest answer is retained."}',
          "",
          'data: {"done":true}',
          "",
        ].join("\n"),
      }),
    );

    await page.goto("/help");
    await page.getByTestId("input-help-chat").fill("Create a storage key");
    await page.getByTestId("button-send-help-chat").click();
    await expect(page.getByTestId("chat-message-assistant-1")).toContainText(
      "The newest answer is retained.",
    );

    const storageKey = await page.evaluate(() =>
      Object.keys(sessionStorage).find((key) => key.startsWith("help-chat-state-")),
    );
    expect(storageKey).toBeTruthy();

    const oversizedTranscript = Array.from({ length: 60 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: index % 2 === 0 ? `Older question ${index}` : `Older answer ${index}`,
    }));
    await page.evaluate(
      ({ key, transcript }) => sessionStorage.setItem(key!, JSON.stringify(transcript)),
      { key: storageKey, transcript: oversizedTranscript },
    );
    await page.reload();

    await expect(page.getByText("Older question 0")).not.toBeVisible();
    await expect(page.getByText("Older question 10")).toBeVisible();
    await expect(page.getByText("Older answer 59")).toBeVisible();
    await expect(page.locator('[data-testid^="chat-message-"]')).toHaveCount(50);

    await page.getByTestId("input-help-chat").fill("What is newest?");
    await page.getByTestId("button-send-help-chat").click();
    await expect(page.getByText("The newest answer is retained.")).toBeVisible();
    await expect(page.getByText("Older question 0")).not.toBeVisible();
    await expect(page.locator('[data-testid^="chat-message-"]')).toHaveCount(50);

    const persistedCount = await page.evaluate((key) => {
      const stored = sessionStorage.getItem(key!);
      return stored ? JSON.parse(stored).length : 0;
    }, storageKey);
    expect(persistedCount).toBe(50);
  });

  test("help chat does not expose one approved identity transcript to another", async ({
    page,
    secondApprovedIdentity,
  }) => {
    await page.route("**/api/help-chat", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'data: {"content":"Only the first identity should see this."}',
          "",
          'data: {"done":true}',
          "",
        ].join("\n"),
      }),
    );

    await page.goto("/help");
    await page.getByTestId("input-help-chat").fill("Private first identity question");
    await page.getByTestId("button-send-help-chat").click();
    await expect(page.getByTestId("chat-message-user-0")).toContainText(
      "Private first identity question",
    );

    await clerkTesting.signOut({ page });
    await page.goto("/sign-in");
    await clerkTesting.signIn({
      page,
      emailAddress: secondApprovedIdentity.email,
    });
    await page.goto("/help");

    await expect(page.getByTestId("input-help-chat")).toBeVisible();
    await expect(page.getByText("Private first identity question")).not.toBeVisible();
    await expect(page.getByText("Only the first identity should see this.")).not.toBeVisible();
  });

  test("help chat shows a recovery message when the route returns an error", async ({ page }) => {
    await page.route("**/api/help-chat", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Failed to get response" }),
      }),
    );

    await page.goto("/help");
    await page.getByTestId("input-help-chat").fill("Will this fail?");
    await page.getByTestId("button-send-help-chat").click();

    await expect(page.getByTestId("chat-message-assistant-1")).toContainText(
      "Sorry, I couldn't get a response. Please try again.",
    );
  });
});