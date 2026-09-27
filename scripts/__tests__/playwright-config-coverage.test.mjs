import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("a package command cannot hide an untyped Playwright launch in nested helpers", () => {
  const helperScriptSources = {
    "scripts/browser-wrapper.mjs": `
      import { fileURLToPath } from "node:url";
      import { spawnSync } from "node:child_process";
      const launcher = new URL("./browser-launcher.mjs", import.meta.url);
      spawnSync(process.execPath, [fileURLToPath(launcher)]);
    `,
    "scripts/browser-launcher.mjs": `
      import { spawnSync } from "node:child_process";
      spawnSync("npx", ["playwright", "test"]);
    `,
  };
  const coverage = {
    packageJson: {
      scripts: {
        "test:hidden-browser": "node scripts/browser-wrapper.mjs",
      },
    },
    manifest: { tiers: {} },
    compilerProject: { include: ["playwright.config.ts"] },
    rootConfigFiles: ["playwright.config.ts"],
    helperScriptSources,
  };

  assert.throws(
    () => checkPlaywrightConfigCoverage(coverage),
    /browser package script 'test:hidden-browser' must run 'npm run typecheck' before launching browser validation/,
  );
  assert.doesNotThrow(() =>
    checkPlaywrightConfigCoverage({
      ...coverage,
      packageJson: {
        scripts: {
          "test:hidden-browser":
            "npm run typecheck && node scripts/browser-wrapper.mjs",
        },
      },
    }),
  );
});

test("Playwright configs passed by a helper are added to compiler coverage", () => {
  assert.throws(
    () =>
      checkPlaywrightConfigCoverage({
        packageJson: {
          scripts: {
            "test:hidden-config":
              "npm run typecheck && node scripts/browser-launcher.mjs",
          },
        },
        manifest: { tiers: {} },
        compilerProject: { include: ["playwright.config.ts"] },
        rootConfigFiles: ["playwright.config.ts", "playwright.hidden.config.ts"],
        helperScriptSources: {
          "scripts/browser-launcher.mjs": `
            import { spawnSync } from "node:child_process";
            spawnSync("npx", [
              "playwright",
              "test",
              "--config",
              "playwright.hidden.config.ts",
            ]);
          `,
        },
      }),
    /outside compiler coverage: playwright\.hidden\.config\.ts/,
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

test("browser package scripts must run typecheck before Playwright", () => {
  assert.throws(
    () =>
      checkPlaywrightConfigCoverage({
        packageJson: {
          scripts: {
            "test:new-browser": "npx playwright test --config playwright.config.ts",
          },
        },
        manifest: { tiers: {} },
        compilerProject: { include: ["playwright.config.ts"] },
        rootConfigFiles: ["playwright.config.ts"],
      }),
    /browser package script 'test:new-browser' must run 'npm run typecheck' before launching browser validation or use scripts\/run-typechecked-playwright\.mjs/,
  );
});

test("the shared Playwright runner typechecks before launching the browser CLI", () => {
  const runner = readFileSync(new URL("../run-typechecked-playwright.mjs", import.meta.url), "utf8");
  const typecheckCall = runner.indexOf('["run", "typecheck"]');
  const playwrightLaunch = runner.indexOf("@playwright/test/cli.js");
  assert.ok(typecheckCall >= 0, "runner must invoke npm run typecheck");
  assert.ok(playwrightLaunch > typecheckCall, "runner must not launch Playwright before typecheck");
});

test("browser validation tiers must run typecheck before their browser step", () => {
  assert.throws(
    () =>
      checkPlaywrightConfigCoverage({
        packageJson: { scripts: {} },
        manifest: {
          tiers: {
            "test-heavy": {
              steps: [
                {
                  name: "browser-tests",
                  kind: "test",
                  command: ["node", "scripts/run-browser-tests.mjs"],
                },
              ],
            },
          },
        },
        compilerProject: { include: ["playwright.config.ts"] },
        rootConfigFiles: ["playwright.config.ts"],
      }),
    /browser validation step 'browser-tests' in tier 'test-heavy' must follow a typecheck step/,
  );
});

test("documented browser commands use the compiler-gated package script", () => {
  const guide = readFileSync(new URL("../../docs/testing.md", import.meta.url), "utf8");
  assert.doesNotMatch(guide, /\bnpx\s+playwright\s+test\b/);
  assert.match(guide, /npm run test:e2e -- tests\/undo-redo\.spec\.ts/);
  assert.match(guide, /npm run test:e2e -- --grep "@undo"/);
  assert.match(guide, /npm run test:e2e -- --grep "@mobile"/);
});

test("standard recursive include patterns cover nested configs", () => {
  assert.doesNotThrow(() =>
    checkPlaywrightConfigCoverage({
      packageJson: {
        scripts: {
          "test:nested-browser":
            "npm run typecheck && playwright test --config tests/playwright.new.config.ts",
        },
      },
      manifest: { tiers: {} },
      compilerProject: { include: ["tests/**/*"] },
      rootConfigFiles: ["tests/playwright.new.config.ts"],
      existingFiles: ["tests/playwright.new.config.ts"],
    }),
  );
});