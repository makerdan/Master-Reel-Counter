import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const replitConfig = readFileSync(resolve(root, ".replit"), "utf8");
const config = readFileSync(resolve(root, "playwright.release.config.ts"), "utf8");
const smoke = readFileSync(resolve(root, "tests/release/managed-clerk-auth.spec.ts"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/managed-clerk-release.yml"), "utf8");
const candidateBuild = readFileSync(resolve(root, "scripts/build-and-verify-release.sh"), "utf8");
const candidateProxy = readFileSync(resolve(root, "scripts/release-candidate-https-proxy.mjs"), "utf8");
const execFileAsync = promisify(execFile);

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
  assert.match(candidateBuild, /PRODUCTION_BASE_URL="\$candidate_url"/);
  assert.match(candidateBuild, /RELEASE_SMOKE_CANDIDATE_TLS_PORT="\$tls_port"/);
  assert.match(candidateBuild, /RELEASE_SMOKE_CANDIDATE_ID="\$candidate_id"/);
  assert.match(candidateProxy, /"x-forwarded-host": publicHost/);
  assert.match(candidateProxy, /"x-forwarded-proto": "https"/);
  assert.match(config, /--host-resolver-rules=MAP \$\{target\.hostname\}:443 127\.0\.0\.1:\$\{candidateTlsPort\}/);
  assert.match(candidateBuild, /npm run verify:managed-clerk-release/);
  assert.match(candidateBuild, /trap cleanup EXIT INT TERM/);
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
  assert.doesNotMatch(smoke, /rejectUnauthorized: false/);
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