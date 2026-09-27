#!/usr/bin/env node
/**
 * Keep executable TypeScript Playwright configurations inside compiler coverage.
 *
 * Package scripts and validation tiers are executable contract surfaces. A new
 * Playwright config added to either surface must be added to the Playwright
 * compiler project at the same time.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function shellCommand(command) {
  return Array.isArray(command) ? command.join(" ") : command;
}

function configFromPlaywrightCommand(command) {
  const normalizedCommand = shellCommand(command);
  const launchesPlaywright =
    /\b(?:npx\s+)?playwright\s+test\b/.test(normalizedCommand) ||
    /(?:^|\s)(?:node\s+)?\S*node_modules\/@playwright\/test\/cli\.js\s+test\b/.test(
      normalizedCommand,
    ) ||
    /(?:^|\s)(?:node\s+)?(?:\.\/)?scripts\/run-typechecked-playwright\.mjs(?:\s|$)/.test(
      normalizedCommand,
    ) ||
    /(?:^|\s)(?:node\s+)?(?:\.\/)?scripts\/run-browser-tests\.mjs(?:\s|$)/.test(
      normalizedCommand,
    );

  if (!launchesPlaywright) return [];

  const explicitConfig = normalizedCommand.match(
    /(?:^|\s)--config(?:=|\s+)(["']?)([^"' \t]+)\1/,
  )?.[2];
  return [normalizePath(explicitConfig || "playwright.config.ts")];
}

function browserValidationCommandIndex(command) {
  const normalizedCommand = shellCommand(command);
  const matches = [
    /\b(?:npx\s+)?playwright\s+test\b/,
    /(?:^|\s)(?:node\s+)?\S*node_modules\/@playwright\/test\/cli\.js\s+test\b/,
    /(?:^|\s)(?:node\s+)?(?:\.\/)?scripts\/run-typechecked-playwright\.mjs(?:\s|$)/,
    /(?:^|\s)(?:node\s+)?(?:\.\/)?scripts\/run-browser-tests\.mjs(?:\s|$)/,
    /(?:^|\s)(?:node\s+)?(?:\.\/)?scripts\/verify-published-release\.mjs(?:\s|$)/,
  ]
    .map((pattern) => pattern.exec(normalizedCommand)?.index)
    .filter((index) => index !== undefined);
  return matches.length > 0 ? Math.min(...matches) : -1;
}

function assertBrowserTypecheckPrerequisites({ packageJson, manifest }) {
  for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
    const normalizedCommand = shellCommand(command);
    const browserIndex = browserValidationCommandIndex(normalizedCommand);
    if (browserIndex < 0) continue;
    if (/scripts\/run-typechecked-playwright\.mjs(?:\s|$)/.test(normalizedCommand)) {
      continue;
    }

    const typecheckIndex = normalizedCommand.indexOf("npm run typecheck");
    if (
      typecheckIndex < 0 ||
      typecheckIndex > browserIndex ||
      !normalizedCommand.slice(typecheckIndex, browserIndex).includes("&&")
    ) {
      throw new Error(
        `browser package script '${scriptName}' must run 'npm run typecheck' before launching browser validation or use scripts/run-typechecked-playwright.mjs`,
      );
    }
  }

  for (const [tierName, tier] of Object.entries(manifest.tiers ?? {})) {
    let typecheckPassedInTier = false;
    for (const step of tier.steps ?? []) {
      const command = shellCommand(step.command);
      if (step.kind === "typecheck" || /\bnpm\s+run\s+typecheck\b/.test(command)) {
        typecheckPassedInTier = true;
      }
      if (browserValidationCommandIndex(command) >= 0 && !typecheckPassedInTier) {
        throw new Error(
          `browser validation step '${step.name}' in tier '${tierName}' must follow a typecheck step`,
        );
      }
    }
  }
}

function referencedPackageScripts(command) {
  const names = [];
  const pattern = /\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g;
  for (const match of shellCommand(command).matchAll(pattern)) {
    names.push(match[1]);
  }
  return names;
}

function discoverExecutableConfigs({ packageJson, manifest, rootConfigFiles }) {
  const configs = new Set(
    rootConfigFiles
      .filter((name) => /^playwright(?:\.[^.]+)?\.config\.ts$/.test(name))
      .map(normalizePath),
  );
  const visitedScripts = new Set();

  function inspectCommand(command) {
    for (const config of configFromPlaywrightCommand(command)) configs.add(config);
    for (const scriptName of referencedPackageScripts(command)) {
      inspectPackageScript(scriptName);
    }
  }

  function inspectPackageScript(scriptName) {
    if (visitedScripts.has(scriptName)) return;
    visitedScripts.add(scriptName);
    const command = packageJson.scripts?.[scriptName];
    if (command) inspectCommand(command);
  }

  for (const command of Object.values(packageJson.scripts ?? {})) inspectCommand(command);
  for (const tier of Object.values(manifest.tiers ?? {})) {
    for (const step of tier.steps ?? []) inspectCommand(step.command);
  }

  return [...configs].sort();
}

function globToRegExp(pattern) {
  const normalizedPattern = normalizePath(pattern);
  let expression = "^";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    if (character === "*" && normalizedPattern[index + 1] === "*") {
      if (normalizedPattern[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

function compilerIncludesPath(configPath, includePatterns) {
  return includePatterns.some((pattern) => globToRegExp(pattern).test(configPath));
}

export function checkPlaywrightConfigCoverage({
  packageJson,
  manifest,
  compilerProject,
  rootConfigFiles,
  existingFiles = rootConfigFiles,
}) {
  const configs = discoverExecutableConfigs({ packageJson, manifest, rootConfigFiles });
  const existing = new Set(existingFiles.map(normalizePath));
  const includePatterns = compilerProject.include ?? [];
  const missingFiles = configs.filter((config) => !existing.has(config));
  const uncovered = configs.filter(
    (config) => existing.has(config) && !compilerIncludesPath(config, includePatterns),
  );

  if (missingFiles.length > 0) {
    throw new Error(`missing Playwright configuration file(s): ${missingFiles.join(", ")}`);
  }
  if (uncovered.length > 0) {
    throw new Error(
      `Playwright configuration file(s) are outside compiler coverage: ${uncovered.join(", ")}`,
    );
  }

  assertBrowserTypecheckPrerequisites({ packageJson, manifest });

  return configs;
}

export function loadPlaywrightConfigCoverage(rootDirectory = root) {
  const packageJson = JSON.parse(readFileSync(resolve(rootDirectory, "package.json"), "utf8"));
  const manifest = JSON.parse(
    readFileSync(resolve(rootDirectory, "docs/validation/manifest.json"), "utf8"),
  );
  const compilerProject = JSON.parse(
    readFileSync(resolve(rootDirectory, "tsconfig.playwright.json"), "utf8"),
  );
  const rootConfigFiles = readdirSync(rootDirectory);

  return checkPlaywrightConfigCoverage({
    packageJson,
    manifest,
    compilerProject,
    rootConfigFiles,
    existingFiles: rootConfigFiles,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const configs = loadPlaywrightConfigCoverage();
    console.log(
      `[playwright-config] PASS: ${configs.length} executable TypeScript configuration(s) are compiler-covered.`,
    );
  } catch (error) {
    console.error(`[playwright-config] FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}