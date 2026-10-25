import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
const selectorConsumers = ["tailwindcss", "@tailwindcss/typography", "postcss-nested"]
  .map(name => from(require, name));
const consumers = [
  ["vite", "7.3.7", require],
  ["vite", "7.3.7", from(require, "@vitejs/plugin-react")],
  ["vite", "7.3.7", from(require, "@tailwindcss/vite")],
  ["brace-expansion", "5.0.12", minimatch],
  ["source-map-js", "1.2.2", postcss],
  ["source-map-js", "1.2.2", tailwind],
  ...selectorConsumers.map(consumer => ["postcss-selector-parser", "7.1.7", consumer]),
];
const sandbox = createRequire(new URL("artifacts/mockup-sandbox/package.json", root));
// Root-only CI installs do not install the independent artifact. Its lockfile
// must always be checked; installed-consumer/build checks run when it is present.
const sandboxInstalled = existsSync(new URL("artifacts/mockup-sandbox/node_modules", root));
const sandboxOptions = {
  skip: sandboxInstalled ? false : "sandbox not installed; both lockfile guards still run",
};
const floors = new Map([
  ["vite", "7.3.7"],
  ["postcss", "8.5.28"],
  ["source-map-js", "1.2.2"],
  ["brace-expansion", "5.0.12"],
  ["browserslist", "4.28.9"],
  ["follow-redirects", "1.16.1"],
  ["lodash", "4.18.0"],
  ["sharp", "0.35.5"],
  ["multer", "2.4.0"],
  ["ip-address", "10.7.1"],
  ["postcss-selector-parser", "7.1.6"],
  ["baseline-browser-mapping", "2.11.0"],
  ["@babel/core", "7.29.6"],
]);
const releaseLines = new Map([
  ["picomatch", { 2: "2.3.2", 3: "3.0.2", 4: "4.0.4" }],
  ["nanoid", { 3: "3.3.18", 5: "5.1.16" }],
]);

function assignedPatched(name, version) {
  if (name === "esbuild") {
    assert.match(version, /^0\.\d+\.\d+$/, "require a stable esbuild release");
    const [, minor, patch] = version.split(".").map(Number);
    // GHSA-g7r4-m6w7-qqqr affects [0.27.3, 0.28.1), not older
    // esbuild lines still used by the root app and its TypeScript loader.
    assert.ok(minor < 27 || (minor === 27 && patch < 3) ||
      (minor === 28 && patch >= 1) || minor > 28,
    `esbuild ${version} is affected by GHSA-g7r4-m6w7-qqqr`);
    return;
  }
  const minimum = releaseLines.has(name)
    ? releaseLines.get(name)[version.split(".")[0]]
    : floors.get(name);
  assert.ok(minimum, `unsupported ${name} release line: ${version}`);
  patched(version, minimum);
}

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
  for (const [old, minimum] of [
    ["7.3.1", "7.3.7"], ["7.3.6", "7.3.7"], ["5.0.9", "5.0.12"],
    ["1.2.1", "1.2.2"], ["8.5.8", "8.5.28"], ["4.28.1", "4.28.9"],
    ["1.16.0", "1.16.1"],
  ]) {
    assert.throws(() => patched(old, minimum), /require .*found/);
    assert.doesNotThrow(() => patched(minimum, minimum));
  }
});

test("assigned advisory guards reject every original active package/version finding", () => {
  for (const [name, versions] of [
    ["picomatch", ["2.3.1", "4.0.3"]],
    ["browserslist", ["4.28.1"]],
    ["vite", ["7.3.1", "7.3.6"]],
    ["follow-redirects", ["1.16.0"]],
    ["brace-expansion", ["5.0.9"]],
    ["postcss", ["8.5.8"]],
    ["lodash", ["4.17.23"]],
    ["sharp", ["0.35.4"]],
    ["nanoid", ["3.3.11"]],
    ["multer", ["2.3.0"]],
    ["ip-address", ["10.7.0"]],
    ["postcss-selector-parser", ["6.0.10", "6.1.4"]],
    ["baseline-browser-mapping", ["2.10.9"]],
    ["@babel/core", ["7.29.0"]],
    ["esbuild", ["0.27.4", "0.28.0"]],
  ]) {
    for (const version of versions) {
      assert.throws(() => assignedPatched(name, version), undefined, `${name}@${version}`);
    }
  }
  for (const [name, versions] of [
    ...[...floors].map(([name, minimum]) => [name, [minimum]]),
    ["picomatch", ["2.3.2", "3.0.2", "4.0.4"]],
    ["nanoid", ["3.3.18", "5.1.16"]],
    ["esbuild", ["0.25.12", "0.27.2", "0.28.1", "0.28.2"]],
  ]) {
    for (const version of versions) assert.doesNotThrow(() => assignedPatched(name, version));
  }
});

for (const base of ["", "artifacts/mockup-sandbox/"]) {
  test(`${base || "root/"} patched lockfile keeps tarballs portable for clean CI installs`, () => {
    const lock = JSON.parse(readFileSync(new URL(`${base}package-lock.json`, root), "utf8"));
    for (const [path, pkg] of Object.entries(lock.packages)) {
      if (!pkg.resolved) continue;
      const url = new URL(pkg.resolved);
      assert.equal(url.protocol, "https:", path);
      assert.equal(url.hostname, "registry.npmjs.org", path);
    }
  });

  test(`${base || "root/"} lockfile and installed copies exclude all active assigned vulnerabilities`, () => {
    const lock = JSON.parse(readFileSync(new URL(`${base}package-lock.json`, root), "utf8"));
    const seen = new Set();
    for (const [path, pkg] of Object.entries(lock.packages)) {
      const name = path.split("node_modules/").at(-1);
      if (!floors.has(name) && !releaseLines.has(name) && name !== "esbuild") continue;
      seen.add(name);
      assignedPatched(name, pkg.version);
      if (!base || sandboxInstalled) {
        const installed = JSON.parse(readFileSync(new URL(`${base}${path}/package.json`, root), "utf8"));
        assert.equal(installed.version, pkg.version, `installed/locked mismatch: ${base}${path}`);
      }
    }
    for (const name of base
      ? ["vite", "postcss", "source-map-js", "browserslist", "picomatch", "nanoid",
        "lodash", "baseline-browser-mapping", "@babel/core", "esbuild"]
      : [...floors.keys(), ...releaseLines.keys(), "esbuild"]) {
      assert.ok(seen.has(name), `missing ${name} from ${base || "root/"} lockfile`);
    }
  });
}

test("sandbox Vite, CSS and Babel consumers resolve patched dependencies", sandboxOptions, () => {
  const css = from(from(sandbox, "vite"), "postcss");
  const node = from(from(sandbox, "@tailwindcss/vite"), "@tailwindcss/node");
  const babel = from(from(sandbox, "@vitejs/plugin-react"), "@babel/core");
  for (const [name, consumer] of [
    ["vite", sandbox],
    ["vite", from(sandbox, "@vitejs/plugin-react")],
    ["vite", from(sandbox, "@tailwindcss/vite")],
    ["postcss", from(sandbox, "vite")],
    ["source-map-js", css],
    ["source-map-js", node],
    ["browserslist", from(babel, "@babel/helper-compilation-targets")],
    ["@babel/core", from(sandbox, "@vitejs/plugin-react")],
    ["picomatch", from(sandbox, "micromatch")],
    ["picomatch", from(sandbox, "vite")],
    ["picomatch", from(from(sandbox, "vite"), "tinyglobby")],
    ["lodash", from(sandbox, "recharts")],
    ["esbuild", from(sandbox, "vite")],
  ]) {
    assignedPatched(name, metadata(consumer.resolve(name), name).version);
  }
});

test("all selector-parser consumers preserve selectors and bound flat-selector parsing", { timeout: 15_000 }, () => {
  for (const consumer of selectorConsumers) {
    boundedFixture(`
      const assert = require("node:assert/strict");
      const parser = require(${JSON.stringify(consumer.resolve("postcss-selector-parser"))});
      const selector = 'article > .reel:is(.active, #selected)[data-label="A B"]::before';
      assert.equal(parser().processSync(selector), selector);
      const long = ".a".repeat(100000);
      const result = parser().astSync(long);
      assert.equal(result.first.nodes.length, 100000);
      assert.equal(result.toString(), long);
      console.log("fixture passed");
    `);
  }
});

for (const [label, consumer] of [
  ["root glob", from(require, "micromatch")],
  ["root Vite", from(require, "vite")],
  ...(sandboxInstalled ? [
    ["sandbox glob", from(sandbox, "micromatch")],
    ["sandbox Vite", from(sandbox, "vite")],
    ["sandbox tinyglobby", from(from(sandbox, "vite"), "tinyglobby")],
  ] : []),
]) {
  test(`${label} picomatch preserves matching and rejects inherited POSIX classes`, { timeout: 15_000 }, () => {
    boundedFixture(`
      const assert = require("node:assert/strict");
      const picomatch = require(${JSON.stringify(consumer.resolve("picomatch"))});
      assert.equal(picomatch("**/*.tsx")("src/App.tsx"), true);
      assert.equal(picomatch("**/*.tsx")("src/App.css"), false);
      assert.equal(picomatch("[[:digit:]].txt")("7.txt"), true);
      for (const name of ["constructor", "toString", "__proto__"]) {
        assert.equal(picomatch("[[:" + name + ":]]")("c"), false);
      }
      for (const pattern of ["+(a|aa)", "+(+(a))", "*(+(a))"]) {
        assert.equal(picomatch(pattern)("a".repeat(40) + "!"), false);
      }
      console.log("fixture passed");
    `);
  });
}

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

test("patched sandbox tooling typechecks and builds its preview", { ...sandboxOptions, timeout: 65_000 }, async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const env = { ...process.env, PORT: "5000", BASE_PATH: "/__mockup/" };
  delete env.NODE_TEST_CONTEXT;
  try {
    for (const script of ["typecheck", "build"]) {
      let output = "";
      const result = await runOwnedProcessGroup("npm", ["run", script], {
        cwd: new URL("artifacts/mockup-sandbox/", root), env, signal: controller.signal,
        terminationGraceMs: 250, terminationWaitMs: 1500,
        onOutput(chunk) { output = (output + chunk.toString()).slice(-64 * 1024); },
      });
      assert.equal(controller.signal.aborted, false, `sandbox ${script} deadline`);
      assert.equal(result.status, 0, output);
      assert.equal(result.groupGone, true, "sandbox tooling must not leave processes behind");
    }
    assert.match(readFileSync(new URL("artifacts/mockup-sandbox/dist/index.html", root), "utf8"), /\/assets\//);
  } finally {
    clearTimeout(timer);
  }
});
