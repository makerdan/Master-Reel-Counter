export function getBrowserProjectCoverage(
  env?: NodeJS.ProcessEnv,
): {
  projects: string[];
  webkitEnabled: boolean;
};

export function formatBrowserProjectCoverage(
  env?: NodeJS.ProcessEnv,
): string;