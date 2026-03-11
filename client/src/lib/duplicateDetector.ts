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
      reelCount: pin.reelCount,
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

export function detectSameReelDuplicates(
  pins: Pin[],
  photos: Photo[],
  scannerResults: ScannerResultSlim[],
): DuplicateGroup[] {
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  const scannerMap = new Map(scannerResults.map((r) => [r.pinId, r]));

  const byPhoto = new Map<number, Pin[]>();
  for (const pin of pins) {
    if (!pin.wireDetails?.trim()) continue;
    const list = byPhoto.get(pin.photoId) ?? [];
    list.push(pin);
    byPhoto.set(pin.photoId, list);
  }

  const seen = new Set<string>();
  const result: DuplicateGroup[] = [];

  for (const [photoId, photoPins] of byPhoto) {
    const photo = photoMap.get(photoId);
    const aisle = photo?.aisle ?? null;
    const section = photo?.section ?? null;

    const byWire = new Map<string, Pin[]>();
    for (const pin of photoPins) {
      const key = pin.wireDetails!.trim().toUpperCase();
      const list = byWire.get(key) ?? [];
      list.push(pin);
      byWire.set(key, list);
    }

    for (const [, group] of byWire) {
      if (group.length < 2) continue;

      const sortedIds = group.map(p => p.id).sort((a, b) => a - b);
      const dedupeKey = `samereel||${sortedIds.join("||")}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const groupPins: DuplicatePinInfo[] = group.map(pin => {
        const scanner = scannerMap.get(pin.id);
        return {
          pinId: pin.id,
          photoId: pin.photoId,
          entryId: pin.entryId,
          wireDetails: pin.wireDetails,
          vendorCode: pin.vendorCode,
          footage: pin.footage,
          reelCount: pin.reelCount,
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
        label: group[0].wireDetails!.trim().toUpperCase(),
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
