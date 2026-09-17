#!/usr/bin/env node
/**
 * lint-storage.mjs
 * ─────────────────
 * Finds executable localStorage / sessionStorage .getItem / .setItem /
 * .removeItem calls whose key expression is not traceable to the typed registry
 * in client/src/lib/storageKeys.ts.
 *
 * Usage:
 *   node scripts/lint-storage.mjs
 *   node scripts/lint-storage.mjs --strict   (exit 1 if violations found)
 *
 * The scanner intentionally excludes only the registry itself. Other files
 * must use registry exports.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import * as ts from "typescript";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = process.env.STORAGE_LINT_SRC
  ? resolve(process.env.STORAGE_LINT_SRC)
  : join(ROOT, "client", "src");

const EXCLUDE_FILES = new Set([
  "client/src/lib/storageKeys.ts",
]);

const STORAGE_METHODS = new Set(["getItem", "setItem", "removeItem"]);

function isStorageKeysModule(moduleSpecifier) {
  return /(?:^|\/)storageKeys(?:\.[cm]?[jt]sx?)?$/.test(moduleSpecifier);
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    const argument = unwrap(expression.argumentExpression);
    if (ts.isStringLiteral(argument)) return argument.text;
  }
  return null;
}

function storageReceiver(expression, bindings, seen = new Set()) {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) {
    if (current.text === "localStorage" || current.text === "sessionStorage") return true;
    if (seen.has(current.text)) return false;
    const initializer = resolveInitializer(current, bindings);
    if (!initializer) return false;
    seen.add(current.text);
    return storageReceiver(initializer, bindings, seen);
  }

  if (
    (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) &&
    (propertyName(current) === "localStorage" || propertyName(current) === "sessionStorage")
  ) {
    const object = unwrap(current.expression);
    return ts.isIdentifier(object) &&
      (object.text === "window" || object.text === "globalThis");
  }

  return false;
}

function collectBindings(sourceFile) {
  const registryBindings = new Set();
  const registryNamespaces = new Set();
  const variableScopes = new Map();

  function isScopeBoundary(node) {
    return ts.isSourceFile(node) ||
      ts.isBlock(node) ||
      ts.isModuleBlock(node) ||
      ts.isFunctionLike(node) ||
      ts.isCatchClause(node);
  }

  function declarationScope(node) {
    let scope = node.parent;
    while (scope && !isScopeBoundary(scope)) scope = scope.parent;
    return scope ?? sourceFile;
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (isStorageKeysModule(node.moduleSpecifier.text) && node.importClause) {
        const bindings = node.importClause.namedBindings;
        if (ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) registryBindings.add(element.name.text);
        } else if (ts.isNamespaceImport(bindings)) {
          registryNamespaces.add(bindings.name.text);
        }
        if (node.importClause.name) registryBindings.add(node.importClause.name.text);
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const scope = declarationScope(node);
      if (!variableScopes.has(scope)) variableScopes.set(scope, new Map());
      variableScopes.get(scope).set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { registryBindings, registryNamespaces, variableScopes };
}

function resolveInitializer(identifier, bindings) {
  let scope = identifier.parent;
  while (scope) {
    const initializers = bindings.variableScopes.get(scope);
    if (initializers?.has(identifier.text)) return initializers.get(identifier.text);
    if (ts.isSourceFile(scope)) break;
    scope = scope.parent;
  }
  return undefined;
}

function isRegistryFunction(expression, bindings, seen = new Set()) {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) {
    if (bindings.registryBindings.has(current.text)) return true;
    if (seen.has(current.text)) return false;
    const initializer = resolveInitializer(current, bindings);
    if (!initializer) return false;
    seen.add(current.text);
    const candidate = unwrap(initializer);
    return (ts.isIdentifier(candidate) || ts.isPropertyAccessExpression(candidate)) &&
      isRegistryFunction(candidate, bindings, seen);
  }

  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const object = unwrap(current.expression);
    return ts.isIdentifier(object) && bindings.registryNamespaces.has(object.text);
  }
  return false;
}

function isRegisteredKey(expression, bindings, seen = new Set()) {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) {
    if (bindings.registryBindings.has(current.text)) return true;
    if (seen.has(current.text)) return false;
    const initializer = resolveInitializer(current, bindings);
    if (!initializer) return false;
    seen.add(current.text);
    return isRegisteredKey(initializer, bindings, seen);
  }

  if (ts.isCallExpression(current)) return isRegistryFunction(current.expression, bindings);
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const object = unwrap(current.expression);
    return ts.isIdentifier(object) && bindings.registryNamespaces.has(object.text);
  }
  return false;
}

function createSourceFile(source, fileName) {
  const scriptKind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

/**
 * Analyze executable storage calls in one TypeScript/TSX source file.
 * The AST keeps comments and string contents out of the call-expression scan.
 */
export function analyzeSource(source, fileName = "fixture.tsx") {
  const sourceFile = createSourceFile(source, fileName);
  const bindings = collectBindings(sourceFile);
  const violations = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = unwrap(node.expression);
      const method = propertyName(expression);
      const receiver = ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
        ? expression.expression
        : null;
      if (
        method &&
        STORAGE_METHODS.has(method) &&
        receiver &&
        storageReceiver(receiver, bindings)
      ) {
        const key = node.arguments[0];
        if (!key || !isRegisteredKey(key, bindings)) {
          violations.push({
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            text: node.getText(sourceFile).replace(/\s+/g, " ").trim(),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

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

export function runLint({
  sourceRoot = SRC,
  projectRoot = ROOT,
  strict = false,
  log = console.log,
} = {}) {
  const violations = [];
  for (const filePath of walk(sourceRoot)) {
    const rel = relative(projectRoot, filePath).replace(/\\/g, "/");
    if (EXCLUDE_FILES.has(rel)) continue;

    const source = readFileSync(filePath, "utf8");
    const sourceFile = createSourceFile(source, filePath);
    if (sourceFile.parseDiagnostics?.length) {
      violations.push({ rel, line: 1, text: "malformed TypeScript source" });
      log(`${rel}:1  malformed TypeScript source`);
    }

    for (const violation of analyzeSource(source, filePath)) {
      violations.push({ ...violation, rel });
      log(`${rel}:${violation.line}  ${violation.text}`);
    }
  }

  log();
  if (violations.length === 0) {
    log("No unregistered storage key literals found.");
  } else {
    log(
      `${violations.length} violation${violations.length === 1 ? "" : "s"} found. ` +
        "Replace raw string literals with typed constants from client/src/lib/storageKeys.ts",
    );
  }

  return { violations, exitCode: strict && violations.length > 0 ? 1 : 0 };
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const rootFlag = process.argv.indexOf("--root");
  const sourceRoot = rootFlag >= 0 && process.argv[rootFlag + 1]
    ? resolve(process.argv[rootFlag + 1])
    : SRC;
  const result = runLint({
    sourceRoot,
    strict: process.argv.includes("--strict"),
  });
  process.exitCode = result.exitCode;
}