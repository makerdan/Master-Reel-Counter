import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const normativeFiles = [
  "SKILL.md", "references/gate-maintenance.md", "references/planning-and-publication.md",
].sort();
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The expected digest comes from the external project pin, never the package's
// own editable manifest. safePath is injected to preserve the common boundary.
export function verifyContract(root, directory, expected, safePath) {
  const rows = normativeFiles.map((name) => {
    const bytes = readFileSync(safePath(root, join(directory, name)));
    return { name, hash: sha(bytes) };
  });
  const observed = sha(rows.map(({ name, hash }) => `${name}\0${hash}\n`).join(""));
  if (observed !== expected) throw new Error("normative contract mismatch (core or required reference)");
  return observed;
}
