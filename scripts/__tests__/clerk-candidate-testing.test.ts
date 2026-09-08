import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { setupCandidateClerkTestingToken } from "../../tests/support/clerk-candidate-testing";

test("testing-token transport reaches only the local candidate with canonical forwarding headers", async () => {
  let received:
    | { host?: string; forwardedHost?: string; forwardedProto?: string; url?: string }
    | undefined;
  const server = http.createServer((request, response) => {
    received = {
      host: request.headers.host,
      forwardedHost: request.headers["x-forwarded-host"] as string | undefined,
      forwardedProto: request.headers["x-forwarded-proto"] as string | undefined,
      url: request.url,
    };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ client: { captcha_bypass: false } }));
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  assert(address && typeof address === "object");

  let routeMatcher: RegExp | undefined;
  let routeHandler: ((route: any, request: any) => Promise<void>) | undefined;
  const browserContext = {
    async route(matcher: RegExp, handler: typeof routeHandler) {
      routeMatcher = matcher;
      routeHandler = handler;
    },
  };
  const page = {
    context: () => browserContext,
  };
  const previousToken = process.env.CLERK_TESTING_TOKEN;
  process.env.CLERK_TESTING_TOKEN = "synthetic-testing-token";

  try {
    await setupCandidateClerkTestingToken({
      page: page as any,
      candidateOrigin: "https://candidate.example",
      proxyPath: "/api/__clerk",
      localCandidateOrigin: `http://127.0.0.1:${address.port}`,
    });
    assert(routeMatcher?.test("https://candidate.example/api/__clerk/v1/client"));
    assert(routeHandler);

    let fulfilled: any;
    const canonicalUrl = "https://candidate.example/api/__clerk/v1/client";
    const request = {
      url: () => canonicalUrl,
      allHeaders: async () => ({ accept: "application/json" }),
    };
    const route = {
      request: () => request,
      fetch: async ({ url, headers }: { url: string; headers: Record<string, string> }) => {
        const { statusCode, body } = await new Promise<{
          statusCode: number;
          body: unknown;
        }>((resolvePromise, reject) => {
          const outgoing = http.request(url, { headers }, (response) => {
            let raw = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              raw += chunk;
            });
            response.on("end", () => {
              resolvePromise({
                statusCode: response.statusCode ?? 500,
                body: JSON.parse(raw),
              });
            });
          });
          outgoing.on("error", reject);
          outgoing.end();
        });
        return {
          status: () => statusCode,
          json: async () => body,
        };
      },
      fulfill: async (options: any) => {
        fulfilled = options;
      },
    };
    await routeHandler(route, request);

    assert.equal(received?.host, "candidate.example");
    assert.equal(received?.forwardedHost, "candidate.example");
    assert.equal(received?.forwardedProto, "https");
    const receivedUrl = new URL(received?.url ?? "", "http://candidate.example");
    assert.equal(receivedUrl.pathname, "/api/__clerk/v1/client");
    assert.equal(
      receivedUrl.searchParams.get("__clerk_testing_token"),
      "synthetic-testing-token",
    );
    assert.equal(fulfilled.json.client.captcha_bypass, true);
  } finally {
    if (previousToken === undefined) delete process.env.CLERK_TESTING_TOKEN;
    else process.env.CLERK_TESTING_TOKEN = previousToken;
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
});