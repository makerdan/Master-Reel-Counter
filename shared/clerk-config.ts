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