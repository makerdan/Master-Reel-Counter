import assert from "node:assert/strict";
import test from "node:test";
import { buildPublishableKey, parsePublishableKey } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  resolveClerkBootstrapConfig,
  resolveClerkEnvironmentPublishableKey,
  resolveClerkRequestPublishableKey,
} from "../../shared/clerk-config";

const tenantHost = "steady-otter-12.clerk.accounts.dev";
const configuredKey = buildPublishableKey(tenantHost);

test("direct preview uses the configured tenant instead of deriving from preview host", () => {
  const config = resolveClerkBootstrapConfig({
    publishableKey: configuredKey,
    runtimeHostname: "picard.replit.dev",
  });
  assert.equal(config.transport, "direct");
  assert.equal(config.publishableKey, configuredKey);
  assert.equal(config.frontendApiHost, tenantHost);
  assert.equal(config.proxyUrl, undefined);
});

test("production proxy keeps the configured tenant behind the exact bounded path", () => {
  const config = resolveClerkBootstrapConfig({
    publishableKey: configuredKey,
    proxyUrl: CLERK_PROXY_PATH,
    runtimeHostname: "master-reel-counter-ai.replit.app",
  });
  assert.equal(config.transport, "proxy");
  assert.equal(config.proxyUrl, CLERK_PROXY_PATH);
  assert.equal(parsePublishableKey(config.publishableKey)?.frontendApi, tenantHost);
  assert.equal(config.frontendApiHost, "master-reel-counter-ai.replit.app");
});

test("bootstrap reports missing and malformed fields without values", () => {
  assert.throws(
    () =>
      resolveClerkBootstrapConfig({
        runtimeHostname: "picard.replit.dev",
      }),
    /VITE_CLERK_PUBLISHABLE_KEY is missing/,
  );
  assert.throws(
    () =>
      resolveClerkBootstrapConfig({
        publishableKey: "invalid-secret-like-value",
        runtimeHostname: "picard.replit.dev",
      }),
    /VITE_CLERK_PUBLISHABLE_KEY is malformed/,
  );
  assert.throws(
    () =>
      resolveClerkBootstrapConfig({
        publishableKey: configuredKey,
        proxyUrl: "https://untrusted.example/api/__clerk",
        runtimeHostname: "picard.replit.dev",
      }),
    /VITE_CLERK_PROXY_URL must be \/api\/__clerk/,
  );
  for (const proxyUrl of ["/", "/wrong-path", "//untrusted.example/api/__clerk"]) {
    assert.throws(
      () =>
        resolveClerkBootstrapConfig({
          publishableKey: configuredKey,
          proxyUrl,
          runtimeHostname: "picard.replit.dev",
        }),
      /VITE_CLERK_PROXY_URL must be \/api\/__clerk/,
    );
  }
});

test("server direct and proxy modes use the same environment contract", () => {
  assert.throws(
    () =>
      resolveClerkEnvironmentPublishableKey({
        clientPublishableKey: configuredKey,
      }),
    /CLERK_PUBLISHABLE_KEY is missing/,
  );
  assert.throws(
    () =>
      resolveClerkEnvironmentPublishableKey({
        serverPublishableKey: "malformed-server-key",
        clientPublishableKey: configuredKey,
      }),
    /CLERK_PUBLISHABLE_KEY is malformed/,
  );
  assert.throws(
    () =>
      resolveClerkEnvironmentPublishableKey({
        serverPublishableKey: configuredKey,
      }),
    /VITE_CLERK_PUBLISHABLE_KEY is missing/,
  );
  assert.throws(
    () =>
      resolveClerkEnvironmentPublishableKey({
        serverPublishableKey: configuredKey,
        clientPublishableKey: "malformed-client-key",
      }),
    /VITE_CLERK_PUBLISHABLE_KEY is malformed/,
  );
  assert.equal(
    resolveClerkEnvironmentPublishableKey({
      serverPublishableKey: configuredKey,
      clientPublishableKey: configuredKey,
    }),
    configuredKey,
  );
  assert.throws(
    () =>
      resolveClerkEnvironmentPublishableKey({
        clientPublishableKey: configuredKey,
      }),
    /CLERK_PUBLISHABLE_KEY is missing/,
  );
  assert.throws(
    () =>
      resolveClerkEnvironmentPublishableKey({
        serverPublishableKey: configuredKey,
        clientPublishableKey: buildPublishableKey(
          "different-tenant.clerk.accounts.dev",
        ),
      }),
    /CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY select different tenants/,
  );
  assert.equal(
    resolveClerkRequestPublishableKey({
      publishableKey: configuredKey,
      requestHost: "localhost:5000",
      proxyEnabled: false,
    }),
    configuredKey,
  );
  assert.equal(
    resolveClerkRequestPublishableKey({
      publishableKey: configuredKey,
      requestHost: "master-reel-counter-ai.replit.app",
      proxyEnabled: true,
    }),
    configuredKey,
  );
});