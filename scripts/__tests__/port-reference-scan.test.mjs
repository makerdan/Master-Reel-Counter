import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  findHardcodedPortReferences,
  scanExecutableSource,
} from "../port-reference-scan.mjs";

test("executable source scan rejects a fixed service port fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "port-reference-fixture-"));
  try {
    await mkdir(join(root, "server"));
    await writeFile(
      join(root, "server", "service.ts"),
      "const server = createServer(); server.listen(43127, '0.0.0.0');\n",
    );
    await writeFile(
      join(root, "server", "config.ts"),
      "const port = Number(process.env.PORT); server.listen(port); server.listen(0);\n",
    );

    const { findings } = scanExecutableSource(root);
    assert.deepEqual(
      findings.map(({ reference }) => reference),
      ["listen(43127"],
    );
    assert.deepEqual(
      findHardcodedPortReferences('const port = Number(process.env.PORT ?? "5000");'),
      ['PORT ?? "5000"'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});