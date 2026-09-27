import {
  test as base,
  expect,
  type APIRequestContext,
} from "@playwright/test";
import sharp from "sharp";
import { createClerkClient } from "@clerk/backend";
import {
  clerk as clerkTesting,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import { parsePublishableKey } from "@clerk/shared/keys";
import { randomUUID } from "node:crypto";
import pg from "pg";

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
): Promise<{ id: number }> {
  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const uploadResponse = await request.post("/api/uploads/direct", {
    multipart: {
      file: { name: "test.png", mimeType: "image/png", buffer: pngBuffer },
    },
  });
  if (!uploadResponse.ok()) {
    throw new Error(
      `uploadTestPhoto direct upload failed: ${uploadResponse.status()} ${await uploadResponse.text()}`,
    );
  }
  const upload = await uploadResponse.json() as { objectPath?: string };
  if (typeof upload.objectPath !== "string" || upload.objectPath.length === 0) {
    throw new Error("uploadTestPhoto direct upload returned no object path");
  }

  const res = await request.post(`/api/sessions/${sessionId}/photos`, {
    data: {
      objectStorageKey: upload.objectPath,
      originalFilename: "test.png",
      mimeType: "image/png",
      fileSize: pngBuffer.byteLength,
      aisle: "A",
      section: "1",
      notes: "",
      isDetailShot: false,
    },
  });
  if (!res.ok()) {
    throw new Error(
      `uploadTestPhoto registration failed: ${res.status()} ${await res.text()}`,
    );
  }
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
  clerkTestingToken: void;
  anonymousRequest: APIRequestContext;
  cleanupIds: number[];
  sessionId: number;
  secondApprovedIdentity: {
    email: string;
  };
};

export const test = base.extend<E2EFixtures>({
  request: async ({ context }, use) => {
    await use(context.request);
  },
  anonymousRequest: async ({ playwright, baseURL }, use) => {
    // The ordinary request fixture shares the browser's saved owner session.
    // Explicitly discard storage state even if the test config gains new defaults.
    if (!baseURL) throw new Error("Anonymous requests require the configured test baseURL");
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const identity = await anonymous.get("/api/auth/user");
      if (identity.status() !== 401) {
        throw new Error(
          `Anonymous request is not anonymous: /api/auth/user returned ${identity.status()}`,
        );
      }
      await use(anonymous);
    } finally {
      await anonymous.dispose();
    }
  },
  clerkTestingToken: [
    async ({ context, page, request }, use) => {
      const frontendApiUrl = parsePublishableKey(
        process.env.VITE_CLERK_PUBLISHABLE_KEY,
      )?.frontendApi;
      if (!frontendApiUrl) {
        throw new Error("Browser tests require a valid VITE_CLERK_PUBLISHABLE_KEY");
      }
      const emailAddress = process.env.E2E_CLERK_EMAIL;
      if (!emailAddress) {
        throw new Error(
          "Browser tests require the disposable Clerk account from global setup",
        );
      }
      await setupClerkTestingToken({
        context,
        options: { frontendApiUrl },
      });
      await page.goto("/");
      await page.waitForFunction(
        () => Boolean((globalThis as typeof globalThis & {
          Clerk?: { loaded?: boolean };
        }).Clerk?.loaded),
        undefined,
        { timeout: 30_000 },
      );
      const hasClerkSession = await page.evaluate(
        () => Boolean((globalThis as typeof globalThis & {
          Clerk?: { user?: unknown };
        }).Clerk?.user),
      );
      let authenticatedUser = await request.get("/api/auth/user");
      if (hasClerkSession && authenticatedUser.status() === 200) {
        const user = await authenticatedUser.json().catch(() => null);
        if (!user || typeof user !== "object" || !("id" in user)) {
          throw new Error(
            "Clerk browser setup failed: /api/auth/user returned no local identity",
          );
        }
      } else {
        // A persisted Clerk session can outlive its testing token. In that
        // case, obtain a fresh ticket rather than trusting the stale session.
        await page.goto("/sign-in");
        await clerkTesting.signIn({ page, emailAddress });
        await page.goto("/");
        authenticatedUser = await request.get("/api/auth/user");
      }
      if (authenticatedUser.status() !== 200) {
        throw new Error(
          `Clerk browser setup failed: /api/auth/user returned ${authenticatedUser.status()}`,
        );
      }
      const user = await authenticatedUser.json().catch(() => null);
      if (!user || typeof user !== "object" || !("id" in user)) {
        throw new Error(
          "Clerk browser setup failed: /api/auth/user returned no local identity",
        );
      }
      await use();
    },
    { auto: true },
  ],
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
  secondApprovedIdentity: async ({ clerkTestingToken }, use) => {
    void clerkTestingToken;
    const secretKey = process.env.CLERK_SECRET_KEY;
    const databaseUrl = process.env.DATABASE_URL;
    if (!secretKey || !databaseUrl) {
      throw new Error(
        "The second approved identity fixture requires CLERK_SECRET_KEY and DATABASE_URL",
      );
    }

    const email = `e2e-clerk-second+${randomUUID()}@example.com`;
    const password = `E2e-${randomUUID()}!9`;
    const clerk = createClerkClient({ secretKey });
    const database = new pg.Client({ connectionString: databaseUrl });
    await database.connect();
    const localUserId = `e2e-clerk-second-${randomUUID()}`;
    let clerkUser: Awaited<ReturnType<typeof clerk.users.createUser>> | null = null;
    let cleanupError: unknown;
    try {
      clerkUser = await clerk.users.createUser({
        externalId: localUserId,
        emailAddress: [email],
        password,
        firstName: "Second",
        lastName: "Playwright",
        skipLegalChecks: true,
      });
      await database.query(
        `INSERT INTO users (
           id, clerk_user_id, email, first_name, last_name, approved, rejected, role
         )
         VALUES ($1, $2, $3, 'Second', 'Playwright', true, false, 'Admin')`,
        [localUserId, clerkUser.id, email],
      );
      await use({ email });
    } finally {
      try {
        await database.query("DELETE FROM users WHERE id = $1", [localUserId]);
      } catch (error) {
        cleanupError = error;
      }
      try {
        await database.end();
      } catch (error) {
        cleanupError ??= error;
      }
      if (clerkUser) {
        try {
          await clerk.users.deleteUser(clerkUser.id);
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (cleanupError) throw cleanupError;
    }
  },
  sessionId: async ({ request }, use) => {
    const sess = await createSessionViaApi(request);
    await use(sess.id);
  },
});

export { expect };
