import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
// Consume structured runner events, never parse TAP or user console output.
export default async function* reporter(source) {
  const tests = [], names = new Map();
  let complete = false;
  for await (const event of source) {
    const d = event.data;
    if (event.type === "test:start") {
      names.set(d.nesting, d.name);
      for (const key of names.keys()) if (key > d.nesting) names.delete(key);
    }
    // With no declared cases (or a module-load crash), Node can report a
    // synthetic file-process subtest. A file exiting zero is not a test body.
    const fileProcess = typeof d.file === "string" && typeof d.name === "string" &&
      resolve(d.name) === resolve(d.file);
    if (["test:pass", "test:fail"].includes(event.type) && d.details?.type !== "suite" && !fileProcess) {
      const outcome = typeof d.skip === "string" && d.skip.includes("does not match pattern") ? "filtered"
        : d.skip ? "skipped" : d.todo ? "todo" : event.type === "test:pass" ? "passed"
          : d.details?.error?.failureType === "cancelledByParent" ? "cancelled" : "failed";
      tests.push({ file: d.file, case: [...Array(d.nesting).keys()].map((i) => names.get(i)).concat(d.name).join(" "),
        outcome, executed: outcome === "passed" || (outcome === "failed" &&
          d.details?.error?.failureType === "testCodeFailure") });
    }
    // Node 20 emits the global plan and final summary diagnostics; test:summary
    // is not present on every supported runtime.
    if (event.type === "test:diagnostic" && d.nesting === 0 && /^duration_ms /.test(d.message)) complete = true;
    if (event.type === "test:summary" && d.file === undefined) complete = true;
    yield `${event.type}: ${d.name ?? d.message ?? ""}\n`;
  }
  writeFileSync(process.env.UNIFIED_RETRY_EVIDENCE, JSON.stringify({
    schemaVersion: 1, runner: "node", complete, tests,
  }));
}
