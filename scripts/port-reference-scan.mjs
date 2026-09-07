/**
 * Small, dependency-free guard for executable service references.
 * Environment-driven ports and ephemeral port 0 are valid; fixed bind ports
 * and fixed localhost service URLs are not valid in service/test wrappers.
 */
export function findHardcodedPortReferences(source) {
  const findings = [];
  const patterns = [
    /\blisten\s*\(\s*[1-9]\d{0,4}\b/g,
    /\b(?:localhost|127\.0\.0\.1):[1-9]\d{0,4}\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) findings.push(match[0]);
  }
  return findings;
}