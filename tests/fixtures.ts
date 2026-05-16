import {
  test as base,
  expect,
  type APIRequestContext,
} from "@playwright/test";

export const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";

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
  return res.json();
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
      await use(ids);
      for (const id of ids) {
        await request.delete(`/api/sessions/${id}`).catch(() => {});
      }
    },
    { auto: false },
  ],
  sessionId: async ({ request, cleanupIds }, use) => {
    const sess = await createSessionViaApi(request);
    cleanupIds.push(sess.id);
    await use(sess.id);
  },
});

export { expect };
