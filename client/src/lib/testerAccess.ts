export function buildTesterLoginUrl(origin: string, ownerUserId: string): string {
  const url = new URL("/tester-login", origin);
  url.searchParams.set("owner", ownerUserId);
  return url.toString();
}

export function getTesterOwnerFromSearch(search: string): string {
  try {
    return new URLSearchParams(search).get("owner")?.trim() ?? "";
  } catch {
    return "";
  }
}