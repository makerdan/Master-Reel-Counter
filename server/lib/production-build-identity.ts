/**
 * script/build.ts replaces this environment reference with the release identity
 * at bundle time. Runtime environment changes cannot alter the built identity.
 */
export const productionBuildId =
  process.env.PRODUCTION_DEPLOYMENT_ID?.trim() || undefined;