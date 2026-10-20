import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const timeout = 15000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function incarnation(pid) {
  try {
    const f = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").at(-1).split(/\s+/);
    return { pid, startTime: f[19], state: f[0] };
  } catch (e) { if (["ENOENT", "ESRCH"].includes(e.code)) return null; throw e; }
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "port-authority-core-"));
  for (const n of ["free-ports.mjs", "validation-lock.mjs", "runtime-environment.mjs", "host-capabilities.mjs"]) {
    copyFileSync(join(root, "scripts", n), join(dir, n));
  }
  // Explicitly simulated test environment applies only to these private child
  // fixtures; caller flags/adapters and real application runtime remain unchanged.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    !k.startsWith("VALIDATION_LOCK_") && !k.startsWith("FREE_PORTS_") &&
    !["NODE_ENV", "REPLIT_ENVIRONMENT", "REPLIT_DEPLOYMENT", "REPLIT_DEV_DOMAIN",
      "PORT_AUTHORITY_DEV_CONTEXT_FILE"].includes(k)));
  Object.assign(env, { NODE_ENV: "test", VALIDATION_LOCK_FILE: join(dir, "lease"),
    VALIDATION_LOCK_WAITERS_DIR: join(dir, "waiters"),
    VALIDATION_LOCK_TIMEOUT_MS: "3000", VALIDATION_LOCK_MAX_HOLD_MS: "5000",
    VALIDATION_LOCK_STOP_GRACE_MS: "100", VALIDATION_LOCK_STOP_KILL_MS: "1000" });
  const jobs = [];
  function launch(name, args, overrides = {}) {
    const child = spawn(process.execPath, [join(dir, name), ...args], {
      env: { ...env, ...overrides }, stdio: ["ignore", "pipe", "pipe"] });
    const identity = incarnation(child.pid);
    let text = "", overflow = false;
    const capture = data => { if (text.length + data.length > 262144) overflow = true;
      else text += data; };
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    const job = { child, identity, get text() { return text; }, closed: false };
    job.done = new Promise((res, rej) => {
      child.once("error", rej);
      child.once("close", (code, signal) => { job.closed = true;
        if (overflow) rej(new Error("fixture output exceeded evidence limit"));
        else res({ code, signal, text }); });
    });
    jobs.push(job); return job;
  }
  t.after(async () => {
    for (const job of jobs) {
      const current = job.identity && incarnation(job.identity.pid);
      if (!job.closed && current?.startTime === job.identity?.startTime) job.child.kill("SIGKILL");
    }
    await Promise.allSettled(jobs.map(j => j.done));
    // Preserve uncertain runtime state rather than age-delete its exclusion.
    if (!existsSync(env.VALIDATION_LOCK_FILE)) rmSync(dir, { recursive: true, force: true });
  }, { timeout: 3000 });
  const run = (name, args, overrides) => launch(name, args, overrides).done;
  const wrap = (code, overrides = {}, options = []) =>
    launch("validation-lock.mjs", [...options, "--", process.execPath, "-e", code], overrides);
  return { dir, env, run, launch, wrap };
}
async function listener(t) {
  const server = createServer(); server.listen(0, "127.0.0.1");
  await new Promise((res, rej) => { server.once("listening", res); server.once("error", rej); });
  t.after(() => new Promise(res => server.close(res)), { timeout: 3000 });
  return server.address().port;
}
test("core: busy inventory is read-only with unconfigured authority adapters", { timeout }, async t => {
  const s = fixture(t), port = await listener(t);
  const result = await s.run("free-ports.mjs", [String(port)]);
  assert.equal(result.code, 3, result.text); assert.match(result.text, /PROTECTED_BUSY/);
  assert(!result.text.includes("AUTHORIZATION_UNAVAILABLE"));
});
test("core: default denies every reclaim/development option without reading manifests", { timeout }, async t => {
  const s = fixture(t), port = await listener(t);
  for (const args of [
    ["--authorized-cleanup", String(port)],
    ["--ownership-manifest", "/must-not-be-read", String(port)],
    ["--include-own-tree", String(port)],
  ]) {
    const result = await s.run("free-ports.mjs", args);
    assert.equal(result.code, 2, result.text); assert.match(result.text, /core inventory is read-only/);
    assert.equal((await s.run("free-ports.mjs", [String(port)])).code, 3);
  }
});
test("core: free fixture port observes FREE; malformed inputs and disable do not", { timeout }, async t => {
  const s = fixture(t), server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise(res => server.once("listening", res));
  const port = server.address().port; await new Promise(res => server.close(res));
  assert.equal((await s.run("free-ports.mjs", [String(port)])).code, 0);
  for (const args of [[], ["0"], ["65536"], ["--bad"]]) {
    assert.equal((await s.run("free-ports.mjs", args)).code, 2);
  }
  const skipped = await s.run("free-ports.mjs", [String(port)], { FREE_PORTS_DISABLE: "1" });
  assert.equal(skipped.code, 3); assert.match(skipped.text, /SKIPPED/);
});
test("core: all production indicators deny; plausible development records cannot override", { timeout }, async t => {
  const s = fixture(t);
  for (const marker of ["NODE_ENV", "REPLIT_DEPLOYMENT", "REPLIT_ENVIRONMENT"]) {
    const overrides = { [marker]: marker === "REPLIT_DEPLOYMENT" ? "1" : "production",
      REPLIT_DEV_DOMAIN: "fixture.example", PORT_AUTHORITY_DEV_CONTEXT_FILE: "/not-authority" };
    assert.equal((await s.run("free-ports.mjs", ["12345"], overrides)).code, 2);
    const result = await s.wrap("console.log('DISPATCHED')", overrides).done;
    assert.equal(result.code, 2); assert(!result.text.includes("DISPATCHED"));
  }
});
test("core: ordinary local lease needs no reclaim adapter and preserves raw child exits", { timeout }, async t => {
  const s = fixture(t);
  for (const code of [0, 7]) {
    const result = await s.wrap(`process.exit(${code})`).done;
    assert.equal(result.code, code, result.text); assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
  }
});
test("core: resource/priority/PID/token reentry requests cannot dispatch", { timeout }, async t => {
  const s = fixture(t);
  for (const [options, overrides] of [
    [["--resource", "test-db"], {}], [["--priority", "1"], {}],
    [[], { VALIDATION_LOCK_CONTEXT_forged: "{}" }],
    [[], { VALIDATION_LOCK_HELD_PID: String(process.pid) }],
  ]) {
    const result = await s.wrap("console.log('DISPATCHED')", overrides, options).done;
    assert.equal(result.code, 2, result.text); assert(!result.text.includes("DISPATCHED"));
    assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
  }
});
test("core: command's advanced-looking argument never enables the profile", { timeout }, async t => {
  const s = fixture(t);
  const result = await s.run("validation-lock.mjs", ["--", process.execPath, "-e",
    "console.log(process.argv[1])", "--", "--advanced"]);
  assert.equal(result.code, 0, result.text); assert.match(result.text, /--advanced/);
  const denied = await s.run("validation-lock.mjs", ["--resource", "db", "--",
    process.execPath, "-e", "process.exit(0)", "--advanced"]);
  assert.equal(denied.code, 2, denied.text);
});
test("core: actual nested wrapper is rejected, not admitted by inherited context", { timeout }, async t => {
  const s = fixture(t), lock = join(s.dir, "validation-lock.mjs");
  const result = await s.wrap(`const {spawnSync}=require('node:child_process');
    const r=spawnSync(process.execPath,[${JSON.stringify(lock)},'--',process.execPath,'-e',"console.log('INNER_STARTED')"],{encoding:'utf8'});
    process.stdout.write(r.stdout+r.stderr);process.exit(r.status??1);`).done;
  assert.equal(result.code, 2, result.text);
  assert(!result.text.includes("INNER_STARTED")); assert(!existsSync(s.env.VALIDATION_LOCK_FILE));
});
test("core: same-file actual callers serialize without advanced flags", { timeout }, async t => {
  const s = fixture(t), log = join(s.dir, "order");
  const code = label => `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(log)},'${label}:start\\n');
    setTimeout(()=>fs.appendFileSync(${JSON.stringify(log)},'${label}:end\\n'),180);`;
  const a = s.wrap(code("a"));
  const deadline = Date.now() + 4000;
  while (!a.text.includes("ACQUIRED") && Date.now() < deadline) await sleep(10);
  assert(a.text.includes("ACQUIRED"), a.text);
  const b = s.wrap(code("b"));
  for (const r of await Promise.all([a.done, b.done])) assert.equal(r.code, 0, r.text);
  assert.equal(readFileSync(log, "utf8"), "a:start\na:end\nb:start\nb:end\n");
});
test("core: queue expiry is separate and cannot steal live ownership", { timeout }, async t => {
  const s = fixture(t), a = s.wrap("setTimeout(()=>{},900)");
  const deadline = Date.now() + 4000;
  while (!a.text.includes("ACQUIRED") && Date.now() < deadline) await sleep(10);
  assert(a.text.includes("ACQUIRED"), a.text);
  const b = await s.wrap("console.log('SECOND_STARTED')", { VALIDATION_LOCK_TIMEOUT_MS: "70" }).done;
  assert.equal(b.code, 3, b.text); assert(!b.text.includes("SECOND_STARTED"));
  assert.equal((await a.done).code, 0);
});
test("core: missing/overflow limits deny and execution expiry cannot become success", { timeout }, async t => {
  const s = fixture(t);
  for (const bad of ["", "0", "Infinity", "2147483648"]) {
    const r = await s.wrap("console.log('DISPATCHED')", { VALIDATION_LOCK_MAX_HOLD_MS: bad }).done;
    assert.equal(r.code, 2, r.text); assert(!r.text.includes("DISPATCHED"));
  }
  const marker = join(s.dir, "confirmed-dispatch");
  // Do not mistake a correct pre-dispatch budget denial (exit 4 with a
  // retained lease) for a completed execution-timeout check. This case needs
  // evidence that user work started before requiring normal lease release.
  const r = await s.wrap(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');
    setInterval(()=>{},20)`, { VALIDATION_LOCK_MAX_HOLD_MS: "5000" }).done;
  assert(existsSync(marker), r.text);
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /"state":"FAILED".*"reason":"execution-budget".*"workloadStopped":true/);
  assert(!existsSync(s.env.VALIDATION_LOCK_FILE), r.text);
});
