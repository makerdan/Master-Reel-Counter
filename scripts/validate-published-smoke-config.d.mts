export const FORBIDDEN_PUBLISHED_SMOKE_INPUTS: readonly string[];

export function validatePublishedSmokeConfiguration(
  environment?: NodeJS.ProcessEnv,
): {
  publishedTarget: URL;
  expectedDeploymentId: string;
};