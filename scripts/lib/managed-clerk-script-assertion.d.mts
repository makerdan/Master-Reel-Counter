export interface ClerkScriptBootTracker {
  recordDocument(path: string): void;
  recordScript(url: string, status: number, contentType: string): void;
  assertValid(): void;
  diagnostic(): {
    unassignedScriptCount: number;
    boots: Array<{
      document: string;
      scripts: Array<{
        path: string;
        candidateOrigin: boolean;
        expectedPath: boolean;
        status: number;
        javascript: boolean;
      }>;
      scriptCount: number;
      boot: number;
    }>;
  };
}

export function createClerkScriptBootTracker(
  candidateOrigin: string,
  proxyPath: string,
): ClerkScriptBootTracker;