import { closeSync, fstatSync, mkdirSync, openSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Cooperative, single-workspace boundary. flock locks the SAME open file
// description passed on fd 3; the Node process retains that fd throughout the
// synchronous coordinator transaction. No callback or database flag is proof.
const held = new Map();

export function inputWriterBoundaryHeld(root) {
  const entry = held.get(realpathSync(root));
  if (!entry) return false;
  try {
    const descriptor = fstatSync(entry.fd);
    const path = statSync(entry.path);
    return descriptor.isFile() && descriptor.dev === path.dev && descriptor.ino === path.ino &&
      realpathSync(entry.path) === entry.path;
  } catch { return false; }
}

export function withInputWriterBoundary(root, action) {
  root = realpathSync(root);
  if (held.has(root)) throw new Error("FAILURE-GATE BLOCKED: nested input writer boundary");
  const directory = resolve(root, ".failure-gate-state");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory) throw new Error("FAILURE-GATE BLOCKED: writer lock directory symlink");
  const path = resolve(directory, "input-writers.lock");
  const fd = openSync(path, "a+", 0o600);
  try {
    if (!fstatSync(fd).isFile() || realpathSync(path) !== path) {
      throw new Error("FAILURE-GATE BLOCKED: unsafe writer lock file");
    }
    // flock operates on the inherited descriptor, not a separate opening of
    // the path. Closing the parent's fd releases the lock even on exceptions.
    const result = spawnSync("flock", ["-x", "-w", "30", "3"], {
      stdio: ["ignore", "ignore", "pipe", fd], timeout: 35_000, encoding: "utf8",
    });
    if (result.error || result.status !== 0) {
      throw new Error("FAILURE-GATE BLOCKED: input writer boundary unavailable");
    }
    held.set(root, { fd, path });
    const value = action();
    if (value?.then) throw new Error("FAILURE-GATE BLOCKED: asynchronous writer action unsupported");
    if (!inputWriterBoundaryHeld(root)) {
      throw new Error("FAILURE-GATE BLOCKED: writer lock file replaced");
    }
    return value;
  } finally {
    held.delete(root);
    closeSync(fd);
  }
}