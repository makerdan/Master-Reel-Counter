/**
 * Code-owned integration boundary, deliberately UNCONFIGURED.
 * A host application must adapt this module against verified authoritative
 * sources, under applicable approval, and test the real checked route.
 *
 * Host owns attestRuntime({binding, developmentRecord?, deadlineAt, abortSignal}).
 * The project's authorized reclaim provider owns beginReclaim({operationId, operation, manifest, binding,
 *   requestedScope, scopeDigest, attestation, deadlineAt, abortSignal}).
 * beginReclaim must atomically verify and claim a one-operation grant and return:
 * {protocolVersion:1, authorizationId, operationId, scopeDigest, attestationId, expiresAt,
 *  runBinding, checkBeforeSignal(request), recordOutcome(request)}.
 * Only the same claimed operation may perform its approved escalation.
 * Callbacks revalidate authority and durably journal intent/outcome, respectively.
 *
 * See reference/runtime-contract.md. Never implement these by trusting local
 * reference strings, booleans, environment variables or caller-written records.
 * No dynamic verifier path, executable or unsigned fixture fallback is allowed.
 * These hooks do NOT create an approval/attestation source.
 * Failure Gate Unified alone supplies neither reclaim capability nor permission.
 * The FAILURE_GATE_AUTHORIZATION_UNAVAILABLE error identifier is retained for
 * adapter compatibility; it does not require a Failure Gate provider.
 */
export async function attestRuntime() {
  throw new Error("HOST_ATTESTATION_UNAVAILABLE: verified host attestation adapter not configured");
}
export async function beginReclaim() {
  throw new Error("FAILURE_GATE_AUTHORIZATION_UNAVAILABLE: checked reclaim adapter not configured");
}