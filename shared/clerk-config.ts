import { parsePublishableKey, publishableKeyFromHost } from "@clerk/shared/keys";

/**
 * Trusted direct Clerk Frontend API configuration.
 *
 * Production proxying and release testing-token transport must use the same
 * origin so a proxy target change cannot silently break release sign-in.
 */
export const CLERK_FRONTEND_API_ORIGIN = "https://frontend-api.clerk.dev";
export const CLERK_FRONTEND_API_HOST = new URL(CLERK_FRONTEND_API_ORIGIN).host;
export const CLERK_PROXY_PATH = "/api/__clerk";
export const CLERK_PROXY_READINESS_PATH = `${CLERK_PROXY_PATH}/healthz`;

export type ClerkBootstrapConfig = {
  publishableKey: string;
  frontendApiHost: string;
  proxyUrl?: string;
  transport: "direct" | "proxy";
};

function requirePublishableKey(
  value: string | undefined,
  fieldName = "VITE_CLERK_PUBLISHABLE_KEY",
) {
  if (!value) {
    throw new Error(`Clerk configuration field ${fieldName} is missing`);
  }
  const parsed = parsePublishableKey(value);
  if (!parsed?.frontendApi) {
    throw new Error(`Clerk configuration field ${fieldName} is malformed`);
  }
  return { value, frontendApiHost: parsed.frontendApi };
}

function normalizeProxyUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\/$/, "");
  if (normalized !== CLERK_PROXY_PATH) {
    throw new Error(
      `Clerk configuration field VITE_CLERK_PROXY_URL must be ${CLERK_PROXY_PATH}`,
    );
  }
  return normalized;
}

export function resolveClerkEnvironmentPublishableKey(input: {
  serverPublishableKey?: string;
  clientPublishableKey?: string;
}): string {
  const server = requirePublishableKey(
    input.serverPublishableKey,
    "CLERK_PUBLISHABLE_KEY",
  );
  const client = requirePublishableKey(
    input.clientPublishableKey,
    "VITE_CLERK_PUBLISHABLE_KEY",
  );
  if (server.frontendApiHost !== client.frontendApiHost) {
    throw new Error(
      "Clerk configuration fields CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY select different tenants",
    );
  }
  return server.value;
}

export function resolveClerkBootstrapConfig(input: {
  publishableKey?: string;
  proxyUrl?: string;
  runtimeHostname: string;
}): ClerkBootstrapConfig {
  const configured = requirePublishableKey(input.publishableKey);
  const proxyUrl = normalizeProxyUrl(input.proxyUrl);
  if (!proxyUrl) {
    return {
      publishableKey: configured.value,
      frontendApiHost: configured.frontendApiHost,
      transport: "direct",
    };
  }
  if (!input.runtimeHostname || input.runtimeHostname.includes(":")) {
    throw new Error("Clerk runtime hostname is invalid for proxy mode");
  }
  return {
    publishableKey: publishableKeyFromHost(
      input.runtimeHostname,
      configured.value,
    ),
    frontendApiHost: input.runtimeHostname,
    proxyUrl,
    transport: "proxy",
  };
}

export function resolveClerkRequestPublishableKey(input: {
  publishableKey?: string;
  requestHost: string;
  proxyEnabled: boolean;
}): string {
  const configured = requirePublishableKey(input.publishableKey);
  if (!input.proxyEnabled) return configured.value;
  const hostname = input.requestHost.replace(/:\d+$/, "");
  if (!hostname) {
    throw new Error("Clerk request host is missing in proxy mode");
  }
  return publishableKeyFromHost(hostname, configured.value);
}