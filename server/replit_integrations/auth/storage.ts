import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../../db";
import { eq, ne, count, sql } from "drizzle-orm";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  createUserIfMissing(user: UpsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserAvatar(id: string, customAvatarKey: string | null): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getRejectedCount(): Promise<number>;
  setUserApproved(id: string, approved: boolean): Promise<User>;
  rejectUser(id: string): Promise<User>;
  clearAllRejected(): Promise<string[]>;
  ensureInitialAdmin(id: string): Promise<User | undefined>;
  canRemoveAdmin(id: string): Promise<boolean>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async createUserIfMissing(userData: UpsertUser): Promise<User> {
    await db.insert(users).values(userData).onConflictDoNothing({ target: users.id });
    const user = await this.getUser(userData.id!);
    if (!user) throw new Error("Failed to create local user");
    return user;
  }

  async updateUserAvatar(id: string, customAvatarKey: string | null): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ customAvatarKey, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).where(ne(users.rejected, true)).orderBy(users.createdAt);
  }

  async getRejectedCount(): Promise<number> {
    const [row] = await db.select({ value: count() }).from(users).where(eq(users.rejected, true));
    return row?.value ?? 0;
  }

  async setUserApproved(id: string, approved: boolean): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ approved, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async rejectUser(id: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ approved: false, rejected: true, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async clearAllRejected(): Promise<string[]> {
    const updatedUsers = await db
      .update(users)
      .set({ rejected: false, updatedAt: new Date() })
      .where(eq(users.rejected, true))
      .returning({ id: users.id });
    return updatedUsers.map((user) => user.id);
  }

  async ensureInitialAdmin(id: string): Promise<User | undefined> {
    return db.transaction(async (tx) => {
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
    const [adminCount] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.role, "Admin"));
    return (adminCount?.value ?? 0) > 1;
  }
}

export const authStorage = new AuthStorage();
