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
const REGISTRY_FILE = join(ROOT, "client", "src", "lib", "storageKeys.ts");
const DASHBOARD_STATE_FIELDS = new Set([
  "openFolders",
  "searchQuery",
  "searchInside",
  "showFilterBar",
  "filterStatus",
  "filterCollaborator",
  "filterWireType",
  "filterMinFootage",
  "filterDateMonth",
  "filterDateYear",
  "sortField",
  "sortDirection",
]);

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

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function registryExports() {
  const source = readFileSync(REGISTRY_FILE, "utf8");
  const sourceFile = createSourceFile(source, REGISTRY_FILE);
  const exports = new Map();

  function keyFactoryMetadata(name, initializer) {
    const isFactory = ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer);
    if (!isFactory) return undefined;

    let returnsKey = false;
    function inspectReturn(node) {
      if (returnsKey) return;
      if (ts.isReturnStatement(node) && node.expression) {
        const expression = unwrap(node.expression);
        returnsKey =
          ts.isStringLiteral(expression) ||
          ts.isNoSubstitutionTemplateLiteral(expression) ||
          ts.isTemplateExpression(expression) ||
          ts.isBinaryExpression(expression) ||
          ts.isCallExpression(expression);
        return;
      }
      ts.forEachChild(node, inspectReturn);
    }

    if (ts.isExpression(initializer.body)) {
      const expression = unwrap(initializer.body);
      returnsKey =
        ts.isStringLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression) ||
        ts.isTemplateExpression(expression) ||
        ts.isBinaryExpression(expression) ||
        ts.isCallExpression(expression);
    } else {
      inspectReturn(initializer.body);
    }

    return returnsKey
      ? { kind: "factory", exportName: name, arity: initializer.parameters.length }
      : undefined;
  }

  function visit(node) {
    if (
      ts.isVariableStatement(node) &&
      hasModifier(node, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        const initializer = declaration.initializer && unwrap(declaration.initializer);
        if (
          initializer &&
          ts.isStringLiteral(initializer) &&
          !name.endsWith("_PREFIX")
        ) {
          exports.set(name, {
            kind: "key",
            exportName: name,
          });
        } else if (initializer) {
          const factory = keyFactoryMetadata(name, initializer);
          if (factory) exports.set(name, factory);
        }
      }
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      hasModifier(node, ts.SyntaxKind.ExportKeyword)
    ) {
      const returnsKey = node.body
        ? (() => {
            let found = false;
            function findReturn(child) {
              if (found) return;
              if (ts.isReturnStatement(child) && child.expression) {
                const expression = unwrap(child.expression);
                if (
                  ts.isStringLiteral(expression) ||
                  ts.isNoSubstitutionTemplateLiteral(expression) ||
                  ts.isTemplateExpression(expression) ||
                  ts.isBinaryExpression(expression) ||
                  ts.isCallExpression(expression)
                ) {
                  found = true;
                  return;
                }
              }
              ts.forEachChild(child, findReturn);
            }
            findReturn(node.body);
            return found;
          })()
        : false;

      if (returnsKey) {
        exports.set(node.name.text, {
          kind: "factory",
          exportName: node.name.text,
          arity: node.parameters.length,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exports;
}

const REGISTRY_EXPORTS = registryExports();

function unknownBinding() {
  return { kind: "unknown" };
}

function createBindingScopes(sourceFile) {
  const scopes = new Map();

  function scopeMap(scope) {
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    return scopes.get(scope);
  }

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

  function bind(scope, name, value) {
    if (typeof name === "string") scopeMap(scope).set(name, value);
    else if (ts.isIdentifier(name)) scopeMap(scope).set(name.text, value);
  }

  function bindPattern(pattern, scope, value = unknownBinding()) {
    if (ts.isIdentifier(pattern)) {
      bind(scope, pattern.text, value);
      return;
    }
    if (ts.isObjectBindingPattern(pattern) || ts.isArrayBindingPattern(pattern)) {
      for (const element of pattern.elements) {
        if (ts.isBindingElement(element)) bindPattern(element.name, scope);
      }
    }
  }

  function registryBinding(exportName) {
    const metadata = REGISTRY_EXPORTS.get(exportName);
    if (!metadata) return unknownBinding();
    return { ...metadata };
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (isStorageKeysModule(node.moduleSpecifier.text) && node.importClause) {
        const scope = sourceFile;
        if (node.importClause.name) bind(scope, node.importClause.name.text, unknownBinding());
        const bindings = node.importClause.namedBindings;
        if (ts.isNamespaceImport(bindings)) {
          bind(scope, bindings.name.text, { kind: "namespace" });
        } else if (ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            bind(scope, element.name.text, registryBinding(element.propertyName?.text ?? element.name.text));
          }
        }
      }
    }

    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) bindPattern(parameter.name, node);
    }

    if (ts.isVariableDeclaration(node)) {
      const value = node.initializer
        ? { kind: "initializer", initializer: node.initializer }
        : unknownBinding();
      bindPattern(node.name, declarationScope(node), value);
    }

    if (ts.isCatchClause(node) && node.variableDeclaration) {
      bindPattern(node.variableDeclaration.name, node);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { scopes, sourceFile };
}

function findBinding(identifier, bindings) {
  let scope = identifier.parent;
  while (scope) {
    const current = bindings.scopes.get(scope);
    if (current?.has(identifier.text)) return current.get(identifier.text);
    if (ts.isSourceFile(scope)) break;
    scope = scope.parent;
  }
  return undefined;
}

function resolveBinding(expression, bindings, seen = new Set()) {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) {
    const binding = findBinding(current, bindings);
    if (!binding || binding.kind !== "initializer") return binding;
    if (seen.has(binding)) return unknownBinding();
    return resolveBinding(binding.initializer, bindings, new Set(seen).add(binding));
  }

  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const namespace = resolveBinding(current.expression, bindings, seen);
    if (namespace?.kind === "namespace") {
      const name = propertyName(current);
      return name ? REGISTRY_EXPORTS.get(name) : undefined;
    }
  }

  return undefined;
}

function storageReceiver(expression, bindings, seen = new Set()) {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) {
    const binding = findBinding(current, bindings);
    if (!binding && (current.text === "localStorage" || current.text === "sessionStorage")) return true;
    if (!binding || binding.kind !== "initializer" || seen.has(binding)) return false;
    return storageReceiver(binding.initializer, bindings, new Set(seen).add(binding));
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

function staticString(expression, bindings, seen = new Set()) {
  const current = unwrap(expression);
  if (ts.isStringLiteral(current)) return current.text;
  if (ts.isNoSubstitutionTemplateLiteral(current)) return current.text;
  if (ts.isIdentifier(current)) {
    const binding = findBinding(current, bindings);
    if (!binding || binding.kind !== "initializer" || seen.has(binding)) return undefined;
    return staticString(binding.initializer, bindings, new Set(seen).add(binding));
  }
  return undefined;
}

function isDynamicIdentity(expression, bindings) {
  const current = unwrap(expression);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) return false;
  if (staticString(current, bindings) !== undefined) return false;
  if (
    ts.isNumericLiteral(current) ||
    current.kind === ts.SyntaxKind.TrueKeyword ||
    current.kind === ts.SyntaxKind.FalseKeyword
  ) return false;
  return true;
}

function isValidFactoryCall(call, factory, bindings) {
  if (!factory || factory.kind !== "factory" || call.arguments.length !== factory.arity) return false;
  if (factory.exportName !== "dashboardStateKey") return true;
  const [field, userId] = call.arguments;
  const fieldName = staticString(field, bindings);
  return DASHBOARD_STATE_FIELDS.has(fieldName) && isDynamicIdentity(userId, bindings);
}

function isRegisteredKey(expression, bindings, seen = new Set()) {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) {
    const directBinding = findBinding(current, bindings);
    if (directBinding?.kind === "initializer" && !seen.has(directBinding)) {
      return isRegisteredKey(
        directBinding.initializer,
        bindings,
        new Set(seen).add(directBinding),
      );
    }
  }
  const binding = resolveBinding(current, bindings);
  if (binding?.kind === "key") return true;
  if (binding?.kind === "factory") {
    return ts.isCallExpression(current) && isValidFactoryCall(current, binding, bindings);
  }
  if (ts.isCallExpression(current)) {
    const factory = resolveBinding(current.expression, bindings, seen);
    return isValidFactoryCall(current, factory, bindings);
  }
  return false;
}

/**
 * Analyze executable storage calls in one TypeScript/TSX source file.
 * The AST keeps comments and string contents out of the call-expression scan.
 */
export function analyzeSource(source, fileName = "fixture.tsx") {
  const sourceFile = createSourceFile(source, fileName);
  const bindings = createBindingScopes(sourceFile);
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