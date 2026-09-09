import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import http from "node:http";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { redactReleaseDiagnostics } from "../redact-release-diagnostics.mjs";
import {
  formatReleaseDiagnostics,
  MAX_DIAGNOSTIC_BYTES,
  MAX_DIAGNOSTIC_LINES,
} from "../print-release-diagnostics.mjs";

const root = resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const replitConfig = readFileSync(resolve(root, ".replit"), "utf8");
const config = readFileSync(resolve(root, "playwright.release.config.ts"), "utf8");
const smoke = readFileSync(resolve(root, "tests/release/managed-clerk-auth.spec.ts"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/managed-clerk-release.yml"), "utf8");
const candidateBuild = readFileSync(resolve(root, "scripts/build-and-verify-release.sh"), "utf8");
const candidateProxy = readFileSync(resolve(root, "scripts/release-candidate-https-proxy.mjs"), "utf8");
const diagnosticRedactor = readFileSync(resolve(root, "scripts/redact-release-diagnostics.mjs"), "utf8");
const serverIndex = readFileSync(resolve(root, "server/index.ts"), "utf8");
const clerkProxyMiddleware = readFileSync(
  resolve(root, "server/middlewares/clerkProxyMiddleware.ts"),
  "utf8",
);
const execFileAsync = promisify(execFile);
const proxyConstructionProgram = [
  'import { clerkProxyMiddleware } from "./server/middlewares/clerkProxyMiddleware.ts";',
  "clerkProxyMiddleware();",
].join("\n");

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
    /playwright test --config playwright\.release\.config\.ts/,
  );
  assert.match(config, /PRODUCTION_BASE_URL is required/);
  assert.match(config, /public HTTPS deployment/);
  assert.match(config, /timeout: 120_000/);
  assert.match(config, /trace: "off"/);
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
  assert.match(candidateBuild, /VITE_CLERK_PUBLIC_HOST="\$candidate_host"/);
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
  assert.match(candidateBuild, /\/api\/__clerk\/healthz/);
  assert.match(candidateBuild, /trap on_exit EXIT/);
  assert.match(candidateBuild, /trap 'exit 130' INT/);
  assert.match(candidateBuild, /trap 'exit 143' TERM/);
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
  assert.match(release, /managed Clerk sign-in preserves/);
  assert.doesNotMatch(release, /dashboard\.spec|settings\.spec|session\.spec/);
});

test("smoke uses disposable managed identity and preserves local authorization state", () => {
  assert.match(smoke, /clerk\.users\.createUser/);
  assert.match(smoke, /externalId: localUserId/);
  assert.match(smoke, /approved, rejected, is_tester/);
  assert.match(smoke, /approved: true, rejected: false, is_tester: false/);
  assert.match(smoke, /clerk\.users\.deleteUser/);
  assert.match(smoke, /DELETE FROM users WHERE id = \$1 RETURNING id/);
  assert.match(smoke, /Managed Clerk release smoke cleanup failed/);
  assert.match(smoke, /removeStaleSmokeUsers/);
  assert.match(smoke, /createdAtBefore: cutoff/);
  assert.match(smoke, /externalId\?\.startsWith\(SMOKE_ID_PREFIX\)/);
  assert.equal(
    smoke.match(/getByRole\("button", \{ name: "Continue", exact: true \}\)/g)?.length,
    2,
  );
  assert.doesNotMatch(smoke, /name: \/continue\/i/);
  assert.doesNotMatch(smoke, /rejectUnauthorized: false/);
});

test("smoke uses Clerk's supported client-trust helper and keeps safe failure evidence", () => {
  assert.equal(packageJson.dependencies["@clerk/backend"], "^3.17.1");
  assert.equal(packageJson.devDependencies["@clerk/testing"], "^2.2.33");
  assert.match(smoke, /setupCandidateClerkTestingToken\(\{/);
  assert.match(smoke, /localCandidateOrigin: process\.env\.RELEASE_SMOKE_CANDIDATE_APP_ORIGIN/);
  assert.match(smoke, /CLERK_TESTING_TOKEN/);
  assert.match(smoke, /\/sign-in\/client-trust/);
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
  assert.match(smoke, /\/api\/__clerk/);
  assert.match(smoke, /fetch\("\/api\/auth\/user"/);
  assert.match(smoke, /fetch\("\/api\/healthz"/);
  assert.match(smoke, /credentials: "same-origin"/);
  assert.doesNotMatch(smoke, /page\.request/);
  assert.match(smoke, /page\.goto\("\/settings"\)/);
  assert.match(smoke, /page\.goto\("\/stats"\)/);
  assert.match(smoke, /button-login/);
  assert.match(smoke, /toBe\(401\)/);
  assert.match(smoke, /fillSecret/);
  assert.doesNotMatch(smoke, /\.fill\(password\)/);
  assert.doesNotMatch(smoke, /Authorization|__test__|owner-login|tester-login/);
});

test("release workflow passes secrets only through the environment", () => {
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /require-trusted-main:/);
  assert.match(workflow, /if \[\[ "\$GITHUB_REF" != "refs\/heads\/main" \]\]/);
  assert.match(workflow, /needs:\s+- require-trusted-main/);
  assert.match(workflow, /npm run verify:managed-clerk-release/);
  assert.match(workflow, /PRODUCTION_BASE_URL: \$\{\{ vars\.PRODUCTION_BASE_URL \}\}/);
  assert.match(workflow, /CLERK_SECRET_KEY: \$\{\{ secrets\.CLERK_SECRET_KEY \}\}/);
  assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.doesNotMatch(workflow, /echo.*SECRET|set -x/);
  assert.doesNotMatch(workflow, /playwright-report/);
  const jobHeader = workflow.slice(0, workflow.indexOf("    steps:"));
  assert.doesNotMatch(jobHeader, /CLERK_SECRET_KEY|DATABASE_URL/);
});