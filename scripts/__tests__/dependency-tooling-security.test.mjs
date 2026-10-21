import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { runOwnedProcessGroup } from "../lib/owned-process-group.mjs";

const require = createRequire(import.meta.url);
const root = new URL("../../", import.meta.url);
const from = (consumer, dependency) =>
  createRequire(consumer.resolve(dependency));
const excel = from(require, "exceljs");
const archiver = from(excel, "archiver");
const readdir = from(archiver, "readdir-glob");
const minimatch = from(readdir, "minimatch");
const postcss = from(require, "postcss");
const tailwind = from(from(require, "@tailwindcss/vite"), "@tailwindcss/node");
const consumers = [
  ["vite", "7.3.7", require],
  ["vite", "7.3.7", from(require, "@vitejs/plugin-react")],
  ["vite", "7.3.7", from(require, "@tailwindcss/vite")],
  ["brace-expansion", "5.0.12", minimatch],
  ["source-map-js", "1.2.2", postcss],
  ["source-map-js", "1.2.2", tailwind],
];

function patched(version, minimum) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "require a stable release");
  const actual = version.split(".").map(Number);
  const floor = minimum.split(".").map(Number);
  assert.equal(actual[0], floor[0], "preserve the compatible major");
  assert.ok(actual[1] > floor[1] ||
    (actual[1] === floor[1] && actual[2] >= floor[2]),
  `require ${minimum} or later compatible patch, found ${version}`);
}

function metadata(entry, name) {
  let directory = dirname(entry);
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (pkg.name === name) return pkg;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    assert.notEqual(parent, directory, `missing metadata for ${name}`);
    directory = parent;
  }
}

function boundedFixture(source) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--max-old-space-size=128", "-e", source], {
    cwd: root, env, encoding: "utf8", timeout: 10_000,
    killSignal: "SIGKILL", maxBuffer: 64 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "fixture passed", "prove fixture executed");
}

test("tooling consumers and every installed lockfile copy exclude affected versions", () => {
  for (const [name, minimum, consumer] of consumers) {
    patched(metadata(consumer.resolve(name), name).version, minimum);
  }
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
  for (const [name, minimum] of new Map(consumers.map(([name, minimum]) => [name, minimum]))) {
    const copies = Object.entries(lock.packages).filter(([path]) =>
      path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
    assert.ok(copies.length, `missing ${name} from lock`);
    for (const [path, pkg] of copies) {
      patched(pkg.version, minimum);
      patched(JSON.parse(readFileSync(new URL(`${path}/package.json`, root), "utf8")).version, minimum);
    }
  }
});

test("version guards reject the previously installed vulnerable versions", () => {
  for (const [old, minimum] of [["7.3.6", "7.3.7"], ["5.0.9", "5.0.12"], ["1.2.1", "1.2.2"]]) {
    assert.throws(() => patched(old, minimum), /require .*found/);
    assert.doesNotThrow(() => patched(minimum, minimum));
  }
});

test("export-resolved brace parser bounds deep nesting, long chains and rewrite work", { timeout: 15_000 }, () => {
  boundedFixture(`
    const assert = require("node:assert/strict");
    const { expand } = require(${JSON.stringify(minimatch.resolve("brace-expansion"))});
    const { minimatch } = require(${JSON.stringify(readdir.resolve("minimatch"))});
    assert.deepEqual(expand("file-{a,b}.xlsx"), ["file-a.xlsx", "file-b.xlsx"]);
    assert.equal(minimatch("file-b.xlsx", "file-{a,b}.xlsx"), true);
    for (const pattern of [
      "{".repeat(4000) + "a,b" + "}".repeat(4000),
      "{a,b}".repeat(1500),
      "{a},b" + "}".repeat(20000),
    ]) {
      try {
        const expanded = expand(pattern);
        assert.ok(expanded.length <= 100000);
        assert.ok(expanded.reduce((sum, item) => sum + item.length, 0) <= 4000000);
      } catch (error) {
        assert.ok(error instanceof RangeError, String(error));
        assert.doesNotMatch(error.message, /call stack|heap/i);
        assert.match(error.message, /max|limit|exceed|expansion/i);
      }
    }
    console.log("fixture passed");
  `);
});

for (const [label, consumer] of [["PostCSS", postcss], ["Tailwind node", tailwind]]) {
  test(`${label} source maps reject invalid and amplified indexed offsets`, { timeout: 15_000 }, () => {
    boundedFixture(`
      const assert = require("node:assert/strict");
      const { SourceMapConsumer, SourceMapGenerator } = require(${JSON.stringify(consumer.resolve("source-map-js"))});
      const flat = { version: 3, sources: ["input.css"], names: [], mappings: "AAAA", sourcesContent: ["a{}"] };
      const indexed = (line, column, map = flat) => ({
        version: 3, sections: [{ offset: { line, column }, map }]
      });
      for (const value of [-1, 0.5, NaN, Infinity, "1", Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => new SourceMapConsumer(indexed(value, 0)), /offset/i);
        assert.throws(() => new SourceMapConsumer(indexed(0, value)), /offset/i);
      }
      assert.throws(() => new SourceMapConsumer(indexed(10000001, 0)), /offset/i);
      assert.throws(() => new SourceMapConsumer(indexed(6000000, 0, indexed(6000000, 0))), /offset/i);
      const valid = new SourceMapConsumer(indexed(2, 0));
      const mappings = [];
      valid.eachMapping(mapping => mappings.push(mapping));
      assert.equal(mappings.length, 1);
      assert.equal(mappings[0].source, "input.css");
      assert.equal(mappings[0].generatedLine, 3);
      assert.equal(mappings[0].generatedColumn, 0);
      // Indexed consumers expose mappings, but do not initialize the basic
      // consumer's sourceRoot metadata expected by fromSourceMap.
      const generator = new SourceMapGenerator();
      valid.eachMapping(mapping => generator.addMapping({
        generated: { line: mapping.generatedLine, column: mapping.generatedColumn },
        original: { line: mapping.originalLine, column: mapping.originalColumn },
        source: mapping.source,
      }));
      const generated = generator.toJSON();
      assert.equal(generated.mappings, ";;AAAA");
      assert.deepEqual(generated.sources, ["input.css"]);
      assert.equal(SourceMapGenerator.fromSourceMap(new SourceMapConsumer(flat)).toJSON().mappings, "AAAA");
      console.log("fixture passed");
    `);
  });
}

test("ExcelJS consumer preserves workbook values and styles on serialization", { timeout: 15_000 }, () => {
  boundedFixture(`
    const assert = require("node:assert/strict");
    const ExcelJS = require(${JSON.stringify(require.resolve("exceljs"))});
    (async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Reel Count");
      sheet.columns = [{ width: 22 }, { width: 14 }];
      sheet.addRow(["Catalog:", "Footage (ft):"]);
      sheet.getCell("A1").font = { bold: true, color: { argb: "FFEA580C" } };
      sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F0EB" } };
      sheet.addRow(["TEST-14", 500]);
      const restored = new ExcelJS.Workbook();
      await restored.xlsx.load(await workbook.xlsx.writeBuffer());
      const output = restored.getWorksheet("Reel Count");
      assert.equal(output.getCell("A2").value, "TEST-14");
      assert.equal(output.getCell("B2").value, 500);
      assert.equal(output.getCell("A1").font.bold, true);
      assert.equal(output.getCell("A1").fill.fgColor.argb, "FFF5F0EB");
      assert.equal(output.getColumn(1).width, 22);
      console.log("fixture passed");
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
});

test("patched Vite produces the application's production client and server", { timeout: 125_000 }, async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let output = "";
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runOwnedProcessGroup("npm", ["run", "build"], {
      cwd: root, env, signal: controller.signal,
      terminationGraceMs: 250, terminationWaitMs: 1500,
      onOutput(chunk) { output = (output + chunk.toString()).slice(-64 * 1024); },
    });
    assert.equal(controller.signal.aborted, false, "production build deadline");
    assert.equal(result.status, 0, output);
    assert.equal(result.groupGone, true, "build must not leave processes behind");
    assert.match(readFileSync(new URL("dist/public/index.html", root), "utf8"), /\/assets\//);
    assert.ok(readFileSync(new URL("dist/index.cjs", root)).length > 0);
  } finally {
    clearTimeout(timer);
  }
});
