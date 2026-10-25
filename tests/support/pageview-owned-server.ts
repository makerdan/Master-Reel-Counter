import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { APIRequestContext } from "@playwright/test";
// @ts-expect-error The shared JavaScript supervisor has no TypeScript declaration.
import { runOwnedProcessGroup } from "../../scripts/lib/owned-process-group.mjs";
import { assertIsolatedReleaseDatabase } from "../../scripts/release-schema-preflight.mjs";

/** Bind a vacant port, never reclaim or signal a pre-existing listener. */
async function vacantPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

export async function startOwnedPageviewServer() {
  // The registered browser wrapper supplies both targets. Never silently use
  // preview, publication, or an implicit developer database.
  const isolated = process.env.RELEASE_SMOKE_DATABASE_URL;
  assert.ok(isolated && process.env.DATABASE_URL === isolated,
    "Pageview allowance requires the registered isolated browser database");
  assertIsolatedReleaseDatabase({
    releaseDatabaseUrl: isolated,
    publicationDatabaseUrl: process.env.RELEASE_PUBLICATION_DATABASE_URL,
  });
  const port = await vacantPort();
  const baseURL = `http://127.0.0.1:${port}`;
  const candidate = `pageview-allowance-${randomUUID()}`;
  const cancellation = new AbortController();
  let pid: number | undefined;
  let exited = false;
  const timer = setTimeout(() => cancellation.abort("SIGTERM"), 165_000);
  const running = runOwnedProcessGroup(process.execPath, [
    "--import", "tsx", "server/index.ts",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", PORT: String(port),
      DATABASE_URL: isolated, RELEASE_CANDIDATE_ID: candidate },
    signal: cancellation.signal,
    // Do not export application/provider logs into public evidence.
    onOutput: () => {},
    onSpawn: (child: { pid?: number }) => { pid = child.pid; },
    terminationGraceMs: 1_000, terminationWaitMs: 3_000,
  });
  // Observe rejection immediately, even if startup fails before readiness.
  const observed = running.then(
    (result: { groupGone: boolean }) => { exited = true; return { result, failed: false }; },
    () => { exited = true; return { result: null, failed: true }; },
  );
  const listener = () => {
    const pids = [...new Set(execFileSync("lsof", [
      "-t", `-iTCP:${port}`, "-sTCP:LISTEN",
    ], { encoding: "utf8", timeout: 2_000 }).trim().split(/\s+/).map(Number))];
    assert.deepEqual(pids, [pid], "Only this test's owned application may listen");
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return { pid, startTicks: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] };
  };
  const health = async (request: APIRequestContext) => {
    const response = await request.get(`${baseURL}/api/healthz`, {
      timeout: 2_000, maxRedirects: 0,
    });
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).candidateId, candidate);
    await response.dispose();
    return { candidateMatched: true, listener: listener() };
  };
  return {
    baseURL, candidate, listener, health,
    async ready(request: APIRequestContext) {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !exited && !cancellation.signal.aborted) {
        try { return await health(request); } catch { await delay(250); }
      }
      throw new Error("Owned isolated pageview application did not become ready");
    },
    async stop() {
      clearTimeout(timer);
      cancellation.abort("SIGTERM");
      const outcome = await observed;
      assert.ok(!outcome.failed && outcome.result?.groupGone,
        "Owned pageview process cleanup must complete");
    },
  };
}
