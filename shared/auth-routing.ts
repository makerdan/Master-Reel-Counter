const SAFE_RETURN_PATHS = [
  /^\/session\/[A-Za-z0-9_-]+$/,
  /^\/join\/[A-Za-z0-9_-]+$/,
  /^\/settings$/,
  /^\/stats$/,
  /^\/help$/,
];

/**
 * Return paths are intentionally allow-listed rather than accepting any
 * same-origin-looking URL. This keeps invite tokens and protected routes
 * inside the app while rejecting external, protocol-relative, and malformed
 * destinations.
 */
export function getSafeReturnPath(rawPath: string | null | undefined): string | null {
  if (!rawPath || rawPath.length > 2048 || !rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return null;
  }
  if (/[\u0000-\u001f\\]/.test(rawPath)) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawPath, "https://master-reel-counter.invalid");
  } catch {
    return null;
  }

  const path = parsed.pathname;
  if (!SAFE_RETURN_PATHS.some((pattern) => pattern.test(path))) return null;
  return `${path}${parsed.search}${parsed.hash}`;
}

export function getReturnPathFromSearch(search: string): string | null {
  try {
    return getSafeReturnPath(new URLSearchParams(search).get("redirect_url"));
  } catch {
    return null;
  }
}

export function buildSignInPath(returnPath: string | null | undefined, basePath = ""): string {
  const safePath = getSafeReturnPath(returnPath);
  const signInPath = `${basePath}/sign-in`;
  return safePath
    ? `${signInPath}?redirect_url=${encodeURIComponent(safePath)}`
    : signInPath;
}