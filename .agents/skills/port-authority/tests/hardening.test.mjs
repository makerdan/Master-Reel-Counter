import nodeTest from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync,
  chmodSync, symlinkSync, linkSync, realpathSync, copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cleanup = join(root, "scripts/free-ports.mjs");
const lock = join(root, "scripts/validation-lock.mjs");
const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
const TEST_TIMEOUT_MS = 30000, HOOK_TIMEOUT_MS = 5000;
const test = (name, fn) => nodeTest(name, { timeout: TEST_TIMEOUT_MS }, fn);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function identity(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
    return { pid, state: f[0], startTime: f[19] };
  } catch (e) { if (e.code === "ENOENT" || e.code === "ESRCH") return null; throw e; }
}
function isAlive(p) {
  const actual = identity(p.pid);
  return actual?.startTime === p.startTime && !["Z", "X"].includes(actual.state);
}
async function until(fn, timeout = 5000) {
  const end = Date.now() + timeout;
  do { const value = fn(); if (value) return value; await sleep(15); } while (Date.now() < end);
  throw new Error("fixture wait timed out");
}
// Test-only authoritative fixture. NEVER copied into the delivered host adapter.
// It simulates host attestation and FG approval/claim/evidence separately from
// caller-written envelopes; it is not genuine platform or approval evidence.
function fixtureHostModule(statePath) {
  return `
    import {readFileSync,writeFileSync,mkdirSync,appendFileSync,rmdirSync} from 'node:fs';
    import {createHash} from 'node:crypto';
    const path=${JSON.stringify(statePath)};
    const load=()=>JSON.parse(readFileSync(path,'utf8'));
    const digest=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
    const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const journal=o=>appendFileSync(path+'.journal',JSON.stringify(o)+'\\n');
    export async function attestRuntime({binding,developmentRecord}){
      const s=load();if(!s.attestationAvailable)throw new Error('fixture attestation source unavailable');
      if(s.attestationDelayMs)await new Promise(r=>setTimeout(r,s.attestationDelayMs));
      if(binding.projectRoot!==s.projectRoot||binding.bootId!==s.bootId)throw new Error('fixture binding mismatch');
      const record=developmentRecord?s.attestations[developmentRecord.attestationReference]:s.defaultAttestation;
      if(!record||record.revoked||(developmentRecord&&record.digest!==digest(developmentRecord)))
        throw new Error('fixture attestation unknown, revoked, or forged');
      if(record.expiresAt<=Date.now())throw new Error('fixture attestation expired');
      return {protocolVersion:1,attestationId:record.id,environment:'development',
        projectRoot:s.projectRoot,bootId:s.bootId,expiresAt:record.expiresAt};
    }
    export async function beginReclaim(request){
      const s=load();if(!s.authorizationAvailable)throw new Error('fixture Failure Gate source unavailable');
      const approved=s.approvals[request.manifest.authorizationReference];
      if(!approved||approved.revoked||approved.expiresAt<=Date.now()||
        approved.manifestDigest!==digest(request.manifest)||
        approved.scopeDigest!==request.scopeDigest||
        digest(request.requestedScope)!==request.scopeDigest||
        !equal(approved.runBinding,request.manifest.runBinding))
        throw new Error('fixture approval missing, expired, revoked, or scope/run mismatch');
      if(request.operation!=='runtime.process-reclaim'||request.binding.projectRoot!==s.projectRoot||
        request.binding.bootId!==s.bootId||request.attestation.projectRoot!==s.projectRoot||
        request.attestation.expiresAt<=Date.now())throw new Error('fixture operation binding mismatch');
      const claim=path+'.claim-'+digest(request.manifest.authorizationReference);
      mkdirSync(claim); // one atomic claim, permanent replay marker in this fixture
      mkdirSync(path+'.active'); // conservative project-wide single-flight fixture
      journal({event:'claim',operationId:request.operationId,reference:request.manifest.authorizationReference});
      if(s.beginHang)await new Promise(()=>{});
      return {protocolVersion:1,authorizationId:request.manifest.authorizationReference,
        operationId:s.handleMismatch?'wrong-operation':request.operationId,scopeDigest:request.scopeDigest,
        attestationId:request.attestation.attestationId,expiresAt:approved.expiresAt,runBinding:approved.runBinding,
        async checkBeforeSignal(next){
          const current=load(),a=current.approvals[request.manifest.authorizationReference];
          if(!current.authorizationAvailable||!a||a.revoked||a.expiresAt<=Date.now()||
            next.operationId!==request.operationId||next.scopeDigest!==request.scopeDigest||
            next.attestation.attestationId!==request.attestation.attestationId||
            next.attestation.expiresAt<=Date.now())throw new Error('fixture signal authority revoked or mismatched');
          journal({event:'signal-intent',operationId:request.operationId,signal:next.signal});
          if(current.revokeAfterTerm&&next.signal==='SIGTERM'){
            current.approvals[request.manifest.authorizationReference].revoked=true;
            writeFileSync(path,JSON.stringify(current));
          }
          return true;
        },
        async recordOutcome(result){
          if(!load().evidenceAvailable)throw new Error('fixture authoritative evidence unavailable');
          if(result.operationId!==request.operationId)throw new Error('fixture outcome operation mismatch');
          journal({event:'outcome',...result});
          if(result.rawOutcome.state==='FREE'&&result.rawOutcome.verifiedTargetsStopped)rmdirSync(path+'.active');
          return true;
        }
      };
    }`;
}
function updateHostState(s, fn) {
  const state = JSON.parse(readFileSync(s.hostState, "utf8"));
  fn(state); writeFileSync(s.hostState, JSON.stringify(state));
}
function setup(t, { host = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "port-authority-regression-"));
  const scripts = join(dir, "runtime-fixture"); mkdirSync(scripts);
  for (const name of ["free-ports.mjs", "validation-lock.mjs", "runtime-environment.mjs", "host-capabilities.mjs"]) {
    const consumer = ["free-ports.mjs", "validation-lock.mjs"].includes(name);
    const destination = join(scripts, name);
    copyFileSync(join(root, "scripts", name), destination);
    if (consumer) {
      // Private advanced-profile fixture only; preserves source fault-injection
      // points and IPC-only workers. This prefix is NEVER shipped to a host.
      const source = readFileSync(destination, "utf8");
      writeFileSync(destination, source.replace("#!/usr/bin/env node",
        `#!/usr/bin/env node\nif (!["--pa-watchdog", "--pa-workload-gate"].includes(process.argv[2])) process.argv.splice(2, 0, "--advanced");`));
    }
  }
  const hostState = join(dir, "fixture-host-state");
  writeFileSync(hostState, JSON.stringify({
    projectRoot: realpathSync(process.cwd()), bootId, attestations: {}, approvals: {},
    attestationAvailable: true, authorizationAvailable: true, evidenceAvailable: true,
    defaultAttestation: { id: "fixture-independent-development-attestation", expiresAt: Date.now() + 120000 },
  }));
  if (host) writeFileSync(join(scripts, "host-capabilities.mjs"), fixtureHostModule(hostState));
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("VALIDATION_LOCK_") || k.startsWith("FREE_PORTS_")) delete env[k];
  delete env.REPLIT_DEV_DOMAIN; delete env.REPLIT_DEPLOYMENT; delete env.REPLIT_ENVIRONMENT;
  delete env.PORT_AUTHORITY_DEV_CONTEXT_FILE;
  Object.assign(env, {
    NODE_ENV: "test", VALIDATION_LOCK_FILE: join(dir, "lease"),
    VALIDATION_LOCK_WAITERS_DIR: join(dir, "waiters"),
    VALIDATION_LOCK_POLL_MS: "20", VALIDATION_LOCK_TIMEOUT_MS: "5000",
    VALIDATION_LOCK_HEARTBEAT_MS: "40", VALIDATION_LOCK_STALE_HEARTBEAT_MS: "200",
    VALIDATION_LOCK_MAX_HOLD_MS: "10000",
    VALIDATION_LOCK_STOP_GRACE_MS: "150", VALIDATION_LOCK_STOP_KILL_MS: "1000",
  });
  const jobs = new Set(), extras = [];
  function launch(script, args = [], overrides = {}, options = {}) {
    if (script === cleanup || script === lock) script = join(scripts, script.split("/").at(-1));
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...env, ...overrides }, stdio: ["ignore", "pipe", "pipe"], ...options,
    });
    let text = "";
    child.stdout.on("data", b => { text += b; });
    child.stderr.on("data", b => { text += b; });
    const task = { child, get text() { return text; }, done: null, closed: false };
    task.done = new Promise((res, rej) => {
      child.once("error", rej);
      child.once("close", code => { task.closed = true; res({ code, text }); });
    });
    jobs.add(task);
    return task;
  }
  const run = (script, args, overrides) => launch(script, args, overrides).done;
  const wrapped = (code, overrides, opts = []) => launch(lock,
    [...opts, "--", process.execPath, "-e", code], overrides);
  t.after(async () => {
    // Only fixture identities created/recorded by this isolated test are signaled.
    for (const task of jobs) if (!task.closed) task.child.kill("SIGTERM");
    await sleep(250);
    for (const task of jobs) if (!task.closed) task.child.kill("SIGKILL");
    for (const p of extras) if (isAlive(p)) process.kill(p.pid, "SIGKILL");
    await Promise.allSettled([...jobs].map(j => j.done));
    rmSync(dir, { recursive: true, force: true });
  }, { timeout: HOOK_TIMEOUT_MS });
  return { dir, env, launch, run, wrapped, extras, hostState, scripts };
}
async function listener(s, body = "") {
  const fixture = s.launch("-e", [
    `const n=require('node:net');const server=n.createServer();
     server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
     ${body}`,
  ], {}, { detached: true });
  const match = await until(() => fixture.text.match(/\{"port":(\d+)\}/));
  return { task: fixture, port: Number(match[1]), identity: identity(fixture.child.pid) };
}
function manifest(s, fixtures, edits = {}) {
  const path = join(s.dir, `manifest-${randomUUID()}.json`);
  const record = {
    version: 2, bootId, expiresAt: Date.now() + 30000,
    ports: fixtures.map(f => f.port), processes: fixtures.map(f => ({
      pid: f.identity.pid, startTime: f.identity.startTime,
    })), authorizationReference: `fixture-approved-${randomUUID()}`,
    runBinding: { taskId: "isolated-task", approvedPlanBinding: "isolated-approved-plan", runId: randomUUID() },
    allowOwnTree: true, ...edits,
  };
  writeFileSync(path, JSON.stringify(record));
  const requestedScope = {
    ports: [...new Set(record.ports)].sort((a, b) => a - b),
    processes: record.processes.map(({ pid, startTime }) => ({ pid, startTime })).sort((a, b) => a.pid - b.pid),
    allowOwnTree: record.allowOwnTree === true,
    signals: ["SIGTERM", "SIGKILL"], graceMs: 3000, killVerificationMs: 5000,
  };
  updateHostState(s, state => {
    state.approvals[record.authorizationReference] = {
      manifestDigest: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
      scopeDigest: createHash("sha256").update(JSON.stringify(requestedScope)).digest("hex"),
      runBinding: record.runBinding, expiresAt: record.expiresAt,
    };
  });
  return path;
}
const actionArgs = (m, port) => ["--ownership-manifest", m, "--include-own-tree", "--authorized-cleanup", String(port)];
function developmentContext(s, edits = {}) {
  const path = join(s.dir, `development-context-${randomUUID()}.json`);
  const now = Date.now();
  const record = {
    version: 1, kind: "replit-development-workspace", bootId,
    projectRoot: realpathSync(process.cwd()), devDomain: "isolated-development.example",
    supervisor: identity(process.pid), issuedAt: now, expiresAt: now + 60000,
    attestationReference: `fixture-attestation-${randomUUID()}`,
    verificationReference: "isolated-fixture-audit-and-approval", ...edits,
  };
  writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
  updateHostState(s, state => {
    state.attestations[record.attestationReference] = {
      id: record.attestationReference, expiresAt: record.expiresAt,
      digest: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
    };
  });
  return { path, record, env: {
    REPLIT_ENVIRONMENT: "production", REPLIT_DEV_DOMAIN: record.devDomain,
    PORT_AUTHORITY_DEV_CONTEXT_FILE: path,
  } };
}
function seedLease(s, owner, edits = {}) {
  const record = {
    version: 2, bootId, token: randomUUID(), owner, baseFile: s.env.VALIDATION_LOCK_FILE,
    resource: "global", acquiredAt: Date.now(), heartbeatAt: Date.now(),
    phase: "finished", recoveryRequired: false, group: null, observed: [], ...edits,
  };
  writeFileSync(s.env.VALIDATION_LOCK_FILE, JSON.stringify(record));
  return record;
}
async function deadOwner(s) {
  const task = s.launch("-e", ["setTimeout(()=>process.exit(0),50)"]);
  const p = identity(task.child.pid);
  assert(p);
  assert.equal((await task.done).code, 0);
  assert(!isAlive(p));
  return p;
}
function overlapCode(log, label, duration) {
  return `const f=require('node:fs');const log=${JSON.stringify(log)};
    f.appendFileSync(log,JSON.stringify({label:${JSON.stringify(label)},event:'start',time:Date.now()})+'\\n');
    setTimeout(()=>f.appendFileSync(log,JSON.stringify({label:${JSON.stringify(label)},event:'end',time:Date.now()})+'\\n'),${duration});`;
}
function assertSerial(log) {
  const events = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  let count = 0;
  for (const e of events) { count += e.event === "start" ? 1 : -1; assert(count >= 0 && count <= 1, JSON.stringify(events)); }
  assert.equal(count, 0);
}

if (process.argv.includes("--supervised")) {
  // Authoring-only outer fixture, not a deployed host admission bypass. Do not
  // mutate the caller's environment or shipped adapters. Only this private
  // fixture subtree receives setup()'s explicitly simulated test environment.
  const teardown = [], s = setup({ after: fn => teardown.push(fn) }, { host: false });
  console.log(JSON.stringify({ scope: "isolated-bundle-fixture-only", testTimeoutMs: TEST_TIMEOUT_MS,
    fixtureHookTimeoutMs: HOOK_TIMEOUT_MS, executionLimitMs: 180000,
    hostActivationEvidence: false, stateDirectory: s.dir }));
  const pattern = process.argv.find(arg => arg.startsWith("--test-name-pattern="));
  const job = s.launch(lock, ["--", process.execPath, "--test", ...(pattern ? [pattern] : []), fileURLToPath(import.meta.url)], {
    VALIDATION_LOCK_MAX_HOLD_MS: "180000", VALIDATION_LOCK_STOP_GRACE_MS: "3000",
    VALIDATION_LOCK_STOP_KILL_MS: "5000",
  });
  const result = await job.done;
  process.stdout.write(result.text);
  if (existsSync(s.env.VALIDATION_LOCK_FILE)) {
    console.error(JSON.stringify({ incident: "suite-fixture-lease-retained", stateDirectory: s.dir }));
  } else {
    for (const finish of teardown) await finish();
  }
  process.exit(result.code ?? 1);
}

// Default-profile behavior is tested separately; retained advanced runtime cases
// below use private explicit-profile shims, never shipped authority integrations.
await import("./core.test.mjs");

test("contract: one identity, reduced defaults and explicit optional features", () => {
  const skill = readFileSync(join(root, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: port-authority\n/);
  assert(skill.split("\n").length < 500);
  assert(skill.split("\n")[2].slice("description: ".length).length <= 1024);
  assert(skill.includes("Core Runtime Hygiene"));
  assert(skill.includes("**read-only inventory**"));
  assert(skill.includes("one outer local lease"));
  assert(!skill.includes("perform exactly three authorized isolation retries"));
  assert(!skill.includes("ACCEPTABLE_WITH_IGNORED_FAILURES"));
  for (const p of ["scripts/free-ports.mjs", "scripts/validation-lock.mjs",
    "scripts/runtime-environment.mjs", "scripts/host-capabilities.mjs", "reference/runtime-contract.md",
    "reference/advanced-controls.md", "reference/symptom-guidance.md",
    "tests/hardening.test.mjs", "tests/core.test.mjs"]) assert(existsSync(join(root, p)));
});

test("contract: stages retain authority and actual host acceptance", () => {
  const guide = readFileSync(join(root, "SKILL.md"), "utf8").replace(/\s+/g, " ");
  const contract = readFileSync(join(root, "reference/runtime-contract.md"), "utf8").replace(/\s+/g, " ");
  for (const state of ["STAGED", "CORE_VERIFIED"]) {
    assert(guide.includes(state)); assert(contract.includes(state));
  }
  assert(guide.includes("two consecutive authorized host acceptance runs"));
  assert(contract.includes("without overwriting live scripts/callers"));
  assert(contract.includes("do not silently remove that dependency"));
  assert(contract.includes("fixture proof alone does not"));
  assert(guide.includes("Unknown governing policy blocks dependent execution"));
});

test("contract: advanced reclaim requires genuine providers and is not supplied by Unified", () => {
  const contract = readFileSync(join(root, "reference/advanced-controls.md"), "utf8").replace(/\s+/g, " ");
  assert(contract.includes("Failure Gate Unified does not provide pre-existing-process reclaim authority"));
  assert(contract.includes("never attestation or authorization"));
  assert(contract.includes("No ordinary Port Authority installation requires this extension"));
  assert(contract.includes("Never install test adapters"));
  assert(contract.includes("atomically claims one operation"));
  assert(contract.includes("reconcile through the actual authorized read/recovery route"));
  const adapter = readFileSync(join(root, "scripts/host-capabilities.mjs"), "utf8");
  assert(adapter.includes("HOST_ATTESTATION_UNAVAILABLE"));
  assert(adapter.includes("FAILURE_GATE_AUTHORIZATION_UNAVAILABLE"));
});

test("contract: Unified integration preserves tier, recovery and process identity boundaries", () => {
  const guide = readFileSync(join(root, "SKILL.md"), "utf8").replace(/\s+/g, " ");
  const contract = readFileSync(join(root, "reference/runtime-contract.md"), "utf8").replace(/\s+/g, " ");
  const advanced = readFileSync(join(root, "reference/advanced-controls.md"), "utf8").replace(/\s+/g, " ");
  assert(guide.includes("exactly one adequate assigned tier"));
  assert(guide.includes("not prerequisites for unrelated plan publication") ||
    guide.includes("or prerequisites for unrelated plan publication"));
  assert(guide.includes("they do not authorize task planning or execution"));
  assert(guide.includes("does not authorize uncertain-lease deletion"));
  assert(contract.includes("not two more approvals or a publication gate for unrelated plans"));
  assert(contract.includes("no separate reviewer or recovery specification is universally required"));
  assert(contract.includes("not unrelated task planning"));
  assert(advanced.includes("Unified task approval alone does not supply this capability"));
});

test("contract: optional review preserves runtime evidence and post-Start safety", () => {
  const guide = readFileSync(join(root, "SKILL.md"), "utf8").replace(/\s+/g, " ");
  const contract = readFileSync(join(root, "reference/runtime-contract.md"), "utf8").replace(/\s+/g, " ");
  const prompt = readFileSync(join(root, "usage-prompt.txt"), "utf8").replace(/\s+/g, " ");
  assert(guide.includes("Separate independent review is optional"));
  assert(guide.includes('record review as "not selected," not pending or blocked'));
  assert(guide.includes("authorized implementer may obtain"));
  assert(guide.includes("two consecutive authorized host acceptance runs"));
  assert(guide.includes("adds no Start interceptor, plan editor or admission authority"));
  assert(guide.includes("A plan amendment is not permission to restart services"));
  assert(contract.includes("independent watchdog and cleanup acknowledgement"));
  assert(contract.includes("their safety contract is unchanged"));
  assert(contract.includes("before changing an active run's binding"));
  assert(prompt.includes("Separate review is not selected by this prompt"));
  assert(!prompt.includes("Create an implementation task and a real dependent independent"));
});

test("contract: complete core criteria preserve installed wiring and independent review", () => {
  const contract = readFileSync(join(root, "reference/runtime-contract.md"), "utf8").replace(/\s+/g, " ");
  for (let i = 1; i <= 12; i++) assert(contract.includes(`C${String(i).padStart(2, "0")}`));
  assert(contract.includes("All conflict participants must resolve the same canonical file"));
  assert(contract.includes("scope, starting observations and expected proof"));
  assert(contract.includes("fresh independent post-repair proof"));
  assert(contract.includes("Definition-only confirmation, resource verification and app integration are distinct"));
  assert(contract.includes("no age-only unlink"));
});

test("contract: health remains actual-route proof; unrelated symptoms are conditional", () => {
  const guide = readFileSync(join(root, "SKILL.md"), "utf8").replace(/\s+/g, " ");
  const contract = readFileSync(join(root, "reference/runtime-contract.md"), "utf8").replace(/\s+/g, " ");
  assert(guide.includes("test the real routed request"));
  assert(guide.includes("Reject HTML-200"));
  assert(guide.includes("Static-only apps need no invented backend"));
  assert(contract.includes("real browser/proxy path"));
  assert(contract.includes("never stop a live service merely to create an outage fixture"));
  const symptoms = readFileSync(join(root, "reference/symptom-guidance.md"), "utf8");
  assert(symptoms.includes("not universal installation"));
});

test("invalid inputs and production flags win over development/disable markers", async t => {
  const s = setup(t);
  for (const args of [[], ["0"], ["65536"], ["--bad"], ["abc"]]) assert.equal((await s.run(cleanup, args)).code, 2);
  for (const args of [[], ["--priority", "10", "--", "node"], ["--resource", "UPPER", "--", "node"],
    ["--resource", "../bad", "--", "node"]]) assert.equal((await s.run(lock, args)).code, 2);
  assert.equal((await s.wrapped("process.exit(0)", { VALIDATION_LOCK_POLL_MS: "0" }).done).code, 2);
  for (const marker of ["NODE_ENV", "REPLIT_DEPLOYMENT", "REPLIT_ENVIRONMENT"]) {
    const env = { [marker]: marker === "REPLIT_DEPLOYMENT" ? "1" : "production",
      REPLIT_DEV_DOMAIN: "leftover-dev", FREE_PORTS_DISABLE: "1" };
    assert.equal((await s.run(cleanup, [], env)).code, 2);
    const result = await s.wrapped("console.log('SHOULD_NOT_EXECUTE')", env).done;
    assert.equal(result.code, 2); assert(!result.text.includes("SHOULD_NOT_EXECUTE"));
  }
  for (const k of ["FREE_PORTS_DISABLE", "FREE_PORTS_RUNNING"]) {
    const result = await s.run(cleanup, ["12345"], { [k]: "1" });
    assert.equal(result.code, 3); assert.match(result.text, /SKIPPED/);
  }
});

test("valid audited-fixture development context admits both scripts without changing flags", async t => {
  const s = setup(t), f = await listener(s), context = developmentContext(s);
  const cleaned = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port), context.env);
  assert.equal(cleaned.code, 0, cleaned.text); assert(!isAlive(f.identity));
  assert.match(cleaned.text, /verified-development-context-admission/);
  const result = await s.wrapped(`if(process.env.REPLIT_ENVIRONMENT!=='production')
    throw new Error('marker changed');console.log('AUTHORIZED_FIXTURE_CHILD')`, context.env).done;
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /AUTHORIZED_FIXTURE_CHILD/);
  assert.match(result.text, /verified-development-context-admission/);
  assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});

test("hard production and deployment markers reject even valid development evidence", async t => {
  const s = setup(t), f = await listener(s), context = developmentContext(s);
  for (const marker of [{ NODE_ENV: "production" }, { REPLIT_DEPLOYMENT: "1" }]) {
    const env = { ...context.env, ...marker };
    const cleaned = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port), env);
    assert.equal(cleaned.code, 2, cleaned.text); assert(isAlive(f.identity));
    assert(!cleaned.text.includes("authorized-process-signal"));
    const result = await s.wrapped("console.log('ILLEGAL_START')", env).done;
    assert.equal(result.code, 2, result.text); assert(!result.text.includes("ILLEGAL_START"));
    assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
  }
});

test("unconfigured bundled host adapters reject plausible attestation and reclaim records", async t => {
  const s = setup(t, { host: false }), f = await listener(s), context = developmentContext(s);
  const blockedContext = await s.wrapped("console.log('ILLEGAL_START')", context.env).done;
  assert.equal(blockedContext.code, 2, blockedContext.text);
  assert.match(blockedContext.text, /HOST_ATTESTATION_UNAVAILABLE/);
  assert(!blockedContext.text.includes("ILLEGAL_START"));
  const blockedAction = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port));
  assert.equal(blockedAction.code, 4, blockedAction.text); assert(isAlive(f.identity));
  assert.match(blockedAction.text, /HOST_ATTESTATION_UNAVAILABLE/);
  assert(!blockedAction.text.includes("authorized-process-signal"));
});

test("local development records without independent provider backing do not admit either script", async t => {
  const s = setup(t), f = await listener(s), context = developmentContext(s);
  updateHostState(s, state => { delete state.attestations[context.record.attestationReference]; });
  const a = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port), context.env);
  const b = await s.wrapped("console.log('ILLEGAL_START')", context.env).done;
  assert.equal(a.code, 2, a.text); assert.equal(b.code, 2, b.text);
  assert(isAlive(f.identity)); assert(!a.text.includes("authorized-process-signal"));
  assert(!b.text.includes("ILLEGAL_START"));
});

test("attestation alone cannot replace an unavailable Failure Gate authorization source", async t => {
  const s = setup(t), f = await listener(s);
  updateHostState(s, state => { state.authorizationAvailable = false; });
  const result = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port));
  assert.equal(result.code, 4, result.text); assert.match(result.text, /Failure Gate source unavailable/);
  assert(isAlive(f.identity)); assert(!result.text.includes("authorized-process-signal"));
});

test("forged references and altered approved plan/run/port/process scope cannot signal", async t => {
  const s = setup(t), target = await listener(s), other = await listener(s);
  const changes = [
    r => { r.authorizationReference = "agent-written-approval"; },
    r => { r.runBinding.taskId = "different-task"; },
    r => { r.runBinding.approvedPlanBinding = "different-plan"; },
    r => { r.runBinding.runId = "different-run"; },
    r => { r.ports.push(other.port); },
    r => { r.processes.push({ pid: other.identity.pid, startTime: other.identity.startTime }); },
    r => { r.expiresAt += 1000; },
  ];
  for (const change of changes) {
    const path = manifest(s, [target]), record = JSON.parse(readFileSync(path, "utf8"));
    change(record); writeFileSync(path, JSON.stringify(record));
    const result = await s.run(cleanup, actionArgs(path, target.port));
    assert.equal(result.code, 4, result.text); assert(!result.text.includes("authorized-process-signal"));
    assert(isAlive(target.identity)); assert(isAlive(other.identity));
  }
});

test("legacy reclaim manifests cannot be upgraded by claiming authorization", async t => {
  const s = setup(t), f = await listener(s);
  for (const edits of [{ version: 1 }, { runBinding: null }]) {
    const result = await s.run(cleanup, actionArgs(manifest(s, [f], edits), f.port));
    assert.equal(result.code, 4, result.text); assert(isAlive(f.identity));
    assert(!result.text.includes("authorized-process-signal"));
  }
});

test("reclaim replay is rejected even after the target and listener stopped", async t => {
  const s = setup(t), f = await listener(s), path = manifest(s, [f]);
  const first = await s.run(cleanup, actionArgs(path, f.port));
  assert.equal(first.code, 0, first.text); assert(!isAlive(f.identity));
  const replay = await s.run(cleanup, actionArgs(path, f.port));
  assert.equal(replay.code, 4, replay.text); assert(!replay.text.includes("authorized-process-signal"));
  const events = readFileSync(`${s.hostState}.journal`, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.filter(e => e.event === "claim").length, 1);
});

test("concurrent reclaim of one grant admits only one operation", async t => {
  const s = setup(t);
  const f = await listener(s, "process.on('SIGTERM',()=>server.close());setInterval(()=>{},1000);");
  const path = manifest(s, [f]);
  const results = await Promise.all([
    s.run(cleanup, actionArgs(path, f.port)), s.run(cleanup, actionArgs(path, f.port)),
  ]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 4], results.map(r => r.text).join("\n"));
  assert(!isAlive(f.identity));
  const events = readFileSync(`${s.hostState}.journal`, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.filter(e => e.event === "claim").length, 1);
});

test("Failure Gate revocation prevents escalation and records the partial outcome", async t => {
  const s = setup(t);
  const f = await listener(s, "process.on('SIGTERM',()=>server.close());setInterval(()=>{},1000);");
  updateHostState(s, state => { state.revokeAfterTerm = true; });
  const result = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port));
  assert.equal(result.code, 4, result.text); assert(isAlive(f.identity));
  assert.match(result.text, /"signal":"SIGTERM"/); assert(!result.text.includes('"signal":"SIGKILL"'));
  const events = readFileSync(`${s.hostState}.journal`, "utf8").trim().split("\n").map(JSON.parse);
  const outcome = events.find(e => e.event === "outcome");
  assert.equal(outcome.rawOutcome.state, "UNKNOWN");
  assert.equal(outcome.signalOutcomes[0].signal, "SIGTERM");
});

test("different grants cannot concurrently reclaim conflicting project resources", async t => {
  const s = setup(t);
  const f = await listener(s, "process.on('SIGTERM',()=>server.close());setInterval(()=>{},1000);");
  const results = await Promise.all([
    s.run(cleanup, actionArgs(manifest(s, [f]), f.port)),
    s.run(cleanup, actionArgs(manifest(s, [f]), f.port)),
  ]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 4], results.map(r => r.text).join("\n"));
  assert(!isAlive(f.identity));
  const events = readFileSync(`${s.hostState}.journal`, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.filter(e => e.event === "claim").length, 1);
});

test("Failure Gate grant expiry prevents escalation even when the manifest remains fresh", async t => {
  const s = setup(t);
  const f = await listener(s, "process.on('SIGTERM',()=>server.close());setInterval(()=>{},1000);");
  const path = manifest(s, [f]);
  updateHostState(s, state => {
    state.approvals[JSON.parse(readFileSync(path, "utf8")).authorizationReference].expiresAt = Date.now() + 2500;
  });
  const result = await s.run(cleanup, actionArgs(path, f.port));
  assert.equal(result.code, 4, result.text); assert(isAlive(f.identity));
  assert.match(result.text, /"signal":"SIGTERM"/); assert(!result.text.includes('"signal":"SIGKILL"'));
});

test("failure to record authoritative evidence preserves raw cleanup success but cannot pass", async t => {
  const s = setup(t), f = await listener(s);
  updateHostState(s, state => { state.evidenceAvailable = false; });
  const result = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port));
  assert.equal(result.code, 4, result.text); assert(!isAlive(f.identity));
  const outcome = result.text.trim().split("\n").filter(l => l.startsWith('{"tool":"free-ports"')).map(JSON.parse).at(-1);
  assert.equal(outcome.evidenceRecorded, false); assert.equal(outcome.rawOutcome.state, "FREE", result.text);
  assert.equal(outcome.rawOutcome.exitCode, 0); assert(outcome.rawOutcome.verifiedTargetsStopped);
});

test("timed-out claims and malformed handles cannot signal or be retried automatically", async t => {
  const s = setup(t), f = await listener(s);
  updateHostState(s, state => { state.beginHang = true; });
  const result = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port));
  assert.equal(result.code, 4, result.text); assert.match(result.text, /deadline exceeded/);
  assert(isAlive(f.identity)); assert(!result.text.includes("authorized-process-signal"));
  const events = readFileSync(`${s.hostState}.journal`, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.filter(e => e.event === "claim").length, 1);
  assert.equal(events.filter(e => e.event === "signal-intent").length, 0);
  const other = setup(t), target = await listener(other);
  updateHostState(other, state => { state.handleMismatch = true; });
  const invalid = await other.run(cleanup, actionArgs(manifest(other, [target]), target.port));
  assert.equal(invalid.code, 4, invalid.text); assert(isAlive(target.identity));
  assert(!invalid.text.includes("authorized-process-signal"));
});

test("missing, stale, unsafe, or unverified development evidence cannot authorize signals or dispatch", async t => {
  const s = setup(t), f = await listener(s);
  const now = Date.now();
  const cases = [
    developmentContext(s, { version: 2 }),
    developmentContext(s, { kind: "deployment" }),
    developmentContext(s, { expiresAt: now - 1 }),
    developmentContext(s, { issuedAt: now + 60000, expiresAt: now + 90000 }),
    developmentContext(s, { expiresAt: now + 3600000 }),
    developmentContext(s, { bootId: "foreign-boot" }),
    developmentContext(s, { projectRoot: s.dir }),
    developmentContext(s, { verificationReference: "" }),
    developmentContext(s, { attestationReference: "" }),
    developmentContext(s, { supervisor: { pid: process.pid, startTime: "1" } }),
    developmentContext(s, { supervisor: f.identity }),
    developmentContext(s, { supervisor: { pid: process.pid, startTime: Number(identity(process.pid).startTime) } }),
  ];
  const noDomain = developmentContext(s); noDomain.env.REPLIT_DEV_DOMAIN = ""; cases.push(noDomain);
  const wrongDomain = developmentContext(s); wrongDomain.env.REPLIT_DEV_DOMAIN = "other.example"; cases.push(wrongDomain);
  const missing = developmentContext(s); rmSync(missing.path); cases.push(missing);
  const malformed = developmentContext(s); writeFileSync(malformed.path, "{bad"); cases.push(malformed);
  const writable = developmentContext(s); chmodSync(writable.path, 0o666); cases.push(writable);
  const linked = developmentContext(s); symlinkSync(linked.path, `${linked.path}.link`);
  linked.env.PORT_AUTHORITY_DEV_CONTEXT_FILE = `${linked.path}.link`; cases.push(linked);
  const hardLinked = developmentContext(s); linkSync(hardLinked.path, `${hardLinked.path}.link`);
  cases.push(hardLinked);
  const relative = developmentContext(s); relative.env.PORT_AUTHORITY_DEV_CONTEXT_FILE = "relative.json"; cases.push(relative);
  const directory = developmentContext(s); directory.env.PORT_AUTHORITY_DEV_CONTEXT_FILE = s.dir; cases.push(directory);
  cases.push({ env: { REPLIT_ENVIRONMENT: "production", REPLIT_DEV_DOMAIN: "domain-alone.example" } });
  for (const context of cases) {
    const cleaned = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port), context.env);
    assert.equal(cleaned.code, 2, cleaned.text); assert(isAlive(f.identity));
    assert(!cleaned.text.includes("authorized-process-signal"));
    const result = await s.wrapped("console.log('ILLEGAL_START')", context.env).done;
    assert.equal(result.code, 2, result.text); assert(!result.text.includes("ILLEGAL_START"));
    assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
  }
});

test("development evidence expiring during queue wait blocks child dispatch", async t => {
  const s = setup(t), context = developmentContext(s, { expiresAt: Date.now() + 2000 });
  seedLease(s, identity(process.pid));
  const job = s.wrapped("console.log('ILLEGAL_START')", context.env);
  await until(() => job.text.includes("verified-development-context-admission"));
  await until(() => Date.now() > context.record.expiresAt);
  rmSync(s.env.VALIDATION_LOCK_FILE);
  const result = await job.done;
  assert.equal(result.code, 4, result.text); assert(!result.text.includes("ILLEGAL_START"));
  assert.match(result.text, /runtime guard blocked before dispatch/);
});

test("expired admission evidence does not disable supervision of an already dispatched child", async t => {
  const s = setup(t), context = developmentContext(s, { expiresAt: Date.now() + 1200 });
  const pidFile = join(s.dir, "admitted-child");
  const job = s.wrapped(`process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));`,
    { ...context.env, VALIDATION_LOCK_MAX_HOLD_MS: "1800" });
  const p = await until(() => existsSync(pidFile) && identity(Number(readFileSync(pidFile, "utf8"))));
  s.extras.push(p);
  const result = await job.done;
  assert.equal(result.code, 1, result.text); assert.match(result.text, /execution-budget/);
  assert(Date.now() > context.record.expiresAt); assert(!isAlive(p));
  assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});

test("expired development context prevents cleanup escalation and requires recovery", async t => {
  const s = setup(t);
  const f = await listener(s, "process.on('SIGTERM',()=>server.close());setInterval(()=>{},1000);");
  const context = developmentContext(s, { expiresAt: Date.now() + 2500 });
  const result = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port), context.env);
  assert.equal(result.code, 4, result.text); assert.match(result.text, /requiresRecovery/);
  assert.match(result.text, /"signal":"SIGTERM"/); assert(!result.text.includes('"signal":"SIGKILL"'));
  assert(isAlive(f.identity));
});

test("unreadable socket inventories fail UNKNOWN without signals", async t => {
  const s = setup(t);
  const code = `const f=require('node:fs');const original=f.readFileSync;
    f.readFileSync=function(p,...a){if(p==='/proc/net/tcp'||p==='/proc/net/tcp6'){
    const e=new Error('fixture discovery denied');e.code='EACCES';throw e;}return original.call(this,p,...a)};
    require('node:module').syncBuiltinESMExports();process.argv=[process.execPath,${JSON.stringify(cleanup)},'12345'];
    import(require('node:url').pathToFileURL(${JSON.stringify(cleanup)}).href);`;
  const result = await s.run("-e", [code]);
  assert.equal(result.code, 4); assert.match(result.text, /UNKNOWN/);
});

test("absent IPv6 table without positive disabled-capability proof stays UNKNOWN", async t => {
  const s = setup(t);
  const code = `const f=require('node:fs');const original=f.readFileSync;
    f.readFileSync=function(p,...a){if(p==='/proc/net/tcp6'){
    const e=new Error('fixture absent table');e.code='ENOENT';throw e;}
    if(p==='/sys/module/ipv6/parameters/disable')return '0';
    return original.call(this,p,...a)};
    require('node:module').syncBuiltinESMExports();process.argv=[process.execPath,${JSON.stringify(cleanup)},'12345'];
    import(require('node:url').pathToFileURL(${JSON.stringify(cleanup)}).href);`;
  const result = await s.run("-e", [code]);
  assert.equal(result.code, 4); assert.match(result.text, /UNKNOWN/);
});

test("unused ephemeral port succeeds without a cleanup manifest", async t => {
  const s = setup(t), probe = createServer();
  await new Promise((res, rej) => { probe.once("error", rej); probe.listen(0, "127.0.0.1", res); });
  const port = probe.address().port;
  await new Promise(res => probe.close(res));
  const result = await s.run(cleanup, [String(port)]);
  assert.equal(result.code, 0, result.text); assert.match(result.text, /FREE/);
});

test("unapproved and protected-own-tree listeners are not signaled", async t => {
  const s = setup(t), f = await listener(s);
  const a = await s.run(cleanup, [String(f.port)]);
  assert.equal(a.code, 3, a.text); assert(isAlive(f.identity));
  const m = manifest(s, [f]);
  const b = await s.run(cleanup, ["--ownership-manifest", m, "--authorized-cleanup", String(f.port)]);
  assert.equal(b.code, 3); assert(isAlive(f.identity));
});

test("expired/wrong-boot/wrong-incarnation/ancestor manifests cannot signal", async t => {
  const s = setup(t), f = await listener(s);
  for (const edits of [
    { expiresAt: Date.now() - 1 }, { bootId: "not-this-boot" },
    { processes: [{ pid: f.identity.pid, startTime: "1" }] },
    { processes: [{ pid: 1, startTime: "1" }] },
    { processes: [f.identity, identity(process.pid)] },
  ]) {
    const m = manifest(s, [f], edits);
    assert.notEqual((await s.run(cleanup, actionArgs(m, f.port))).code, 0);
    assert(isAlive(f.identity));
  }
});

test("unapproved descendant blocks all cleanup signals", async t => {
  const s = setup(t), pidFile = join(s.dir, "descendant");
  const f = await listener(s, `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));`);
  await until(() => existsSync(pidFile));
  const child = await until(() => identity(Number(readFileSync(pidFile, "utf8"))));
  s.extras.push(child);
  const result = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port));
  assert.equal(result.code, 3, result.text); assert.match(result.text, /unapproved descendant/);
  assert(isAlive(f.identity)); assert(isAlive(child));
});

test("dry-run changes nothing; authorized exact target stops and unrelated target survives", async t => {
  const s = setup(t), target = await listener(s), other = await listener(s);
  const m = manifest(s, [target]);
  const dry = await s.run(cleanup, ["--ownership-manifest", m, "--include-own-tree", "--dry-run", String(target.port)]);
  assert.equal(dry.code, 3, dry.text); assert(isAlive(target.identity)); assert(isAlive(other.identity));
  const result = await s.run(cleanup, actionArgs(m, target.port));
  assert.equal(result.code, 0, result.text); assert(!isAlive(target.identity)); assert(isAlive(other.identity));
  assert.match(result.text, /authorized-process-signal/);
  assert.match(result.text, /verifiedTargetsStopped/);
});

test("closing port cannot hide an authorized surviving process", async t => {
  const s = setup(t);
  const f = await listener(s, "process.on('SIGTERM',()=>server.close());setInterval(()=>{},1000);");
  const result = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port));
  assert.equal(result.code, 0, result.text); assert(!isAlive(f.identity));
  assert.match(result.text, /SIGKILL/);
});

test("action manifest verifies targets even if the listener closed before invocation", async t => {
  const s = setup(t);
  const f = await listener(s, "setInterval(()=>{},1000);setTimeout(()=>server.close(()=>console.log('CLOSED')),100);");
  await until(() => f.task.text.includes("CLOSED"));
  assert(isAlive(f.identity));
  const result = await s.run(cleanup, actionArgs(manifest(s, [f]), f.port));
  assert.equal(result.code, 0, result.text); assert(!isAlive(f.identity));
  assert.match(result.text, /verifiedTargetsStopped/);
});

test("raw child statuses propagate; missing executable fails without stranded lease", async t => {
  const s = setup(t);
  for (const code of [0, 7]) {
    const result = await s.wrapped(`process.exit(${code})`).done;
    assert.equal(result.code, code, result.text); assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
  }
  const failed = await s.run(lock, ["--", join(s.dir, "no-executable")]);
  assert.notEqual(failed.code, 0); assert(!existsSync(s.env.VALIDATION_LOCK_FILE), failed.text);
});

test("same-resource commands serialize; disjoint resources can overlap", async t => {
  const s = setup(t), log = join(s.dir, "events");
  const pair = [s.wrapped(overlapCode(log, "a", 250)), s.wrapped(overlapCode(log, "b", 250))];
  const pairResults = await Promise.all(pair.map(p => p.done));
  for (const result of pairResults) assert.equal(result.code, 0, JSON.stringify(pairResults));
  assertSerial(log);
  const independent = join(s.dir, "independent");
  const others = [
    s.wrapped(overlapCode(independent, "a", 400), { VALIDATION_LOCK_FILE: join(s.dir, "a") }, ["--resource", "a"]),
    s.wrapped(overlapCode(independent, "b", 400), { VALIDATION_LOCK_FILE: join(s.dir, "b") }, ["--resource", "b"]),
  ];
  for (const result of await Promise.all(others.map(p => p.done))) assert.equal(result.code, 0, result.text);
  const events = readFileSync(independent, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events[0].event, "start"); assert.equal(events[1].event, "start");
});

test("stale heartbeat/max-hold does not reclaim a live owner", async t => {
  const s = setup(t);
  const record = seedLease(s, identity(process.pid), { heartbeatAt: 1, acquiredAt: 1 });
  const result = await s.wrapped("console.log('ILLEGAL_START')", { VALIDATION_LOCK_TIMEOUT_MS: "200" }).done;
  assert.equal(result.code, 3); assert(!result.text.includes("ILLEGAL_START"));
  assert.equal(JSON.parse(readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8")).token, record.token);
});

test("quiescent dead owner recovers; surviving workload blocks recovery", async t => {
  const s = setup(t), dead = await deadOwner(s);
  seedLease(s, dead);
  const recovered = await s.wrapped("process.exit(0)").done;
  assert.equal(recovered.code, 0, recovered.text);
  assert.match(recovered.text, /verified-quiescent-stale-recovery/);
  const f = await listener(s);
  seedLease(s, dead, { phase: "running", group: f.identity.pid, observed: [f.identity] });
  const blocked = await s.wrapped("console.log('ILLEGAL_START')").done;
  assert.equal(blocked.code, 4); assert(!blocked.text.includes("ILLEGAL_START"));
  assert(isAlive(f.identity)); assert(existsSync(s.env.VALIDATION_LOCK_FILE));
});

test("launch gaps, legacy/corrupt leases, and abandoned transition mutexes fail closed", async t => {
  const s = setup(t), dead = await deadOwner(s);
  seedLease(s, dead, { phase: "launching" });
  assert.equal((await s.wrapped("process.exit(0)").done).code, 4);
  seedLease(s, { ...identity(process.pid), startTime: Number(identity(process.pid).startTime) });
  assert.equal((await s.wrapped("console.log('ILLEGAL_START')").done).code, 4);
  for (const data of ["123\n456\n", "{broken-json", JSON.stringify({ version: 2 })]) {
    writeFileSync(s.env.VALIDATION_LOCK_FILE, data);
    assert.equal((await s.wrapped("process.exit(0)").done).code, 4);
    assert.equal(readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8"), data);
  }
  rmSync(s.env.VALIDATION_LOCK_FILE);
  mkdirSync(`${s.env.VALIDATION_LOCK_FILE}.transition`);
  assert.equal((await s.wrapped("process.exit(0)", { VALIDATION_LOCK_TIMEOUT_MS: "150" }).done).code, 3);
});

test("PID-only and forged token/path reentry cannot bypass the lease", async t => {
  const s = setup(t);
  assert.equal((await s.wrapped("console.log('ILLEGAL_START')",
    { VALIDATION_LOCK_HELD_PID: String(process.pid) }).done).code, 4);
  const key = `VALIDATION_LOCK_CONTEXT_${createHash("sha256").update(s.env.VALIDATION_LOCK_FILE).digest("hex")}`;
  const record = seedLease(s, identity(process.pid));
  for (const entry of [
    { file: s.env.VALIDATION_LOCK_FILE, token: "wrong", owner: record.owner },
    { file: join(s.dir, "other-path"), token: record.token, owner: record.owner },
    { file: s.env.VALIDATION_LOCK_FILE, token: record.token, owner: { pid: process.pid, startTime: "1" } },
  ]) {
    const result = await s.wrapped("console.log('ILLEGAL_START')", {
      [key]: JSON.stringify({ baseFile: s.env.VALIDATION_LOCK_FILE, resource: "global", chain: [entry] }),
    }).done;
    assert.equal(result.code, 4); assert(!result.text.includes("ILLEGAL_START"));
  }
});

test("deep sequential reentry finishes; inherited-context parallel siblings serialize", async t => {
  const s = setup(t);
  // Surface the exact private fixture path and descriptor metadata if a safe
  // regular-file rejection recurs. Keep the same checks and fail-closed result.
  const environment = join(s.scripts, "runtime-environment.mjs");
  const environmentSource = readFileSync(environment, "utf8");
  const guard = 'throw new Error("unsafe or oversized JSON file");';
  assert.equal(environmentSource.split(guard).length, 2);
  writeFileSync(environment, environmentSource.replace(guard,
    'throw new Error("unsafe or oversized JSON file: " + path + " (size=" + stat.size + ", links=" + stat.nlink + ", mode=" + stat.mode + ")");'));
  const fixtureLock = join(s.scripts, "validation-lock.mjs");
  const deep = s.launch(lock, ["--", process.execPath, fixtureLock, "--", process.execPath, fixtureLock,
    "--", process.execPath, "-e", "process.exit(0)"]);
  const deepResult = await deep.done;
  assert.equal(deepResult.code, 0, deepResult.text); assert.match(deepResult.text, /"nested":true/);
  const log = join(s.dir, "siblings");
  const commands = ["a", "b"].map(label => [fixtureLock, "--", process.execPath, "-e", overlapCode(log, label, 250)]);
  const parent = `const {spawn}=require('node:child_process');
    Promise.all(${JSON.stringify(commands)}.map(args=>new Promise(r=>{
      const c=spawn(process.execPath,args,{env:process.env,stdio:'inherit'});c.on('exit',r);
    }))).then(codes=>process.exit(codes.every(c=>c===0)?0:1));`;
  const result = await s.wrapped(parent).done;
  assert.equal(result.code, 0, result.text); assertSerial(log);
});

test("parent exit cleans surviving descendants and cannot become a successful run", async t => {
  const s = setup(t), pidFile = join(s.dir, "survivor");
  const descendant = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
    process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
  const parent = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});
    c.unref();setTimeout(()=>process.exit(0),150);`;
  const job = s.wrapped(parent);
  await until(() => existsSync(pidFile));
  const p = await until(() => identity(Number(readFileSync(pidFile, "utf8"))));
  s.extras.push(p);
  const result = await job.done;
  assert.equal(result.code, 1, result.text); assert.match(result.text, /surviving-descendant/);
  assert(!isAlive(p)); assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});

test("cancellation holds exclusion until resistant child stops", async t => {
  const s = setup(t), pidFile = join(s.dir, "resistant");
  const code = `process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));`;
  const first = s.wrapped(code);
  const p = await until(() => existsSync(pidFile) && identity(Number(readFileSync(pidFile, "utf8"))));
  s.extras.push(p);
  const check = `const f=require('node:fs');let live=false;
    try {const r=f.readFileSync('/proc/${p.pid}/stat','utf8').split(') ')[1].split(' ');
      live=r[19]===${JSON.stringify(p.startTime)}&&!['Z','X'].includes(r[0]);}catch{}
    if(live)throw new Error('OVERLAP');`;
  const second = s.wrapped(check);
  first.child.kill("SIGTERM");
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 1, a.text); assert.equal(b.code, 0, b.text);
  assert(!isAlive(p)); assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});

test("execution budget stops owned work before replacement", async t => {
  const s = setup(t), pidFile = join(s.dir, "budget-child");
  // Separate process startup from the runtime timeout assertion: 250 ms may
  // expire before the watchdog/gate is launched on a loaded host. This case
  // proves the command actually started, then proves bounded cleanup and
  // serialized replacement. Exit 4 before the marker cannot satisfy it.
  const first = s.wrapped(`process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));`, { VALIDATION_LOCK_MAX_HOLD_MS: "5000" });
  const p = await until(() => existsSync(pidFile) && identity(Number(readFileSync(pidFile, "utf8"))), 7000);
  assert(first.text.includes('"executionLimitMs":5000'), first.text);
  s.extras.push(p);
  const next = s.wrapped(`try {const f=require('node:fs').readFileSync('/proc/${p.pid}/stat','utf8').split(') ')[1].split(' ');
    if(f[19]===${JSON.stringify(p.startTime)}&&!['Z','X'].includes(f[0]))throw new Error('OVERLAP');
    }catch(e){if(e.message==='OVERLAP')throw e;}`);
  const [a, b] = await Promise.all([first.done, next.done]);
  assert.equal(a.code, 1, a.text); assert.match(a.text, /execution-budget/);
  assert.equal(b.code, 0, b.text); assert(!isAlive(p));
});

test("all validation budgets are explicit, finite and timer-safe before dispatch", async t => {
  const s = setup(t);
  for (const name of ["TIMEOUT_MS", "MAX_HOLD_MS"]) {
    for (const value of [undefined, "0", "-1", "Infinity", "NaN", "2147483648"]) {
      const result = await s.wrapped("console.log('ILLEGAL_START')", { [`VALIDATION_LOCK_${name}`]: value }).done;
      assert.equal(result.code, 2, result.text);
      assert.match(result.text, /explicit finite timer-safe/);
      assert(!result.text.includes("ILLEGAL_START")); assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
    }
  }
  const overflow = await s.wrapped("console.log('ILLEGAL_START')", { VALIDATION_LOCK_POLL_MS: "2147483648" }).done;
  assert.equal(overflow.code, 2);
  const normal = await s.wrapped("process.exit(0)").done;
  assert.equal(normal.code, 0, normal.text);
  for (const value of ['"queueLimitMs":5000', '"executionLimitMs":10000', '"clock":"monotonic"', "local-supervision-not-checked-approval"]) {
    assert(normal.text.includes(value), normal.text);
  }
});

test("direct package-script dispatcher fixture cannot bypass outer execution deadline", async t => {
  const s = setup(t), packageFile = join(s.dir, "package.json"), script = join(s.dir, "hang.cjs");
  const marker = join(s.dir, "direct-script-dispatched");
  writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');
    process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
  writeFileSync(packageFile, JSON.stringify({ scripts: { "test-direct": script } }));
  const dispatcher = `const script=JSON.parse(require('node:fs').readFileSync(${JSON.stringify(packageFile)},'utf8')).scripts['test-direct'];
    const c=require('node:child_process').spawn(process.execPath,[script],{stdio:'inherit'});
    c.on('exit',(code,signal)=>process.exit(signal?1:code));`;
  const result = await s.wrapped(dispatcher, { VALIDATION_LOCK_MAX_HOLD_MS: "5000" }).done;
  assert(existsSync(marker), result.text);
  assert.match(result.text, /"executionLimitMs":5000/);
  assert.equal(result.code, 1, result.text); assert.match(result.text, /execution-budget/);
  assert.match(result.text, /"workloadStopped":true/); assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});

test("async test and hanging hook report finite timeout; outer wrapper stops remaining handles", async t => {
  const s = setup(t), marker = join(s.dir, "node-test-callback");
  const cases = [
    `const fs=require('node:fs'),test=require('node:test');setInterval(()=>{},1000);
      test('async hang',{timeout:40},async()=>{fs.writeFileSync(${JSON.stringify(marker)},'started');
        await new Promise(()=>{});});`,
    `const fs=require('node:fs'),test=require('node:test');setInterval(()=>{},1000);
      test('hook hang',{timeout:200},t=>{fs.writeFileSync(${JSON.stringify(marker)},'started');
        t.after(async()=>await new Promise(()=>{}),{timeout:40});});`,
  ];
  for (const code of cases) {
    rmSync(marker, { force: true });
    const result = await s.wrapped(code, { VALIDATION_LOCK_MAX_HOLD_MS: "5000" }).done;
    assert(existsSync(marker), result.text);
    assert.match(result.text, /"executionLimitMs":5000/);
    assert.notEqual(result.code, 0, result.text);
    assert.match(result.text, /timed out after 40ms/); assert.match(result.text, /execution-budget/);
    assert.match(result.text, /"workloadStopped":true/);
    assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
  }
});

test("outer supervisor stops synchronous test despite its blocked per-test timer", async t => {
  const s = setup(t), marker = join(s.dir, "sync-test-dispatched");
  const result = await s.wrapped(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');
    require('node:test')('sync hang',{timeout:40},()=>{while(true){}});`,
    { VALIDATION_LOCK_MAX_HOLD_MS: "5000" }).done;
  assert(existsSync(marker), result.text);
  assert.match(result.text, /"executionLimitMs":5000/);
  assert.equal(result.code, 1, result.text); assert.match(result.text, /execution-budget/);
  assert.match(result.text, /"workloadStopped":true/); assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});

// All clock controls and source injections below are PRIVATE test fixtures.
// They change Date.now only, never performance.now/hrtime or runtime budgets.
function clockReversalScript(s, command, reverseWhenFileExists = null) {
  return `const fs=require('node:fs'),realNow=Date.now.bind(Date);let offset=0;
    globalThis.__paReverseWallClock=()=>{
      if(offset)return;
      const before=realNow();offset=3600000;
      console.log(JSON.stringify({fixture:'wall-clock-reversed',before,after:realNow()-offset}));
    };
    Date.now=()=>{
      if(${JSON.stringify(reverseWhenFileExists)}&&fs.existsSync(${JSON.stringify(reverseWhenFileExists)}))
        globalThis.__paReverseWallClock();
      return realNow()-offset;
    };
    process.argv=[process.execPath,${JSON.stringify(join(s.scripts, "validation-lock.mjs"))},'--',
      process.execPath,'-e',${JSON.stringify(command)}];
    import(${JSON.stringify(join(s.scripts, "validation-lock.mjs"))});`;
}
function injectPrivateClockFixture(s, point, before) {
  const file = join(s.scripts, "validation-lock.mjs"), source = readFileSync(file, "utf8");
  assert.equal(source.split(point).length, 2, "private fixture injection must identify one exact boundary");
  writeFileSync(file, source.replace(point, before + point));
}
function assertWallClockReversed(text) {
  const line = text.split("\n").find(line => line.startsWith('{"fixture":"wall-clock-reversed"'));
  assert(line, "the wall-clock reversal must actually occur\n" + text);
  const event = JSON.parse(line);
  assert(event.before - event.after >= 3599000, "fixture must move wall time back approximately one hour");
}

test("wall-clock reversal: expiry before dispatch returns 4 and retains the unfinalized lease", async t => {
  const s = setup(t), marker = join(s.dir, "must-not-dispatch");
  // Establish expiry at the pre-worker boundary, rather than assuming a slow
  // machine finishes watchdog/gate startup inside a 200 ms execution window.
  injectPrivateClockFixture(s,
    '  if (cancelled || performance.now() - acquiredMono >= maxHoldMs) {',
    '  globalThis.__paReverseWallClock(); await sleep(maxHoldMs);\n');
  const started = process.hrtime.bigint();
  const result = await s.run("-e", [clockReversalScript(s,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected dispatch')`)],
    { VALIDATION_LOCK_MAX_HOLD_MS: "200" });
  assert.equal(result.code, 4, result.text);
  assertWallClockReversed(result.text);
  assert.match(result.text, /execution-budget expired before launch/);
  assert(!existsSync(marker), "no workload may run before denied dispatch");
  assert(!result.text.includes("independent-watchdog-registered"));
  const lease = JSON.parse(readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8"));
  assert.equal(lease.phase, "launching");
  assert.equal(lease.recoveryRequired, true);
  assert.equal(lease.group, null);
  assert.deepEqual(lease.observed, []);
  assert(!isAlive(lease.owner), "the fixture owner must have exited");
  assert(Number(process.hrtime.bigint() - started) / 1e6 < 10000, "startup denial must remain bounded");
});

test("wall-clock reversal: confirmed dispatched work times out with exit 1 and verified cleanup", async t => {
  const s = setup(t), marker = join(s.dir, "dispatched-workload");
  const command = `const fs=require('node:fs');
    const raw=fs.readFileSync('/proc/'+process.pid+'/stat','utf8');
    fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({
      pid:process.pid,startTime:raw.slice(raw.lastIndexOf(')')+2).trim().split(/\\s+/)[19]}));
    setInterval(()=>{},1000);`;
  // A declared finite five-second window separates this case from startup
  // expiry. The workload marker is mandatory: exit 4 is NOT accepted here.
  // The wall clock reverses only after user work has actually been dispatched.
  const started = process.hrtime.bigint();
  const job = s.launch("-e", [clockReversalScript(s, command, marker)],
    { VALIDATION_LOCK_MAX_HOLD_MS: "5000" });
  const owned = await until(() => existsSync(marker) && JSON.parse(readFileSync(marker, "utf8")), 7000);
  s.extras.push(owned);
  const result = await job.done;
  assert.equal(result.code, 1, result.text);
  assertWallClockReversed(result.text);
  assert.match(result.text, /"executionLimitMs":5000/);
  assert.match(result.text, /"state":"FAILED".*"reason":"execution-budget".*"workloadStopped":true/);
  assert.match(result.text, /independent-watchdog-registered/);
  assert(!isAlive(owned), "the dispatched workload incarnation must be stopped");
  assert(!existsSync(s.env.VALIDATION_LOCK_FILE), "confirmed quiescence must permit normal lease release");
  assert(Number(process.hrtime.bigint() - started) / 1e6 < 10000, "wall-clock reversal must not extend the execution deadline");
});

test("wall-clock reversal: queue expiry returns 3 without dispatch or changing the live owner's lease", async t => {
  const s = setup(t), marker = join(s.dir, "queued-must-not-dispatch");
  seedLease(s, identity(process.pid));
  const originalLease = readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8");
  // Reverse after enqueuedMono/enqueuedAt are captured, even when no lease
  // writes occur while waiting. A call-count clock stub did not prove that.
  injectPrivateClockFixture(s,
    "  while (!cancelled && performance.now() - enqueuedMono < queueMs) {",
    "  globalThis.__paReverseWallClock();\n");
  const started = process.hrtime.bigint();
  const result = await s.run("-e", [clockReversalScript(s,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected dispatch')`)],
    { VALIDATION_LOCK_TIMEOUT_MS: "500" });
  assert.equal(result.code, 3, result.text);
  assertWallClockReversed(result.text);
  assert.match(result.text, /queue timeout/);
  assert(!existsSync(marker));
  assert(!result.text.includes('"state":"ACQUIRED"'));
  assert.equal(readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8"), originalLease);
  assert(Number(process.hrtime.bigint() - started) / 1e6 < 10000, "wall-clock reversal must not extend the queue deadline");
});

test("late raw zero cannot win the execution deadline race", async t => {
  const s = setup(t), marker = join(s.dir, "late-zero");
  const injected = `const fs=require('node:fs'),original=fs.readdirSync;let delayed=false;
    fs.readdirSync=function(path,...args){if(path==='/proc'&&!delayed&&fs.existsSync(${JSON.stringify(marker)})){
      delayed=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5500);}
      return original.call(this,path,...args);};
    require('node:module').syncBuiltinESMExports();
    process.argv=[process.execPath,${JSON.stringify(join(s.scripts, "validation-lock.mjs"))},'--',
      process.execPath,'-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setTimeout(()=>process.exit(0),30);`)}];
    import(${JSON.stringify(join(s.scripts, "validation-lock.mjs"))});`;
  // The child must finish before the owner resumes, after the independent
  // finite deadline. A five-second startup window separates that stage from
  // the 5.5-second deliberate observation pause.
  const result = await s.run("-e", [injected], { VALIDATION_LOCK_MAX_HOLD_MS: "5000" });
  assert.equal(result.code, 1, result.text); assert.match(result.text, /"rawExitCode":0/);
  assert.match(result.text, /execution-budget/); assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});

test("admission rechecks cannot dispatch after the execution budget has expired", async t => {
  const s = setup(t), context = developmentContext(s);
  updateHostState(s, state => { state.attestationDelayMs = 75; });
  const result = await s.wrapped("console.log('ILLEGAL_START')", {
    ...context.env, VALIDATION_LOCK_MAX_HOLD_MS: "40",
  }).done;
  assert.equal(result.code, 4, result.text);
  assert.match(result.text, /execution-budget expired before launch/);
  assert(!result.text.includes("ILLEGAL_START"));
});

test("post-spawn journal failure cleans owned work but retains lease and blocks replacement", async t => {
  const s = setup(t), pidFile = join(s.dir, "journal-child");
  const job = s.wrapped(`process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));`);
  const p = await until(() => existsSync(pidFile) && identity(Number(readFileSync(pidFile, "utf8"))));
  s.extras.push(p);
  await until(() => {
    try { const r = JSON.parse(readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8")); return r.phase === "running"; }
    catch { return false; }
  });
  await until(() => {
    try { mkdirSync(`${s.env.VALIDATION_LOCK_FILE}.transition`); return true; }
    catch (e) { if (e.code !== "EEXIST") throw e; return false; }
  });
  const result = await job.done;
  assert.equal(result.code, 4, result.text); assert.match(result.text, /supervision-error-owned-cleanup/);
  assert.match(result.text, /"workloadStopped":true/); assert.match(result.text, /"leaseRetained":true/);
  assert(!isAlive(p)); assert(existsSync(s.env.VALIDATION_LOCK_FILE));
  const next = await s.wrapped("console.log('ILLEGAL_START')", { VALIDATION_LOCK_TIMEOUT_MS: "150" }).done;
  assert.equal(next.code, 3, next.text); assert(!next.text.includes("ILLEGAL_START"));
});

test("descendant spawned on SIGTERM is discovered and receives termination", async t => {
  const s = setup(t), rootPid = join(s.dir, "term-root"), latePid = join(s.dir, "term-late");
  const late = `process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
  const parent = `let spawned=false;process.on('SIGTERM',()=>{if(!spawned){spawned=true;
    const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(late)}],{stdio:'ignore'});
    const f=require('node:fs'),fields=f.readFileSync('/proc/'+c.pid+'/stat','utf8').split(') ')[1].split(' ');
    f.writeFileSync(${JSON.stringify(latePid)},JSON.stringify({pid:c.pid,startTime:fields[19]}));}});
    require('node:fs').writeFileSync(${JSON.stringify(rootPid)},String(process.pid));setInterval(()=>{},1000);`;
  const job = s.wrapped(parent, { VALIDATION_LOCK_MAX_HOLD_MS: "5000", VALIDATION_LOCK_STOP_GRACE_MS: "350" });
  const rootIdentity = await until(() => existsSync(rootPid) && identity(Number(readFileSync(rootPid, "utf8"))));
  s.extras.push(rootIdentity);
  const lateIdentity = await until(() => existsSync(latePid) && JSON.parse(readFileSync(latePid, "utf8")));
  s.extras.push(lateIdentity);
  const result = await job.done;
  assert.match(result.text, /"executionLimitMs":5000/);
  assert.equal(result.code, 1, result.text); assert(!isAlive(rootIdentity)); assert(!isAlive(lateIdentity));
  assert(result.text.includes(`"pid":${lateIdentity.pid}`)); assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});

test("FIFO and oversized JSON cannot hang manifest, lease or advisory waiter reads", async t => {
  const s = setup(t);
  const fifo = join(s.dir, "fifo");
  assert.equal(spawnSync("mkfifo", [fifo], { timeout: 1000 }).status, 0);
  const lease = await s.wrapped("console.log('ILLEGAL_START')", { VALIDATION_LOCK_FILE: fifo }).done;
  assert.equal(lease.code, 4, lease.text); assert(!lease.text.includes("ILLEGAL_START"));
  const f = await listener(s);
  const busy = await s.run(cleanup, actionArgs(fifo, f.port));
  assert.equal(busy.code, 4, busy.text); assert(isAlive(f.identity));
  mkdirSync(s.env.VALIDATION_LOCK_WAITERS_DIR, { recursive: true });
  assert.equal(spawnSync("mkfifo", [join(s.env.VALIDATION_LOCK_WAITERS_DIR, "bad.json")], { timeout: 1000 }).status, 0);
  assert.equal((await s.wrapped("process.exit(0)").done).code, 0);
  writeFileSync(s.env.VALIDATION_LOCK_FILE, " ".repeat(1024 * 1024 + 1));
  assert.equal((await s.wrapped("console.log('ILLEGAL_START')").done).code, 4);
});

test("transient post-signal discovery is bounded and preserved in authoritative raw evidence", async t => {
  const s = setup(t), f = await listener(s), path = manifest(s, [f]);
  const args = actionArgs(path, f.port);
  const injected = `const fs=require('node:fs'),original=fs.readdirSync,kill=process.kill;let signaled=false,failed=false;
    process.kill=function(pid,signal){const result=kill.call(this,pid,signal);if(signal==='SIGTERM')signaled=true;return result;};
    fs.readdirSync=function(path,...args){if(path==='/proc'&&signaled&&!failed){
      failed=true;throw Object.assign(new Error('fixture process exited during discovery'),{code:'ESRCH'});}
      return original.call(this,path,...args);};
    require('node:module').syncBuiltinESMExports();
    process.argv=[process.execPath,${JSON.stringify(join(s.scripts, "free-ports.mjs"))},...${JSON.stringify(args)}];
    import(${JSON.stringify(join(s.scripts, "free-ports.mjs"))});`;
  const result = await s.run("-e", [injected]);
  assert.equal(result.code, 0, result.text); assert(!isAlive(f.identity));
  assert.match(result.text, /transient-shutdown-discovery/);
  const journal = readFileSync(s.hostState + ".journal", "utf8").trim().split("\n").map(JSON.parse);
  const outcome = journal.find(row => row.event === "outcome");
  assert.equal(outcome.rawOutcome.verificationObservations.length, 1);
});

test("persistent or permission-denied shutdown discovery cannot authorize escalation or success", async t => {
  for (const code of ["ESRCH", "EACCES"]) {
    const s = setup(t), f = await listener(s, "process.on('SIGTERM',()=>{});"), path = manifest(s, [f]);
    const injected = `const fs=require('node:fs'),original=fs.readdirSync,kill=process.kill;let signaled=false;
      process.kill=function(pid,signal){const result=kill.call(this,pid,signal);if(signal==='SIGTERM')signaled=true;return result;};
      fs.readdirSync=function(path,...args){if(path==='/proc'&&signaled){
        throw Object.assign(new Error('fixture unavailable discovery'),{code:${JSON.stringify(code)}});}
        return original.call(this,path,...args);};
      require('node:module').syncBuiltinESMExports();
      process.argv=[process.execPath,${JSON.stringify(join(s.scripts, "free-ports.mjs"))},...${JSON.stringify(actionArgs(path, f.port))}];
      import(${JSON.stringify(join(s.scripts, "free-ports.mjs"))});`;
    const result = await s.run("-e", [injected]);
    assert.equal(result.code, 4, result.text); assert(isAlive(f.identity));
    assert(!result.text.includes('"signal":"SIGKILL"'), result.text);
    if (code === "EACCES") assert(!result.text.includes("transient-shutdown-discovery"), result.text);
  }
});

test("malformed manifest members return structured INVALID without any signals", async t => {
  const s = setup(t), f = await listener(s);
  for (const member of [null, 0, "", [], {}, { pid: f.identity.pid, startTime: null }]) {
    const path = manifest(s, [f]), record = JSON.parse(readFileSync(path, "utf8"));
    record.processes = [member]; writeFileSync(path, JSON.stringify(record));
    const result = await s.run(cleanup, actionArgs(path, f.port));
    assert.equal(result.code, 2, result.text);
    assert.match(result.text, /"state":"INVALID"/);
    assert(!result.text.includes("TypeError")); assert(!result.text.includes("authorized-process-signal"));
    assert(isAlive(f.identity));
  }
});

test("retained transient error blocks replacement even without an abandoned transition", async t => {
  for (const kind of ["journal", "discovery"]) {
    const s = setup(t), marker = join(s.dir, "started");
    const injected = `const fs=require('node:fs'),sync=fs.fsyncSync,ls=fs.readdirSync;let failed=false;
      fs.fsyncSync=function(...args){
        if(${JSON.stringify(kind)}==='journal'&&!failed&&fs.existsSync(${JSON.stringify(s.env.VALIDATION_LOCK_FILE)})){
          const r=JSON.parse(fs.readFileSync(${JSON.stringify(s.env.VALIDATION_LOCK_FILE)},'utf8'));
          if(r.phase==='running'){failed=true;throw Object.assign(new Error('one-shot journal error'),{code:'EIO'});}
        }return sync.apply(this,args);};
      fs.readdirSync=function(path,...args){
        if(${JSON.stringify(kind)}==='discovery'&&path==='/proc'&&!failed&&fs.existsSync(${JSON.stringify(marker)})){
          failed=true;throw Object.assign(new Error('one-shot discovery error'),{code:'EIO'});}
        return ls.call(this,path,...args);};
      require('node:module').syncBuiltinESMExports();
      process.argv=[process.execPath,${JSON.stringify(join(s.scripts, "validation-lock.mjs"))},'--',
        process.execPath,'-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');setInterval(()=>{},1000);`)}];
      import(${JSON.stringify(join(s.scripts, "validation-lock.mjs"))});`;
    const first = await s.run("-e", [injected]);
    assert.equal(first.code, 4, first.text);
    assert.match(first.text, /"leaseRetained":true/);
    const retained = JSON.parse(readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8"));
    assert.equal(retained.recoveryRequired, true);
    if (kind === "journal") {
      assert(existsSync(`${s.env.VALIDATION_LOCK_FILE}.transition`));
      // Remove only this known private fixture sidecar to exercise the lease's
      // independent recovery guard; this is NEVER a host recovery instruction.
      rmSync(`${s.env.VALIDATION_LOCK_FILE}.transition`, { recursive: true });
    } else assert(!existsSync(`${s.env.VALIDATION_LOCK_FILE}.transition`));
    const next = await s.wrapped("console.log('ILLEGAL_START')").done;
    assert.equal(next.code, 4, next.text); assert(!next.text.includes("ILLEGAL_START"));
    assert.match(next.text, /separately authorized recovery/);
    assert.equal(JSON.parse(readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8")).token, retained.token);
  }
});

test("older leases without recovery disposition cannot be upgraded by ordinary recovery", async t => {
  const s = setup(t), dead = await deadOwner(s), r = seedLease(s, dead);
  delete r.recoveryRequired; writeFileSync(s.env.VALIDATION_LOCK_FILE, JSON.stringify(r));
  const next = await s.wrapped("console.log('ILLEGAL_START')").done;
  assert.equal(next.code, 4, next.text); assert(!next.text.includes("ILLEGAL_START"));
  assert.equal(JSON.parse(readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8")).token, r.token);
});

test("independent watchdog stops detached work when wrapper stalls or its original group dies", async t => {
  for (const external of [false, true]) {
    const s = setup(t), marker = join(s.dir, "watchdog-child");
    const code = String.raw`const f=require('node:fs'),r=f.readFileSync('/proc/'+process.pid+'/stat','utf8');
      process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
      f.writeFileSync(${JSON.stringify(`${marker}.pending`)},JSON.stringify({
        pid:process.pid,startTime:r.slice(r.lastIndexOf(')')+2).trim().split(/\s+/)[19]}));
      f.renameSync(${JSON.stringify(`${marker}.pending`)},${JSON.stringify(marker)});`;
    const injected = `const fs=require('node:fs'),ls=fs.readdirSync;let stalled=false;
      fs.readdirSync=function(path,...args){
        if(path==='/proc'&&!stalled&&fs.existsSync(${JSON.stringify(marker)})){
          stalled=true;console.log('WRAPPER_STALLED');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000);}
        return ls.call(this,path,...args);};
      require('node:module').syncBuiltinESMExports();
      process.argv=[process.execPath,${JSON.stringify(join(s.scripts, "validation-lock.mjs"))},'--',
        process.execPath,'-e',${JSON.stringify(code)}];
      import(${JSON.stringify(join(s.scripts, "validation-lock.mjs"))});`;
    const child = spawn(external ? "timeout" : process.execPath,
      external ? ["--signal=TERM", "--kill-after=0.3s", "1.5s", process.execPath, "-e", injected]
        : ["-e", injected],
      { env: { ...s.env, VALIDATION_LOCK_MAX_HOLD_MS: external ? "10000" : "1000" },
        stdio: ["ignore", "pipe", "pipe"] });
    let text = ""; child.stdout.on("data", b => { text += b; }); child.stderr.on("data", b => { text += b; });
    const done = new Promise((res, rej) => { child.once("error", rej); child.once("close", (code, signal) => res({ code, signal })); });
    const p = await until(() => existsSync(marker) && JSON.parse(readFileSync(marker, "utf8")));
    s.extras.push(p);
    const result = await done;
    assert.notEqual(result.code, 0, text);
    assert.match(text, /WRAPPER_STALLED/); assert.match(text, /independent-watchdog-stop/);
    assert(!isAlive(p), text);
    assert(existsSync(s.env.VALIDATION_LOCK_FILE));
    assert.equal(JSON.parse(readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8")).recoveryRequired, true);
    const next = await s.wrapped("console.log('ILLEGAL_START')").done;
    assert.equal(next.code, 4, next.text); assert(!next.text.includes("ILLEGAL_START"));
  }
});

test("user work cannot dispatch without independent watchdog registration", async t => {
  const s = setup(t);
  const injected = `const cp=require('node:child_process'),original=cp.spawn;
    cp.spawn=function(command,args,...rest){
      const child=original.call(this,command,args,...rest);
      if(args?.includes('--pa-watchdog')){
        const send=child.send.bind(child);child.send=function(m,...a){
          if(m?.type==='register'){const cb=a.at(-1);if(typeof cb==='function')cb();return true;}
          return send(m,...a);};
      }return child;};
    require('node:module').syncBuiltinESMExports();
    process.argv=[process.execPath,${JSON.stringify(join(s.scripts, "validation-lock.mjs"))},'--',
      process.execPath,'-e',"console.log('ILLEGAL_START')"];
    import(${JSON.stringify(join(s.scripts, "validation-lock.mjs"))});`;
  const result = await s.run("-e", [injected]);
  assert.equal(result.code, 4, result.text); assert(!result.text.includes("ILLEGAL_START"));
  assert(existsSync(s.env.VALIDATION_LOCK_FILE));
  for (const mode of ["--pa-workload-gate", "--pa-watchdog"]) {
    assert.equal((await s.run(lock, [mode])).code, 2);
  }
});

test("loss of independent watchdog stops known work and retains recovery exclusion", async t => {
  const s = setup(t), marker = join(s.dir, "watchdog-loss-child");
  const job = s.wrapped(`process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
    require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));`);
  const p = await until(() => existsSync(marker) && identity(Number(readFileSync(marker, "utf8"))));
  s.extras.push(p);
  const guard = await until(() => {
    const m = job.text.match(/"incident":"independent-watchdog-registered","pid":(\d+),"startTime":"(\d+)"/);
    if (m) return { pid: Number(m[1]), startTime: m[2] };
  });
  assert(isAlive(guard)); process.kill(guard.pid, "SIGKILL");
  const result = await job.done;
  assert.equal(result.code, 4, result.text);
  assert(!isAlive(p)); assert.match(result.text, /watchdog unavailable/);
  assert.equal(JSON.parse(readFileSync(s.env.VALIDATION_LOCK_FILE, "utf8")).recoveryRequired, true);
});

test("gated command preserves actual signal outcome rather than worker exit 1", async t => {
  const s = setup(t);
  const result = await s.wrapped("process.kill(process.pid,'SIGTERM')").done;
  assert.equal(result.code, 1, result.text);
  assert.match(result.text, /"rawExitCode":null,"signal":"SIGTERM"/);
  assert.match(result.text, /"commandOutcome":\{"exitCode":null,"signal":"SIGTERM"\}/);
  assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});

test("exit during contended journal await is re-observed before survivor classification", async t => {
  const s = setup(t), marker = join(s.dir, "journal-contention-child");
  const code = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');
    setTimeout(()=>process.exit(0),5);`;
  const injected = `const fs=require('node:fs'),mkdir=fs.mkdirSync;let until=0,once=false;
    fs.mkdirSync=function(path,...args){
      if(path===${JSON.stringify(`${s.env.VALIDATION_LOCK_FILE}.transition`)}&&
          fs.existsSync(${JSON.stringify(marker)})){
        if(!once){once=true;until=Date.now()+150;console.log('FIXTURE_JOURNAL_CONTENTION');}
        if(Date.now()<until)throw Object.assign(new Error('fixture mutex contention'),{code:'EEXIST'});}
      return mkdir.call(this,path,...args);};
    require('node:module').syncBuiltinESMExports();
    process.argv=[process.execPath,${JSON.stringify(join(s.scripts, "validation-lock.mjs"))},'--',
      process.execPath,'-e',${JSON.stringify(code)}];
    import(${JSON.stringify(join(s.scripts, "validation-lock.mjs"))});`;
  const result = await s.run("-e", [injected]);
  assert.match(result.text, /FIXTURE_JOURNAL_CONTENTION/);
  assert.equal(result.code, 0, result.text); assert(!result.text.includes("surviving-descendant"));
  assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});