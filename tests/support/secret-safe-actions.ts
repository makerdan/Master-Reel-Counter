type SecretFillTarget = {
  fill(value: string): Promise<void>;
};

export async function fillSecret(
  target: SecretFillTarget,
  secret: string,
  safeFailureMessage: string,
): Promise<void> {
  try {
    await target.fill(secret);
  } catch {
    throw new Error(safeFailureMessage);
  }
}