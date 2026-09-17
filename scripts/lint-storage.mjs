#!/usr/bin/env node
/**
 * lint-storage.mjs
 * ─────────────────
 * Finds executable localStorage / sessionStorage .getItem / .setItem /
 * .removeItem calls whose first argument is not provably supplied by
 * client/src/lib/storageKeys.ts.
 *
 * Usage:
 *   node scripts/lint-storage.mjs
 *   node scripts/lint-storage.mjs --strict   (exit 1 if violations found)
 *
 * The scanner intentionally excludes only the registry itself. Other files
 * (including the theme system and photo notes UI) must use registry exports.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = process.env.STORAGE_LINT_SRC
  ? resolve(process.env.STORAGE_LINT_SRC)
  : join(ROOT, "client", "src");

const EXCLUDE_FILES = new Set([
  "client/src/lib/storageKeys.ts",
]);
const STORAGE_METHODS = new Set(["getItem", "setItem", "removeItem"]);

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      entries.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      entries.push(full);
    }
  }
  return entries;
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function isStorageKeysModule(moduleSpecifier) {
  const value = moduleSpecifier.text;
  return value === "@/lib/storageKeys" || /(?:^|\/)storageKeys$/.test(value);
}

function propertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return null;
}

function propertyReceiver(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.expression;
  if (ts.isElementAccessExpression(expression)) return expression.expression;
  return null;
}

function createFileState(sourceFile) {
  const registryBindings = new Set();
  const registryNamespaces = new Set();
  const declarations = new Map();
  const storageAliases = new Map([
    ["localStorage", "local"],
    ["sessionStorage", "session"],
  ]);

  function collect(node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier) && isStorageKeysModule(moduleSpecifier)) {
        const clause = node.importClause;
        if (clause?.name) registryBindings.add(clause.name.text);
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          registryNamespaces.add(bindings.name.text);
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            registryBindings.add(element.name.text);
          }
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declarations.set(node.name.text, node);
    }
    ts.forEachChild(node, collect);
  }
  collect(sourceFile);

  function resolveStorage(expression, seen = new Set()) {
    const current = unwrap(expression);
    if (ts.isIdentifier(current)) {
      const direct = storageAliases.get(current.text);
      if (direct) return direct;
      const declaration = declarations.get(current.text);
      if (!declaration || seen.has(declaration)) return null;
      if (!declaration.initializer) return null;
      return resolveStorage(
        declaration.initializer,
        new Set(seen).add(declaration),
      );
    }
    if (
      (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) &&
      (propertyName(current) === "localStorage" || propertyName(current) === "sessionStorage")
    ) {
      const receiver = unwrap(propertyReceiver(current));
      if (
        ts.isIdentifier(receiver) &&
        (receiver.text === "window" || receiver.text === "globalThis")
      ) {
        return propertyName(current) === "localStorage" ? "local" : "session";
      }
    }
    return null;
  }

  // Resolve aliases repeatedly so declarations can refer to another alias
  // declared later in the file.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, declaration] of declarations) {
      if (storageAliases.has(name) || !declaration.initializer) continue;
      const resolved = resolveStorage(declaration.initializer);
      if (resolved) {
        storageAliases.set(name, resolved);
        changed = true;
      }
    }
  }

  function isRegistryReference(expression) {
    const current = unwrap(expression);
    if (ts.isIdentifier(current)) return registryBindings.has(current.text);
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      const receiver = unwrap(propertyReceiver(current));
      return ts.isIdentifier(receiver) && registryNamespaces.has(receiver.text);
    }
    return false;
  }

  function isRegisteredKey(expression, seen = new Set()) {
    const current = unwrap(expression);
    if (isRegistryReference(current)) return true;

    if (ts.isIdentifier(current)) {
      const declaration = declarations.get(current.text);
      if (!declaration || seen.has(declaration) || !declaration.initializer) return false;
      return isRegisteredKey(
        declaration.initializer,
        new Set(seen).add(declaration),
      );
    }

    // Calls to imported registry factories (for example dashboardStateKey())
    // are allowed without attempting to evaluate their runtime arguments.
    if (ts.isCallExpression(current)) {
      return isRegistryReference(current.expression);
    }

    return false;
  }

  return { resolveStorage, isRegisteredKey };
}

function lintFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const rel = relative(ROOT, filePath).replace(/\\/g, "/");
  const findings = [];

  if (sourceFile.parseDiagnostics?.length) {
    findings.push({
      line: 1,
      text: "malformed TypeScript source",
    });
  }

  const state = createFileState(sourceFile);
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const method = propertyName(node.expression);
      const receiver = propertyReceiver(node.expression);
      if (method && STORAGE_METHODS.has(method) && receiver) {
        if (state.resolveStorage(receiver)) {
          const key = node.arguments[0];
          if (!key || !state.isRegisteredKey(key)) {
            findings.push({
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
              text: node.getText(sourceFile).split(/\r?\n/, 1)[0].trim(),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return findings.map((finding) => `${rel}:${finding.line}  ${finding.text}`);
}

let violations = 0;
for (const filePath of walk(SRC)) {
  const rel = relative(ROOT, filePath).replace(/\\/g, "/");
  if (EXCLUDE_FILES.has(rel)) continue;
  for (const finding of lintFile(filePath)) {
    console.log(finding);
    violations++;
  }
}

console.log();
if (violations === 0) {
  console.log("No unregistered storage key literals found.");
} else {
  console.log(
    `${violations} violation${violations === 1 ? "" : "s"} found. ` +
      "Replace raw string literals with typed constants from client/src/lib/storageKeys.ts",
  );
}

const strict = process.argv.includes("--strict");
if (strict && violations > 0) process.exit(1);
