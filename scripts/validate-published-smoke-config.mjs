import { parsePublishableKey } from "@clerk/shared/keys";
import {
  validateProductionBaseUrl,
  validateProductionDeploymentId,
} from "./validate-production-base-url.mjs";

const requiredEnvironment = [
  "PRODUCTION_BASE_URL",
  "PRODUCTION_DEPLOYMENT_ID",
  "RELEASE_PUBLISHED_SMOKE_TARGET",
  "RELEASE_PUBLISHED_SMOKE_MODE",
  "CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
];

export const FORBIDDEN_PUBLISHED_SMOKE_INPUTS = Object.freeze([
  "DATABASE_URL",
  "RELEASE_SMOKE_DATABASE_URL",
  "RELEASE_PUBLICATION_DATABASE_URL",
  "RELEASE_PUBLISHED_SMOKE_DATABASE_URL",
  "RELEASE_SMOKE_INTERNAL_CANDIDATE",
  "RELEASE_SMOKE_CANDIDATE_HOST",
  "RELEASE_SMOKE_CANDIDATE_TLS_PORT",
  "RELEASE_SMOKE_CANDIDATE_APP_ORIGIN",
  "RELEASE_SMOKE_CANDIDATE_ID",
  "CLERK_SECRET_KEY",
]);

function requirePublishableKey(value, fieldName) {
  let parsed;
  try {
    parsed = parsePublishableKey(value);
  } catch {
    parsed = null;
  }
  if (!parsed?.frontendApi) {
    throw new Error(`Clerk configuration field ${fieldName} is malformed`);
  }
  return parsed;
}

export function validatePublishedSmokeConfiguration(environment = process.env) {
  const missing = requiredEnvironment.filter(
    (name) => typeof environment[name] !== "string" || !environment[name].trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Published read-only Clerk verification is missing required environment variables: ${missing.join(", ")}`,
    );
  }

  const publishedTarget = validateProductionBaseUrl(
    environment.PRODUCTION_BASE_URL,
  );
  const expectedDeploymentId = validateProductionDeploymentId(
    environment.PRODUCTION_DEPLOYMENT_ID,
  );
  const smokeTarget = validateProductionBaseUrl(
    environment.RELEASE_PUBLISHED_SMOKE_TARGET,
  );
  if (
    smokeTarget.origin !== publishedTarget.origin ||
    smokeTarget.pathname !== "/"
  ) {
    throw new Error(
      "RELEASE_PUBLISHED_SMOKE_TARGET must match PRODUCTION_BASE_URL exactly; refusing an ambiguous published smoke pairing.",
    );
  }
  if (environment.RELEASE_PUBLISHED_SMOKE_MODE !== "read-only") {
    throw new Error(
      "RELEASE_PUBLISHED_SMOKE_MODE must be read-only; published verification cannot use a fixture-writing smoke mode.",
    );
  }

  const serverKey = requirePublishableKey(
    environment.CLERK_PUBLISHABLE_KEY,
    "CLERK_PUBLISHABLE_KEY",
  );
  const clientKey = requirePublishableKey(
    environment.VITE_CLERK_PUBLISHABLE_KEY,
    "VITE_CLERK_PUBLISHABLE_KEY",
  );
  if (serverKey.frontendApi !== clientKey.frontendApi) {
    throw new Error(
      "Clerk configuration fields CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY select different tenants",
    );
  }

  const suppliedForbiddenInputs = FORBIDDEN_PUBLISHED_SMOKE_INPUTS.filter(
    (name) => environment[name],
  );
  if (suppliedForbiddenInputs.length > 0) {
    throw new Error(
      `Published read-only verification refuses database, Clerk-secret, or internal-candidate inputs: ${suppliedForbiddenInputs.join(", ")}`,
    );
  }

  return { publishedTarget, expectedDeploymentId };
}