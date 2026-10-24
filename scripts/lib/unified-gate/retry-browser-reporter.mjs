import { writeFileSync } from "node:fs";
export default class RetryReporter {
  tests = [];
  error = false;
  onError() { this.error = true; }
  onTestEnd(test, result) {
    const skipped = result.status === "skipped" || result.status === "interrupted";
    this.tests.push({ file: test.location.file, case: test.titlePath().filter(Boolean).join(" "),
      project: test.parent.project()?.name ?? "", attempt: result.retry,
      outcome: result.status === "passed" ? "passed" : result.status === "skipped" ? "skipped"
        : result.status === "interrupted" ? "cancelled" : "failed",
      // Playwright includes beforeEach/fixture execution in an attempt. It
      // cannot attest entry into the test body itself (see onStepBegin below).
      executed: !skipped && (result.status === "passed" || this.bodies.has(result)) });
  }
  bodies = new WeakSet();
  onStepBegin(test, result, step) {
    if (["test.step", "pw:api", "expect"].includes(step.category)) {
      // APIs in hooks are not proof of body execution.
      let parent = step;
      while (parent.parent) parent = parent.parent;
      if (parent.title === "Before Hooks" || parent.title === "After Hooks") return;
      this.bodies.add(result);
    }
  }
  onEnd(result) {
    writeFileSync(process.env.UNIFIED_RETRY_EVIDENCE, JSON.stringify({
      schemaVersion: 1, runner: "playwright", complete: true,
      error: this.error || result.status !== "passed", tests: this.tests,
    }));
  }
}
