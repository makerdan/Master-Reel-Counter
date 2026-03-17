import type { Folder } from "@shared/schema";

export function findFolderConflict(
  proposedName: string,
  parentFolderId: number | null,
  folders: Folder[],
): Folder | null {
  const trimmed = proposedName.trim().toLowerCase();
  if (!trimmed) return null;
  return (
    folders.find(
      (f) =>
        f.name.trim().toLowerCase() === trimmed &&
        (f.parentFolderId ?? null) === parentFolderId,
    ) ?? null
  );
}

export function getNextAutoNumberedName(
  baseName: string,
  parentFolderId: number | null,
  folders: Folder[],
): string {
  const siblings = folders.filter(
    (f) => (f.parentFolderId ?? null) === parentFolderId,
  );
  const names = new Set(siblings.map((f) => f.name.trim().toLowerCase()));

  let n = 1;
  let candidate: string;
  do {
    candidate = `${baseName} (${n})`;
    n++;
  } while (names.has(candidate.toLowerCase()));

  return candidate;
}
