import {
  test as base,
  expect,
  type APIRequestContext,
} from "@playwright/test";

export const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";

const cleanupIdsByRequest = new WeakMap<APIRequestContext, number[]>();

export async function createSessionViaApi(
  request: APIRequestContext,
  name?: string,
): Promise<{ id: number; name: string }> {
  const sessionName = name ?? `E2E Session ${Date.now()}`;
  const res = await request.post("/api/sessions", {
    data: { name: sessionName, location: null },
  });
  if (!res.ok())
    throw new Error(`createSession failed: ${res.status()} ${await res.text()}`);
  const session = (await res.json()) as { id: number; name: string };
  cleanupIdsByRequest.get(request)?.push(session.id);
  return session;
}

export async function createEntryViaApi(
  request: APIRequestContext,
  sessionId: number,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number }> {
  const res = await request.post(`/api/sessions/${sessionId}/entries`, {
    data: {
      aisle: "A",
      section: "1",
      category: "TEST-14",
      footage: 500,
      manufacturer: "ACME",
      reelCount: 1,
      notes: "",
      ...overrides,
    },
  });
  if (!res.ok())
    throw new Error(`createEntry failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function uploadTestPhoto(
  request: APIRequestContext,
  sessionId: number,
): Promise<{ id: number } | null> {
  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const res = await request.post(`/api/sessions/${sessionId}/photos`, {
    multipart: {
      photo: { name: "test.png", mimeType: "image/png", buffer: pngBuffer },
      aisle: "A",
      section: "1",
      notes: "",
      isReceiving: "false",
      isOnFloor: "false",
    },
  });
  if (!res.ok()) return null;
  return res.json();
}

type E2EFixtures = {
  cleanupIds: number[];
  sessionId: number;
};

export const test = base.extend<E2EFixtures>({
  cleanupIds: [
    async ({ request }, use) => {
      const ids: number[] = [];
      cleanupIdsByRequest.set(request, ids);
      try {
        await use(ids);
      } finally {
        cleanupIdsByRequest.delete(request);
        const failures: string[] = [];
        for (const id of new Set(ids)) {
          try {
            const response = await request.delete(`/api/sessions/${id}/permanent`);
            if (response.status() !== 200 && response.status() !== 404) {
              failures.push(`${id}: HTTP ${response.status()} ${await response.text()}`);
            }
          } catch (error) {
            failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (failures.length > 0) {
          throw new Error(`Failed to permanently clean up E2E sessions:\n${failures.join("\n")}`);
        }
      }
    },
    { auto: true },
  ],
  sessionId: async ({ request }, use) => {
    const sess = await createSessionViaApi(request);
    await use(sess.id);
  },
});

export { expect };
