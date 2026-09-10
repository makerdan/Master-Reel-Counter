export async function directPhotoFileKey(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${file.type}:${file.size}:${hash}`;
}

export function createDirectPhotoRegistrationKey(): string {
  return `direct-photo-${crypto.randomUUID()}`;
}