#!/usr/bin/env node
/**
 * Keep executable TypeScript Playwright configurations inside compiler coverage.
 *
 * Package scripts, referenced helpers, and validation tiers are executable
 * contract surfaces. A new Playwright config added to any surface must be
 * added to the Playwright compiler project at the same time.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

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

function directBrowserValidationCommandIndex(command) {
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

function referencedPackageScriptEntries(command) {
  return [...shellCommand(command).matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)].map(
    (match) => ({ name: match[1], index: match.index }),
  );
}

function referencedPackageScripts(command) {
  return referencedPackageScriptEntries(command).map(({ name }) => name);
}

function localScriptReferences(text, parentScriptPath, rootDirectory, sourceCode = false) {
  const pattern =
    /(?<![\w@.-])((?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:mjs|cjs|js|tsx?|sh))(?=$|[\s"'`,;)\]])/g;
  const references = [];
  for (const match of text.matchAll(pattern)) {
    const reference = match[1].replaceAll("\\", "/");
    if (
      reference.includes("node_modules/") ||
      reference.includes("/__tests__/") ||
      reference.includes("/tests/") ||
      /(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/.test(reference) ||
      /(?:^|\/)playwright(?:\.[^.]+)?\.config\.ts$/.test(reference)
    ) {
      continue;
    }
    if (sourceCode) {
      const preceding = text.slice(Math.max(0, match.index - 500), match.index);
      const currentLine = preceding.slice(preceding.lastIndexOf("\n") + 1);
      const statementStart = text.lastIndexOf(";", match.index) + 1;
      const statement = text.slice(statementStart, match.index);
      const imported =
        /\b(?:from\s*|import\s*\(|import\s+|require\s*\()\s*["'`]?$/.test(currentLine);
      const shellCommand =
        parentScriptPath?.endsWith(".sh") &&
        /\b(?:node|bash|sh)\s+$/.test(currentLine);
      const passedToLauncher =
        /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|runOwnedProcessGroup|resolve|new\s+URL)\s*\([\s\S]*$/.test(
          statement,
        );
      if (!imported && !shellCommand && !passedToLauncher) continue;
    }

    const relativeTo = reference.startsWith("./") || reference.startsWith("../")
      ? parentScriptPath
        ? dirname(parentScriptPath)
        : "."
      : ".";
    const absolutePath = resolve(rootDirectory, relativeTo, reference);
    const scriptPath = normalizePath(relative(rootDirectory, absolutePath));
    if (scriptPath === ".." || scriptPath.startsWith("../")) continue;
    references.push({ path: scriptPath, index: match.index });
  }
  return references;
}

function browserConfigsFromHelperSource(source, scriptPath) {
  if (scriptPath.endsWith(".sh")) {
    return configFromPlaywrightCommand(source);
  }

  const startsChildProcess =
    /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|runOwnedProcessGroup)\s*\(/.test(
      source,
    );
  const launchesPlaywrightCli =
    /@playwright\/test\/cli\.js/.test(source) ||
    /["'`]playwright["'`]\s*,\s*["'`]test["'`]/.test(source) ||
    /\b(?:npx\s+)?playwright\s+test\b/.test(source);
  if (!startsChildProcess || !launchesPlaywrightCli) return [];

  const configs = new Set(
    [...source.matchAll(/(?:\.{0,2}\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.config\.ts/g)]
      .map((match) => normalizePath(match[0])),
  );
  return configs.size > 0 ? [...configs] : ["playwright.config.ts"];
}

function loadReferencedHelperSources({
  packageJson,
  manifest,
  rootDirectory,
  providedSources = {},
}) {
  const sources = new Map(
    Object.entries(providedSources).map(([path, source]) => [normalizePath(path), source]),
  );
  const pendingPaths = [];
  const pendingCommands = [
    ...Object.values(packageJson.scripts ?? {}),
    ...Object.values(manifest.tiers ?? {}).flatMap((tier) =>
      (tier.steps ?? []).map((step) => step.command),
    ),
  ];
  const queuedPaths = new Set();
  const queuedPackageScripts = new Set();

  function enqueueCommand(command, parentScriptPath) {
    for (const { path } of localScriptReferences(shellCommand(command), parentScriptPath, rootDirectory)) {
      if (queuedPaths.has(path)) continue;
      queuedPaths.add(path);
      pendingPaths.push(path);
    }
    for (const { name } of referencedPackageScriptEntries(command)) {
      if (queuedPackageScripts.has(name)) continue;
      queuedPackageScripts.add(name);
      const nestedCommand = packageJson.scripts?.[name];
      if (nestedCommand) pendingCommands.push(nestedCommand);
    }
  }

  while (pendingCommands.length > 0) {
    enqueueCommand(pendingCommands.shift(), null);
  }
  while (pendingPaths.length > 0) {
    const scriptPath = pendingPaths.pop();
    let source = sources.get(scriptPath);
    if (source === undefined) {
      const absolutePath = resolve(rootDirectory, scriptPath);
      if (!existsSync(absolutePath)) continue;
      source = readFileSync(absolutePath, "utf8");
      sources.set(scriptPath, source);
    }

    enqueueCommand(source, scriptPath);
  }

  return sources;
}

function helperScriptLaunchesBrowser(
  scriptPath,
  { helperScriptSources, rootDirectory },
  visitedScripts = new Set(),
) {
  if (visitedScripts.has(scriptPath)) return false;
  visitedScripts.add(scriptPath);

  const source = helperScriptSources.get(scriptPath);
  if (source === undefined) return false;
  // The shared compiler-gated launcher is a prerequisite boundary for callers,
  // including guarded diagnostics reached through the generic tier dispatcher.
  // Config discovery still traverses it independently below. Its actual
  // compiler-before-browser behavior is exercised by configuration/lifecycle
  // fixtures; this static check is not a proof of arbitrary JavaScript flow.
  if (scriptPath === "scripts/run-typechecked-playwright.mjs" &&
    /const typecheckStatus = run\("npm", \["run", "typecheck"\]\);\s*if \(typecheckStatus !== 0\) process\.exit\(typecheckStatus\);/.test(source))
    return false;
  if (browserConfigsFromHelperSource(source, scriptPath).length > 0) return true;

  for (const { path } of localScriptReferences(source, scriptPath, rootDirectory, true)) {
    if (
      helperScriptLaunchesBrowser(
        path,
        { helperScriptSources, rootDirectory },
        visitedScripts,
      )
    ) {
      return true;
    }
  }
  return false;
}

function commandLaunchesBrowser(
  command,
  { packageJson, helperScriptSources, rootDirectory },
  visitedScripts = new Set(),
  visitedPackageScripts = new Set(),
) {
  if (directBrowserValidationCommandIndex(command) >= 0) return true;
  for (const { path } of localScriptReferences(shellCommand(command), null, rootDirectory)) {
    if (
      helperScriptLaunchesBrowser(
        path,
        { helperScriptSources, rootDirectory },
        visitedScripts,
      )
    ) {
      return true;
    }
  }
  for (const { name } of referencedPackageScriptEntries(command)) {
    if (visitedPackageScripts.has(name)) continue;
    visitedPackageScripts.add(name);
    const nestedCommand = packageJson.scripts?.[name];
    if (
      nestedCommand &&
      commandLaunchesBrowser(
        nestedCommand,
        { packageJson, helperScriptSources, rootDirectory },
        visitedScripts,
        visitedPackageScripts,
      )
    ) {
      return true;
    }
  }
  return false;
}

function browserValidationCommandIndex(
  command,
  { packageJson, helperScriptSources, rootDirectory, followPackageScripts = true },
) {
  const normalizedCommand = shellCommand(command);
  const indices = [];
  const directIndex = directBrowserValidationCommandIndex(normalizedCommand);
  if (directIndex >= 0) indices.push(directIndex);

  for (const { path, index } of localScriptReferences(
    normalizedCommand,
    null,
    rootDirectory,
  )) {
    if (
      helperScriptLaunchesBrowser(path, { helperScriptSources, rootDirectory })
    ) {
      indices.push(index);
    }
  }
  if (followPackageScripts) {
    for (const { name, index } of referencedPackageScriptEntries(normalizedCommand)) {
      const nestedCommand = packageJson.scripts?.[name];
      if (
        nestedCommand &&
        commandLaunchesBrowser(nestedCommand, {
          packageJson,
          helperScriptSources,
          rootDirectory,
        })
      ) {
        indices.push(index);
      }
    }
  }
  return indices.length > 0 ? Math.min(...indices) : -1;
}

function assertBrowserTypecheckPrerequisites({
  packageJson,
  manifest,
  helperScriptSources,
  rootDirectory,
}) {
  for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
    const normalizedCommand = shellCommand(command);
    const browserIndex = browserValidationCommandIndex(normalizedCommand, {
      packageJson,
      helperScriptSources,
      rootDirectory,
      followPackageScripts: false,
    });
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
      if (
        browserValidationCommandIndex(command, {
          packageJson,
          helperScriptSources,
          rootDirectory,
        }) >= 0 &&
        !typecheckPassedInTier
      ) {
        throw new Error(
          `browser validation step '${step.name}' in tier '${tierName}' must follow a typecheck step`,
        );
      }
    }
  }
}

function discoverExecutableConfigs({
  packageJson,
  manifest,
  rootConfigFiles,
  helperScriptSources,
  rootDirectory,
}) {
  const configs = new Set(
    rootConfigFiles
      .filter((name) => /^playwright(?:\.[^.]+)?\.config\.ts$/.test(name))
      .map(normalizePath),
  );
  const visitedScripts = new Set();
  const visitedPackageScripts = new Set();

  function inspectCommand(command) {
    for (const config of configFromPlaywrightCommand(command)) configs.add(config);
    for (const { path } of localScriptReferences(
      shellCommand(command),
      null,
      rootDirectory,
    )) {
      inspectHelperScript(path);
    }
    for (const scriptName of referencedPackageScripts(command)) {
      inspectPackageScript(scriptName);
    }
  }

  function inspectHelperScript(scriptPath) {
    if (visitedScripts.has(scriptPath)) return;
    visitedScripts.add(scriptPath);
    const source = helperScriptSources.get(scriptPath);
    if (source === undefined) return;
    for (const config of browserConfigsFromHelperSource(source, scriptPath)) {
      configs.add(config);
    }
    for (const { path } of localScriptReferences(
      source,
      scriptPath,
      rootDirectory,
      true,
    )) {
      inspectHelperScript(path);
    }
    for (const scriptName of referencedPackageScripts(source)) {
      inspectPackageScript(scriptName);
    }
  }

  function inspectPackageScript(scriptName) {
    if (visitedPackageScripts.has(scriptName)) return;
    visitedPackageScripts.add(scriptName);
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
  rootDirectory = root,
  helperScriptSources: providedHelperScriptSources = {},
}) {
  const absoluteRootDirectory = resolve(rootDirectory);
  const helperScriptSources = loadReferencedHelperSources({
    packageJson,
    manifest,
    rootDirectory: absoluteRootDirectory,
    providedSources: providedHelperScriptSources,
  });
  const configs = discoverExecutableConfigs({
    packageJson,
    manifest,
    rootConfigFiles,
    helperScriptSources,
    rootDirectory: absoluteRootDirectory,
  });
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

  assertBrowserTypecheckPrerequisites({
    packageJson,
    manifest,
    helperScriptSources,
    rootDirectory: absoluteRootDirectory,
  });

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