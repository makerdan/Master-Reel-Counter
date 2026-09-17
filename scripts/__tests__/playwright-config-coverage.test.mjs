import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPlaywrightConfigCoverage,
  loadPlaywrightConfigCoverage,
} from "../check-playwright-config-coverage.mjs";

test("all current Playwright configurations are compiler-covered", () => {
  assert.deepEqual(loadPlaywrightConfigCoverage(), [
    "playwright.clerk-preview.config.ts",
    "playwright.config.ts",
    "playwright.release.config.ts",
  ]);
});

test("a package script config cannot bypass compiler coverage", () => {
  assert.throws(
    () =>
      checkPlaywrightConfigCoverage({
        packageJson: {
          scripts: {
            "test:new-browser": "playwright test --config playwright.new.config.ts",
          },
        },
        manifest: { tiers: {} },
        compilerProject: { include: ["tests/**/*", "playwright.config.ts"] },
        rootConfigFiles: ["playwright.config.ts", "playwright.new.config.ts"],
      }),
    /outside compiler coverage: playwright\.new\.config\.ts/,
  );
});

test("a direct Playwright CLI package script config cannot bypass coverage", () => {
  assert.throws(
    () =>
      checkPlaywrightConfigCoverage({
        packageJson: {
          scripts: {
            "test:new-browser":
              "node node_modules/@playwright/test/cli.js test --config playwright.new.config.ts",
          },
        },
        manifest: { tiers: {} },
        compilerProject: { include: ["tests/**/*", "playwright.config.ts"] },
        rootConfigFiles: ["playwright.config.ts", "playwright.new.config.ts"],
      }),
    /outside compiler coverage: playwright\.new\.config\.ts/,
  );
});

test("a tier-invoked config cannot bypass compiler coverage", () => {
  assert.throws(
    () =>
      checkPlaywrightConfigCoverage({
        packageJson: { scripts: {} },
        manifest: {
          tiers: {
            "test-heavy": {
              steps: [
                {
                  command: ["node", "scripts/run-browser-tests.mjs", "--config", "playwright.new.config.ts"],
                },
              ],
            },
          },
        },
        compilerProject: { include: ["tests/**/*", "playwright.config.ts"] },
        rootConfigFiles: ["playwright.config.ts", "playwright.new.config.ts"],
      }),
    /outside compiler coverage: playwright\.new\.config\.ts/,
  );
});

test("standard recursive include patterns cover nested configs", () => {
  assert.doesNotThrow(() =>
    checkPlaywrightConfigCoverage({
      packageJson: {
        scripts: {
          "test:nested-browser": "playwright test --config tests/playwright.new.config.ts",
        },
      },
      manifest: { tiers: {} },
      compilerProject: { include: ["tests/**/*"] },
      rootConfigFiles: ["tests/playwright.new.config.ts"],
      existingFiles: ["tests/playwright.new.config.ts"],
    }),
  );
});