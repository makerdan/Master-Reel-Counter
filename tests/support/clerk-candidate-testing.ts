import { setupClerkTestingToken } from "@clerk/testing/playwright";
import type { BrowserContext, Page, Route } from "@playwright/test";

type SetupCandidateTestingTokenOptions = {
  page: Page;
  candidateOrigin: string;
  proxyPath: string;
  localCandidateOrigin?: string;
};

function createLocalCandidateContext(
  context: BrowserContext,
  candidateOrigin: string,
  localCandidateOrigin: string,
  proxyPath: string,
): BrowserContext {
  const canonical = new URL(candidateOrigin);
  const local = new URL(localCandidateOrigin);
  if (
    local.protocol !== "http:" ||
    local.hostname !== "127.0.0.1" ||
    !local.port
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
                  requested.origin !== canonical.origin ||
                  !requested.pathname.startsWith(`${proxyPath}/v1/`)
                ) {
                  throw new Error(
                    `Refusing to forward unexpected Clerk testing request ${requested.pathname}`,
                  );
                }

                const forwarded = new URL(`${requested.pathname}${requested.search}`, local);
                return target.fetch({
                  ...options,
                  url: forwarded.href,
                  headers: {
                    ...(await request.allHeaders()),
                    ...options.headers,
                    host: canonical.host,
                    "x-forwarded-host": canonical.host,
                    "x-forwarded-proto": "https",
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
  const frontendApiUrl = `${candidate.host}${proxyPath}`;

  if (!localCandidateOrigin) {
    await setupClerkTestingToken({
      page,
      options: { frontendApiUrl },
    });
    return;
  }

  const context = createLocalCandidateContext(
    page.context(),
    candidate.origin,
    localCandidateOrigin,
    proxyPath,
  );
  await setupClerkTestingToken({
    context,
    options: { frontendApiUrl },
  });
}