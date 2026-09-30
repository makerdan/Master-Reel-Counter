const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function validateProductionBaseUrl(rawValue = process.env.PRODUCTION_BASE_URL) {
  if (!rawValue?.trim()) {
    throw new Error(
      "PRODUCTION_BASE_URL is required. Refusing to run the managed Clerk release smoke against an implicit target.",
    );
  }

  let target;
  try {
    target = new URL(rawValue);
  } catch {
    throw new Error("PRODUCTION_BASE_URL must be a valid public HTTPS deployment URL.");
  }

  if (
    target.protocol !== "https:" ||
    LOCAL_HOSTNAMES.has(target.hostname) ||
    target.hostname.endsWith(".localhost") ||
    target.hostname.endsWith(".local") ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  ) {
    throw new Error("PRODUCTION_BASE_URL must be a public HTTPS deployment URL.");
  }

  return target;
}

export function validateProductionDeploymentId(
  rawValue = process.env.PRODUCTION_DEPLOYMENT_ID,
) {
  const deploymentId = rawValue?.trim();
  if (!deploymentId) {
    throw new Error(
      "PRODUCTION_DEPLOYMENT_ID is required. Refusing to verify a release without an expected build identity.",
    );
  }
  if (deploymentId.length > 256 || /[\r\n]/.test(deploymentId)) {
    throw new Error("PRODUCTION_DEPLOYMENT_ID must be a bounded single-line value.");
  }
  return deploymentId;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateProductionBaseUrl();
  validateProductionDeploymentId();
  console.log("Published production URL and build identity are configured.");
}