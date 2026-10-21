import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

// Ignore TERM in the parent to exercise escalation. Keep it alive to reap its
// child, which runs in a separate session like the real smoke server.
process.on("SIGTERM", () => {});
const child = spawn(process.execPath, ["-e", `
  process.send("ready");
  setInterval(() => {}, 1_000);
`], { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
child.once("message", () => {
  writeFileSync(process.argv[2], JSON.stringify({ parent: process.pid, child: child.pid }));
  console.log("hung-command stdout ready");
  console.error("hung-command stderr ready");
});
setInterval(() => {}, 1_000);
