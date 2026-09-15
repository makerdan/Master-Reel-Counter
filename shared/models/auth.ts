import { sql } from "drizzle-orm";
import { boolean, jsonb, pgEnum, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const accountRoleEnum = pgEnum("account_role", ["Admin", "User"]);

export const USER_CAPABILITIES = [
  "session_create",
  "session_delete",
  "exports",
  "photo_management",
  "ai_scanning",
  "collaborator_management",
  "statistics",
  "account_settings",
] as const;

export type UserCapability = (typeof USER_CAPABILITIES)[number];
export type UserCapabilities = Record<UserCapability, boolean>;

export const RESTRICTED_USER_CAPABILITIES: UserCapabilities = {
  session_create: false,
  session_delete: false,
  exports: false,
  photo_management: true,
  ai_scanning: false,
  collaborator_management: false,
  statistics: false,
  account_settings: false,
};

export const ALL_USER_CAPABILITIES: UserCapabilities = Object.fromEntries(
  USER_CAPABILITIES.map((capability) => [capability, true]),
) as UserCapabilities;

// Local account state for Clerk identities.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clerkUserId: varchar("clerk_user_id").unique(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  customAvatarKey: varchar("custom_avatar_key"),
  approved: boolean("approved").default(false).notNull(),
  rejected: boolean("rejected").default(false).notNull(),
  role: accountRoleEnum("role").default("User").notNull(),
  capabilities: jsonb("capabilities").$type<UserCapabilities>().default(RESTRICTED_USER_CAPABILITIES).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type UserProfileWrite = Omit<UpsertUser, "clerkUserId">;

export type AccountRole = (typeof accountRoleEnum.enumValues)[number];
