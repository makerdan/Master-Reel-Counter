import { Storage } from "@google-cloud/storage";
import { createHash } from "node:crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parseObjectPath(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const pathParts = normalized.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid object-storage path");
  }
  return {
    bucketName: pathParts[1],
    objectName: pathParts.slice(2).join("/"),
  };
}

export function resolvePrivateObjectFile(client, privateObjectDir, objectPath) {
  if (!privateObjectDir) {
    throw new Error("PRIVATE_OBJECT_DIR is required for object cleanup");
  }
  const entityId = objectPath.startsWith("/objects/")
    ? objectPath.slice("/objects/".length)
    : objectPath.replace(/^\/+/, "");
  const fullPath = `${privateObjectDir.replace(/\/+$/, "")}/${entityId}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  return client.bucket(bucketName).file(objectName);
}

export async function deletePrivateObjectsAndVerify({
  client = objectStorageClient,
  privateObjectDir = process.env.PRIVATE_OBJECT_DIR,
  objectPaths,
}) {
  const batchId = createHash("sha256")
    .update([...objectPaths].sort().join("\0"))
    .digest("hex")
    .slice(0, 12);
  const failures = [];
  let removed = 0;

  for (const [index, objectPath] of objectPaths.entries()) {
    try {
      const file = resolvePrivateObjectFile(client, privateObjectDir, objectPath);
      await file.delete({ ignoreNotFound: true });
      const [exists] = await file.exists();
      if (exists) throw new Error("Object still exists after deletion");
      removed += 1;
    } catch {
      failures.push(index);
    }
  }

  if (failures.length > 0) {
    const error = new Error(
      `Object cleanup incomplete for batch ${batchId}: ${failures.length} of ${objectPaths.length} object(s) require retry`,
    );
    error.failureIndexes = failures;
    error.batchId = batchId;
    throw error;
  }

  return { attempted: objectPaths.length, removed, batchId };
}