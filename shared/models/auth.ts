import { sql } from "drizzle-orm";
import { boolean, pgEnum, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const accountRoleEnum = pgEnum("account_role", ["Admin", "User"]);

// Local account state for Clerk identities.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  customAvatarKey: varchar("custom_avatar_key"),
  approved: boolean("approved").default(false).notNull(),
  rejected: boolean("rejected").default(false).notNull(),
  role: accountRoleEnum("role").default("User").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export type AccountRole = (typeof accountRoleEnum.enumValues)[number];
