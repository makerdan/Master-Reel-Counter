import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  CLERK_PROXY_TARGET,
  CLERK_PROXY_PATH as PRODUCTION_CLERK_PROXY_PATH,
  createClerkProxyMiddleware,
} from "../../server/middlewares/clerkProxyMiddleware";
import {
  CLERK_TESTING_FRONTEND_API_ORIGIN,
  setupCandidateClerkTestingToken,
} from "../../tests/support/clerk-candidate-testing";
import { CLERK_PROXY_PATH } from "../../shared/clerk-config";

test("production proxy and release testing transport share the trusted Clerk origin", () => {
  assert.equal(CLERK_PROXY_TARGET, CLERK_TESTING_FRONTEND_API_ORIGIN);
});

test("production proxy and release testing transport share the canonical proxy path", () => {
  assert.equal(PRODUCTION_CLERK_PROXY_PATH, CLERK_PROXY_PATH);
});

test("controlled upstream contract verifies Clerk path, headers, response, and streaming", async () => {
  const previousSecret = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = "synthetic-proxy-secret";
  let upstreamChunksSent = 0;
  let received: {
    url?: string;
    host?: string;
    proxyUrl?: string;
    forwardedFor?: string;
    secret?: string;
  } = {};

  const upstream = http.createServer((request, response) => {
    received = {
      url: request.url,
      host: request.headers.host,
      proxyUrl: request.headers["clerk-proxy-url"] as string | undefined,
      forwardedFor: request.headers["x-forwarded-for"] as string | undefined,
      secret: request.headers["clerk-secret-key"] as string | undefined,
    };
    response.writeHead(206, {
      "content-type": "application/octet-stream",
      "x-clerk-contract": "streamed",
    });
    upstreamChunksSent++;
    response.write("stream-first");
    setTimeout(() => {
      upstreamChunksSent++;
      response.end("stream-second");
    }, 25);
  });
  await new Promise<void>((resolvePromise) =>
    upstream.listen(0, "127.0.0.1", resolvePromise),
  );
  const upstreamAddress = upstream.address();
  assert(upstreamAddress && typeof upstreamAddress === "object");

  const proxyMiddleware = createClerkProxyMiddleware({
    target: `http://127.0.0.1:${upstreamAddress.port}`,
    connectTimeoutMs: 200,
    responseTimeoutMs: 500,
  });
  const proxy = http.createServer((request, response) => {
    proxyMiddleware(request as any, response as any, () => {
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise<void>((resolvePromise) =>
    proxy.listen(0, "127.0.0.1", resolvePromise),
  );
  const proxyAddress = proxy.address();
  assert(proxyAddress && typeof proxyAddress === "object");

  try {
    const response = await new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
      body: string;
    }>((resolvePromise, reject) => {
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port: proxyAddress.port,
          path: `${CLERK_PROXY_PATH}/v1/client?safe_query=present`,
          method: "GET",
          headers: {
            host: "candidate.example",
            "x-forwarded-host": "candidate.example",
            "x-forwarded-proto": "https",
            "x-forwarded-for": "203.0.113.8, 198.51.100.4",
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          incoming.on("end", () =>
            resolvePromise({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
          incoming.once("error", reject);
        },
      );
      request.once("error", reject);
      request.end();
    });

    assert.equal(received.url, "/v1/client?safe_query=present");
    assert.equal(received.proxyUrl, `https://candidate.example${CLERK_PROXY_PATH}`);
    assert.equal(received.forwardedFor, "203.0.113.8");
    assert.equal(received.secret, "synthetic-proxy-secret");
    assert.match(received.host ?? "", /^127\.0\.0\.1:/);
    assert.equal(response.status, 206);
    assert.equal(response.headers["content-type"], "application/octet-stream");
    assert.equal(response.headers["x-clerk-contract"], "streamed");
    assert.equal(response.headers["content-length"], "25");
    assert.equal(response.body, "stream-firststream-second");
    assert.equal(upstreamChunksSent, 2);
  } finally {
    if (previousSecret === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = previousSecret;
    await new Promise<void>((resolvePromise) => proxy.close(() => resolvePromise()));
    await new Promise<void>((resolvePromise) => upstream.close(() => resolvePromise()));
  }
});

test("testing-token transport covers the Clerk sign-in and client-trust sequence through the canonical candidate", async () => {
  const received: Array<{
    method?: string;
    host?: string;
    forwardedHost?: string;
    forwardedProto?: string;
    url?: string;
  }> = [];
  const server = http.createServer((request, response) => {
    received.push({
      method: request.method,
      host: request.headers.host,
      forwardedHost: request.headers["x-forwarded-host"] as string | undefined,
      forwardedProto: request.headers["x-forwarded-proto"] as string | undefined,
      url: request.url,
    });
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        client: { captcha_bypass: false },
        response: { captcha_bypass: false },
      }),
    );
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  assert(address && typeof address === "object");

  const routeRegistrations: Array<{
    matcher: RegExp;
    handler: (route: any, request: any) => Promise<void>;
  }> = [];
  const browserContext = {
    async route(
      matcher: RegExp,
      handler: (route: any, request: any) => Promise<void>,
    ) {
      routeRegistrations.push({ matcher, handler });
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
      localCandidateOrigin: `http://127.0.0.1:${address.port}`,
    });
    assert.equal(routeRegistrations.length, 2);

    const requestSequence = [
      {
        method: "POST",
        sourceUrl: `${CLERK_TESTING_FRONTEND_API_ORIGIN}/v1/client/handshake`,
        candidatePath: `${CLERK_PROXY_PATH}/v1/client/handshake`,
      },
      {
        method: "GET",
        sourceUrl: `https://candidate.example${CLERK_PROXY_PATH}/v1/client`,
        candidatePath: `${CLERK_PROXY_PATH}/v1/client`,
      },
      {
        method: "POST",
        sourceUrl: `https://candidate.example${CLERK_PROXY_PATH}/v1/client/sign_ins`,
        candidatePath: `${CLERK_PROXY_PATH}/v1/client/sign_ins`,
      },
      {
        method: "POST",
        sourceUrl:
          `https://candidate.example${CLERK_PROXY_PATH}/v1/client/sign_ins/sia_test/attempt_first_factor`,
        candidatePath: `${CLERK_PROXY_PATH}/v1/client/sign_ins/sia_test/attempt_first_factor`,
      },
      {
        method: "POST",
        sourceUrl:
          `https://candidate.example${CLERK_PROXY_PATH}/v1/client/sign_ins/sia_test/prepare_verification`,
        candidatePath: `${CLERK_PROXY_PATH}/v1/client/sign_ins/sia_test/prepare_verification`,
      },
      {
        method: "POST",
        sourceUrl:
          `https://candidate.example${CLERK_PROXY_PATH}/v1/client/sign_ins/sia_test/attempt_verification`,
        candidatePath: `${CLERK_PROXY_PATH}/v1/client/sign_ins/sia_test/attempt_verification`,
      },
      {
        method: "POST",
        sourceUrl:
          `https://candidate.example${CLERK_PROXY_PATH}/v1/client/sessions/sess_test/touch`,
        candidatePath: `${CLERK_PROXY_PATH}/v1/client/sessions/sess_test/touch`,
      },
      {
        method: "DELETE",
        sourceUrl:
          `https://candidate.example${CLERK_PROXY_PATH}/v1/client/sessions/sess_test`,
        candidatePath: `${CLERK_PROXY_PATH}/v1/client/sessions/sess_test`,
      },
    ] as const;
    const fulfilled: any[] = [];

    for (const requestStep of requestSequence) {
      const registration = routeRegistrations.find(({ matcher }) =>
        matcher.test(requestStep.sourceUrl),
      );
      assert(registration, `No testing-token route matched ${requestStep.sourceUrl}`);
      const request = {
        url: () => requestStep.sourceUrl,
        method: () => requestStep.method,
        allHeaders: async () => ({
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        }),
      };
      const route = {
        request: () => request,
        fetch: async ({
          url,
          headers,
        }: {
          url: string;
          headers: Record<string, string>;
        }) => {
          const { statusCode, body } = await new Promise<{
            statusCode: number;
            body: unknown;
          }>((resolvePromise, reject) => {
            const outgoing = http.request(
              url,
              { headers, method: requestStep.method },
              (response) => {
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
              },
            );
            outgoing.on("error", reject);
            outgoing.end();
          });
          return {
            status: () => statusCode,
            json: async () => body,
          };
        },
        fulfill: async (options: any) => {
          fulfilled.push(options);
        },
      };
      await registration.handler(route, request);
    }

    assert.equal(received.length, requestSequence.length);
    for (const [index, requestStep] of requestSequence.entries()) {
      const actual = received[index];
      assert.equal(actual.method, requestStep.method);
      assert.equal(actual.host, "candidate.example");
      assert.equal(actual.forwardedHost, "candidate.example");
      assert.equal(actual.forwardedProto, "https");
      const receivedUrl = new URL(actual.url ?? "", "http://candidate.example");
      assert.equal(receivedUrl.pathname, requestStep.candidatePath);
      assert.equal(
        receivedUrl.searchParams.get("__clerk_testing_token"),
        "synthetic-testing-token",
      );
    }
    assert.equal(fulfilled.length, requestSequence.length);
    for (const response of fulfilled) {
      assert.equal(response.json.client.captcha_bypass, true);
      assert.equal(response.json.response.captcha_bypass, true);
    }

    const rejectedRequests = [
      `https://attacker.example${CLERK_PROXY_PATH}/v1/client`,
      "https://candidate.example/not-clerk/v1/client",
      `https://candidate.example${CLERK_PROXY_PATH}/v2/client`,
    ];
    for (const url of rejectedRequests) {
      assert.equal(
        routeRegistrations.some(({ matcher }) => matcher.test(url)),
        false,
      );
    }
  } finally {
    if (previousToken === undefined) delete process.env.CLERK_TESTING_TOKEN;
    else process.env.CLERK_TESTING_TOKEN = previousToken;
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
});