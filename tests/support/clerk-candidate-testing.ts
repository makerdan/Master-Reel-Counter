import { setupClerkTestingToken } from "@clerk/testing/playwright";
import type { BrowserContext, Page, Route } from "@playwright/test";
import {
  CLERK_FRONTEND_API_HOST,
  CLERK_FRONTEND_API_ORIGIN,
} from "../../shared/clerk-config";

type SetupCandidateTestingTokenOptions = {
  page: Page;
  candidateOrigin: string;
  proxyPath: string;
  localCandidateOrigin?: string;
};

export const CLERK_TESTING_FRONTEND_API_ORIGIN = CLERK_FRONTEND_API_ORIGIN;

type CandidateTransportOptions = {
  context: BrowserContext,
  candidateOrigin: string;
  proxyPath: string;
  sourceOrigin: string;
  sourcePathPrefix: string;
  localCandidateOrigin?: string;
};

function createCandidateTransportContext({
  context,
  candidateOrigin,
  proxyPath,
  sourceOrigin,
  sourcePathPrefix,
  localCandidateOrigin,
}: CandidateTransportOptions): BrowserContext {
  const canonical = new URL(candidateOrigin);
  const source = new URL(sourceOrigin);
  const local = localCandidateOrigin ? new URL(localCandidateOrigin) : canonical;
  if (canonical.protocol !== "https:") {
    throw new Error("Clerk candidate transport must use an explicit HTTPS origin");
  }
  if (!proxyPath.startsWith("/") || proxyPath.endsWith("/")) {
    throw new Error(
      "Clerk candidate proxy path must be an absolute path without a trailing slash",
    );
  }
  if (
    localCandidateOrigin &&
    (local.protocol !== "http:" ||
      local.hostname !== "127.0.0.1" ||
      !local.port)
  ) {
    throw new Error("Local Clerk candidate transport must be an explicit HTTP loopback origin");
  }

  return {
    route: async (matcher: Parameters<BrowserContext["route"]>[0], handler: Parameters<BrowserContext["route"]>[1]) => {
      await context.route(matcher, async (route, request) => {
        const localRoute = new Proxy(route, {
          get(target, property) {
            if (property === "fetch") {
              return async (options: Parameters<Route["fetch"]>[0] = {}) => {
                const requested = new URL(options.url ?? request.url());
                if (
                  requested.origin !== source.origin ||
                  !requested.pathname.startsWith(sourcePathPrefix)
                ) {
                  throw new Error(
                    `Refusing to forward unexpected Clerk testing request ${requested.pathname}`,
                  );
                }

                const clerkPath = requested.pathname.slice(sourcePathPrefix.length - 4);
                const forwarded = new URL(
                  `${proxyPath}${clerkPath}${requested.search}`,
                  local,
                );
                return target.fetch({
                  ...options,
                  url: forwarded.href,
                  headers: {
                    ...(await request.allHeaders()),
                    ...options.headers,
                    host: canonical.host,
                    "x-forwarded-host": canonical.host,
                    "x-forwarded-proto": canonical.protocol.slice(0, -1),
                  },
                });
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        await handler(localRoute, request);
      });
    },
  } as unknown as BrowserContext;
}

export async function setupCandidateClerkTestingToken({
  page,
  candidateOrigin,
  proxyPath,
  localCandidateOrigin,
}: SetupCandidateTestingTokenOptions): Promise<void> {
  const candidate = new URL(candidateOrigin);
  const transports = [
    {
      frontendApiUrl: `${candidate.host}${proxyPath}`,
      sourceOrigin: candidate.origin,
      sourcePathPrefix: `${proxyPath}/v1/`,
    },
    {
      frontendApiUrl: CLERK_FRONTEND_API_HOST,
      sourceOrigin: CLERK_TESTING_FRONTEND_API_ORIGIN,
      sourcePathPrefix: "/v1/",
    },
  ];

  for (const transport of transports) {
    const context = createCandidateTransportContext({
      context: page.context(),
      candidateOrigin: candidate.origin,
      proxyPath,
      sourceOrigin: transport.sourceOrigin,
      sourcePathPrefix: transport.sourcePathPrefix,
      localCandidateOrigin,
    });
    await setupClerkTestingToken({
      context,
      options: { frontendApiUrl: transport.frontendApiUrl },
    });
  }
}