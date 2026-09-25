#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const scannedDirectories = ["client", "server", "shared", "script", "scripts"];
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".sh", ".ts", ".tsx"]);
const excludedFiles = new Set(["scripts/port-authority-test.mjs"]);
const replitStorageSidecarAddress = "127.0.0.1:1106";

/**
 * Fixed service bindings, URLs, configuration values, and PORT fallbacks are
 * prohibited. Port 0 and values read directly from the environment are valid.
 */
export function findHardcodedPortReferences(source) {
  const findings = [];
  const patterns = [
    /\blisten\s*\(\s*(?:(?:["'])([1-9]\d{0,4})(?:["'])|[1-9]\d{0,4})(?=\s*[,)]|\s|$)/g,
    /\b(?:PORT|[A-Z][A-Z\d_]*_PORT)\s*(?:\|\||\?\?)\s*["']?([1-9]\d{0,4})["']?/g,
    /\bport\s*:\s*["']?([1-9]\d{0,4})["']?(?=\s*[,})]|$)/gi,
    /\b(?:const|let|var)\s+(?:port|PORT|[A-Za-z_$][\w$]*(?:Port|_PORT))\s*=\s*["']?([1-9]\d{0,4})["']?(?=\s*[,;)\n]|$)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) findings.push(match[0]);
  }
  const fixedLoopbackUrl = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):[1-9]\d{0,4}\b/g;
  for (const match of source.matchAll(fixedLoopbackUrl)) {
    // Replit's managed object-storage sidecar exposes a fixed loopback
    // endpoint; it is an integration contract, not an app-owned service port.
    if (match[0] !== replitStorageSidecarAddress) findings.push(match[0]);
  }
  return findings;
}

function isTestOrFixturePath(path) {
  const normalized = path.split(sep).join("/");
  const segments = normalized.split("/");
  return (
    excludedFiles.has(normalized) ||
    segments.some((segment) => segment === "__tests__" || segment === "tests") ||
    /\.(?:test|spec)\.[^.]+$/.test(normalized)
  );
}

function isExecutableSource(path) {
  return sourceExtensions.has(extname(path)) && !isTestOrFixturePath(path);
}

function collectSourceFiles(root) {
  const files = [];

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (entry.isFile() && isExecutableSource(relative(root, path))) {
        files.push(path);
      }
    }
  }

  for (const directory of scannedDirectories) {
    const path = resolve(root, directory);
    if (existsSync(path)) walk(path);
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && isExecutableSource(entry.name)) {
      files.push(resolve(root, entry.name));
    }
  }
  return [...new Set(files)].sort();
}

export function scanPortReferenceFiles(files) {
  const findings = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const reference of findHardcodedPortReferences(source)) {
      findings.push({ file, reference });
    }
  }
  return findings;
}

export function scanExecutableSource(root = projectRoot) {
  const files = collectSourceFiles(root);
  return { files, findings: scanPortReferenceFiles(files) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, findings } = scanExecutableSource();
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `[port-reference-scan] FAIL: ${relative(projectRoot, finding.file)} contains fixed service port ${JSON.stringify(finding.reference)}.`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log(`[port-reference-scan] PASS: ${files.length} executable source files scanned.`);
  }
}