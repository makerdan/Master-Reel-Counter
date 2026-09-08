import assert from "node:assert/strict";
import test from "node:test";
import { fillSecret } from "../../tests/support/secret-safe-actions.js";

test("secret fill failures do not retain the supplied value", async () => {
  const sentinel = "SENTINEL-PASSWORD-MUST-NOT-LEAK";
  const target = {
    async fill(value: string): Promise<void> {
      throw new Error(`Playwright timeout while filling ${value}`);
    },
  };

  await assert.rejects(
    fillSecret(target, sentinel, "Managed Clerk password field could not be completed"),
    (error: Error) => {
      const surfaced = `${error.message}\n${error.stack ?? ""}`;
      assert.equal(error.message, "Managed Clerk password field could not be completed");
      assert.equal(surfaced.includes(sentinel), false);
      return true;
    },
  );
});