import type { File, Storage } from "@google-cloud/storage";

export const objectStorageClient: Storage;

export function canonicalPhysicalObjectKey(objectPath: string): string;

export function resolvePrivateObjectFile(
  client: Storage,
  privateObjectDir: string,
  objectPath: string,
): File;

export function deletePrivateObjectsAndVerify(options: {
  client?: Storage;
  privateObjectDir?: string;
  objectPaths: string[];
}): Promise<{ attempted: number; removed: number; batchId: string }>;