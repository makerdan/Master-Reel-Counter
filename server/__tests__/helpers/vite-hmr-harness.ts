import { execFileSync } from "node:child_process";
import { constants as osConstants, tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { chromium } from "@playwright/test";

interface HmrServerState {
  pid: number;
  port: number;
}

interface HmrHarnessResources {
  directory: string;
  sourceDirectory: string;
  stateFile: string;
  port: number;
  processHandle?: ChildProcess;
  browser?: Browser;
  page?: Page;
  state?: HmrServerState[];
  browserSocketEvents: Array<{ event: string; url: string }>;
  cleanupPromise?: Promise<void>;
}

export interface HmrHarness extends HmrHarnessResources {
  processHandle: ChildProcess;
  browser: Browser;
  page: Page;
  state: HmrServerState[];
}

export interface HmrHarnessOptions {
  previewHost?: string;
  previewClientPort?: number;
  listenPort?: number;
  baseUrl?: string;
}

const activeHarnesses = new Set<HmrHarnessResources>();
const signals = ["SIGINT", "SIGTERM"] as const;
const signalCallbacks = new Map<(typeof signals)[number], () => void>();
let signalHandlersInstalled = false;
let signalCleanupStarted = false;

async function waitFor<T>(
  description: string,
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function installSignalHandlers() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  for (const signal of signals) {
    const callback = () => {
      if (signalCleanupStarted) return;
      signalCleanupStarted = true;
      void (async () => {
        const results = await Promise.allSettled(
          [...activeHarnesses].map((harness) => closeHmrHarness(harness)),
        );
        const failed = results.filter((result) => result.status === "rejected");
        for (const result of failed) {
          if (result.status === "rejected") {
            console.error("[vite-hmr-harness] Cleanup failed after interruption:", result.reason);
          }
        }
        const signalNumber = osConstants.signals[signal] ?? 1;
        process.exit(128 + signalNumber);
      })();
    };
    signalCallbacks.set(signal, callback);
    process.on(signal, callback);
  }
}

function removeSignalHandlersIfIdle() {
  if (activeHarnesses.size > 0 || !signalHandlersInstalled) return;
  for (const signal of signals) {
    const callback = signalCallbacks.get(signal);
    if (callback) process.removeListener(signal, callback);
    signalCallbacks.delete(signal);
  }
  signalHandlersInstalled = false;
  signalCleanupStarted = false;
}

function chromiumExecutable() {
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function readServerState(path: string): Promise<HmrServerState[]> {
  return readFile(path, "utf8")
    .then((contents) =>
      contents
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as HmrServerState),
    )
    .catch(() => []);
}

function processGroupAlive(processGroupId: number) {
  try {
    process.kill(process.platform === "win32" ? processGroupId : -processGroupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function isProcessGroupAlive(processGroupId: number) {
  return processGroupAlive(processGroupId);
}

export function signalProcessGroup(
  processGroupId: number,
  signal: NodeJS.Signals,
) {
  try {
    process.kill(
      process.platform === "win32" ? processGroupId : -processGroupId,
      signal,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function stopProcessGroup(processGroupId: number) {
  if (!processGroupAlive(processGroupId)) return;

  signalProcessGroup(processGroupId, "SIGTERM");
  try {
    await waitFor(
      "owned HMR process group to exit",
      async () => processGroupAlive(processGroupId),
      (alive) => !alive,
      5000,
    );
  } catch {
    signalProcessGroup(processGroupId, "SIGKILL");
    await waitFor(
      "owned HMR process group to exit after SIGKILL",
      async () => processGroupAlive(processGroupId),
      (alive) => !alive,
      5000,
    );
  }
}

async function closeBrowserResources(harness: HmrHarnessResources) {
  const closeOperations = [
    harness.page?.close().catch(() => {}),
    harness.browser?.close().catch(() => {}),
  ].filter((operation): operation is Promise<void> => operation !== undefined);
  if (closeOperations.length === 0) return;

  let timeout: NodeJS.Timeout | undefined;
  const closed = await Promise.race([
    Promise.allSettled(closeOperations).then(() => true),
    new Promise<boolean>((resolvePromise) => {
      timeout = setTimeout(() => resolvePromise(false), 5000);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (!closed) throw new Error("Timed out closing the HMR browser resources");
}

function socketEvents(page: Page) {
  return page.evaluate(
    () =>
      (window as Window & {
        __hmrSocketEvents?: Array<{ event: string; url: string }>;
      }).__hmrSocketEvents ?? [],
  );
}

export async function createHmrHarness(
  options: HmrHarnessOptions = {},
): Promise<HmrHarness> {
  const directory = await mkdtemp(join(tmpdir(), "vite-hmr-live-"));
  const sourceDirectory = join(directory, "src");
  const stateFile = join(directory, "state.jsonl");
  const harness: HmrHarnessResources = {
    directory,
    sourceDirectory,
    stateFile,
    port: options.listenPort ?? 0,
    browserSocketEvents: [],
  };
  activeHarnesses.add(harness);
  installSignalHandlers();

  try {
    await mkdir(sourceDirectory);
    await writeFile(
      join(directory, "index.html"),
      `<!doctype html>
<html><body><output id="value"></output><script type="module" src="/src/main.js"></script></body></html>`,
      "utf8",
    );
    await writeFile(
      join(sourceDirectory, "marker.js"),
      `export const value = "initial";\n`,
      "utf8",
    );
    await writeFile(
      join(sourceDirectory, "main.js"),
      `import { value } from "./marker.js";
window.__hmrUpdates = [];
function render(nextValue) {
  document.querySelector("#value").textContent = nextValue;
}
render(value);
if (import.meta.hot) {
  import.meta.hot.accept("./marker.js", (module) => {
    const nextValue = module?.value;
    window.__hmrUpdates.push(nextValue);
    render(nextValue);
  });
}
`,
      "utf8",
    );

    if (harness.port === 0) {
      const portProbe = createNetServer();
      await new Promise<void>((resolvePromise, reject) => {
        portProbe.once("error", reject);
        portProbe.listen(0, "127.0.0.1", resolvePromise);
      });
      const address = portProbe.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not determine a free Vite HMR fixture port");
      }
      harness.port = address.port;
      await new Promise<void>((resolvePromise, reject) => {
        portProbe.close((error) => (error ? reject(error) : resolvePromise()));
      });
    }

    const tsxCli = resolve("node_modules", "tsx", "dist", "cli.mjs");
    const fixtureEntry = resolve("server/__tests__/fixtures/vite-hmr-server.mjs");
    const isPreview = Boolean(options.previewHost);
    const command = isPreview
      ? [tsxCli, fixtureEntry]
      : [resolve("scripts/dev-supervisor.mjs")];
    const child = spawn(process.execPath, command, {
      cwd: resolve("."),
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(harness.port),
        ...(isPreview
          ? {
              VITE_HMR_PREVIEW_HOST: options.previewHost,
              VITE_HMR_PREVIEW_PORT: String(options.previewClientPort ?? 443),
              VITE_HMR_LISTEN_HOST: "0.0.0.0",
            }
          : {
              DEV_SUPERVISOR_ENTRY: fixtureEntry,
              DEV_STARTUP_TIMEOUT_MS: "10000",
            }),
        VITE_HMR_FIXTURE_ROOT: directory,
        VITE_HMR_STATE_FILE: stateFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    harness.processHandle = child;
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });

    harness.state = await waitFor(
      "the supervised Vite fixture",
      async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`Vite HMR fixture exited before readiness:\n${output}`);
        }
        return readServerState(stateFile);
      },
      (value) =>
        value.length >= 1 &&
        (isPreview || output.includes("Server ready on port")),
      20000,
    );

    const executablePath = chromiumExecutable();
    if (!executablePath) {
      throw new Error("Live Vite HMR validation requires a Chromium executable");
    }
    harness.browser = await chromium.launch({ headless: true, executablePath });
    harness.page = await harness.browser.newPage();
    await harness.page.addInitScript(() => {
      const nativeWebSocket = window.WebSocket;
      const events: Array<{ event: string; url: string }> = [];
      (window as Window & { __hmrSocketEvents?: typeof events }).__hmrSocketEvents = events;
      window.WebSocket = new Proxy(nativeWebSocket, {
        construct(target, args) {
          const socket = Reflect.construct(target, args) as WebSocket;
          const url = socket.url;
          events.push({ event: "construct", url });
          for (const event of ["open", "close", "error"]) {
            socket.addEventListener(event, () => events.push({ event, url }));
          }
          return socket;
        },
      });
    });
    harness.page.on("websocket", (webSocket) => {
      if (new URL(webSocket.url()).pathname !== "/vite-hmr") return;
      const url = webSocket.url();
      harness.browserSocketEvents.push({ event: "open", url });
      webSocket.on("close", () => harness.browserSocketEvents.push({ event: "close", url }));
    });
    const baseUrl = options.baseUrl ?? `http://127.0.0.1:${harness.port}/`;
    await harness.page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    return harness as HmrHarness;
  } catch (error) {
    await closeHmrHarness(harness);
    throw error;
  }
}

export function closeHmrHarness(harness: HmrHarnessResources): Promise<void> {
  if (harness.cleanupPromise) return harness.cleanupPromise;
  harness.cleanupPromise = (async () => {
    const cleanupErrors: unknown[] = [];
    try {
      const processHandle = harness.processHandle;
      const processGroupId = processHandle?.pid;
      if (processHandle && processGroupId) {
        try {
          await stopProcessGroup(processGroupId);
          if (processHandle.exitCode === null && processHandle.signalCode === null) {
            await waitFor(
              "owned HMR launcher to exit",
              async () =>
                processHandle.exitCode === null && processHandle.signalCode === null,
              (running) => !running,
              5000,
            );
          }
        } catch (error) {
          cleanupErrors.push(error);
        }
      }

      try {
        await closeBrowserResources(harness);
      } catch (error) {
        cleanupErrors.push(error);
      }
    } finally {
      await rm(harness.directory, { recursive: true, force: true });
      activeHarnesses.delete(harness);
      removeSignalHandlersIfIdle();
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "One or more HMR harness resources failed to close");
    }
  })();
  return harness.cleanupPromise;
}

export { socketEvents, waitFor };