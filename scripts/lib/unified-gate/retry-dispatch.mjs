// Supervised only by unified-step. This is not an admission or public retry route.
import { runOwnedProcessGroup } from "../owned-process-group.mjs";
const adapter = JSON.parse(process.argv[2]);
const root = process.cwd();
const controller = new AbortController();
const abort = () => controller.abort();
process.once("SIGTERM", abort); process.once("SIGINT", abort);
const env = { ...process.env, ...adapter.env, UNIFIED_RETRY_EVIDENCE: adapter.evidencePath };
// Nested Node runners otherwise can exit zero without running their tests.
delete env.NODE_TEST_CONTEXT;
async function execute(command, args) {
  if (controller.signal.aborted) return 130;
  const result = await runOwnedProcessGroup(command, args, {
    cwd: root, env, stdio: "inherit", signal: controller.signal,
  });
  return result.groupGone ? result.status : 125;
}
try {
  process.exitCode = await execute(adapter.command[0], adapter.command.slice(1));
} finally {
  process.removeListener("SIGTERM", abort); process.removeListener("SIGINT", abort);
}
