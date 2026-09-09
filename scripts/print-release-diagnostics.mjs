import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { redactReleaseDiagnostics } from "./redact-release-diagnostics.mjs";

export const MAX_DIAGNOSTIC_LINES = 120;
export const MAX_DIAGNOSTIC_BYTES = 16_384;
const MAX_LOG_LINES = 40;
const MAX_LOG_LINE_BYTES = 256;
const MAX_LEDGER_ITEMS = 10;
const MAX_LEDGER_ITEM_BYTES = 160;
const MAX_BROWSER_BYTES = 4_096;
const MAX_BROWSER_FIELD_BYTES = 768;
const MAX_CANDIDATE_BYTES = 4_096;
const MAX_PROXY_BYTES = 4_096;
const SAFE_PATH = /^\/[A-Za-z0-9/_\-.~%]*$/;
const SAFE_ROUTE_REQUEST =
  /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) \/[A-Za-z0-9/_\-.~%]* [1-5][0-9]{2}$/;
const SAFE_FAILED_REQUEST =
  /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) \/[A-Za-z0-9/_\-.~%]* (?:net::)?ERR_[A-Z_]+$/;
const SAFE_PAGE_ERROR = /^(?:[A-Za-z][A-Za-z0-9]{0,39}Error|PageError)$/;
const CREDENTIAL_SHAPE =
  /(?:\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/;

function truncateUtf8(value, maxBytes) {
  const buffer = Buffer.from(value);
  if (buffer.length <= maxBytes) return value;
  return buffer
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD$/, "");
}

function truncateUtf8End(value, maxBytes) {
  const buffer = Buffer.from(value);
  if (buffer.length <= maxBytes) return value;
  return buffer
    .subarray(buffer.length - maxBytes)
    .toString("utf8")
    .replace(/^\uFFFD/, "");
}

function boundedLines(value, limit, maxBytes) {
  const sanitized = redactReleaseDiagnostics(String(value));
  const lines = sanitized
    .split(/\r?\n/)
    .slice(-limit)
    .map((line) => truncateUtf8(line, MAX_LOG_LINE_BYTES));
  return truncateUtf8End(lines.join("\n"), maxBytes);
}

function validLedgerItem(item, pattern) {
  return (
    typeof item === "string" &&
    Buffer.byteLength(item) <= MAX_LEDGER_ITEM_BYTES &&
    !CREDENTIAL_SHAPE.test(item) &&
    pattern.test(item)
  );
}

function safeLedger(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const stringList = (candidate, pattern) =>
    Array.isArray(candidate)
      ? candidate
          .filter((item) => typeof item === "string")
          .slice(-MAX_LEDGER_ITEMS)
          .map((item) =>
            validLedgerItem(item, pattern) ? item : "[REDACTED INVALID ENTRY]",
          )
      : [];
  return {
    finalPath:
      typeof value.finalPath === "string" && SAFE_PATH.test(value.finalPath)
        && Buffer.byteLength(value.finalPath) <= MAX_LEDGER_ITEM_BYTES
        && !CREDENTIAL_SHAPE.test(value.finalPath)
        ? value.finalPath
        : "[REDACTED INVALID ENTRY]",
    routeStates: stringList(value.routeStates, SAFE_PATH),
    clerkRequests: stringList(value.clerkRequests, SAFE_ROUTE_REQUEST),
    requestFailures: stringList(value.requestFailures, SAFE_FAILED_REQUEST),
    pageErrors: stringList(value.pageErrors, SAFE_PAGE_ERROR),
  };
}

function formatLedgerList(items) {
  const retained = [...items];
  while (
    retained.length > 0 &&
    Buffer.byteLength(JSON.stringify(retained)) > MAX_BROWSER_FIELD_BYTES
  ) {
    retained.shift();
  }
  if (retained.length < items.length) retained.unshift("[OMITTED]");
  return JSON.stringify(retained);
}

async function readSafe(path, fallback) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

export async function formatReleaseDiagnostics({
  browserPath,
  candidateLogPath,
  proxyLogPath,
}) {
  const browserRaw = await readSafe(browserPath, "{}");
  let browser;
  try {
    browser = safeLedger(JSON.parse(browserRaw));
  } catch {
    browser = { finalPath: "[invalid browser diagnostic]" };
  }
  const candidate = boundedLines(
    await readSafe(candidateLogPath, "[candidate log unavailable]"),
    MAX_LOG_LINES,
    MAX_CANDIDATE_BYTES,
  );
  const proxy = boundedLines(
    await readSafe(proxyLogPath, "[proxy log unavailable]"),
    MAX_LOG_LINES,
    MAX_PROXY_BYTES,
  );
  const browserSection = [
    `finalPath=${JSON.stringify(browser.finalPath)}`,
    `routeStates=${formatLedgerList(browser.routeStates ?? [])}`,
    `clerkRequests=${formatLedgerList(browser.clerkRequests ?? [])}`,
    `requestFailures=${formatLedgerList(browser.requestFailures ?? [])}`,
    `pageErrors=${formatLedgerList(browser.pageErrors ?? [])}`,
  ].join("\n");
  if (Buffer.byteLength(browserSection) > MAX_BROWSER_BYTES) {
    throw new Error("Browser diagnostic section exceeded its fixed budget");
  }
  const block = [
    "===== MANAGED CLERK RELEASE DIAGNOSTICS =====",
    "[browser]",
    browserSection,
    "[candidate tail]",
    candidate,
    "[proxy tail]",
    proxy,
    "===== END MANAGED CLERK RELEASE DIAGNOSTICS =====",
  ].join("\n");
  const redacted = block
    .split(/\r?\n/)
    .slice(0, MAX_DIAGNOSTIC_LINES)
    .join("\n");
  return truncateUtf8(redacted, MAX_DIAGNOSTIC_BYTES - 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = await formatReleaseDiagnostics({
    browserPath: process.argv[2],
    candidateLogPath: process.argv[3],
    proxyLogPath: process.argv[4],
  });
  process.stderr.write(`${output}\n`);
}