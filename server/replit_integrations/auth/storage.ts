import { users, type User, type UserProfileWrite } from "@shared/models/auth";
import { db } from "../../db";
import { and, eq, isNull, ne, count, or, sql } from "drizzle-orm";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByClerkUserId(clerkUserId: string): Promise<User | undefined>;
  createUserIfMissing(user: UserProfileWrite): Promise<User>;
  createUserForClerkIdentity(user: UserProfileWrite, clerkUserId: string): Promise<User>;
  bindClerkUserId(id: string, clerkUserId: string): Promise<User | undefined>;
  upsertUser(user: UserProfileWrite): Promise<User>;
  updateUserAvatar(id: string, customAvatarKey: string | null): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getRejectedCount(): Promise<number>;
  setUserApproved(id: string, approved: boolean): Promise<User>;
  rejectUser(id: string): Promise<User>;
  clearAllRejected(): Promise<string[]>;
  ensureInitialAdmin(id: string): Promise<User | undefined>;
  canRemoveAdmin(id: string): Promise<boolean>;
}

export function sanitizeUserProfileWrite(userData: UserProfileWrite): UserProfileWrite {
  const {
    id,
    email,
    firstName,
    lastName,
    profileImageUrl,
    customAvatarKey,
    approved,
    rejected,
    role,
    createdAt,
    updatedAt,
  } = userData;
  return {
    id,
    email,
    firstName,
    lastName,
    profileImageUrl,
    customAvatarKey,
    approved,
    rejected,
    role,
    createdAt,
    updatedAt,
  };
}

export class AuthStorage implements IAuthStorage {
  constructor(private readonly database = db) {}

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await this.database.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByClerkUserId(clerkUserId: string): Promise<User | undefined> {
    const [user] = await this.database.select().from(users).where(eq(users.clerkUserId, clerkUserId));
    return user;
  }

  async upsertUser(userData: UserProfileWrite): Promise<User> {
    const profile = sanitizeUserProfileWrite(userData);
    const [user] = await this.database
      .insert(users)
      .values(profile)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...profile,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async createUserIfMissing(userData: UserProfileWrite): Promise<User> {
    const profile = sanitizeUserProfileWrite(userData);
    await this.database.insert(users).values(profile).onConflictDoNothing({ target: users.id });
    const user = await this.getUser(userData.id!);
    if (!user) throw new Error("Failed to create local user");
    return user;
  }

  async createUserForClerkIdentity(
    userData: UserProfileWrite,
    clerkUserId: string,
  ): Promise<User> {
    const profile = sanitizeUserProfileWrite(userData);
    await this.database
      .insert(users)
      .values({ ...profile, clerkUserId })
      .onConflictDoNothing({ target: users.id });
    const user = await this.getUserByClerkUserId(clerkUserId);
    if (!user) throw new Error("Failed to create linked local user");
    return user;
  }

  async bindClerkUserId(id: string, clerkUserId: string): Promise<User | undefined> {
    const [user] = await this.database
      .update(users)
      .set({ clerkUserId, updatedAt: new Date() })
      .where(and(
        eq(users.id, id),
        or(isNull(users.clerkUserId), eq(users.clerkUserId, clerkUserId)),
      ))
      .returning();
    return user;
  }

  async updateUserAvatar(id: string, customAvatarKey: string | null): Promise<User> {
    const [user] = await this.database
      .update(users)
      .set({ customAvatarKey, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await this.database.select().from(users).where(ne(users.rejected, true)).orderBy(users.createdAt);
  }

  async getRejectedCount(): Promise<number> {
    const [row] = await this.database.select({ value: count() }).from(users).where(eq(users.rejected, true));
    return row?.value ?? 0;
  }

  async setUserApproved(id: string, approved: boolean): Promise<User> {
    const [user] = await this.database
      .update(users)
      .set({ approved, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async rejectUser(id: string): Promise<User> {
    const [user] = await this.database
      .update(users)
      .set({ approved: false, rejected: true, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async clearAllRejected(): Promise<string[]> {
    const updatedUsers = await this.database
      .update(users)
      .set({ rejected: false, updatedAt: new Date() })
      .where(eq(users.rejected, true))
      .returning({ id: users.id });
    return updatedUsers.map((user) => user.id);
  }

  async ensureInitialAdmin(id: string): Promise<User | undefined> {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('master-reel-counter-initial-admin'))`);
      const [adminCount] = await tx
        .select({ value: count() })
        .from(users)
        .where(eq(users.role, "Admin"));
      if ((adminCount?.value ?? 0) > 0) {
        const [existing] = await tx.select().from(users).where(eq(users.id, id));
        return existing;
      }
      const [promoted] = await tx
        .update(users)
        .set({ role: "Admin", approved: true, rejected: false, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      return promoted;
    });
  }

  async canRemoveAdmin(id: string): Promise<boolean> {
    const user = await this.getUser(id);
    if (user?.role !== "Admin") return true;
    const [adminCount] = await this.database
      .select({ value: count() })
      .from(users)
      .where(eq(users.role, "Admin"));
    return (adminCount?.value ?? 0) > 1;
  }
}

export const authStorage = new AuthStorage();
