import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

export function generateSalt(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function generateDataKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

const MIN_SECRET_LENGTH = 32;

export function validateSessionSecret(): void {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    const msg = secret
      ? `SESSION_SECRET is too short (${secret.length} chars); minimum is ${MIN_SECRET_LENGTH}`
      : "SESSION_SECRET environment variable is not set";
    throw new Error(`[startup] ${msg}. The server cannot start without a strong SESSION_SECRET.`);
  }
}

export function deriveKEK(salt: string): Buffer {
  const serverSecret = process.env.SESSION_SECRET;
  if (!serverSecret || serverSecret.length < MIN_SECRET_LENGTH) {
    throw new Error("SESSION_SECRET is missing or too short; cannot derive encryption key.");
  }
  return crypto.pbkdf2Sync(serverSecret, Buffer.from(salt, "hex"), PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
}

export function wrapKey(dataKey: Buffer, kek: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, kek, iv);
  const encrypted = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function unwrapKey(wrappedKey: string, kek: Buffer): Buffer {
  const parts = wrappedKey.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, kek, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function encrypt(text: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(encoded: string, key: Buffer): string {
  if (!encoded.startsWith("enc:")) return encoded;
  const parts = encoded.split(":");
  if (parts.length !== 4) return encoded;
  const iv = Buffer.from(parts[1], "hex");
  const authTag = Buffer.from(parts[2], "hex");
  const encrypted = Buffer.from(parts[3], "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("enc:");
}

const ENCODABLE_ENTRY_FIELDS = [
  "reelTag", "wireType", "gauge", "color", "manufacturer", "notes", "palletId", "position", "conductors",
] as const;

export function encryptEntry(entry: Record<string, any>, key: Buffer): Record<string, any> {
  const result = { ...entry };
  for (const field of ENCODABLE_ENTRY_FIELDS) {
    if (result[field] && typeof result[field] === "string" && !isEncrypted(result[field])) {
      result[field] = encrypt(result[field], key);
    }
  }
  return result;
}

export class DecryptionError extends Error {
  constructor(public readonly field: string, cause: unknown) {
    super(`Failed to decrypt field "${field}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "DecryptionError";
  }
}

export const UNREADABLE_SENTINEL = "[unreadable]";

export type DecryptOptions = { strict?: boolean };

export function decryptEntry(entry: Record<string, any>, key: Buffer, options: DecryptOptions = {}): Record<string, any> {
  const strict = options.strict !== false;
  const result = { ...entry };
  for (const field of ENCODABLE_ENTRY_FIELDS) {
    if (result[field] && typeof result[field] === "string" && isEncrypted(result[field])) {
      try {
        result[field] = decrypt(result[field], key);
      } catch (cause) {
        if (strict) {
          throw new DecryptionError(field, cause);
        }
        console.warn(`[decryptEntry] best-effort: field "${field}" on entry ${entry.id ?? "?"} could not be decrypted — substituting sentinel`);
        result[field] = UNREADABLE_SENTINEL;
      }
    }
  }
  return result;
}
