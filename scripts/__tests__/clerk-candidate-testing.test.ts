import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { CLERK_PROXY_TARGET } from "../../server/middlewares/clerkProxyMiddleware";
import {
  CLERK_TESTING_FRONTEND_API_ORIGIN,
  setupCandidateClerkTestingToken,
} from "../../tests/support/clerk-candidate-testing";

test("production proxy and release testing transport share the trusted Clerk origin", () => {
  assert.equal(CLERK_PROXY_TARGET, CLERK_TESTING_FRONTEND_API_ORIGIN);
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
      proxyPath: "/api/__clerk",
      localCandidateOrigin: `http://127.0.0.1:${address.port}`,
    });
    assert.equal(routeRegistrations.length, 2);

    const requestSequence = [
      {
        method: "POST",
        sourceUrl: `${CLERK_TESTING_FRONTEND_API_ORIGIN}/v1/client/handshake`,
        candidatePath: "/api/__clerk/v1/client/handshake",
      },
      {
        method: "GET",
        sourceUrl: "https://candidate.example/api/__clerk/v1/client",
        candidatePath: "/api/__clerk/v1/client",
      },
      {
        method: "POST",
        sourceUrl: "https://candidate.example/api/__clerk/v1/client/sign_ins",
        candidatePath: "/api/__clerk/v1/client/sign_ins",
      },
      {
        method: "POST",
        sourceUrl:
          "https://candidate.example/api/__clerk/v1/client/sign_ins/sia_test/attempt_first_factor",
        candidatePath:
          "/api/__clerk/v1/client/sign_ins/sia_test/attempt_first_factor",
      },
      {
        method: "POST",
        sourceUrl:
          "https://candidate.example/api/__clerk/v1/client/sign_ins/sia_test/prepare_verification",
        candidatePath:
          "/api/__clerk/v1/client/sign_ins/sia_test/prepare_verification",
      },
      {
        method: "POST",
        sourceUrl:
          "https://candidate.example/api/__clerk/v1/client/sign_ins/sia_test/attempt_verification",
        candidatePath:
          "/api/__clerk/v1/client/sign_ins/sia_test/attempt_verification",
      },
      {
        method: "POST",
        sourceUrl:
          "https://candidate.example/api/__clerk/v1/client/sessions/sess_test/touch",
        candidatePath:
          "/api/__clerk/v1/client/sessions/sess_test/touch",
      },
      {
        method: "DELETE",
        sourceUrl:
          "https://candidate.example/api/__clerk/v1/client/sessions/sess_test",
        candidatePath:
          "/api/__clerk/v1/client/sessions/sess_test",
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
      "https://attacker.example/api/__clerk/v1/client",
      "https://candidate.example/not-clerk/v1/client",
      "https://candidate.example/api/__clerk/v2/client",
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