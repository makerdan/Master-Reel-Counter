import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  closeHmrHarness,
  createHmrHarness,
  socketEvents,
  waitFor,
} from "../helpers/vite-hmr-harness.ts";

const previewHost = process.env.REPLIT_DEV_DOMAIN?.trim();
if (!previewHost) {
  throw new Error("The interruption worker requires REPLIT_DEV_DOMAIN");
}

const previewClientPort = 3003;
const harness = await createHmrHarness({
  previewHost,
  previewClientPort,
  listenPort: 5001,
  baseUrl: `https://${previewHost}:${previewClientPort}/`,
});

try {
  await waitFor(
    "the preview worker's HMR WebSocket",
    () => socketEvents(harness.page),
    (events) =>
      events.some((event) => {
        if (event.event !== "open") return false;
        const url = new URL(event.url);
        return url.hostname === previewHost && url.port === String(previewClientPort);
      }),
    30000,
  );
  await writeFile(
    join(harness.sourceDirectory, "marker.js"),
    `export const value = "interrupt-ready";\n`,
    "utf8",
  );
  await harness.page.waitForFunction(
    () => document.querySelector("#value")?.textContent === "interrupt-ready",
  );

  process.stdout.write(
    `HMR_WORKER_READY ${JSON.stringify({
      processGroupId: harness.processHandle.pid,
      serverPid: harness.state[0].pid,
      directory: harness.directory,
    })}\n`,
  );
  await new Promise(() => {});
} finally {
  await closeHmrHarness(harness);
}