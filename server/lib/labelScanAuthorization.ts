import { LabelScanResourceError } from "./labelScanResources";

interface ScanIdentity {
  pinId: number;
  photoId: number;
}

// Validate the entire batch before any image reads, AI calls or persistence.
// The per-photo route supplies its authorized photo ID, not the client's value.
export async function authorizeLabelScanPins(
  sessionId: number,
  requests: unknown[],
  getPin: (id: number) => Promise<{ photoId: number } | undefined>,
  getPhoto: (id: number) => Promise<{ sessionId: number } | undefined>,
): Promise<void> {
  const photoIds = new Set<number>();
  const pinIds = new Set<number>();
  for (const request of requests) {
    const pin = request as ScanIdentity | null;
    if (!pin || !Number.isSafeInteger(pin.pinId) || pin.pinId <= 0 ||
        !Number.isSafeInteger(pin.photoId) || pin.photoId <= 0 || pinIds.has(pin.pinId)) {
      throw new LabelScanResourceError("Invalid scan pin identifiers", 400);
    }
    pinIds.add(pin.pinId);
    const storedPin = await getPin(pin.pinId);
    if (!storedPin || storedPin.photoId !== pin.photoId) {
      throw new LabelScanResourceError("Scan pins must belong to the requested photo and session", 400);
    }
    photoIds.add(pin.photoId);
  }
  for (const photoId of photoIds) {
    const photo = await getPhoto(photoId);
    if (!photo || photo.sessionId !== sessionId) {
      throw new LabelScanResourceError("Scan pins must belong to the requested photo and session", 400);
    }
  }
}
