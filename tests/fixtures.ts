import {
  test as base,
  expect,
  type APIRequestContext,
} from "@playwright/test";
import sharp from "sharp";

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

export type OrientedJpegFixture = {
  name: string;
  buffer: Buffer;
  sourceWidth: number;
  sourceHeight: number;
  preparedWidth: number;
  preparedHeight: number;
  expectedCorners: readonly OrientedJpegCornerColor[];
};

export type OrientedJpegCornerColor = "red" | "green" | "blue" | "yellow";

export const orientedJpegFixtureCases = [
  {
    name: "mirrored-horizontal-exif-2.jpg",
    sourceWidth: 40,
    sourceHeight: 24,
    orientation: 2,
    expectedCorners: ["green", "red", "yellow", "blue"],
  },
  {
    name: "mirrored-vertical-exif-4.jpg",
    sourceWidth: 40,
    sourceHeight: 24,
    orientation: 4,
    expectedCorners: ["blue", "yellow", "red", "green"],
  },
  {
    name: "mirrored-90-transpose-exif-5.jpg",
    sourceWidth: 40,
    sourceHeight: 24,
    orientation: 5,
    expectedCorners: ["red", "blue", "green", "yellow"],
  },
  {
    name: "portrait-exif-6.jpg",
    sourceWidth: 40,
    sourceHeight: 24,
    orientation: 6,
    expectedCorners: ["blue", "red", "yellow", "green"],
  },
  {
    name: "mirrored-90-transverse-exif-7.jpg",
    sourceWidth: 40,
    sourceHeight: 24,
    orientation: 7,
    expectedCorners: ["yellow", "green", "blue", "red"],
  },
  {
    name: "landscape-exif-8.jpg",
    sourceWidth: 24,
    sourceHeight: 40,
    orientation: 8,
    expectedCorners: ["green", "yellow", "red", "blue"],
  },
] satisfies ReadonlyArray<{
  name: string;
  sourceWidth: number;
  sourceHeight: number;
  orientation: 2 | 4 | 5 | 6 | 7 | 8;
  expectedCorners: readonly OrientedJpegCornerColor[];
}>;

export async function createOrientedJpegFixture(
  fixtureCase: (typeof orientedJpegFixtureCases)[number],
): Promise<OrientedJpegFixture> {
  const {
    name,
    sourceWidth,
    sourceHeight,
    orientation,
    expectedCorners,
  } = fixtureCase;
  const swapsDimensions = orientation >= 5;
  const svg = Buffer.from(`
    <svg width="${sourceWidth}" height="${sourceHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${sourceWidth / 2}" height="${sourceHeight / 2}" x="0" y="0" fill="#ff0000"/>
      <rect width="${sourceWidth / 2}" height="${sourceHeight / 2}" x="${sourceWidth / 2}" y="0" fill="#00ff00"/>
      <rect width="${sourceWidth / 2}" height="${sourceHeight / 2}" x="0" y="${sourceHeight / 2}" fill="#0000ff"/>
      <rect width="${sourceWidth / 2}" height="${sourceHeight / 2}" x="${sourceWidth / 2}" y="${sourceHeight / 2}" fill="#ffff00"/>
    </svg>
  `);
  const buffer = await sharp(svg)
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .withMetadata({ orientation })
    .toBuffer();

  return {
    name,
    buffer,
    sourceWidth,
    sourceHeight,
    preparedWidth: swapsDimensions ? sourceHeight : sourceWidth,
    preparedHeight: swapsDimensions ? sourceWidth : sourceHeight,
    expectedCorners,
  };
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
