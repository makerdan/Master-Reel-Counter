const BASE_PROJECTS = ["chromium", "mobile-chromium"];

export function getBrowserProjectCoverage(env = process.env) {
  const webkitEnabled =
    env.CI === "true" || env.PLAYWRIGHT_WEBKIT_ENABLED === "true";
  return {
    projects: [
      ...BASE_PROJECTS,
      ...(webkitEnabled ? ["mobile-webkit"] : []),
    ],
    webkitEnabled,
  };
}

export function formatBrowserProjectCoverage(env = process.env) {
  const { projects, webkitEnabled } = getBrowserProjectCoverage(env);
  const matrix = `[browser-coverage] Enabled Playwright projects: ${projects.join(", ")}.`;
  return webkitEnabled
    ? `${matrix} WebKit coverage is included.`
    : `${matrix} mobile-webkit is CI-only unless explicitly enabled; this local heavy run is partial, not full browser-matrix coverage.`;
}