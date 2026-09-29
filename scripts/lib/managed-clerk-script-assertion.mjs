/**
 * Group Clerk script responses by completed main-document loads, rather than
 * by the lifetime of a Playwright Page (which can contain several full loads).
 */
export function createClerkScriptBootTracker(candidateOrigin, proxyPath) {
  const boots = [];
  const unassignedScripts = [];
  const expectedPath = new RegExp(
    `^${proxyPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/npm/@clerk/clerk-js@[^/]+/dist/clerk\\.browser\\.js$`,
  );

  function recordDocument(path) {
    const safePath = /^\/[A-Za-z0-9/_\-.~%]*$/.test(path) && path.length <= 160
      ? path
      : "/[REDACTED-INVALID-PATH]";
    boots.push({ path: safePath, scripts: [] });
  }

  function recordScript(url, status, contentType) {
    const parsed = new URL(url);
    const script = {
      path: expectedPath.test(parsed.pathname) ? parsed.pathname : "/[UNEXPECTED-SCRIPT-PATH]",
      candidateOrigin: parsed.origin === candidateOrigin,
      expectedPath: expectedPath.test(parsed.pathname),
      status,
      javascript: /^(?:application|text)\/javascript\b/i.test(contentType),
    };
    (boots.at(-1)?.scripts ?? unassignedScripts).push(script);
  }

  function assertValid() {
    if (boots.length === 0 || unassignedScripts.length > 0) {
      throw new Error("Clerk JavaScript must load during a completed candidate document boot");
    }
    for (const [index, boot] of boots.entries()) {
      if (boot.scripts.length !== 1) {
        throw new Error(`Clerk JavaScript must load once from the exact candidate proxy in document boot ${index + 1} (observed ${boot.scripts.length})`);
      }
      const script = boot.scripts[0];
      if (!script.candidateOrigin || !script.expectedPath || script.status !== 200 || !script.javascript) {
        throw new Error(`Clerk JavaScript must be a 200 JavaScript response from the exact candidate proxy in document boot ${index + 1}`);
      }
    }
  }

  // Diagnostics contain paths only, not query strings, keys, headers or bodies.
  function diagnostic() {
    return { unassignedScriptCount: unassignedScripts.length, boots: boots.slice(-10).map((boot, index) => ({
      document: boot.path,
      scripts: boot.scripts.slice(-4),
      scriptCount: boot.scripts.length,
      boot: boots.length - Math.min(boots.length, 10) + index + 1,
    })) };
  }

  return { recordDocument, recordScript, assertValid, diagnostic };
}