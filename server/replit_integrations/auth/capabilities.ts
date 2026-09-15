import {
  ALL_USER_CAPABILITIES,
  RESTRICTED_USER_CAPABILITIES,
  USER_CAPABILITIES,
  type User,
  type UserCapabilities,
  type UserCapability,
} from "@shared/models/auth";

export {
  ALL_USER_CAPABILITIES,
  RESTRICTED_USER_CAPABILITIES,
  USER_CAPABILITIES,
};
export type { UserCapabilities, UserCapability };

/**
 * Normalize persisted capability data at the authorization boundary. A
 * malformed or future value is never treated as enabled.
 */
export function normalizeUserCapabilities(value: unknown): UserCapabilities {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    USER_CAPABILITIES.map((capability) => [capability, source[capability] === true]),
  ) as UserCapabilities;
}

/** Admin authority is complete and cannot be reduced by User capability data. */
export function effectiveUserCapabilities(user: Pick<User, "role" | "capabilities">): UserCapabilities {
  return user.role === "Admin"
    ? { ...ALL_USER_CAPABILITIES }
    : normalizeUserCapabilities(user.capabilities);
}

export function hasUserCapability(
  user: Pick<User, "role" | "approved" | "rejected" | "capabilities"> | undefined,
  capability: UserCapability,
): boolean {
  if (!user || !user.approved || user.rejected) return false;
  return effectiveUserCapabilities(user)[capability] === true;
}