import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = readFileSync(join(HERE, "SKILL.md"), "utf8");

function sourceFile(source) {
  return ts.createSourceFile(
    "fixture.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function isSecretInitialization(node) {
  const text = node.getText();
  return /process\.env/i.test(text) && /POE_API_KEY2?/i.test(text);
}

function isProviderActivity(node) {
  if (!ts.isCallExpression(node)) return false;
  const text = node.expression.getText();
  return (
    /\.(?:list|create)\s*$/.test(text) ||
    /(?:check|health|catalog|model|completion|response|chat|fetch)/i.test(text)
  ) && /(?:models|completions|responses|api\.poe\.com|getPoeClient|poe)/i.test(node.getText());
}

function inspectExecutableModuleScope(source) {
  const file = sourceFile(source);
  const findings = [];
  const constructors = new Set(["OpenAI"]);
  const namespaces = new Set();

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "openai") continue;
    const clause = statement.importClause;
    if (clause?.name) constructors.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      namespaces.add(clause.namedBindings.name.text);
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === "OpenAI") {
          constructors.add(element.name.text);
        }
      }
    }
  }

  function isPoeClientConstruction(node) {
    if (!ts.isNewExpression(node)) return false;
    if (ts.isIdentifier(node.expression)) return constructors.has(node.expression.text);
    return (
      ts.isPropertyAccessExpression(node.expression) &&
      namespaces.has(node.expression.expression.getText()) &&
      node.expression.name.text === "OpenAI"
    );
  }

  function unwrapExpression(node) {
    let current = node;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  }

  function inspectExecutable(node) {
    const calledExpression = ts.isCallExpression(node)
      ? unwrapExpression(node.expression)
      : undefined;
    if (calledExpression && ts.isFunctionLike(calledExpression)) {
      const body = calledExpression.body;
      if (ts.isBlock(body)) {
        for (const statement of body.statements) inspectExecutable(statement);
      } else {
        inspectExecutable(body);
      }
      for (const argument of node.arguments) inspectExecutable(argument);
      return;
    }
    if (ts.isFunctionLike(node)) return;
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const member of node.members) {
        if (ts.isClassStaticBlockDeclaration(member)) {
          for (const statement of member.body.statements) inspectExecutable(statement);
          continue;
        }
        const isStatic = member.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword,
        );
        if (isStatic && ts.isPropertyDeclaration(member) && member.initializer) {
          inspectExecutable(member.initializer);
        }
        if (isStatic && member.name && ts.isComputedPropertyName(member.name)) {
          inspectExecutable(member.name.expression);
        }
      }
      return;
    }
    if (isPoeClientConstruction(node)) findings.push("module-scope-client");
    if (isSecretInitialization(node)) findings.push("module-scope-secret-lookup");
    if (isProviderActivity(node)) findings.push("module-scope-provider-call");
    ts.forEachChild(node, inspectExecutable);
  }

  for (const statement of file.statements) {
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer && !ts.isFunctionLike(declaration.initializer)) {
          inspectExecutable(declaration);
        }
      }
      continue;
    }
    inspectExecutable(statement);
  }
  return [...new Set(findings)];
}

function assertSafeFixture(source) {
  assert.deepEqual(inspectExecutableModuleScope(source), []);
}

function assertUnsafeFixture(source, finding) {
  assert.ok(
    inspectExecutableModuleScope(source).includes(finding),
    `expected ${finding} for:\n${source}`,
  );
}

test("installed Poe Setup guidance preserves the approved operational contract", () => {
  assert.match(SKILL, /^---\nname: Poe-Setup\n/);
  assert.match(SKILL, /# Poe API Integration — Portable, Chatbot-Oriented Setup Guide/);
  assert.match(SKILL, /process\.env\.POE_API_KEY2/);
  assert.match(SKILL, /baseURL: "https:\/\/api\.poe\.com\/v1"/);
  assert.match(SKILL, /export function getPoeClient\(\): OpenAI/);
  assert.match(SKILL, /Importing the module\s+must not read or validate optional Poe configuration/);
  assert.match(SKILL, /explicit startup preflight may call the same getter/);
  assert.match(SKILL, /health check makes one catalogue request/);
  assert.match(SKILL, /must not trigger per-model inference probes/);
  assert.match(SKILL, /startup, deployment startup, readiness checks, health\s+checks, and catalogue refreshes must issue zero model-completion requests/);
  assert.match(SKILL, /explicit,\s+protected administrator or operator action/);
  assert.match(SKILL, /aggregate request count, and the\s+aggregate operation deadline/);
  assert.match(SKILL, /safe partial or\s+budget-limited results/);
  assert.match(SKILL, /Do not capability-probe every model in the catalogue/);
  assert.doesNotMatch(SKILL, /\bPOE_API_KEY\b(?!2)/);
});

test("the installed raw SDK example is import-safe executable code", () => {
  const marker = "export function getPoeClient(): OpenAI";
  const markerIndex = SKILL.indexOf(marker);
  assert.notEqual(markerIndex, -1);
  const fenceStart = SKILL.lastIndexOf("```ts\n", markerIndex);
  const fenceEnd = SKILL.indexOf("\n```", markerIndex);
  assert.ok(fenceStart >= 0 && fenceEnd > markerIndex);
  const installedExample = SKILL.slice(fenceStart + "```ts\n".length, fenceEnd);
  assertSafeFixture(installedExample);
});

test("rejects legacy caller configuration while retaining explanatory bot guidance", () => {
  const executableLegacyBotClient =
    'const client = new OpenAI({ apiKey: process.env.POE_API_KEY2, baseURL: "https://api.poe.com/bot/" });';
  assert.match(executableLegacyBotClient, /new OpenAI[\s\S]*api\.poe\.com\/bot\//);
  assert.doesNotMatch(SKILL, /new OpenAI\(\{[\s\S]{0,300}baseURL:\s*["']https:\/\/api\.poe\.com\/bot\//);
  assert.match(SKILL, /legacy `\/bot\/` paths use Poe's bot-server protocol/);
});

test("rejects differently named eager module-scope clients", () => {
  assertUnsafeFixture(
    'const poeClient = new OpenAI({ apiKey: process.env.POE_API_KEY2, baseURL: "https://api.poe.com/v1" });',
    "module-scope-client",
  );
  assertUnsafeFixture(
    'const transportForInference = new OpenAI({ baseURL: "https://api.poe.com/v1", apiKey: process.env.POE_API_KEY2 });',
    "module-scope-client",
  );
  assertUnsafeFixture(
    'import PoeCaller from "openai";\nconst options = { baseURL: "https://api.poe.com/v1", apiKey: "fixture" };\nconst transport = new PoeCaller(options);',
    "module-scope-client",
  );
  assertUnsafeFixture(
    'import { OpenAI as PoeCaller } from "openai";\nconst options = getPoeOptions();\nconst transport = new PoeCaller(options);',
    "module-scope-client",
  );
});

test("rejects module-scope secret validation", () => {
  assertUnsafeFixture(
    'if (!process.env.POE_API_KEY2) throw new Error("missing Poe configuration");',
    "module-scope-secret-lookup",
  );
  assertUnsafeFixture(
    'const configuredKey = requirePoeSecret(process.env.POE_API_KEY2);',
    "module-scope-secret-lookup",
  );
  assertUnsafeFixture(
    'const apiKey = process.env.POE_API_KEY2;\nif (!apiKey) throw new Error("missing Poe configuration");',
    "module-scope-secret-lookup",
  );
  assertUnsafeFixture(
    'const optionalPoeKey = process.env.POE_API_KEY2;',
    "module-scope-secret-lookup",
  );
  assertUnsafeFixture(
    'const optionalPoeKey = process.env["POE_API_KEY2"];',
    "module-scope-secret-lookup",
  );
  assertUnsafeFixture(
    'const { POE_API_KEY2: optionalPoeKey } = process.env;',
    "module-scope-secret-lookup",
  );
});

test("rejects import-triggered health, catalogue, and completion activity", () => {
  assertUnsafeFixture("await checkPoeHealth();", "module-scope-provider-call");
  assertUnsafeFixture("const catalogue = await getPoeClient().models.list();", "module-scope-provider-call");
  assertUnsafeFixture(
    'const answer = await getPoeClient().chat.completions.create({ model: "fixture", messages: [] });',
    "module-scope-provider-call",
  );
});

test("rejects class-static and immediately invoked module initialization", () => {
  assertUnsafeFixture(
    'class Provider { static client = new OpenAI({}); }',
    "module-scope-client",
  );
  assertUnsafeFixture(
    'class Provider { static { void getPoeClient().models.list(); } }',
    "module-scope-provider-call",
  );
  assertUnsafeFixture(
    'const client = (() => new OpenAI({}))();',
    "module-scope-client",
  );
});

test("accepts the approved lazy memoized getter", () => {
  assertSafeFixture(`
    import OpenAI from "openai";
    let transportForInference: OpenAI | undefined;
    export function getPoeClient(): OpenAI {
      if (transportForInference) return transportForInference;
      const apiKey = process.env.POE_API_KEY2;
      if (!apiKey) throw new Error("POE_API_KEY2 is not configured on the server");
      transportForInference = new OpenAI({
        apiKey,
        baseURL: "https://api.poe.com/v1",
        timeout: 30_000,
      });
      return transportForInference;
    }
  `);
});

test("accepts a lazy memoized arrow-function getter", () => {
  assertSafeFixture(`
    import PoeCaller from "openai";
    let client: PoeCaller | undefined;
    export const getPoeClient = (): PoeCaller => {
      if (client) return client;
      const apiKey = process.env.POE_API_KEY2;
      if (!apiKey) throw new Error("POE_API_KEY2 is not configured on the server");
      client = new PoeCaller({
        apiKey,
        baseURL: "https://api.poe.com/v1",
      });
      return client;
    };
  `);
});