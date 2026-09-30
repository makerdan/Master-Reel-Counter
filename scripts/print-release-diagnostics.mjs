import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { redactReleaseDiagnostics } from "./redact-release-diagnostics.mjs";

export const MAX_DIAGNOSTIC_LINES = 120;
export const MAX_DIAGNOSTIC_BYTES = 24_576;
const MAX_LOG_LINES = 40;
const MAX_LOG_LINE_BYTES = 256;
const MAX_LEDGER_ITEMS = 10;
const MAX_LEDGER_ITEM_BYTES = 160;
const MAX_ROLE_INPUT_BYTES = 32_768;
const MAX_ROLE_SECTION_BYTES = 4_096;
const MAX_ROLE_FIELD_BYTES = 512;
const MAX_SESSION_FIELD_BYTES = 1_536;
const MAX_SESSION_OBSERVATIONS = 20;
const MAX_BROWSER_BYTES = 4_096;
const MAX_BROWSER_FIELD_BYTES = 768;
const MAX_CANDIDATE_BYTES = 4_096;
const MAX_PROXY_BYTES = 4_096;
const SAFE_PATH = /^\/[A-Za-z0-9/_\-.~%]*$/;
const SAFE_ROUTE_REQUEST =
  /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) \/[A-Za-z0-9/_\-.~%]* [1-5][0-9]{2}$/;
const SAFE_FAILED_REQUEST =
  /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) \/[A-Za-z0-9/_\-.~%]* (?:net::)?ERR_[A-Z_]+$/;
const SAFE_ROLE_REQUEST_PATHS = new Set([
  "/api/__clerk/v1/client",
  "/api/__clerk/v1/client/sign_ins",
  "/api/__clerk/v1/client/sign_ups",
  "/api/__clerk/v1/client/sessions",
  "/api/__clerk/v1/client/verify",
  "/api/__clerk/v1/client/tasks",
  "/other-route",
]);
const SAFE_PAGE_ERROR = /^(?:[A-Za-z][A-Za-z0-9]{0,39}Error|PageError)$/;
const SAFE_ROLE_PATHS = new Set([
  "/",
  "/settings",
  "/stats",
  "/sign-in",
  "/sign-in/client-trust",
  "/sign-in/[other-step]",
  "/[other-route]",
]);
const SAFE_SESSION_STATUSES = new Set([
  "clerk-unloaded",
  "loaded-without-session",
  "active-session-on-sign-in",
  "active-session-route-ready",
]);
const SAFE_SESSION_PHASES = new Set([
  "poll",
  "completed",
  "timeout",
  "client-trust-timeout",
]);
const SAFE_SESSION_FAILURE_CATEGORIES = new Set([
  "not-observed",
  "none",
  "clerk-unloaded-timeout",
  "loaded-without-session-timeout",
  "active-session-route-timeout",
  "client-trust-timeout",
  "observation-unavailable",
  "diagnostics-unavailable",
]);
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
  const matches =
    typeof pattern === "function" ? pattern(item) : pattern.test(item);
  return (
    typeof item === "string" &&
    Buffer.byteLength(item) <= MAX_LEDGER_ITEM_BYTES &&
    !CREDENTIAL_SHAPE.test(item) &&
    matches
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

function unavailableRoleLedger() {
  return {
    finalPath: "[role diagnostic unavailable]",
    routeStates: [],
    clerkRequests: [],
    requestFailures: [],
    pageErrors: [],
    sessionObservations: [],
    sessionFailureCategory: "diagnostics-unavailable",
  };
}

function unavailableBrowserLedger() {
  return {
    finalPath: "[browser diagnostic unavailable]",
    routeStates: [],
    clerkRequests: [],
    requestFailures: [],
    pageErrors: [],
  };
}

function safeRolePath(value) {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value) <= MAX_LEDGER_ITEM_BYTES &&
    !CREDENTIAL_SHAPE.test(value) &&
    SAFE_ROLE_PATHS.has(value)
  )
    ? value
    : "[REDACTED INVALID ENTRY]";
}

function safeRoleStringList(value, pattern) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ["[REDACTED INVALID ENTRY]"];
  const retained = value.slice(-MAX_LEDGER_ITEMS).map((item) =>
    validLedgerItem(item, pattern) ? item : "[REDACTED INVALID ENTRY]",
  );
  if (value.length > MAX_LEDGER_ITEMS) retained.unshift("[OMITTED]");
  return retained;
}

function isSafeRoleRequest(item, pattern) {
  if (!validLedgerItem(item, pattern)) return false;
  const match = item.match(
    /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) (\/[A-Za-z0-9/_\-.~%]*) (?:[1-5][0-9]{2}|(?:net::)?ERR_[A-Z_]+)$/,
  );
  return Boolean(match && SAFE_ROLE_REQUEST_PATHS.has(match[1]));
}

function safeRoleRequestList(value, pattern) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ["[REDACTED INVALID ENTRY]"];
  const retained = value.slice(-MAX_LEDGER_ITEMS).map((item) =>
    isSafeRoleRequest(item, pattern) ? item : "[REDACTED INVALID ENTRY]",
  );
  if (value.length > MAX_LEDGER_ITEMS) retained.unshift("[OMITTED]");
  return retained;
}

function sessionObservationIsValid(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const {
    path,
    clerkLoaded,
    hasActiveSession,
    status,
    phase,
    elapsedMs,
  } = value;
  if (
    safeRolePath(path) !== path ||
    typeof clerkLoaded !== "boolean" ||
    typeof hasActiveSession !== "boolean" ||
    !SAFE_SESSION_STATUSES.has(status) ||
    !SAFE_SESSION_PHASES.has(phase) ||
    !Number.isInteger(elapsedMs) ||
    elapsedMs < 0 ||
    elapsedMs > 30_000
  ) {
    return false;
  }
  if (status === "clerk-unloaded") return !clerkLoaded && !hasActiveSession;
  if (status === "loaded-without-session") {
    return clerkLoaded && !hasActiveSession;
  }
  if (!clerkLoaded || !hasActiveSession) return false;
  return status === (
    path.startsWith("/sign-in")
      ? "active-session-on-sign-in"
      : "active-session-route-ready"
  );
}

function safeSessionObservations(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ["[REDACTED INVALID ENTRY]"];
  const retained = value.slice(-MAX_SESSION_OBSERVATIONS).map((item) =>
    sessionObservationIsValid(item)
      ? {
          path: item.path,
          clerkLoaded: item.clerkLoaded,
          hasActiveSession: item.hasActiveSession,
          status: item.status,
          phase: item.phase,
          elapsedMs: item.elapsedMs,
        }
      : "[REDACTED INVALID ENTRY]",
  );
  if (value.length > MAX_SESSION_OBSERVATIONS) retained.unshift("[OMITTED]");
  return retained;
}

function safeRoleLedger(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unavailableRoleLedger();
  }
  return {
    finalPath:
      value.finalPath === undefined
        ? "[role diagnostic unavailable]"
        : safeRolePath(value.finalPath),
    routeStates: safeRoleStringList(
      value.routeStates,
      (item) => safeRolePath(item) === item,
    ),
    clerkRequests: safeRoleRequestList(value.clerkRequests, SAFE_ROUTE_REQUEST),
    requestFailures: safeRoleRequestList(value.requestFailures, SAFE_FAILED_REQUEST),
    pageErrors: safeRoleStringList(value.pageErrors, SAFE_PAGE_ERROR),
    sessionObservations: safeSessionObservations(value.sessionObservations),
    sessionFailureCategory:
      typeof value.sessionFailureCategory === "string" &&
      Buffer.byteLength(value.sessionFailureCategory) <= 64 &&
      SAFE_SESSION_FAILURE_CATEGORIES.has(value.sessionFailureCategory)
        ? value.sessionFailureCategory
        : "[REDACTED INVALID ENTRY]",
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

function formatBoundedList(items, maxBytes) {
  const retained = [...items];
  while (retained.length > 0 && Buffer.byteLength(JSON.stringify(retained)) > maxBytes) {
    retained.shift();
  }
  if (retained.length < items.length) retained.unshift("[OMITTED]");
  return JSON.stringify(retained);
}

function formatRoleSection(role, ledger) {
  const section = [
    `finalPath=${JSON.stringify(ledger.finalPath)}`,
    `routeStates=${formatBoundedList(ledger.routeStates, MAX_ROLE_FIELD_BYTES)}`,
    `clerkRequests=${formatBoundedList(ledger.clerkRequests, MAX_ROLE_FIELD_BYTES)}`,
    `requestFailures=${formatBoundedList(ledger.requestFailures, MAX_ROLE_FIELD_BYTES)}`,
    `pageErrors=${formatBoundedList(ledger.pageErrors, MAX_ROLE_FIELD_BYTES)}`,
    `sessionObservations=${formatBoundedList(ledger.sessionObservations, MAX_SESSION_FIELD_BYTES)}`,
    `sessionFailureCategory=${JSON.stringify(ledger.sessionFailureCategory)}`,
  ].join("\n");
  if (Buffer.byteLength(section) > MAX_ROLE_SECTION_BYTES) {
    throw new Error(`${role} diagnostic section exceeded its fixed budget`);
  }
  return [`[${role}]`, section].join("\n");
}

async function readSafe(path, fallback, maxBytes = Number.POSITIVE_INFINITY) {
  try {
    const file = await stat(path);
    if (file.size > maxBytes) return fallback;
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

export async function formatReleaseDiagnostics({
  browserPath,
  candidateLogPath,
  proxyLogPath,
  googleAdminPath,
  googleUserPath,
}) {
  const browserRaw = await readSafe(browserPath, null);
  let browser;
  if (typeof browserRaw !== "string") {
    browser = unavailableBrowserLedger();
  } else {
    try {
      browser = safeLedger(JSON.parse(browserRaw));
    } catch {
      browser = { finalPath: "[invalid browser diagnostic]" };
    }
  }
  const readRoleLedger = async (path) => {
    const raw = await readSafe(path, null, MAX_ROLE_INPUT_BYTES);
    if (typeof raw !== "string") return unavailableRoleLedger();
    try {
      return safeRoleLedger(JSON.parse(raw));
    } catch {
      return unavailableRoleLedger();
    }
  };
  const [googleAdmin, googleUser] = await Promise.all([
    readRoleLedger(googleAdminPath),
    readRoleLedger(googleUserPath),
  ]);
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
  const googleAdminSection = formatRoleSection("google-admin", googleAdmin);
  const googleUserSection = formatRoleSection("google-user", googleUser);
  const block = [
    "===== MANAGED CLERK RELEASE DIAGNOSTICS =====",
    "[browser]",
    browserSection,
    googleAdminSection,
    googleUserSection,
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
    googleAdminPath: process.argv[5],
    googleUserPath: process.argv[6],
  });
  process.stderr.write(`${output}\n`);
}