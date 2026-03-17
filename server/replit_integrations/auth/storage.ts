import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../../db";
import { eq, ne } from "drizzle-orm";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserAvatar(id: string, customAvatarKey: string | null): Promise<User>;
  getAllUsers(): Promise<User[]>;
  setUserApproved(id: string, approved: boolean): Promise<User>;
  rejectUser(id: string): Promise<User>;
  clearAllRejected(): Promise<void>;
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

  async clearAllRejected(): Promise<void> {
    await db
      .update(users)
      .set({ rejected: false, updatedAt: new Date() })
      .where(eq(users.rejected, true));
  }
}

export const authStorage = new AuthStorage();
