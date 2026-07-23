/**
 * @feature photo-upload-validation
 * Guards the `POST /api/sessions/:sessionId/photos` route against:
 *   - Missing body (no Content-Type header) → must return 400, not crash with 500
 *   - Empty JSON body → must return 400 (objectStorageKey is required)
 *   - Client-injected server fields (userId, id) → must be ignored; server values win
 */
import { test, expect, createSessionViaApi } from "./fixtures";

test.describe("photo POST validation @photo-upload", () => {
  test("missing body (no Content-Type) returns 400 not 500", async ({
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Photo Validation ${Date.now()}`);
    cleanupIds.push(sess.id);

    const res = await request.post(`/api/sessions/${sess.id}/photos`, {
      headers: {},
      data: undefined,
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("message");
  });

  test("empty JSON body returns 400 (objectStorageKey required)", async ({
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Photo Validation ${Date.now()}`);
    cleanupIds.push(sess.id);

    const res = await request.post(`/api/sessions/${sess.id}/photos`, {
      data: {},
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("message");
    expect(body.errors).toHaveProperty("objectStorageKey");
  });

  test("client-supplied userId and sessionId are overridden by server values", async ({
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Photo Override ${Date.now()}`);
    cleanupIds.push(sess.id);

    const res = await request.post(`/api/sessions/${sess.id}/photos`, {
      data: {
        objectStorageKey: `uploads/fake-regression-test-${Date.now()}.jpg`,
        originalFilename: "regression.jpg",
        userId: "INJECTED-USER-ID",
        sessionId: 99999,
        uploadedBy: "INJECTED-NAME",
      },
    });

    expect(res.status()).toBe(200);
    const photo = await res.json();
    expect(photo.userId).not.toBe("INJECTED-USER-ID");
    expect(photo.sessionId).toBe(sess.id);
    expect(photo.uploadedBy).not.toBe("INJECTED-NAME");
  });
});
