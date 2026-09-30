import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import http from "node:http";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";
import pg from "pg";
import { redactReleaseDiagnostics } from "../redact-release-diagnostics.mjs";
import {
  formatReleaseDiagnostics,
  MAX_DIAGNOSTIC_BYTES,
  MAX_DIAGNOSTIC_LINES,
} from "../print-release-diagnostics.mjs";
import {
  COUNT_REMAINING_REMOVED_ACCOUNT_DATA_SQL,
  FILTER_REMOVED_REVIEW_COHORT_SQL,
  SELECT_REMOVED_ACCOUNT_OBJECT_KEYS_SQL,
} from "../lib/managed-clerk-reset-queries.mjs";
import {
  createOwnedDatabase,
  dropOwnedDatabase,
} from "../release-smoke-database.mjs";
import { validatePublishedSmokeConfiguration } from "../validate-published-smoke-config.mjs";
import { deletePrivateObjectsAndVerify } from "../../server/replit_integrations/object_storage/objectStorageClient.mjs";
import { createClerkScriptBootTracker } from "../lib/managed-clerk-script-assertion.mjs";

const root = resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const buildScript = readFileSync(resolve(root, "script/build.ts"), "utf8");
const productionBuildIdentity = readFileSync(
  resolve(root, "server/lib/production-build-identity.ts"),
  "utf8",
);
const replitConfig = readFileSync(resolve(root, ".replit"), "utf8");
const config = readFileSync(resolve(root, "playwright.release.config.ts"), "utf8");
const ordinaryConfig = readFileSync(resolve(root, "playwright.config.ts"), "utf8");
const smoke = readFileSync(resolve(root, "tests/release/managed-clerk-auth.spec.ts"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/managed-clerk-release.yml"), "utf8");
const candidateBuild = readFileSync(resolve(root, "scripts/build-and-verify-release.sh"), "utf8");
const publishedRelease = readFileSync(
  resolve(root, "scripts/verify-published-release.mjs"),
  "utf8",
);
const publishedSmokeConfig = readFileSync(
  resolve(root, "scripts/validate-published-smoke-config.mjs"),
  "utf8",
);
const productionUrlValidation = readFileSync(
  resolve(root, "scripts/validate-production-base-url.mjs"),
  "utf8",
);
const releaseSchemaPreflight = readFileSync(
  resolve(root, "scripts/release-schema-preflight.mjs"),
  "utf8",
);
const releaseSchemaPreparation = readFileSync(
  resolve(root, "scripts/prepare-release-test-database.mjs"),
  "utf8",
);
const candidateProxy = readFileSync(resolve(root, "scripts/release-candidate-https-proxy.mjs"), "utf8");
const diagnosticRedactor = readFileSync(resolve(root, "scripts/redact-release-diagnostics.mjs"), "utf8");
const candidateTesting = readFileSync(resolve(root, "tests/support/clerk-candidate-testing.ts"), "utf8");
const releaseSmoke = readFileSync(resolve(root, "tests/release/managed-clerk-auth.spec.ts"), "utf8");
const sharedClerkConfig = readFileSync(resolve(root, "shared/clerk-config.ts"), "utf8");
const serverIndex = readFileSync(resolve(root, "server/index.ts"), "utf8");
const browserSetup = readFileSync(resolve(root, "tests/global-setup.ts"), "utf8");
const browserRunner = readFileSync(resolve(root, "scripts/run-browser-tests.mjs"), "utf8");
const googleReleaseSmoke = readFileSync(
  resolve(root, "tests/release/google-clerk-auth.spec.ts"),
  "utf8",
);
const publishedReadOnlySmoke = readFileSync(
  resolve(root, "tests/release/published-auth-read-only.spec.ts"),
  "utf8",
);
const clerkTestPermissions = readFileSync(
  resolve(root, "tests/support/clerk-test-permissions.ts"),
  "utf8",
);
const clerkProxyMiddleware = readFileSync(
  resolve(root, "server/middlewares/clerkProxyMiddleware.ts"),
  "utf8",
);
const authBridge = readFileSync(
  resolve(root, "server/replit_integrations/auth/replitAuth.ts"),
  "utf8",
);
const authExports = readFileSync(
  resolve(root, "server/replit_integrations/auth/index.ts"),
  "utf8",
);
const serverRoutes = readFileSync(resolve(root, "server/routes.ts"), "utf8");
const authModels = readFileSync(resolve(root, "shared/models/auth.ts"), "utf8");
const testerReconciliation = readFileSync(
  resolve(root, "migrations/0025_reconcile_legacy_tester_accounts.sql"),
  "utf8",
);
const managedClerkReset = readFileSync(
  resolve(root, "scripts/reset-managed-clerk.mjs"),
  "utf8",
);
const managedClerkResetQueries = readFileSync(
  resolve(root, "scripts/lib/managed-clerk-reset-queries.mjs"),
  "utf8",
);
const browserFixtureCleanup = readFileSync(
  resolve(root, "tests/clerk-fixture-cleanup.ts"),
  "utf8",
);
const execFileAsync = promisify(execFile);
const proxyConstructionProgram = [
  'import { clerkProxyMiddleware } from "./server/middlewares/clerkProxyMiddleware.ts";',
  "clerkProxyMiddleware();",
].join("\n");

function clerkPermissionProbeProgram(capability) {
  const providerMessage = `raw-provider-message-${capability}`;
  const secret = `raw-clerk-secret-${capability}`;
  const requestBody = `raw-request-body-${capability}`;
  const token = `raw-testing-token-${capability}`;
  const source = [
    'import assert from "node:assert/strict";',
    'import { ClerkAPIResponseError } from "@clerk/shared/error";',
    'import { assertClerkTestPermissions } from "./tests/support/clerk-test-permissions.ts";',
    `const providerMessage = ${JSON.stringify(providerMessage)};`,
    `const secret = ${JSON.stringify(secret)};`,
    `const requestBody = ${JSON.stringify(requestBody)};`,
    `const token = ${JSON.stringify(token)};`,
    "const providerResponse = [providerMessage, secret, requestBody, token].join(\" | \");",
    "let capturedRequestBody;",
    "const clerk = {",
    "  users: {",
    "    createUser: async (params) => {",
    "      capturedRequestBody = JSON.stringify(params);",
    capability === "user"
      ? "      throw new ClerkAPIResponseError(providerResponse, { status: 403, data: [{ code: \"forbidden\", message: providerResponse }] });"
      : "      throw new ClerkAPIResponseError(requestBody, { status: 422, data: [{ code: \"form_data_missing\", message: providerResponse }] });",
    "    },",
    "    deleteUser: async () => undefined,",
    "  },",
    "  testingTokens: {",
    "    createTestingToken: async () => {",
    capability === "user"
      ? `      return { token: ${JSON.stringify(token)} };`
      : "      throw new ClerkAPIResponseError(providerResponse, { status: 403, data: [{ code: \"forbidden\", message: providerResponse }] });",
    "    },",
    "  },",
    "};",
    "let failure;",
    "try {",
    "  await assertClerkTestPermissions(clerk);",
    "} catch (error) {",
    "  failure = error;",
    "}",
    "assert.ok(failure instanceof Error, \"permission preflight should reject\");",
    capability === "user"
      ? 'assert.match(failure.message, /disposable-user creation/);'
      : 'assert.match(failure.message, /testing-token creation/);',
    capability === "user"
      ? 'assert.match(failure.message, /manage users/);'
      : 'assert.match(failure.message, /create testing tokens/);',
    'assert.match(failure.message, /Browser validation did not start/);',
    "for (const leakedValue of [providerMessage, secret, requestBody, token, capturedRequestBody]) {",
    "  if (leakedValue) assert.equal(failure.message.includes(leakedValue), false);",
    "}",
    "console.log(failure.message);",
  ].join("\n");
  return { source, providerMessage, secret, requestBody, token };
}

function clerkUnexpectedProbeProgram(capability, failureKind) {
  const providerMessage = `raw-unexpected-provider-message-${capability}-${failureKind}`;
  const secret = `raw-unexpected-clerk-secret-${capability}-${failureKind}`;
  const requestBody = `raw-unexpected-request-body-${capability}-${failureKind}`;
  const token = `raw-unexpected-testing-token-${capability}-${failureKind}`;
  const providerResponse = [providerMessage, secret, requestBody, token].join(" | ");
  const throwUnexpectedFailure =
    failureKind === "provider"
      ? `      throw new ClerkAPIResponseError(providerResponse, { status: 422, data: [{ code: "form_data_invalid", message: providerResponse }] });`
      : "      throw new Error(providerResponse);";
  const source = [
    'import assert from "node:assert/strict";',
    'import { ClerkAPIResponseError } from "@clerk/shared/error";',
    'import { assertClerkTestPermissions } from "./tests/support/clerk-test-permissions.ts";',
    `const providerMessage = ${JSON.stringify(providerMessage)};`,
    `const secret = ${JSON.stringify(secret)};`,
    `const requestBody = ${JSON.stringify(requestBody)};`,
    `const token = ${JSON.stringify(token)};`,
    `const providerResponse = ${JSON.stringify(providerResponse)};`,
    "let capturedRequestBody;",
    "const clerk = {",
    "  users: {",
    "    createUser: async (params) => {",
    "      capturedRequestBody = JSON.stringify(params);",
    capability === "user"
      ? throwUnexpectedFailure
      : '      throw new ClerkAPIResponseError(requestBody, { status: 422, data: [{ code: "form_data_missing", message: providerMessage }] });',
    "    },",
    "    deleteUser: async () => undefined,",
    "  },",
    "  testingTokens: {",
    "    createTestingToken: async () => {",
    capability === "user"
      ? `      return { token: ${JSON.stringify(token)} };`
      : throwUnexpectedFailure,
    "    },",
    "  },",
    "};",
    "let failure;",
    "try {",
    "  await assertClerkTestPermissions(clerk);",
    "} catch (error) {",
    "  failure = error;",
    "}",
    "assert.ok(failure instanceof Error, \"unexpected preflight failure should reject\");",
    capability === "user"
      ? 'assert.match(failure.message, /failed during disposable-user creation/);'
      : 'assert.match(failure.message, /failed during testing-token creation/);',
    'assert.match(failure.message, /Browser validation did not start/);',
    'assert.match(failure.message, /Check (the Clerk tenant configuration|Clerk connectivity)/);',
    "for (const leakedValue of [providerMessage, secret, requestBody, token, capturedRequestBody]) {",
    "  if (leakedValue) assert.equal(failure.message.includes(leakedValue), false);",
    "}",
    "assert.equal(failure.message.includes('{\"'), false);",
    "console.log(failure.message);",
  ].join("\n");
  return { source, providerMessage, secret, requestBody, token };
}

function seededGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
}

function generatedRedactionCases() {
  const next = seededGenerator(0x595a11);
  const separators = [" ", "-", "_"];
  const casings = [
    (value) => value,
    (value) => value.toUpperCase(),
    (value) => value.replace(/[a-z]/g, (character, index) =>
      index % 2 === 0 ? character.toUpperCase() : character,
    ),
  ];
  const cases = [];
  for (let index = 0; index < 36; index += 1) {
    const caseId = `seed-${index.toString(36).padStart(2, "0")}-${(next() % 0xfff)
      .toString(16)
      .padStart(3, "0")}`;
    const secret = `sentinel-${caseId}-${(next() % 1_000_000).toString(36)}`;
    const separator = separators[next() % separators.length];
    const label = casings[next() % casings.length](
      index % 3 === 0
        ? `api${separator}key`
        : index % 3 === 1
          ? `request${separator}body`
          : "Authorization",
    );
    const credential =
      index % 3 === 0
        ? `sk_test_${secret}`
        : index % 3 === 1
          ? `pk_live_${secret}`
          : `eyJ${secret}payload.eyJ${secret}claims.eyJ${secret}signature`;
    const placement =
      index % 4 === 0
        ? `${label}: ${credential}; second=${credential}`
        : index % 4 === 1
          ? `prefix ${credential} suffix`
          : index % 4 === 2
            ? `GET /sign-in?token=${secret}&credential=${credential}`
            : `${label}:\n{"credential":"${credential}","marker":"${secret}"}`;
    cases.push({ caseId, secrets: [secret, credential], input: placement });
  }
  return cases;
}

function proxyConstructionEnvironment(overrides = {}) {
  const environment = { ...process.env };
  delete environment.CLERK_SECRET_KEY;
  return { ...environment, ...overrides };
}

function listTests(configPath, environment = {}) {
  return execFileSync(
    "npx",
    ["playwright", "test", "--config", configPath, "--list", "--reporter=line"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...environment },
    },
  );
}

test("release command uses an isolated production-only Playwright configuration", () => {
  assert.match(
    packageJson.scripts["verify:managed-clerk-release"],
    /scripts\/run-typechecked-playwright\.mjs --config playwright\.release\.config\.ts/,
  );
  assert.match(config, /validateProductionBaseUrl/);
  assert.match(productionUrlValidation, /PRODUCTION_BASE_URL is required/);
  assert.match(productionUrlValidation, /public HTTPS deployment/);
  assert.match(config, /timeout: 120_000/);
  assert.match(config, /trace: "off"/);
  assert.match(config, /screenshot: "off"/);
  assert.match(config, /reporter: "line"/);
  assert.doesNotMatch(config, /html/);
  assert.doesNotMatch(config, /globalSetup|webServer|tests\/\.auth/);
});

test("every Replit deployment build gates the exact production candidate", () => {
  assert.match(replitConfig, /build = \["npm", "run", "release:build"\]/);
  assert.equal(packageJson.scripts["release:build"], "bash scripts/build-and-verify-release.sh");
  assert.match(candidateBuild, /npm run build/);
  assert.match(candidateBuild, /NODE_ENV=production PORT="\$candidate_port" RELEASE_CANDIDATE_ID="\$candidate_id"/);
  assert.match(candidateBuild, /master-reel-counter-ai\.replit\.app/);
  assert.doesNotMatch(candidateBuild, /VITE_CLERK_PUBLIC_HOST/);
  assert.match(candidateBuild, /wait-for-release-candidate\.mjs/);
  assert.match(candidateBuild, /RELEASE_SMOKE_INTERNAL_CANDIDATE=1/);
  assert.match(candidateBuild, /RELEASE_SMOKE_CANDIDATE_HOST="\$candidate_host"/);
  assert.match(candidateBuild, /RELEASE_SMOKE_CANDIDATE_APP_ORIGIN="http:\/\/127\.0\.0\.1:\$\{candidate_port\}"/);
  assert.match(candidateBuild, /PRODUCTION_BASE_URL="\$candidate_url"/);
  assert.match(candidateBuild, /RELEASE_SMOKE_CANDIDATE_TLS_PORT="\$tls_port"/);
  assert.match(candidateBuild, /RELEASE_SMOKE_CANDIDATE_ID="\$candidate_id"/);
  assert.match(candidateProxy, /"x-forwarded-host": publicHost/);
  assert.match(candidateProxy, /"x-forwarded-proto": "https"/);
  assert.match(config, /--host-resolver-rules=MAP \$\{target\.hostname\}:443 127\.0\.0\.1:\$\{candidateTlsPort\}/);
  assert.match(candidateBuild, /npm run verify:managed-clerk-release/);
  assert.match(candidateBuild, /import \{ CLERK_PROXY_PATH \} from "\.\/shared\/clerk-config\.ts"/);
  assert.match(candidateBuild, /import \{ CLERK_PROXY_READINESS_PATH \} from "\.\/shared\/clerk-config\.ts"/);
  assert.match(candidateBuild, /VITE_CLERK_PROXY_URL="\$clerk_proxy_path"/);
  assert.match(candidateBuild, /\$\{clerk_proxy_readiness_path\}/);
  assert.doesNotMatch(candidateBuild, /\/api\/__clerk\/healthz/);
  assert.match(candidateBuild, /trap on_exit EXIT/);
  assert.match(candidateBuild, /trap 'exit 130' INT/);
  assert.match(candidateBuild, /trap 'exit 143' TERM/);
});

test("manual CI release gate verifies the currently published deployment", () => {
  assert.match(workflow, /name: Verify published managed Clerk deployment/);
  assert.match(workflow, /name: Require safe published production URL/);
  assert.match(workflow, /PRODUCTION_BASE_URL: \$\{\{ vars\.PRODUCTION_BASE_URL \}\}/);
  assert.match(workflow, /PRODUCTION_DEPLOYMENT_ID: \$\{\{ vars\.PRODUCTION_DEPLOYMENT_ID \}\}/);
  assert.match(
    workflow,
    /RELEASE_PUBLISHED_SMOKE_TARGET: \$\{\{ vars\.PRODUCTION_BASE_URL \}\}/,
  );
  assert.match(workflow, /RELEASE_PUBLISHED_SMOKE_MODE: read-only/);
  assert.match(workflow, /run: node scripts\/validate-production-base-url\.mjs/);
  assert.match(workflow, /run: npm run verify:managed-clerk-published/);
  assert.doesNotMatch(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.doesNotMatch(workflow, /CLERK_SECRET_KEY: \$\{\{ secrets\.CLERK_SECRET_KEY \}\}/);
  assert.doesNotMatch(workflow, /image: postgres:16/);
  assert.doesNotMatch(workflow, /run: npm run release:build/);
  assert.doesNotMatch(workflow, /RELEASE_SMOKE_DATABASE_URL:/);
  assert.doesNotMatch(workflow, /RELEASE_CANDIDATE_ID:/);
  assert.match(packageJson.scripts["verify:managed-clerk-published"], /verify-published-release\.mjs/);
  assert.match(publishedSmokeConfig, /validateProductionBaseUrl/);
  assert.match(publishedSmokeConfig, /validateProductionDeploymentId/);
  assert.match(publishedRelease, /validatePublishedSmokeConfiguration\(process\.env\)/);
  assert(
    publishedRelease.indexOf("validatePublishedSmokeConfiguration(process.env)") <
      publishedRelease.indexOf("await verifyPublishedDeploymentIdentity()"),
    "published smoke configuration must validate before network access",
  );
  assert(
    publishedRelease.indexOf("validatePublishedSmokeConfiguration(process.env)") <
      publishedRelease.indexOf("spawnSync("),
    "published smoke configuration must validate before Playwright can start",
  );
  assert.match(publishedRelease, /\/api\/healthz/);
  assert.match(publishedRelease, /buildId !== expectedBuildId/);
  assert.match(publishedRelease, /playwright\.release\.config\.ts/);
  assert.match(publishedRelease, /publishedReadOnlyEnvironment/);
  assert.match(publishedRelease, /delete publishedReadOnlyEnvironment\[name\]/);
  assert.match(publishedRelease, /RELEASE_SMOKE_PUBLISHED_READ_ONLY = "1"/);
  assert.match(publishedSmokeConfig, /"DATABASE_URL"/);
  assert.match(publishedSmokeConfig, /"CLERK_SECRET_KEY"/);
  assert.match(publishedSmokeConfig, /RELEASE_PUBLISHED_SMOKE_TARGET/);
  assert.match(publishedSmokeConfig, /RELEASE_PUBLISHED_SMOKE_MODE/);
  assert.match(publishedSmokeConfig, /refusing an ambiguous published smoke pairing/);
  assert.match(publishedSmokeConfig, /refuses database, Clerk-secret, or internal-candidate inputs/);
  assert.match(publishedRelease, /FORBIDDEN_PUBLISHED_SMOKE_INPUTS/);
  assert.match(publishedSmokeConfig, /"RELEASE_SMOKE_INTERNAL_CANDIDATE"/);
  assert.match(config, /validatePublishedSmokeConfiguration\(process\.env\)/);
  assert.match(config, /!isPublishedReadOnly &&/);
  assert.doesNotMatch(publishedRelease, /release:build|build-and-verify-release/);
  assert.match(candidateBuild, /candidate_id="\$\{RELEASE_CANDIDATE_ID:-/);
  assert.match(
    buildScript,
    /"process\.env\.PRODUCTION_DEPLOYMENT_ID": JSON\.stringify\(productionDeploymentId\)/,
  );
  assert.match(
    productionBuildIdentity,
    /process\.env\.PRODUCTION_DEPLOYMENT_ID\?\.trim\(\) \|\| undefined/,
  );
});

test("manual CI published deployment check requires only matched publishable keys", () => {
  assert.match(workflow, /name: Require matched production Clerk publishable keys/);
  assert.doesNotMatch(workflow, /secrets\.CLERK_SECRET_KEY/);
  assert.equal(
    workflow.match(/CLERK_PUBLISHABLE_KEY: \$\{\{ secrets\.CLERK_PUBLISHABLE_KEY \}\}/g)?.length,
    2,
  );
  assert.equal(
    workflow.match(
      /VITE_CLERK_PUBLISHABLE_KEY: \$\{\{ secrets\.VITE_CLERK_PUBLISHABLE_KEY \}\}/g,
    )?.length,
    2,
  );
  assert.match(workflow, /\[\[ -n "\$CLERK_PUBLISHABLE_KEY" \]\] \|\| missing\+=\("CLERK_PUBLISHABLE_KEY"\)/);
  assert.match(
    workflow,
    /\[\[ -n "\$VITE_CLERK_PUBLISHABLE_KEY" \]\] \|\| missing\+=\("VITE_CLERK_PUBLISHABLE_KEY"\)/,
  );
  assert.match(workflow, /secrets\.VITE_CLERK_PUBLISHABLE_KEY/);
  assert.match(workflow, /validation is blocked: missing production publishable key/);
  assert.doesNotMatch(workflow, /continue-on-error:[\s\S]*Require matched production Clerk publishable keys/);
});

test("published deployment target validation fails closed for missing or unsafe URLs", () => {
  assert.match(productionUrlValidation, /PRODUCTION_BASE_URL is required/);
  assert.match(productionUrlValidation, /must be a valid public HTTPS deployment URL/);
  assert.match(productionUrlValidation, /target\.protocol !== "https:"/);
  assert.match(productionUrlValidation, /target\.username/);
  assert.match(productionUrlValidation, /target\.password/);
  assert.match(productionUrlValidation, /target\.search/);
  assert.match(productionUrlValidation, /target\.hash/);
  assert.match(productionUrlValidation, /localhost/);
  assert.match(productionUrlValidation, /PRODUCTION_DEPLOYMENT_ID is required/);
});

test("published smoke configuration rejects missing and invalid values before network or browser startup", async () => {
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "published-smoke-preflight-"),
  );
  const markerPath = resolve(temporaryDirectory, "unexpected-side-effect");
  const preloadPath = resolve(temporaryDirectory, "observe-side-effects.mjs");
  await writeFile(
    preloadPath,
    [
      'import childProcess from "node:child_process";',
      'import { syncBuiltinESMExports } from "node:module";',
      'import { appendFileSync } from "node:fs";',
      `const marker = ${JSON.stringify(markerPath)};`,
      'globalThis.fetch = async () => { appendFileSync(marker, "fetch\\n"); throw new Error("unexpected health request"); };',
      'childProcess.spawnSync = (...args) => { appendFileSync(marker, "spawn\\n"); return { status: 1 }; };',
      "syncBuiltinESMExports();",
    ].join("\n"),
  );

  const validEnvironment = {
    PRODUCTION_BASE_URL: "https://published.example",
    PRODUCTION_DEPLOYMENT_ID: "deployment-id-847",
    RELEASE_PUBLISHED_SMOKE_TARGET: "https://published.example",
    RELEASE_PUBLISHED_SMOKE_MODE: "read-only",
    CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZGV2JA",
    VITE_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZGV2JA",
  };
  const missingVariables = [
    "PRODUCTION_BASE_URL",
    "PRODUCTION_DEPLOYMENT_ID",
    "RELEASE_PUBLISHED_SMOKE_TARGET",
    "RELEASE_PUBLISHED_SMOKE_MODE",
    "CLERK_PUBLISHABLE_KEY",
    "VITE_CLERK_PUBLISHABLE_KEY",
  ];
  const invalidConfigurations = [
    ["PRODUCTION_BASE_URL", "not-a-public-url", /PRODUCTION_BASE_URL/],
    ["PRODUCTION_DEPLOYMENT_ID", "line one\nline two", /PRODUCTION_DEPLOYMENT_ID/],
    [
      "RELEASE_PUBLISHED_SMOKE_TARGET",
      "https://published.example/nested",
      /must match PRODUCTION_BASE_URL exactly/,
    ],
    ["RELEASE_PUBLISHED_SMOKE_MODE", "fixture-writing", /must be read-only/],
    ["CLERK_PUBLISHABLE_KEY", "not-a-publishable-key", /CLERK_PUBLISHABLE_KEY is malformed/],
    [
      "VITE_CLERK_PUBLISHABLE_KEY",
      "not-a-publishable-key",
      /VITE_CLERK_PUBLISHABLE_KEY is malformed/,
    ],
    [
      "VITE_CLERK_PUBLISHABLE_KEY",
      "pk_test_ZXhhbXBsZS5jb20k",
      /select different tenants/,
    ],
    ["DATABASE_URL", "postgres://customer.invalid/customer", /DATABASE_URL/],
    ["CLERK_SECRET_KEY", "sk_test_never-use", /CLERK_SECRET_KEY/],
  ];

  try {
    for (const name of missingVariables) {
      const environment = { ...validEnvironment };
      delete environment[name];
      await assert.rejects(
        execFileAsync(
          process.execPath,
          ["--import", preloadPath, "scripts/verify-published-release.mjs"],
          { cwd: root, env: environment },
        ),
        (error) => {
          assert.match(error.stderr, new RegExp(name));
          return true;
        },
      );
      await assert.rejects(readFile(markerPath), { code: "ENOENT" });
    }

    for (const [name, value, expectedError] of invalidConfigurations) {
      const environment = { ...validEnvironment, [name]: value };
      await assert.rejects(
        execFileAsync(
          process.execPath,
          ["--import", preloadPath, "scripts/verify-published-release.mjs"],
          { cwd: root, env: environment },
        ),
        (error) => {
          assert.match(error.stderr, expectedError);
          return true;
        },
      );
      await assert.rejects(readFile(markerPath), { code: "ENOENT" });
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  assert.equal(
    validatePublishedSmokeConfiguration(validEnvironment).publishedTarget.origin,
    "https://published.example",
  );
});

test("release workflow and production startup share the two-key tenant contract", () => {
  assert.match(
    serverIndex,
    /resolveClerkEnvironmentPublishableKey\(\{\s*serverPublishableKey: process\.env\.CLERK_PUBLISHABLE_KEY,\s*clientPublishableKey: process\.env\.VITE_CLERK_PUBLISHABLE_KEY,\s*\}\)/,
  );
  assert.match(
    sharedClerkConfig,
    /requirePublishableKey\(\s*input\.serverPublishableKey,\s*"CLERK_PUBLISHABLE_KEY",\s*\)/,
  );
  assert.match(
    sharedClerkConfig,
    /requirePublishableKey\(\s*input\.clientPublishableKey,\s*"VITE_CLERK_PUBLISHABLE_KEY",\s*\)/,
  );
  assert.match(
    sharedClerkConfig,
    /CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY select different tenants/,
  );
  assert.doesNotMatch(
    sharedClerkConfig,
    /allowClientFallback:\s*true/,
  );
});

test("production and release testing derive the proxy path from one shared source", () => {
  assert.match(sharedClerkConfig, /export const CLERK_PROXY_PATH = "\/api\/__clerk";/);
  assert.match(clerkProxyMiddleware, /CLERK_PROXY_PATH[\s\S]*from "@shared\/clerk-config"/);
  assert.match(candidateTesting, /CLERK_PROXY_PATH[\s\S]*from "\.\.\/\.\.\/shared\/clerk-config"/);
  assert.match(releaseSmoke, /CLERK_PROXY_PATH[\s\S]*from "\.\.\/\.\.\/shared\/clerk-config"/);
  assert.match(candidateTesting, /frontendApiUrl: `\$\{candidate\.host\}\$\{CLERK_PROXY_PATH\}`/);
  assert.doesNotMatch(releaseSmoke, /proxyPath:\s*["'`]\/api\/__clerk/);
});

test("standard validation runs the deterministic release proxy contract before live smoke", () => {
  assert.match(
    packageJson.scripts["test:managed-clerk-release-contract"],
    /clerk-candidate-testing\.test\.ts/,
  );
  assert.match(
    readFileSync(resolve(root, "docs/validation/manifest.json"), "utf8"),
    /"name": "clerk-release-contract"[\s\S]*"npm", "run", "test:managed-clerk-release-contract"/,
  );
  assert.match(
    packageJson.scripts["test:managed-clerk-release-contract"],
    /release-schema-preflight\.test\.mjs/,
  );
});

test("release candidate schema setup is isolated, migration-aware, and read-only before fixtures", () => {
  assert.match(candidateBuild, /release-smoke-database\.mjs/);
  assert.match(candidateBuild, /select_release_database[\s\S]*npm run build/);
  assert.match(candidateBuild, /env -u RELEASE_SMOKE_DATABASE_URL npm run build/);
  assert.doesNotMatch(candidateBuild, /export RELEASE_SMOKE_DATABASE_URL/);
  assert.match(candidateBuild, /selected_smoke_database_url="\$\([\s\S]*unset RELEASE_SMOKE_DATABASE_URL/);
  assert.match(candidateBuild, /stop_release_process "\$proxy_pid"[\s\S]*cleanup_release_database/);
  assert.doesNotMatch(candidateBuild, /source "\$database_env"/);
  assert.match(candidateBuild, /timeout --kill-after=1s[\s\S]*release-smoke-database\.mjs cleanup/);
  assert.match(candidateBuild, /RELEASE_SMOKE_DATABASE_URL/);
  assert.match(
    candidateBuild,
    /RELEASE_SMOKE_INTERNAL_CANDIDATE=1[\s\S]*RELEASE_SMOKE_DATABASE_URL="\$selected_smoke_database_url"[\s\S]*RELEASE_PUBLICATION_DATABASE_URL="\$DATABASE_URL"[\s\S]*PRODUCTION_BASE_URL="\$candidate_url"[\s\S]*npm run verify:managed-clerk-release/,
  );
  assert.match(candidateBuild, /prepare-release-test-database\.mjs/);
  assert.match(candidateBuild, /DATABASE_URL="\$selected_smoke_database_url"/);
  assert.match(releaseSchemaPreparation, /drizzle-kit/);
  assert.match(releaseSchemaPreparation, /"export"/);
  assert.match(releaseSchemaPreparation, /Admin.*User.*account role enum/);
  assert.match(releaseSchemaPreparation, /assertReleaseSchema/);
  assert.match(releaseSchemaPreparation, /RELEASE_PUBLICATION_SCHEMA_PREFLIGHT/);
  assert.match(candidateBuild, /RELEASE_PUBLICATION_SCHEMA_PREFLIGHT=1/);
  assert.match(releaseSchemaPreflight, /Release schema preflight failed before fixture provisioning/);
  assert.match(releaseSchemaPreflight, /account_role/);
  assert.match(releaseSchemaPreflight, /is_tester/);
  assert.match(releaseSchemaPreflight, /tester_password/);
  assert.match(releaseSchemaPreflight, /table_name = 'sessions'/);
  assert.match(releaseSmoke, /assertReleaseSchema\(database\)/);
  assert.match(releaseSmoke, /assertIsolatedReleaseDatabase/);
  assert.match(releaseSmoke, /RELEASE_PUBLICATION_DATABASE_URL/);
  assert.match(
    releaseSmoke,
    /assertReleaseSchema\(database\);[\s\S]*removeStaleSmokeUsers/,
  );
  assert.match(
    browserSetup,
    /assertReleaseSchema\(database\);[\s\S]*clerk\.users\.createUser/,
  );
  assert.match(browserRunner, /CREATE DATABASE/);
  assert(
    browserRunner.indexOf("assertIsolatedReleaseDatabase({", browserRunner.indexOf("else {")) <
      browserRunner.indexOf("createTemporaryDatabase(databaseName, browserDatabaseUrl)"),
    "automatic browser database isolation must be established before CREATE DATABASE",
  );
  assert.match(browserRunner, /prepare-release-test-database\.mjs/);
  assert.match(browserRunner, /DROP DATABASE IF EXISTS/);
  assert.match(browserRunner, /RELEASE_SMOKE_DATABASE_URL/);
  assert.match(browserRunner, /RELEASE_PUBLICATION_DATABASE_URL/);
  assert.match(browserRunner, /RELEASE_PUBLICATION_SCHEMA_PREFLIGHT: "0"/);
  assert.match(googleReleaseSmoke, /assertIsolatedReleaseDatabase/);
  assert.match(googleReleaseSmoke, /assertReleaseSchema\(database\)/);
  assert.match(googleReleaseSmoke, /RELEASE_SMOKE_DATABASE_URL/);
  assert.match(googleReleaseSmoke, /RELEASE_PUBLICATION_DATABASE_URL/);
  assert.match(googleReleaseSmoke, /internalCandidate/);
  assert.match(googleReleaseSmoke, /connectionString: process\.env\.RELEASE_SMOKE_DATABASE_URL/);
  assert.doesNotMatch(releaseSmoke, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(googleReleaseSmoke, /process\.env\.DATABASE_URL/);
  assert(
    releaseSmoke.indexOf("assertIsolatedReleaseDatabase({") <
      releaseSmoke.indexOf("createClerkClient({"),
    "managed candidate isolation must be established before provider access",
  );
  assert(
    releaseSmoke.indexOf("assertIsolatedReleaseDatabase({") <
      releaseSmoke.indexOf("new Client({"),
    "managed candidate isolation must be established before SQL access",
  );
  assert(
    googleReleaseSmoke.indexOf("assertIsolatedReleaseDatabase({") <
      googleReleaseSmoke.indexOf("createClerkClient({"),
    "Google candidate isolation must be established before provider access",
  );
  const googleBeforeAll = googleReleaseSmoke.indexOf("test.beforeAll(async () => {");
  const googleSchemaPreflight = googleReleaseSmoke.indexOf(
    "await assertReleaseSchema(database)",
    googleBeforeAll,
  );
  const googlePermissionPreflight = googleReleaseSmoke.indexOf(
    "await assertClerkTestPermissions(clerk)",
    googleBeforeAll,
  );
  assert(googleBeforeAll >= 0);
  assert(googleSchemaPreflight >= 0);
  assert(googlePermissionPreflight >= 0);
  assert(
    googleSchemaPreflight < googlePermissionPreflight,
    "Google schema preflight must pass before Clerk permission probes",
  );
  assert(
    googleReleaseSmoke.indexOf("assertIsolatedReleaseDatabase({") <
      googleReleaseSmoke.indexOf("new Client({"),
    "Google candidate isolation must be established before SQL access",
  );
  assert.match(config, /published-auth-read-only\.spec\.ts/);
  assert.match(config, /validatePublishedSmokeConfiguration\(process\.env\)/);
  assert.match(publishedReadOnlySmoke, /page\.request\.get\("\/api\/auth\/user"\)/);
  assert.match(publishedReadOnlySmoke, /RELEASE_SMOKE_PUBLISHED_READ_ONLY/);
  assert.match(publishedReadOnlySmoke, /RELEASE_PUBLISHED_SMOKE_TARGET/);
  assert.match(publishedReadOnlySmoke, /RELEASE_PUBLISHED_SMOKE_MODE/);
  assert.match(publishedReadOnlySmoke, /refuses privileged/);
  assert.doesNotMatch(
    publishedReadOnlySmoke,
    /createClerkClient|new Client|database\.query|createUser|deleteUser|INSERT INTO|DELETE FROM/,
  );
});

async function runReleaseDatabaseHarness({ directory, lifecycleBody, exitStatus = "0", extraEnv = {} }) {
  const lifecyclePath = resolve(directory, "database-lifecycle.sh");
  const markerPath = resolve(directory, "database-lifecycle.log");
  await writeFile(
    lifecyclePath,
    ["#!/usr/bin/env bash", "set -euo pipefail", lifecycleBody, ""].join("\n"),
  );
  await chmod(lifecyclePath, 0o755);
  const result = await execFileAsync(
    "bash",
    [resolve(root, "scripts/build-and-verify-release.sh")],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://publisher:secret@db.example/publication",
        RELEASE_DATABASE_LIFECYCLE_COMMAND: lifecyclePath,
        RELEASE_DATABASE_HARNESS_EXIT_STATUS: exitStatus,
        RELEASE_DATABASE_MARKER: markerPath,
        RELEASE_CLEANUP_TIMEOUT_SECONDS: "1",
        ...extraEnv,
      },
    },
  ).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
  );
  return { ...result, markerPath };
}

test("missing release smoke target is provisioned before build and cleaned on success", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-database-harness-"));
  try {
    const result = await runReleaseDatabaseHarness({
      directory,
      lifecycleBody: `
case "$1" in
  select)
    printf '{"owned":true}' > "$2"
    printf 'select:%s\\n' "\${RELEASE_SMOKE_DATABASE_URL:-missing}" >> "$RELEASE_DATABASE_MARKER"
    ;;
  url) printf 'postgresql://smoke:secret@db.example/owned' ;;
  cleanup) printf 'cleanup\\n' >> "$RELEASE_DATABASE_MARKER" ;;
esac`,
    });
    assert.equal(result.code, 0);
    assert.equal(await readFile(result.markerPath, "utf8"), "select:missing\ncleanup\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit release smoke target is preserved and cleanup runs after candidate failure", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-database-harness-"));
  try {
    const explicit = "postgresql://smoke:secret@db.example/explicit";
    const result = await runReleaseDatabaseHarness({
      directory,
      exitStatus: "37",
      extraEnv: { RELEASE_SMOKE_DATABASE_URL: explicit },
      lifecycleBody: `
case "$1" in
  select)
    printf '{"owned":false}' > "$2"
    printf 'select:%s\\n' "$RELEASE_SMOKE_DATABASE_URL" >> "$RELEASE_DATABASE_MARKER"
    ;;
  url) printf '%s' "$RELEASE_SMOKE_DATABASE_URL" ;;
  cleanup) printf 'cleanup\\n' >> "$RELEASE_DATABASE_MARKER" ;;
esac`,
    });
    assert.equal(result.code, 37);
    assert.equal(await readFile(result.markerPath, "utf8"), `select:${explicit}\ncleanup\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("database creation and cleanup failures block release without leaking credentials", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-database-harness-"));
  try {
    const creation = await runReleaseDatabaseHarness({
      directory,
      lifecycleBody: `echo "creation denied" >&2; exit 1`,
    });
    assert.equal(creation.code, 1);
    assert.match(creation.stderr, /creation denied/);
    assert.equal(creation.stderr.includes("publisher:secret"), false);

    const cleanup = await runReleaseDatabaseHarness({
      directory,
      lifecycleBody: `
if [[ "$1" == select ]]; then
  printf '{"owned":true}' > "$2"
elif [[ "$1" == url ]]; then
  printf 'postgresql://smoke:secret@db.example/owned'
else
  echo "drop denied" >&2
  exit 1
fi`,
    });
    assert.equal(cleanup.code, 1);
    assert.match(cleanup.stderr, /temporary database cleanup failed/);
    assert.equal(cleanup.stderr.includes("smoke:secret"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("selection timeout still invokes state-based cleanup", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-database-harness-"));
  try {
    const result = await runReleaseDatabaseHarness({
      directory,
      extraEnv: { RELEASE_DATABASE_SELECTION_TIMEOUT_SECONDS: "1" },
      lifecycleBody: `
if [[ "$1" == select ]]; then
  printf '{"owned":true}' > "$2"
  sleep 60
elif [[ "$1" == cleanup ]]; then
  printf 'cleanup\\n' >> "$RELEASE_DATABASE_MARKER"
fi`,
    });
    assert.equal(result.code, 124);
    assert.equal(await readFile(result.markerPath, "utf8"), "cleanup\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} after database selection cleans the owned target`, async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "release-database-signal-"));
    const lifecyclePath = resolve(directory, "database-lifecycle.sh");
    const markerPath = resolve(directory, "database-lifecycle.log");
    await writeFile(
      lifecyclePath,
      `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  select) printf '{"owned":true}' > "$2"; printf 'selected\\n' >> "$RELEASE_DATABASE_MARKER" ;;
  url) printf 'postgresql://smoke:secret@db.example/owned' ;;
  cleanup) printf 'cleanup\\n' >> "$RELEASE_DATABASE_MARKER" ;;
esac
`,
    );
    await chmod(lifecyclePath, 0o755);
    const child = spawn("bash", [resolve(root, "scripts/build-and-verify-release.sh")], {
      cwd: root,
      detached: true,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://publisher:secret@db.example/publication",
        RELEASE_DATABASE_LIFECYCLE_COMMAND: lifecyclePath,
        RELEASE_DATABASE_HARNESS_WAIT: "1",
        RELEASE_DATABASE_MARKER: markerPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      let selected = false;
      for (let attempt = 0; attempt < 500; attempt += 1) {
        if ((await readFile(markerPath, "utf8").catch(() => "")).includes("selected")) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      }
      selected = (await readFile(markerPath, "utf8").catch(() => "")).includes("selected");
      assert.equal(selected, true, "release harness did not finish database selection");
      process.kill(-child.pid, signal);
      const outcome = await new Promise((resolvePromise) => {
        child.once("exit", (code, childSignal) => resolvePromise({ code, signal: childSignal }));
      });
      assert.ok(outcome.code !== 0 || outcome.signal);
      assert.match(await readFile(markerPath, "utf8"), /selected\ncleanup\n/);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("real lifecycle helper persists ownership, rolls back ambiguous create, and drops idempotently", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-database-helper-"));
  const statePath = resolve(directory, "state.json");
  const queries = [];
  class SuccessfulClient {
    async connect() {}
    async query(sql) {
      queries.push(sql);
    }
    async end() {}
  }
  try {
    const state = await createOwnedDatabase(
      "postgresql://publisher:secret@db.example/publication",
      statePath,
      { ClientClass: SuccessfulClient, uuid: () => "00000000-0000-0000-0000-000000000001" },
    );
    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(persisted.databaseName, state.databaseName);
    assert.deepEqual(Object.keys(persisted).sort(), ["databaseName", "owned"]);
    const publicationDatabaseUrl = "postgresql://publisher:secret@db.example/publication";
    await dropOwnedDatabase(state, { ClientClass: SuccessfulClient, publicationDatabaseUrl });
    await dropOwnedDatabase(state, { ClientClass: SuccessfulClient, publicationDatabaseUrl });
    assert.equal(queries.filter((sql) => /^CREATE DATABASE/.test(sql)).length, 1);
    assert.equal(queries.filter((sql) => /^DROP DATABASE IF EXISTS/.test(sql)).length, 2);

    class AmbiguousFailureClient extends SuccessfulClient {
      async query(sql) {
        queries.push(sql);
        if (/^CREATE DATABASE/.test(sql)) {
          const error = new Error("credential-bearing provider detail");
          error.code = "42501";
          throw error;
        }
      }
    }
    await assert.rejects(
      createOwnedDatabase(
        "postgresql://publisher:secret@db.example/publication",
        statePath,
        { ClientClass: AmbiguousFailureClient, uuid: () => "00000000-0000-0000-0000-000000000002" },
      ),
      (error) =>
        /permission to create and drop temporary databases/.test(error.message) &&
        !error.message.includes("publisher:secret") &&
        !error.message.includes("credential-bearing"),
    );
    assert.ok(queries.some((sql) => /^DROP DATABASE IF EXISTS.*000000000002/.test(sql)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real release lifecycle CLI creates and removes a PostgreSQL database", async (context) => {
  if (!process.env.DATABASE_URL) {
    context.skip("DATABASE_URL is unavailable");
    return;
  }
  const directory = await mkdtemp(resolve(tmpdir(), "release-database-live-"));
  const statePath = resolve(directory, "state.json");
  const helperPath = resolve(root, "scripts/release-smoke-database.mjs");
  try {
    await execFileAsync(process.execPath, [helperPath, "select", statePath], {
      cwd: root,
      env: { ...process.env, RELEASE_SMOKE_DATABASE_URL: "" },
    });
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.match(state.databaseName, /^release_smoke_/);
    const selectedUrl = await execFileAsync(process.execPath, [helperPath, "url", statePath], {
      cwd: root,
    });
    assert.equal(new URL(selectedUrl.stdout).pathname, `/${state.databaseName}`);
    await execFileAsync(process.execPath, [helperPath, "cleanup", statePath], { cwd: root });
    const adminUrl = new URL(process.env.DATABASE_URL);
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    try {
      const result = await admin.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [state.databaseName],
      );
      assert.equal(result.rowCount, 0);
    } finally {
      await admin.end();
    }
  } finally {
    const state = await readFile(statePath, "utf8").then(JSON.parse, () => null);
    if (state?.owned) await dropOwnedDatabase(state).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("consecutive automatic release runs each clean their owned database", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-database-harness-"));
  try {
    const lifecycleBody = `
case "$1" in
  select)
    printf '{"owned":true}' > "$2"
    printf 'select\\n' >> "$RELEASE_DATABASE_MARKER"
    ;;
  url) printf 'postgresql://smoke:secret@db.example/owned' ;;
  cleanup) printf 'cleanup\\n' >> "$RELEASE_DATABASE_MARKER" ;;
esac`;
    const first = await runReleaseDatabaseHarness({ directory, lifecycleBody });
    const second = await runReleaseDatabaseHarness({ directory, lifecycleBody });
    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
    assert.equal(await readFile(first.markerPath, "utf8"), "select\ncleanup\nselect\ncleanup\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production Clerk proxy fails closed and exposes public readiness before auth", () => {
  assert.match(
    clerkProxyMiddleware,
    /NODE_ENV === "production" && !environment\.CLERK_SECRET_KEY/,
  );
  assert.match(clerkProxyMiddleware, /CLERK_SECRET_KEY is required/);
  assert.doesNotMatch(clerkProxyMiddleware, /if \(!secretKey\) \{\s*return .*next/);

  const readinessRoute = serverIndex.indexOf("app.get(CLERK_PROXY_READINESS_PATH");
  const proxyMount = serverIndex.indexOf("app.use(CLERK_PROXY_PATH");
  const clerkAuth = serverIndex.indexOf("clerkMiddleware((req)");
  const routeRegistration = serverIndex.indexOf("await registerRoutes");
  assert(readinessRoute >= 0);
  assert(readinessRoute < proxyMount);
  assert(proxyMount < clerkAuth);
  assert(readinessRoute < routeRegistration);
  assert.match(serverIndex, /candidateId: process\.env\.RELEASE_CANDIDATE_ID/);
  assert.match(serverIndex, /buildId: productionBuildId/);
});

test("published verification requires and checks the immutable build identity", () => {
  assert.match(publishedReadOnlySmoke, /PRODUCTION_DEPLOYMENT_ID/);
  assert.match(publishedReadOnlySmoke, /\/api\/healthz/);
  assert.match(publishedReadOnlySmoke, /buildId: process\.env\.PRODUCTION_DEPLOYMENT_ID/);
  assert.match(publishedRelease, /redirect: "manual"/);
  assert.match(publishedRelease, /refusing to verify an unknown deployment/);
});

test("a stale built artifact cannot pass published verification with the expected runtime ID", async () => {
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "published-build-identity-"),
  );
  const staleArtifactPath = resolve(temporaryDirectory, "stale-release-identity.mjs");
  const preloadPath = resolve(temporaryDirectory, "mock-stale-release-health.mjs");
  const markerPath = resolve(temporaryDirectory, "browser-started");
  const staleBuildId = "previous-release-build";
  const expectedBuildId = "intended-release-build";

  try {
    await esbuild({
      entryPoints: [resolve(root, "server/lib/production-build-identity.ts")],
      platform: "node",
      bundle: true,
      format: "esm",
      outfile: staleArtifactPath,
      define: {
        "process.env.PRODUCTION_DEPLOYMENT_ID": JSON.stringify(staleBuildId),
      },
    });

    await writeFile(
      preloadPath,
      [
        'import childProcess from "node:child_process";',
        'import { syncBuiltinESMExports } from "node:module";',
        'import { appendFileSync } from "node:fs";',
        "const { productionBuildId } = await import(process.env.STALE_BUILD_ID_MODULE_URL);",
        'globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, buildId: productionBuildId }), { status: 200 });',
        `childProcess.spawnSync = () => { appendFileSync(${JSON.stringify(markerPath)}, "started\\n"); return { status: 0 }; };`,
        "syncBuiltinESMExports();",
      ].join("\n"),
    );

    await assert.rejects(
      execFileAsync(
        process.execPath,
        ["--import", preloadPath, "scripts/verify-published-release.mjs"],
        {
          cwd: root,
          env: {
            PRODUCTION_BASE_URL: "https://published.example",
            PRODUCTION_DEPLOYMENT_ID: expectedBuildId,
            RELEASE_PUBLISHED_SMOKE_TARGET: "https://published.example",
            RELEASE_PUBLISHED_SMOKE_MODE: "read-only",
            CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZGV2JA",
            VITE_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZGV2JA",
            STALE_BUILD_ID_MODULE_URL: pathToFileURL(staleArtifactPath).href,
          },
        },
      ),
      (error) => {
        assert.match(
          error.stderr,
          /Published build identity is absent or does not match the intended release/,
        );
        return true;
      },
    );
    await assert.rejects(readFile(markerPath), { code: "ENOENT" });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("development retains its proxy-free Clerk path", () => {
  assert.match(
    clerkProxyMiddleware,
    /if \(process\.env\.NODE_ENV !== "production"\) \{\s*return \(_req, _res, next\) => next\(\)/,
  );
});

test("production proxy construction rejects missing configuration with a safe error", async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ["--import", "tsx/esm", "--input-type=module", "--eval", proxyConstructionProgram],
      {
        cwd: root,
        env: proxyConstructionEnvironment({ NODE_ENV: "production" }),
      },
    ),
    (error) => {
      assert.match(error.stderr, /CLERK_SECRET_KEY is required/);
      assert.doesNotMatch(error.stderr, /sk_(?:live|test)_/);
      return true;
    },
  );
});

test("configured production and proxy-free development construct Clerk middleware", async () => {
  await execFileAsync(
    process.execPath,
    ["--import", "tsx/esm", "--input-type=module", "--eval", proxyConstructionProgram],
    {
      cwd: root,
      env: proxyConstructionEnvironment({
        NODE_ENV: "production",
        CLERK_SECRET_KEY: "not-logged-test-value",
      }),
    },
  );
  await execFileAsync(
    process.execPath,
    ["--import", "tsx/esm", "--input-type=module", "--eval", proxyConstructionProgram],
    {
      cwd: root,
      env: proxyConstructionEnvironment({ NODE_ENV: "development" }),
    },
  );
});

test("candidate readiness rejects a healthy process with the wrong build identity", async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, candidateId: "another-build" }));
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  assert(address && typeof address === "object");
  const liveProcess = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
  try {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "scripts/wait-for-release-candidate.mjs",
          `http://127.0.0.1:${address.port}`,
          "expected-build",
          String(liveProcess.pid),
          "400",
        ],
        { cwd: root },
      ),
      /Production candidate did not become ready/,
    );
  } finally {
    liveProcess.kill();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test("ordinary and release Playwright configurations have disjoint discovery", () => {
  const ordinary = listTests("playwright.config.ts");
  const release = listTests("playwright.release.config.ts", {
    PRODUCTION_BASE_URL: "https://example.com",
  });
  assert.doesNotMatch(ordinary, /managed Clerk sign-in preserves/);
  assert.match(release, /published managed Clerk and Google boundaries are reachable without fixture writes/);
  assert.doesNotMatch(release, /managed Clerk sign-in preserves/);
  assert.doesNotMatch(release, /dashboard\.spec|settings\.spec|session\.spec/);
  assert.throws(
    () => listTests("playwright.release.config.ts", {
      PRODUCTION_BASE_URL: "https://example.com",
      PRODUCTION_DEPLOYMENT_ID: "test-deployment",
      RELEASE_PUBLISHED_SMOKE_TARGET: "https://example.com",
      RELEASE_PUBLISHED_SMOKE_MODE: "read-only",
      CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZGV2JA",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZGV2JA",
      DATABASE_URL: "",
      RELEASE_SMOKE_DATABASE_URL: "",
      RELEASE_PUBLICATION_DATABASE_URL: "",
      RELEASE_PUBLISHED_SMOKE_DATABASE_URL: "",
      CLERK_SECRET_KEY: "",
      RELEASE_SMOKE_PUBLISHED_READ_ONLY: "1",
      RELEASE_SMOKE_INTERNAL_CANDIDATE: "1",
      RELEASE_SMOKE_CANDIDATE_HOST: "example.com",
      RELEASE_SMOKE_CANDIDATE_TLS_PORT: "443",
    }),
    /refuses database, Clerk-secret, or internal-candidate inputs/,
  );
});

test("smoke uses disposable managed identity and preserves local authorization state", () => {
  assert.match(smoke, /clerk\.users\.createUser/);
  assert.match(smoke, /externalId: localUserId/);
  assert.match(smoke, /approved, rejected, role/);
  assert.match(smoke, /approved: true, rejected: false, role: "Admin"/);
  assert.match(smoke, /clerk\.users\.deleteUser/);
  assert.match(smoke, /DELETE FROM users WHERE id = \$1 RETURNING id/);
  assert.match(smoke, /assertProviderUserAbsent/);
  assert.match(smoke, /assertLocalUserAbsent/);
  assert.match(smoke, /externalId: \[localUserId\]/);
  assert.match(smoke, /SELECT id FROM users WHERE id = \$1/);
  assert.match(smoke, /cleanupBrowserSession/);
  assert.match(smoke, /context\.clearCookies\(\)/);
  assert.match(smoke, /context\.close\(\)/);
  assert.match(smoke, /delete process\.env\.CLERK_TESTING_TOKEN/);
  assert.match(smoke, /Managed Clerk release smoke cleanup failed/);
  assert.match(smoke, /removeStaleSmokeUsers/);
  assert.match(smoke, /createdAtBefore: cutoff/);
  assert.match(smoke, /externalId\?\.startsWith\(SMOKE_ID_PREFIX\)/);
  assert.match(smoke, /clerkTesting\.signIn\(\{/);
  assert.doesNotMatch(smoke, /name: \/continue\/i/);
  assert.doesNotMatch(smoke, /rejectUnauthorized: false/);
  assert.match(smoke, /resolveClerkEnvironmentPublishableKey/);
  assert.match(smoke, /CLERK_PUBLISHABLE_KEY/);
  assert.match(smoke, /VITE_CLERK_PUBLISHABLE_KEY/);
  assert.doesNotMatch(config, /storageState/);
});

test("ordinary browser fixtures persist Clerk external IDs as local account IDs", () => {
  assert.match(browserSetup, /externalId: localUserId/);
  assert.match(browserSetup, /id, clerk_user_id, email/);
  assert.match(browserSetup, /\[localUserId, clerkUser\.id, email\]/);
  assert.doesNotMatch(
    browserSetup,
    /INSERT INTO users \(id, email[\s\S]*\[clerkUser\.id, email\]/,
  );
});

test("ordinary browser fixtures clean disposable provider identities on every run", () => {
  assert.match(ordinaryConfig, /globalTeardown: "\.\/tests\/global-teardown\.ts"/);
  assert.match(browserSetup, /cleanupClerkBrowserFixture\(clerk, database, previousFixture\)/);
  assert.match(browserSetup, /createdFixture = \{/);
  assert.match(browserSetup, /writeClerkBrowserFixture\(createdFixture\)/);
  assert.match(browserSetup, /cleanupClerkBrowserFixture\(clerk, database, createdFixture\)/);
  assert.match(browserSetup, /Browser fixture setup and cleanup both failed/);
  assert.match(browserSetup, /browser\?\.close\(\)/);
  assert.match(browserFixtureCleanup, /requires a Clerk development tenant/);
  assert.match(browserFixtureCleanup, /await database\.query\("BEGIN"\)/);
  assert.match(browserFixtureCleanup, /await database\.query\("ROLLBACK"\)/);
  assert.match(browserFixtureCleanup, /clerk\.users\.deleteUser\(fixture\.clerkUserId\)/);
  assert.match(browserFixtureCleanup, /DELETE FROM users WHERE id = \$1/);
  assert.doesNotMatch(browserFixtureCleanup, /getUserList|WHERE id LIKE/);
});

test("browser setup reports missing Clerk test permissions before fixtures", () => {
  assert.match(browserSetup, /assertClerkTestPermissions\(clerk\)/);
  assert.match(googleReleaseSmoke, /test\.beforeAll\(async \(\) => \{/);
  assert.match(googleReleaseSmoke, /assertClerkTestPermissions\(clerk\)/);
  assert.match(clerkTestPermissions, /createUser\(\{\} as never\)/);
  assert.match(clerkTestPermissions, /createTestingToken\(\)/);
  assert.match(clerkTestPermissions, /form_data_missing/);
  assert.match(clerkTestPermissions, /permissionPreflightError/);
  assert.match(clerkTestPermissions, /Browser validation did not start/);
  assert.match(clerkTestPermissions, /deleteUser\(probeUserId\)/);
  assert.doesNotMatch(clerkTestPermissions, /error\.message/);
  assert.doesNotMatch(clerkTestPermissions, /JSON\.stringify\(error/);
});

test("permission preflight redacts forbidden Clerk responses for both capabilities", async () => {
  for (const capability of ["user", "testing-token"]) {
    const probe = clerkPermissionProbeProgram(capability);
    const result = await execFileAsync(
      process.execPath,
      ["--import", "tsx/esm", "--input-type=module", "--eval", probe.source],
      { cwd: root, maxBuffer: 1024 * 1024 },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(
      output,
      capability === "user"
        ? /disposable-user creation[\s\S]*manage users/
        : /testing-token creation[\s\S]*create testing tokens/,
    );
    for (const secret of [
      probe.providerMessage,
      probe.secret,
      probe.requestBody,
      probe.token,
      '{"',
    ]) {
      assert.equal(
        output.includes(secret),
        false,
        `${capability} permission failure leaked ${secret}`,
      );
    }
  }
});

test("permission preflight redacts unexpected Clerk and network failures", async () => {
  for (const capability of ["user", "testing-token"]) {
    for (const failureKind of ["provider", "network"]) {
      const probe = clerkUnexpectedProbeProgram(capability, failureKind);
      const result = await execFileAsync(
        process.execPath,
        ["--import", "tsx/esm", "--input-type=module", "--eval", probe.source],
        { cwd: root, maxBuffer: 1024 * 1024 },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      assert.match(
        output,
        capability === "user"
          ? /failed during disposable-user creation/
          : /failed during testing-token creation/,
      );
      assert.match(output, /Browser validation did not start/);
      for (const secret of [
        probe.providerMessage,
        probe.secret,
        probe.requestBody,
        probe.token,
        '{"',
      ]) {
        assert.equal(
          output.includes(secret),
          false,
          `${capability} ${failureKind} failure leaked ${secret}`,
        );
      }
    }
  }
});

test("smoke uses Clerk's supported testing sign-in and keeps safe failure evidence", () => {
  assert.equal(packageJson.dependencies["@clerk/backend"], "^3.17.2");
  assert.equal(packageJson.devDependencies["@clerk/testing"], "^2.2.33");
  assert.match(smoke, /setupCandidateClerkTestingToken\(\{/);
  assert.match(smoke, /localCandidateOrigin: process\.env\.RELEASE_SMOKE_CANDIDATE_APP_ORIGIN/);
  assert.match(smoke, /CLERK_TESTING_TOKEN/);
  assert.match(smoke, /clerkTesting\.signIn\(\{/);
  assert.match(smoke, /frontendApiUrl: new URL\(CLERK_TESTING_FRONTEND_API_ORIGIN\)\.host/);
  assert.match(
    smoke,
    /waitForCompletedSignIn\(page, routeStates\);\s*await page\.goto\("\/settings"\);\s*await expect\(page\)\.toHaveURL\(`\$\{baseURL\}\/settings`\);\s*await expect\(page\.getByTestId\("text-settings-title"\)\)/,
  );
  assert.doesNotMatch(smoke, /history\.replaceState/);
  assert.match(smoke, /request\.isNavigationRequest\(\)/);
  assert.match(smoke, /request\.resourceType\(\) === "document"/);
  assert.match(smoke, /request\.frame\(\) === page\.mainFrame\(\)/);
  assert.match(smoke, /clerkScriptBoots\.recordDocument\(safeDiagnosticPath\(response\.url\(\)\)\)/);
  assert.match(smoke, /clerkScriptBoots\.recordScript\(response\.url\(\), response\.status\(\), response\.headers\(\)\["content-type"\]/);
  assert.match(smoke, /clerkScriptBoots\.assertValid\(\)/);
  assert.match(smoke, /clerkScriptBoots: clerkScriptBoots\.diagnostic\(\)/);
  assert.match(smoke, /managed-clerk-browser-trace/);
  assert.match(smoke, /clerkRequests/);
  assert.match(
    smoke,
    /request\.method\(\).*safeDiagnosticPath\(request\.url\(\)\).*normalizedFailureClass/s,
  );
  assert.match(
    smoke,
    /request\.method\(\).*safeDiagnosticPath\(response\.url\(\)\).*response\.status\(\)/s,
  );
  assert.match(smoke, /Native Playwright traces retain cookies and request payloads/);
  assert.doesNotMatch(smoke, /goto\(`\/sign-in\?__clerk_testing_token=/);
  assert.match(candidateBuild, /test-results\/release-diagnostics/);
  assert.match(candidateBuild, /redact-release-diagnostics\.mjs/);
  assert.doesNotMatch(candidateBuild, /cat "\$(?:server|proxy)_log"/);
  assert.equal(candidateBuild.match(/print_safe_log "\$(?:server|proxy)_log"/g)?.length, 2);
  assert.doesNotMatch(
    candidateBuild,
    /tail -n 300 "\$(?:source|1)"\s*\|\s*node scripts\/redact-release-diagnostics\.mjs/,
  );
  assert.match(diagnosticRedactor, /\[REDACTED\]/);
  assert.match(candidateBuild, /tail -n 300/);
  assert.match(candidateBuild, /print-release-diagnostics\.mjs/);
  assert.match(workflow, /test-results\//);
});

test("Clerk release scripts are checked once per completed document boot, not once per page", () => {
  const origin = "https://candidate.example";
  const proxy = "/api/__clerk";
  const script = `${origin}${proxy}/npm/@clerk/clerk-js@5.0.0/dist/clerk.browser.js`;
  const create = () => createClerkScriptBootTracker(origin, proxy);
  const valid = (tracker) => tracker.recordScript(script, 200, "application/javascript; charset=utf-8");

  const single = create();
  single.recordDocument("/settings");
  valid(single);
  assert.doesNotThrow(() => single.assertValid());

  const navigated = create();
  navigated.recordDocument("/settings");
  valid(navigated);
  navigated.recordDocument("/sign-in");
  valid(navigated);
  navigated.recordDocument("/settings");
  valid(navigated);
  assert.doesNotThrow(() => navigated.assertValid());
  assert.deepEqual(navigated.diagnostic().boots.map(({ document, scriptCount }) => [document, scriptCount]), [
    ["/settings", 1], ["/sign-in", 1], ["/settings", 1],
  ]);

  const duplicate = create();
  duplicate.recordDocument("/settings");
  valid(duplicate);
  duplicate.recordScript(script, 200, "text/javascript");
  assert.throws(() => duplicate.assertValid(), /document boot 1 \(observed 2\)/);

  const missing = create();
  missing.recordDocument("/settings");
  assert.throws(() => missing.assertValid(), /document boot 1 \(observed 0\)/);
  const missingAfterNavigation = create();
  missingAfterNavigation.recordDocument("/settings");
  valid(missingAfterNavigation);
  missingAfterNavigation.recordDocument("/sign-in");
  assert.throws(() => missingAfterNavigation.assertValid(), /document boot 2 \(observed 0\)/);

  for (const [url, status, mime] of [
    [script.replace(origin, "https://other.example"), 200, "application/javascript"],
    [script.replace(proxy, "/other-proxy"), 200, "application/javascript"],
    [script.replace("/npm/", "/other/npm/"), 200, "application/javascript"],
    [script, 404, "application/javascript"],
    [script, 200, "text/html"],
  ]) {
    const invalid = create();
    invalid.recordDocument("/settings");
    invalid.recordScript(url, status, mime);
    assert.throws(() => invalid.assertValid(), /200 JavaScript response from the exact candidate proxy/);
  }
  const orphan = create();
  orphan.recordScript(script, 200, "application/javascript");
  assert.throws(() => orphan.assertValid(), /completed candidate document boot/);
});

test("failed EXIT cleanup keeps the release status and removes its fixtures", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-cleanup-harness-"));
  const browserPath = resolve(directory, "browser.json");
  const candidateLogPath = resolve(directory, "candidate.log");
  const proxyLogPath = resolve(directory, "proxy.log");
  const tlsDirectory = resolve(directory, "tls");
  const markerPath = resolve(directory, "cleanup-attempts.log");
  const redactorPath = resolve(directory, "failing-redactor.sh");
  const diagnosticsPath = resolve(directory, "failing-diagnostics.sh");
  const retainedDiagnosticsDirectory = resolve(directory, "retained-diagnostics");
  await mkdir(tlsDirectory);
  await writeFile(browserPath, "{}");
  await writeFile(candidateLogPath, "candidate evidence");
  await writeFile(proxyLogPath, "proxy evidence");
  await writeFile(
    redactorPath,
    [
      "#!/usr/bin/env bash",
      'printf "redactor\\n" >> "$RELEASE_CLEANUP_MARKER"',
      "exit 71",
      "",
    ].join("\n"),
  );
  await writeFile(
    diagnosticsPath,
    [
      "#!/usr/bin/env bash",
      'printf "diagnostics\\n" >> "$RELEASE_CLEANUP_MARKER"',
      "exit 72",
      "",
    ].join("\n"),
  );
  await chmod(redactorPath, 0o755);
  await chmod(diagnosticsPath, 0o755);
  const candidateProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], {
    stdio: "ignore",
  });
  const proxyProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], {
    stdio: "ignore",
  });
  try {
    const failure = await execFileAsync(
      "bash",
      [resolve(root, "scripts/build-and-verify-release.sh")],
      {
        cwd: root,
        env: {
          ...process.env,
          RELEASE_CLEANUP_HARNESS: "1",
          RELEASE_CLEANUP_EXIT_STATUS: "23",
          RELEASE_CLEANUP_TIMEOUT_SECONDS: "2",
          RELEASE_SERVER_PID: String(candidateProcess.pid),
          RELEASE_PROXY_PID: String(proxyProcess.pid),
          RELEASE_SERVER_LOG: candidateLogPath,
          RELEASE_PROXY_LOG: proxyLogPath,
          RELEASE_BROWSER_DIAGNOSTIC: browserPath,
          RELEASE_TLS_DIR: tlsDirectory,
          RELEASE_DIAGNOSTICS_DIR: retainedDiagnosticsDirectory,
          RELEASE_REDACT_COMMAND: redactorPath,
          RELEASE_DIAGNOSTICS_COMMAND: diagnosticsPath,
          RELEASE_CLEANUP_MARKER: markerPath,
        },
      },
    ).then(
      () => null,
      (error) => error,
    );
    assert(failure);
    assert.equal(failure.code, 23);
    assert.match(failure.stderr, /diagnostic artifact retention failed/);
    assert.match(failure.stderr, /diagnostic printing failed/);
    assert.equal(await readFile(markerPath, "utf8"), "redactor\nredactor\ndiagnostics\n");
    assert.throws(() => process.kill(candidateProcess.pid, 0), /ESRCH/);
    assert.throws(() => process.kill(proxyProcess.pid, 0), /ESRCH/);
    await assert.rejects(readFile(candidateLogPath, "utf8"));
    await assert.rejects(readFile(proxyLogPath, "utf8"));
    await assert.rejects(readFile(tlsDirectory, "utf8"));
  } finally {
    if (candidateProcess.exitCode === null) candidateProcess.kill("SIGKILL");
    if (proxyProcess.exitCode === null) proxyProcess.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("early release failure excludes browser and role diagnostics from a prior run", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-stale-diagnostics-"));
  const diagnosticsDirectory = resolve(directory, "diagnostics");
  const browserPath = resolve(directory, "browser.json");
  const priorAdminPath = "/settings";
  const priorUserPath = "/stats";
  try {
    await mkdir(diagnosticsDirectory);
    await writeFile(
      browserPath,
      JSON.stringify({
        finalPath: "/sign-in/client-trust",
        routeStates: ["/sign-in", "/sign-in/client-trust"],
        clerkRequests: ["POST /api/__clerk/v1/client/sign_ins 200"],
      }),
    );
    await writeFile(
      resolve(diagnosticsDirectory, "google-admin.json"),
      JSON.stringify({
        finalPath: priorAdminPath,
        routeStates: [priorAdminPath],
        sessionObservations: [
          {
            path: priorAdminPath,
            clerkLoaded: true,
            hasActiveSession: true,
            status: "active-session-route-ready",
            phase: "completed",
            elapsedMs: 1,
          },
        ],
        sessionFailureCategory: "none",
      }),
    );
    await writeFile(
      resolve(diagnosticsDirectory, "google-user.json"),
      JSON.stringify({ finalPath: priorUserPath, routeStates: [priorUserPath] }),
    );

    const failure = await execFileAsync(
      "bash",
      [resolve(root, "scripts/build-and-verify-release.sh")],
      {
        cwd: root,
        env: {
          ...process.env,
          RELEASE_CLEANUP_HARNESS: "1",
          RELEASE_CLEANUP_EXIT_STATUS: "23",
          RELEASE_CLEANUP_TIMEOUT_SECONDS: "2",
          RELEASE_BROWSER_DIAGNOSTIC: browserPath,
          RELEASE_DIAGNOSTICS_DIR: diagnosticsDirectory,
        },
      },
    ).then(
      () => null,
      (error) => error,
    );

    assert(failure);
    assert.equal(failure.code, 23);
    assert.match(failure.stderr, /\[browser diagnostic unavailable\]/);
    assert.match(failure.stderr, /\[role diagnostic unavailable\]/);
    assert.match(failure.stderr, /sessionFailureCategory="diagnostics-unavailable"/);
    for (const staleValue of [
      "/sign-in/client-trust",
      "POST /api/__clerk/v1/client/sign_ins 200",
      priorAdminPath,
      priorUserPath,
      "active-session-route-ready",
    ]) {
      assert.equal(failure.stderr.includes(staleValue), false, `reported stale value ${staleValue}`);
    }
    await assert.rejects(readFile(browserPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release diagnostic redaction removes complete auth and cookie values", () => {
  const redacted = redactReleaseDiagnostics(
    [
      "Authorization: Bearer abc.def.ghi",
      "Cookie: session=first; testing_token=second; other=third",
      "Set-Cookie: __session=fourth; HttpOnly; Secure",
      "GET /sign-in?__clerk_testing_token=fifth&other=safe",
      "password=sixth token: seventh secret=eighth",
      'requestBody={"identifier":"ninth"} responseBody: tenth',
      "CLERK_SECRET_KEY=sk_test_eleventh",
      "VITE_CLERK_PUBLISHABLE_KEY=pk_test_twelfth",
      "safe prefix sk_test_thirteenth and sk_test_fourteenth",
      "CLERK_TESTING_TOKEN=underscore-label-fifteenth",
      "responseBody:",
      '{"identifier":"multiline-sixteenth"}',
      "-----BEGIN PRIVATE KEY-----",
      "private-key-seventeenth",
      "-----END PRIVATE KEY-----",
      "-----BEGIN PRIVATE KEY-----",
      "incomplete-private-key-eighteenth",
    ].join("\n"),
  );
  for (const secret of [
    "abc.def.ghi",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
    "thirteenth",
    "fourteenth",
    "fifteenth",
    "sixteenth",
    "seventeenth",
    "eighteenth",
  ]) {
    assert(!redacted.includes(secret));
  }
  assert.match(redacted, /\[REDACTED UNSAFE LINE\]/);
});

test("seeded redaction cases cover supported credentials and bounded truncation", async () => {
  const cases = generatedRedactionCases();
  const generatedInput = cases.map(({ input }) => input).join("\n");
  const redacted = redactReleaseDiagnostics(generatedInput);
  for (const { caseId, secrets } of cases) {
    for (const secret of secrets) {
      assert(!redacted.includes(secret), `redaction case ${caseId} leaked a sentinel`);
    }
  }

  const boundaryCases = cases.slice(-6).map(({ caseId, secrets }) => ({
    caseId,
    secret: secrets[1],
    input: `${"x".repeat(255)}${secrets[1]}${"y".repeat(255)}`,
  }));
  const directory = await mkdtemp(resolve(tmpdir(), "release-diagnostics-generated-"));
  const browserPath = resolve(directory, "browser.json");
  const candidateLogPath = resolve(directory, "candidate.log");
  const proxyLogPath = resolve(directory, "proxy.log");
  try {
    await writeFile(browserPath, "{}");
    await writeFile(
      candidateLogPath,
      boundaryCases.map(({ input }) => input).join("\n"),
    );
    await writeFile(proxyLogPath, boundaryCases.map(({ input }) => input).join("\n"));
    const output = await formatReleaseDiagnostics({
      browserPath,
      candidateLogPath,
      proxyLogPath,
    });
    assert(Buffer.byteLength(output) <= MAX_DIAGNOSTIC_BYTES);
    assert(output.split(/\r?\n/).length <= MAX_DIAGNOSTIC_LINES);
    for (const { caseId, secret } of boundaryCases) {
      assert(!output.includes(secret), `truncation case ${caseId} leaked a sentinel`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("complete logs are sanitized before tail selection", () => {
  const secret = "multiline-body-secret";
  const input = [
    "responseBody:",
    ...Array(350).fill(`identifier=${secret}`),
  ].join("\n");
  const retainedTail = redactReleaseDiagnostics(input)
    .split(/\r?\n/)
    .slice(-300)
    .join("\n");
  assert(!retainedTail.includes(secret));
  assert.match(retainedTail, /\[REDACTED BODY CONTENT\]/);
});

test("failed release diagnostics are structured, bounded, and secret-redacted", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-diagnostics-"));
  const browserPath = resolve(directory, "browser.json");
  const candidateLogPath = resolve(directory, "candidate.log");
  const proxyLogPath = resolve(directory, "proxy.log");
  const secrets = [
    "testing-token-value",
    "cookie-value",
    "password-value",
    "sk_test_secret-key-value",
    "query-value",
    "authorization-value",
    "request-body-value",
    "response-body-value",
  ];
  await writeFile(
    browserPath,
    JSON.stringify({
      finalPath: "/sign-in/client-trust",
      routeStates: ["/sign-in", "/sign-in/client-trust"],
      clerkRequests: ["POST /api/__clerk/v1/client/sign_ins 200"],
      requestFailures: ["GET /api/__clerk/v1/client ERR_CONNECTION_RESET"],
      pageErrors: ["TypeError"],
    }),
  );
  const injected = [
    `token=${secrets[0]}`,
    `Cookie: __session=${secrets[1]}`,
    `password=${secrets[2]}`,
    `CLERK_SECRET_KEY=${secrets[3]}`,
    `GET /path?unsafe=${secrets[4]}`,
    `Authorization: Bearer ${secrets[5]}`,
    `requestBody=${secrets[6]}`,
    `responseBody=${secrets[7]}`,
  ];
  await writeFile(candidateLogPath, Array(100).fill(injected.join("\n")).join("\n"));
  await writeFile(proxyLogPath, Array(100).fill("proxy line").join("\n"));

  const output = await formatReleaseDiagnostics({
    browserPath,
    candidateLogPath,
    proxyLogPath,
  });
  assert.match(output, /MANAGED CLERK RELEASE DIAGNOSTICS/);
  assert.match(output, /\[google-admin\]/);
  assert.match(output, /\[google-user\]/);
  assert.match(output, /sessionFailureCategory="diagnostics-unavailable"/);
  assert.match(output, /finalPath="\/sign-in\/client-trust"/);
  assert.match(output, /POST \/api\/__clerk\/v1\/client\/sign_ins 200/);
  assert.match(output, /ERR_CONNECTION_RESET/);
  assert.match(output, /\[candidate tail\]/);
  assert.match(output, /\[proxy tail\]/);
  assert.match(output, /END MANAGED CLERK RELEASE DIAGNOSTICS/);
  assert(Buffer.byteLength(output) <= MAX_DIAGNOSTIC_BYTES);
  assert(output.split(/\r?\n/).length <= MAX_DIAGNOSTIC_LINES);
  for (const secret of secrets) assert(!output.includes(secret));
});

test("browser diagnostic values fail closed and cannot crowd out log tails", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-diagnostics-invalid-"));
  const browserPath = resolve(directory, "browser.json");
  const candidateLogPath = resolve(directory, "candidate.log");
  const proxyLogPath = resolve(directory, "proxy.log");
  const unsafe = "private-browser-value";
  const credentialPath = "/sk_test_browser-credential-value";
  await writeFile(
    browserPath,
    JSON.stringify({
      finalPath: `/safe?query=${unsafe}`,
      routeStates: [credentialPath, ...Array(100).fill(`/safe?query=${unsafe}`)],
      clerkRequests: Array(100).fill(`POST /api/__clerk/path 200 ${unsafe}`),
      requestFailures: [`GET /api/__clerk/path arbitrary-${unsafe}`],
      pageErrors: [`TypeError ${unsafe}`],
    }),
  );
  await writeFile(candidateLogPath, "candidate evidence");
  await writeFile(proxyLogPath, "proxy evidence");
  const output = await formatReleaseDiagnostics({
    browserPath,
    candidateLogPath,
    proxyLogPath,
  });
  assert(!output.includes(unsafe));
  assert(!output.includes("browser-credential-value"));
  assert.match(output, /\[REDACTED INVALID ENTRY\]/);
  assert.match(output, /candidate evidence/);
  assert.match(output, /proxy evidence/);
  assert.match(output, /END MANAGED CLERK RELEASE DIAGNOSTICS/);
});

test("Google role diagnostics expose bounded safe session transitions", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-role-diagnostics-"));
  const browserPath = resolve(directory, "browser.json");
  const adminPath = resolve(directory, "google-admin.json");
  const userPath = resolve(directory, "google-user.json");
  const candidateLogPath = resolve(directory, "candidate.log");
  const proxyLogPath = resolve(directory, "proxy.log");
  const observation = (overrides) => ({
    path: "/sign-in",
    clerkLoaded: false,
    hasActiveSession: false,
    status: "clerk-unloaded",
    phase: "poll",
    elapsedMs: 0,
    ...overrides,
  });

  await writeFile(browserPath, "{}");
  await writeFile(candidateLogPath, "candidate evidence");
  await writeFile(proxyLogPath, "proxy evidence");
  await writeFile(
    adminPath,
    JSON.stringify({
      finalPath: "/sign-in",
      routeStates: ["/sign-in"],
      clerkRequests: ["POST /api/__clerk/v1/client/sign_ins 200"],
      requestFailures: [],
      pageErrors: [],
      sessionObservations: [
        observation({ elapsedMs: 0 }),
        observation({
          clerkLoaded: true,
          status: "loaded-without-session",
          elapsedMs: 1_000,
        }),
        observation({
          clerkLoaded: true,
          hasActiveSession: true,
          status: "active-session-on-sign-in",
          phase: "timeout",
          elapsedMs: 30_000,
        }),
      ],
      sessionFailureCategory: "active-session-route-timeout",
    }),
  );
  await writeFile(
    userPath,
    JSON.stringify({
      finalPath: "/sign-in",
      routeStates: ["/sign-in"],
      clerkRequests: [],
      requestFailures: [],
      pageErrors: [],
      sessionObservations: [
        observation({
          clerkLoaded: true,
          status: "loaded-without-session",
          phase: "timeout",
          elapsedMs: 30_000,
        }),
      ],
      sessionFailureCategory: "loaded-without-session-timeout",
    }),
  );

  const output = await formatReleaseDiagnostics({
    browserPath,
    candidateLogPath,
    proxyLogPath,
    googleAdminPath: adminPath,
    googleUserPath: userPath,
  });

  assert.match(output, /\[google-admin\]/);
  assert.match(output, /\[google-user\]/);
  assert.match(output, /"status":"clerk-unloaded"/);
  assert.match(output, /"status":"loaded-without-session"/);
  assert.match(output, /"status":"active-session-on-sign-in"/);
  assert.match(output, /sessionFailureCategory="active-session-route-timeout"/);
  assert.match(output, /sessionFailureCategory="loaded-without-session-timeout"/);
  assert(Buffer.byteLength(output) <= MAX_DIAGNOSTIC_BYTES);
  assert(output.split(/\r?\n/).length <= MAX_DIAGNOSTIC_LINES);
});

test("Google role diagnostic input rejects unsafe and oversized values", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-role-diagnostics-invalid-"));
  const browserPath = resolve(directory, "browser.json");
  const adminPath = resolve(directory, "google-admin.json");
  const userPath = resolve(directory, "google-user.json");
  const candidateLogPath = resolve(directory, "candidate.log");
  const proxyLogPath = resolve(directory, "proxy.log");
  const malicious = [
    "account-identifier-secret",
    "person@example.invalid",
    "query-string-secret",
    "credential-secret",
    "unbounded-status-secret",
  ];
  await writeFile(browserPath, "{}");
  await writeFile(candidateLogPath, "candidate evidence");
  await writeFile(proxyLogPath, "proxy evidence");
  await writeFile(adminPath, "x".repeat(40_000));
  await writeFile(
    userPath,
    JSON.stringify({
      finalPath: `/sign-in?email=${malicious[1]}`,
      routeStates: [`/settings/${malicious[0]}`],
      clerkRequests: [`POST /api/__clerk/v1/client/sessions/${malicious[0]} 200`],
      requestFailures: [`GET /api/__clerk/v1/client/${malicious[0]} ERR_CONNECTION_RESET`],
      pageErrors: [],
      sessionObservations: Array(21).fill(
        {
          path: `/sign-in?token=${malicious[3]}`,
          clerkLoaded: "true",
          hasActiveSession: true,
          status: malicious[4],
          phase: "timeout",
          elapsedMs: 30_001,
          rawClerkObject: malicious[2],
        },
      ),
      sessionFailureCategory: `token=${malicious[3]}`,
    }),
  );

  const output = await formatReleaseDiagnostics({
    browserPath,
    candidateLogPath,
    proxyLogPath,
    googleAdminPath: adminPath,
    googleUserPath: userPath,
  });

  for (const value of malicious) assert.equal(output.includes(value), false);
  assert.match(output, /\[REDACTED INVALID ENTRY\]/);
  assert.match(output, /\[role diagnostic unavailable\]/);
  assert.match(output, /sessionFailureCategory="diagnostics-unavailable"/);
  assert.match(output, /\[OMITTED\]/);
  assert(Buffer.byteLength(output) <= MAX_DIAGNOSTIC_BYTES);
  assert(output.split(/\r?\n/).length <= MAX_DIAGNOSTIC_LINES);
});

test("maximum valid diagnostic input preserves every bounded section", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-diagnostics-max-"));
  const browserPath = resolve(directory, "browser.json");
  const candidateLogPath = resolve(directory, "candidate.log");
  const proxyLogPath = resolve(directory, "proxy.log");
  const longPath = `/${"a".repeat(150)}`;
  await writeFile(
    browserPath,
    JSON.stringify({
      finalPath: longPath,
      routeStates: Array(50).fill(longPath),
      clerkRequests: Array(50).fill(`POST ${longPath} 200`),
      requestFailures: Array(50).fill(`GET ${longPath} ERR_CONNECTION_RESET`),
      pageErrors: Array(50).fill("TypeError"),
    }),
  );
  await writeFile(candidateLogPath, Array(40).fill("c".repeat(256)).join("\n"));
  await writeFile(proxyLogPath, Array(40).fill("p".repeat(256)).join("\n"));
  const output = await formatReleaseDiagnostics({
    browserPath,
    candidateLogPath,
    proxyLogPath,
  });
  assert.match(output, /\[browser\]/);
  assert.match(output, /finalPath=/);
  assert.match(output, /routeStates=/);
  assert.match(output, /clerkRequests=/);
  assert.match(output, /requestFailures=/);
  assert.match(output, /pageErrors=/);
  assert.match(output, /\[candidate tail\]/);
  assert.match(output, /\[proxy tail\]/);
  assert.match(output, /END MANAGED CLERK RELEASE DIAGNOSTICS/);
  assert(Buffer.byteLength(`${output}\n`) <= MAX_DIAGNOSTIC_BYTES);
  assert(output.split(/\r?\n/).length <= MAX_DIAGNOSTIC_LINES);
});

test("smoke proves proxy, cookie-only API, protected pages, and sign-out", () => {
  assert.match(smoke, /CLERK_PROXY_PATH/);
  assert.match(smoke, /fetch\("\/api\/auth\/user"/);
  assert.match(smoke, /fetch\("\/api\/healthz"/);
  assert.match(smoke, /credentials: "same-origin"/);
  assert.doesNotMatch(smoke, /page\.request/);
  assert.match(
    smoke,
    /waitForCompletedSignIn\(page, routeStates\);\s*await page\.goto\("\/settings"\);\s*await expect\(page\)\.toHaveURL\(`\$\{baseURL\}\/settings`\)/,
  );
  assert.match(
    smoke,
    /await page\.getByTestId\("button-login"\)\.click\(\);[\s\S]*?await expect\(page\.getByTestId\("text-settings-title"\)\)/,
  );
  assert.match(smoke, /page\.goto\("\/settings"\)/);
  assert.match(smoke, /page\.goto\("\/stats"\)/);
  assert.match(smoke, /button-login/);
  assert.match(smoke, /toBe\(401\)/);
  assert.match(smoke, /clerkTesting\.signIn/);
  assert.doesNotMatch(smoke, /\.fill\(password\)/);
  assert.doesNotMatch(smoke, /Authorization|__test__|owner-login|tester-login/);
});

test("Google role smoke requires an active Clerk session and emits only coarse state", () => {
  assert.match(
    googleReleaseSmoke,
    /waitForCompletedSignIn\(page, routeStates, sessionDiagnostics\)/,
  );
  assert.match(googleReleaseSmoke, /clerkLoaded: clerkState\.loaded/);
  assert.match(googleReleaseSmoke, /hasActiveSession: clerkState\.hasActiveSession/);
  assert.match(googleReleaseSmoke, /"active-session-on-sign-in"/);
  assert.match(googleReleaseSmoke, /"loaded-without-session"/);
  assert.match(googleReleaseSmoke, /"clerk-unloaded"/);
  assert.match(
    googleReleaseSmoke,
    /if \(clerkState\.loaded && clerkState\.hasActiveSession\)/,
  );
  assert.match(
    googleReleaseSmoke,
    /waitForCompletedSignIn\(page, routeStates, sessionDiagnostics\);\s*await page\.goto\("\/settings"\);\s*await expect\(page\)\.toHaveURL\(`\$\{baseURL\}\/settings`\)/,
  );
  assert.match(googleReleaseSmoke, /sessionObservations/);
  assert.match(googleReleaseSmoke, /sessionFailureCategory/);
  assert.match(googleReleaseSmoke, /testInfo\.attach/);
  assert.match(googleReleaseSmoke, /google-\$\{roleCase\.role\.toLowerCase\(\)\}\.json/);
  assert.match(candidateBuild, /google_admin_diagnostic/);
  assert.match(candidateBuild, /google_user_diagnostic/);
  assert.match(candidateBuild, /google_admin_diagnostic"\s+"\$google_user_diagnostic"/);
});

test("Clerk-only auth leaves no tester session or password machinery", () => {
  const packageText = JSON.stringify(packageJson);
  assert.doesNotMatch(
    packageText,
    /(?:express-session|connect-pg-simple|bcrypt)/,
  );
  assert.doesNotMatch(authBridge, /express-session|connect-pg-simple|function getSession|function setupAuth/);
  assert.doesNotMatch(authExports, /getSession|setupAuth/);
  assert.doesNotMatch(serverRoutes, /sessionParser|setupAuth/);
  assert.doesNotMatch(authModels, /pgTable\(\s*["']sessions["']/);
});

test("legacy reconciliation retains one Admin and removes non-Admin-owned data", () => {
  assert.match(testerReconciliation, /requires exactly one retained Admin/);
  assert.match(testerReconciliation, /role = 'Admin'/);
  assert.match(testerReconciliation, /DELETE FROM user_settings/);
  assert.match(testerReconciliation, /DELETE FROM upload_intents/);
  assert.match(testerReconciliation, /DELETE FROM conversations/);
  assert.match(testerReconciliation, /DELETE FROM counting_sessions/);
  assert.match(testerReconciliation, /DELETE FROM folders/);
  assert.match(testerReconciliation, /DELETE FROM session_collaborators/);
  assert.match(testerReconciliation, /DELETE FROM users/);
  assert.match(testerReconciliation, /DROP TABLE IF EXISTS sessions/);
});

test("managed Clerk reset retains the selected Admin and removes every other account", () => {
  assert.match(managedClerkReset, /users\.getUser\(managedClerkUserId\)/);
  assert.match(
    managedClerkReset,
    /managedIdentity\.externalId !== null[\s\S]*managedIdentity\.externalId !== retainedAdminId/,
  );
  assert.match(managedClerkReset, /LOCK TABLE users, counting_sessions/);
  assert.match(
    managedClerkReset,
    /WHERE id = \$1 AND approved = true AND rejected = false[\s\S]*\[retainedAdminId\]/,
  );
  assert.match(
    managedClerkReset,
    /SELECT id, clerk_user_id FROM users WHERE id <> \$1[\s\S]*\[retainedAdminId\]/,
  );
  assert.doesNotMatch(managedClerkReset, /WHERE role <> 'Admin'/);
  assert.match(managedClerkReset, /WHERE clerk_user_id = \$1 AND id <> \$2/);
  assert.match(
    managedClerkReset,
    /SET clerk_user_id = \$1,[\s\S]*role = 'Admin'[\s\S]*WHERE id = \$2 AND approved = true AND rejected = false/,
  );
  assert.match(
    managedClerkReset,
    /DELETE FROM scan_results[\s\S]*cutover_removed_identities/,
  );
  assert.match(managedClerkReset, /DELETE FROM entries[\s\S]*WHERE user_id/);
  assert.match(managedClerkReset, /DELETE FROM photos[\s\S]*WHERE user_id/);
  assert.match(
    managedClerkResetQueries,
    /jsonb_array_elements\(session\.review_cohort::jsonb\)/,
  );
  for (const table of [
    "user_settings",
    "upload_intents",
    "conversations",
    "user_wire_categories",
    "ai_usage_logs",
    "feedback",
    "comments",
    "review_responses",
    "activity_logs",
  ]) {
    assert.match(managedClerkReset, new RegExp(`\"${table}\"`));
  }
  assert.match(
    managedClerkReset,
    /finalState\.rowCount !== 1[\s\S]*approved !== true[\s\S]*rejected !== false/,
  );
  assert.match(managedClerkReset, /remainingOwnedData\.rows\[0\]\?\.count !== 0/);
  assert.match(managedClerkReset, /SELECT_REMOVED_ACCOUNT_OBJECT_KEYS_SQL/);
  assert.match(managedClerkReset, /deletePrivateObjectsAndVerify/);
  assert.doesNotMatch(managedClerkReset, /object_storage_key.*console|console.*object_storage_key/);
});

test("managed Clerk object cleanup is retryable, verified, and path-safe", async () => {
  const operations = [];
  const files = new Map([
    ["private/uploads/removed-a.jpg", { exists: true, failDelete: false }],
    ["private/uploads/removed-b.jpg", { exists: true, failDelete: true }],
  ]);
  const client = {
    bucket(bucketName) {
      assert.equal(bucketName, "bucket");
      return {
        file(objectName) {
          const state = files.get(objectName);
          assert(state);
          return {
            async delete() {
              operations.push(["delete", objectName]);
              if (state.failDelete) throw new Error(`sensitive:${objectName}`);
              state.exists = false;
            },
            async exists() {
              operations.push(["exists", objectName]);
              return [state.exists];
            },
          };
        },
      };
    },
  };
  const paths = ["/uploads/removed-a.jpg", "/objects/uploads/removed-b.jpg"];

  await assert.rejects(
    deletePrivateObjectsAndVerify({
      client,
      privateObjectDir: "/bucket/private",
      objectPaths: paths,
    }),
    (error) => {
      assert.match(error.message, /1 of 2 object\(s\) require retry/);
      assert.deepEqual(error.failureIndexes, [1]);
      assert.match(error.batchId, /^[a-f0-9]{12}$/);
      assert.doesNotMatch(error.message, /removed-|uploads|private|bucket/);
      return true;
    },
  );

  files.get("private/uploads/removed-b.jpg").failDelete = false;
  const retried = await deletePrivateObjectsAndVerify({
    client,
    privateObjectDir: "/bucket/private",
    objectPaths: paths,
  });
  assert.equal(retried.attempted, 2);
  assert.equal(retried.removed, 2);
  assert.match(retried.batchId, /^[a-f0-9]{12}$/);
  assert.deepEqual(operations.slice(-4), [
    ["delete", "private/uploads/removed-a.jpg"],
    ["exists", "private/uploads/removed-a.jpg"],
    ["delete", "private/uploads/removed-b.jpg"],
    ["exists", "private/uploads/removed-b.jpg"],
  ]);
});

test("managed Clerk reset SQL filters both local and Clerk identity references", async () => {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required for reset SQL verification");
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  try {
    await database.query("BEGIN");
    await database.query(`
      CREATE TEMP TABLE counting_sessions (
        id integer PRIMARY KEY,
        user_id varchar NOT NULL,
        review_cohort text
      );
      CREATE TEMP TABLE cutover_removed_accounts (
        id varchar PRIMARY KEY,
        clerk_user_id varchar
      );
      CREATE TEMP TABLE cutover_removed_identities (id varchar PRIMARY KEY);
      CREATE TEMP TABLE scan_results (scanned_by varchar);
      CREATE TEMP TABLE folders (user_id varchar);
      CREATE TEMP TABLE session_collaborators (user_id varchar);
      CREATE TEMP TABLE session_invite_links (created_by varchar);
      CREATE TEMP TABLE users (
        id varchar PRIMARY KEY,
        custom_avatar_key varchar
      );
      CREATE TEMP TABLE photos (
        session_id integer,
        user_id varchar,
        object_storage_key text
      );
      CREATE TEMP TABLE entries (user_id varchar);
      CREATE TEMP TABLE user_settings (user_id varchar, company_logo_key text);
      CREATE TEMP TABLE upload_intents (user_id varchar, object_path text);
      CREATE TEMP TABLE conversations (user_id varchar);
      CREATE TEMP TABLE user_wire_categories (user_id varchar);
      CREATE TEMP TABLE ai_usage_logs (user_id varchar);
      CREATE TEMP TABLE feedback (user_id varchar);
      CREATE TEMP TABLE comments (user_id varchar);
      CREATE TEMP TABLE review_responses (user_id varchar);
      CREATE TEMP TABLE activity_logs (user_id varchar);
    `);
    await database.query(
      `INSERT INTO cutover_removed_accounts (id, clerk_user_id)
       VALUES ('removed-local', 'user_removedClerk')`,
    );
    await database.query(
      `INSERT INTO users (id, custom_avatar_key)
       VALUES
         ('removed-local', '/objects/uploads/removed-avatar.jpg'),
         ('retained-owner', '/uploads/shared-avatar.jpg')`,
    );
    await database.query(
      `INSERT INTO cutover_removed_identities (id)
       VALUES ('removed-local'), ('user_removedClerk')`,
    );
    await database.query(
      `INSERT INTO counting_sessions (id, user_id, review_cohort)
       VALUES
         (
           1,
           'retained-owner',
           '[{"userId":"removed-local"},{"userId":"user_removedClerk"},{"userId":"retained-owner"}]'
         ),
         (2, 'removed-local', NULL)`,
    );
    await database.query(
      `INSERT INTO photos (session_id, user_id, object_storage_key)
       VALUES
         (1, 'removed-local', '/uploads/removed-only.jpg'),
         (1, 'removed-local', '/objects/uploads/shared.jpg'),
         (1, 'retained-owner', '/uploads/shared.jpg'),
         (1, 'retained-owner', '/uploads/retained-only.jpg'),
         (2, 'retained-owner', '/uploads/removed-session.jpg'),
         (2, 'retained-owner', '/objects/uploads/cross-session-shared.jpg'),
         (1, 'retained-owner', '/uploads/cross-session-shared.jpg')`,
    );
    await database.query(
      `INSERT INTO user_settings (user_id, company_logo_key)
       VALUES
         ('removed-local', '/uploads/removed-logo.jpg'),
         ('removed-local', '/objects/uploads/shared-avatar.jpg')`,
    );
    await database.query(
      `INSERT INTO upload_intents (user_id, object_path)
       VALUES ('removed-local', '/uploads/removed-pending.jpg')`,
    );
    const removedObjectKeys = await database.query(
      SELECT_REMOVED_ACCOUNT_OBJECT_KEYS_SQL,
    );
    assert.deepEqual(removedObjectKeys.rows, [
      { object_storage_key: "/uploads/removed-avatar.jpg" },
      { object_storage_key: "/uploads/removed-logo.jpg" },
      { object_storage_key: "/uploads/removed-only.jpg" },
      { object_storage_key: "/uploads/removed-pending.jpg" },
      { object_storage_key: "/uploads/removed-session.jpg" },
    ]);
    await database.query(FILTER_REMOVED_REVIEW_COHORT_SQL);
    const cohort = await database.query(
      "SELECT review_cohort FROM counting_sessions WHERE id = 1",
    );
    assert.deepEqual(JSON.parse(cohort.rows[0].review_cohort), [
      { userId: "retained-owner" },
    ]);

    await database.query(
      "INSERT INTO scan_results (scanned_by) VALUES ('user_removedClerk')",
    );
    await database.query(
      `DELETE FROM photos
       WHERE user_id IN (SELECT id FROM cutover_removed_accounts)
          OR session_id IN (
            SELECT session.id
            FROM counting_sessions session
            JOIN cutover_removed_accounts removed ON removed.id = session.user_id
          )`,
    );
    await database.query(
      `DELETE FROM user_settings
       WHERE user_id IN (SELECT id FROM cutover_removed_accounts)`,
    );
    await database.query(
      `DELETE FROM upload_intents
       WHERE user_id IN (SELECT id FROM cutover_removed_accounts)`,
    );
    await database.query(
      `DELETE FROM counting_sessions
       WHERE user_id IN (SELECT id FROM cutover_removed_accounts)`,
    );
    const remaining = await database.query(
      COUNT_REMAINING_REMOVED_ACCOUNT_DATA_SQL,
    );
    assert.equal(remaining.rows[0].count, 1);
    await database.query("DELETE FROM scan_results");
    const clean = await database.query(COUNT_REMAINING_REMOVED_ACCOUNT_DATA_SQL);
    assert.equal(clean.rows[0].count, 0);
  } finally {
    await database.query("ROLLBACK").catch(() => {});
    await database.end();
  }
});

test("workspace config does not pin Clerk credentials or a tenant", () => {
  assert.doesNotMatch(
    replitConfig,
    /(?:CLERK_PUBLISHABLE_KEY|VITE_CLERK_PUBLISHABLE_KEY|VITE_CLERK_PUBLIC_HOST|ADMIN_USER_ID)/,
  );
});

test("published release workflow passes protected inputs only through the environment", () => {
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /require-trusted-main:/);
  assert.match(workflow, /if \[\[ "\$GITHUB_REF" != "refs\/heads\/main" \]\]/);
  assert.match(workflow, /needs:\s+- require-trusted-main/);
  assert.match(workflow, /npm run verify:managed-clerk-published/);
  assert.match(workflow, /PRODUCTION_BASE_URL: \$\{\{ vars\.PRODUCTION_BASE_URL \}\}/);
  assert.doesNotMatch(workflow, /CLERK_SECRET_KEY: \$\{\{ secrets\.CLERK_SECRET_KEY \}\}/);
  assert.match(workflow, /CLERK_PUBLISHABLE_KEY: \$\{\{ secrets\.CLERK_PUBLISHABLE_KEY \}\}/);
  assert.match(
    workflow,
    /VITE_CLERK_PUBLISHABLE_KEY: \$\{\{ secrets\.VITE_CLERK_PUBLISHABLE_KEY \}\}/,
  );
  assert.doesNotMatch(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.doesNotMatch(workflow, /echo.*SECRET|set -x/);
  assert.doesNotMatch(workflow, /playwright-report/);
  const jobHeader = workflow.slice(0, workflow.indexOf("    steps:"));
  assert.doesNotMatch(jobHeader, /CLERK_SECRET_KEY|DATABASE_URL|PRODUCTION_BASE_URL/);
});