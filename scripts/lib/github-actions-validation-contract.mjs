/**
 * PostgreSQL compatibility contract for the GitHub Actions validation harness.
 *
 * Keep this value aligned with the service image in
 * .github/workflows/validation.yml. The workflow contract test intentionally
 * fails when the image drifts from this supported test-harness version.
 */
export const SUPPORTED_POSTGRES_MAJOR_VERSION = 16;
export const SUPPORTED_POSTGRES_IMAGE = `postgres:${SUPPORTED_POSTGRES_MAJOR_VERSION}`;

export function postgresMajorVersion(serverVersionNum) {
  const numericVersion = Number(serverVersionNum);
  if (!Number.isInteger(numericVersion) || numericVersion < 10_000) {
    throw new Error(`invalid PostgreSQL server_version_num: ${serverVersionNum}`);
  }
  return Math.floor(numericVersion / 10_000);
}