import type { Pin, Photo } from "@shared/schema";

export interface ScannerResultSlim {
  pinId: number;
  editCatalog: string;
  editVendor: string;
  editFootage: string;
  confidence: string;
  rawText: string | null;
}

export interface DuplicatePinInfo {
  pinId: number;
  photoId: number;
  entryId: number | null;
  wireDetails: string | null;
  vendorCode: string | null;
  footage: number | null;
  reelCount: number;
  xPercent: number;
  yPercent: number;
  photoAisle: string | null;
  photoSection: string | null;
  photoObjectStorageKey: string;
  scannerCatalog?: string;
  scannerVendor?: string;
  scannerFootage?: string;
  scannerConfidence?: string;
}

export interface DuplicateGroup {
  label: string;
  aisle: string | null;
  section: string | null;
  pins: DuplicatePinInfo[];
  isDefiniteDoubleCount: boolean;
  groupType: "label-match" | "same-reel";
}

export function detectDuplicatePins(
  pins: Pin[],
  photos: Photo[],
  scannerResults: ScannerResultSlim[],
): DuplicateGroup[] {
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  const scannerMap = new Map(scannerResults.map((r) => [r.pinId, r]));

  const groupMap = new Map<string, DuplicatePinInfo[]>();

  for (const pin of pins) {
    if (!pin.label) continue;
    const photo = photoMap.get(pin.photoId);
    const aisle = photo?.aisle ?? null;
    const section = photo?.section ?? null;
    const key = `${pin.label.trim().toUpperCase()}||${aisle ?? ""}||${section ?? ""}`;

    const scanner = scannerMap.get(pin.id);
    const info: DuplicatePinInfo = {
      pinId: pin.id,
      photoId: pin.photoId,
      entryId: pin.entryId,
      wireDetails: pin.wireDetails,
      vendorCode: pin.vendorCode,
      footage: pin.footage,
      reelCount: pin.reelCount ?? 1,
      xPercent: pin.xPercent,
      yPercent: pin.yPercent,
      photoAisle: aisle,
      photoSection: section,
      photoObjectStorageKey: photo?.objectStorageKey ?? "",
      ...(scanner
        ? {
            scannerCatalog: scanner.editCatalog,
            scannerVendor: scanner.editVendor,
            scannerFootage: scanner.editFootage,
            scannerConfidence: scanner.confidence,
          }
        : {}),
    };

    const existing = groupMap.get(key) ?? [];
    existing.push(info);
    groupMap.set(key, existing);
  }

  const result: DuplicateGroup[] = [];

  for (const [key, groupPins] of groupMap) {
    if (groupPins.length < 2) continue;

    const nonNullEntryIds = groupPins
      .map((p) => p.entryId)
      .filter((id): id is number => id !== null);
    const uniqueNonNullEntries = new Set(nonNullEntryIds);

    if (
      uniqueNonNullEntries.size === 1 &&
      nonNullEntryIds.length === groupPins.length
    ) {
      continue;
    }

    const parts = key.split("||");
    const labelPart = parts[0];
    const aislePart = parts[1] || null;
    const sectionPart = parts[2] || null;

    result.push({
      label: labelPart,
      aisle: aislePart,
      section: sectionPart,
      pins: groupPins,
      isDefiniteDoubleCount: uniqueNonNullEntries.size > 1,
      groupType: "label-match",
    });
  }

  result.sort((a, b) => {
    if (a.isDefiniteDoubleCount !== b.isDefiniteDoubleCount)
      return a.isDefiniteDoubleCount ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return result;
}

const BASE_PIN_DIAMETER_PCT = 4;
const PROXIMITY_MULTIPLIER = 3;

function normalizeWire(w: string | null | undefined): string {
  return w?.trim().toUpperCase() || "";
}

function wireDetailsMatch(a: Pin, b: Pin): boolean {
  const wa = normalizeWire(a.wireDetails);
  const wb = normalizeWire(b.wireDetails);
  if (wa === "" || wb === "") return true;
  return wa === wb;
}

function pinDistance(a: Pin, b: Pin): number {
  const dx = a.xPercent - b.xPercent;
  const dy = a.yPercent - b.yPercent;
  return Math.sqrt(dx * dx + dy * dy);
}

export function detectSameReelDuplicates(
  pins: Pin[],
  photos: Photo[],
  scannerResults: ScannerResultSlim[],
): DuplicateGroup[] {
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  const scannerMap = new Map(scannerResults.map((r) => [r.pinId, r]));

  const byPhoto = new Map<number, Pin[]>();
  for (const pin of pins) {
    const list = byPhoto.get(pin.photoId) ?? [];
    list.push(pin);
    byPhoto.set(pin.photoId, list);
  }

  const result: DuplicateGroup[] = [];

  for (const [photoId, photoPins] of byPhoto) {
    if (photoPins.length < 2) continue;
    const photo = photoMap.get(photoId);
    const aisle = photo?.aisle ?? null;
    const section = photo?.section ?? null;
    const pinScale = photo?.pinScale ?? 1;
    const threshold = BASE_PIN_DIAMETER_PCT * pinScale * PROXIMITY_MULTIPLIER;

    const parent = new Map<number, number>();
    for (const pin of photoPins) parent.set(pin.id, pin.id);

    const find = (x: number): number => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!);
        x = parent.get(x)!;
      }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (let i = 0; i < photoPins.length; i++) {
      for (let j = i + 1; j < photoPins.length; j++) {
        const a = photoPins[i], b = photoPins[j];
        if (wireDetailsMatch(a, b) && pinDistance(a, b) <= threshold) {
          union(a.id, b.id);
        }
      }
    }

    const clusters = new Map<number, Pin[]>();
    for (const pin of photoPins) {
      const root = find(pin.id);
      const list = clusters.get(root) ?? [];
      list.push(pin);
      clusters.set(root, list);
    }

    for (const [, group] of clusters) {
      if (group.length < 2) continue;

      const firstWire = normalizeWire(group[0].wireDetails);
      const labelText = firstWire || "No Details";

      const groupPins: DuplicatePinInfo[] = group.map(pin => {
        const scanner = scannerMap.get(pin.id);
        return {
          pinId: pin.id,
          photoId: pin.photoId,
          entryId: pin.entryId,
          wireDetails: pin.wireDetails,
          vendorCode: pin.vendorCode,
          footage: pin.footage,
          reelCount: pin.reelCount ?? 1,
          xPercent: pin.xPercent,
          yPercent: pin.yPercent,
          photoAisle: aisle,
          photoSection: section,
          photoObjectStorageKey: photo?.objectStorageKey ?? "",
          ...(scanner
            ? {
                scannerCatalog: scanner.editCatalog,
                scannerVendor: scanner.editVendor,
                scannerFootage: scanner.editFootage,
                scannerConfidence: scanner.confidence,
              }
            : {}),
        };
      });

      result.push({
        label: labelText,
        aisle,
        section,
        pins: groupPins,
        isDefiniteDoubleCount: false,
        groupType: "same-reel",
      });
    }
  }

  result.sort((a, b) => a.label.localeCompare(b.label));
  return result;
}

export function loadScannerResults(sessionId: number): ScannerResultSlim[] {
  try {
    const raw = localStorage.getItem(`scanner-results-${sessionId}`);
    if (!raw) return [];
    const data: ScannerResultSlim[] = JSON.parse(raw);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return data.filter((d: any) => d.timestamp > cutoff);
  } catch {
    return [];
  }
}
