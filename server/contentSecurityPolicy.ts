const CLERK_FAPI_ORIGIN = "https://frontend-api.clerk.dev";
const CLERK_INSTANCE_ORIGIN = "https://*.clerk.accounts.dev";
const CLOUDFLARE_CHALLENGE_ORIGIN = "https://challenges.cloudflare.com";
const CLERK_PROTECTION_ORIGIN = "https://*.protect.clerk.com";

const CLERK_SCRIPT_SOURCES = [
  CLERK_FAPI_ORIGIN,
  CLERK_INSTANCE_ORIGIN,
  CLOUDFLARE_CHALLENGE_ORIGIN,
  CLERK_PROTECTION_ORIGIN,
];

/**
 * Keep the production script allow-list explicit. The app uses a same-origin
 * Clerk proxy, while Clerk's client and protection flow still require these
 * documented upstream origins. Vite's eval-based development client is the
 * only additional script allowance retained outside production.
 */
export function createContentSecurityPolicyDirectives(isProduction = process.env.NODE_ENV === "production") {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      ...(isProduction ? [] : ["'unsafe-inline'", "'unsafe-eval'"]),
      ...CLERK_SCRIPT_SOURCES,
    ],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    imgSrc: ["'self'", "data:", "blob:", "https:"],
    connectSrc: ["'self'", "wss:", "ws:", "https:"],
    fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'", "blob:"],
    workerSrc: ["'self'", "blob:"],
    frameSrc: ["'self'", "https://challenges.cloudflare.com", "https:"],
  };
}