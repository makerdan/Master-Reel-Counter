import https from "node:https";

const [healthUrl, expectedId, rawPid, rawTimeout, tlsOption] = process.argv.slice(2);
const pid = Number(rawPid);
const timeoutMs = Number(rawTimeout);

if (!healthUrl || !expectedId || !Number.isInteger(pid) || !Number.isFinite(timeoutMs)) {
  throw new Error("Release candidate readiness arguments are invalid");
}

function processIsAlive() {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const deadline = Date.now() + timeoutMs;
const allowSelfSigned = tlsOption === "--insecure-tls";
const insecureAgent = allowSelfSigned
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

function readHealth() {
  if (!allowSelfSigned) {
    return fetch(healthUrl, { signal: AbortSignal.timeout(1_000) }).then(
      async (response) => ({
        ok: response.ok,
        body: await response.json(),
      }),
    );
  }
  return new Promise((resolve, reject) => {
    const request = https.get(healthUrl, { agent: insecureAgent, timeout: 1_000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({
            ok: (response.statusCode ?? 500) < 400,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Readiness request timed out")));
    request.on("error", reject);
  });
}

while (Date.now() < deadline) {
  if (!processIsAlive()) {
    throw new Error("Production candidate stopped before becoming ready");
  }
  try {
    const response = await readHealth();
    if (response.ok) {
      const body = response.body;
      if (body?.ok === true && body?.candidateId === expectedId) {
        process.exit(0);
      }
    }
  } catch {
    // The candidate can refuse connections while it is still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

throw new Error("Production candidate did not become ready within the release timeout");