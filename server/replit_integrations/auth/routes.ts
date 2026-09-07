import type { Express, RequestHandler } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";

export function isOwnerIdentity(user: any): boolean {
  return user?.isOwner === true;
}

export async function isIdentityApproved(user: any): Promise<boolean> {
  if (user?.isTester || isOwnerIdentity(user)) return true;
  const userId = user?.claims?.sub;
  if (!userId) return false;
  const dbUser = await authStorage.getUser(userId);
  return Boolean(dbUser?.approved && !dbUser.rejected);
}

export const isApproved: RequestHandler = async (req: any, res, next) => {
  const user = req.user as any;
  if (!user?.claims?.sub) return res.status(401).json({ message: "Unauthorized" });
  if (!(await isIdentityApproved(user))) {
    return res.status(403).json({ message: "pending_approval" });
  }
  return next();
};

/** Shared server-authoritative owner boundary for support/admin operations. */
export const ownerOnly: RequestHandler = (req: any, res, next) => {
  if (!isOwnerIdentity(req.user)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
};

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user as any;
      if (user.isTester) {
        return res.json({
          id: user.claims.sub,
          email: null,
          firstName: user.claims.firstName || user.claims.first_name,
          lastName: null,
          profileImageUrl: null,
          customAvatarKey: null,
          approved: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isTester: true,
          testerOwnerUserId: user.claims.testerOwnerUserId,
        });
      }
      const userId = req.user.claims.sub;
      const dbUser = await authStorage.getUser(userId);

      if (dbUser && isOwnerIdentity(req.user) && !dbUser.approved) {
        const updatedUser = await authStorage.setUserApproved(userId, true);
        return res.json(updatedUser);
      }

      res.json({
        ...dbUser,
        // Development-only owner-login compatibility is intentionally
        // observable only as a client test marker, never as a permission.
        isTestOwner: req.user.isTestOwner === true ? true : undefined,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/admin/users", isAuthenticated, isApproved, async (req: any, res) => {
    try {
      if (!isOwnerIdentity(req.user)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const allUsers = await authStorage.getAllUsers();
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/admin/rejected-users/count", isAuthenticated, isApproved, async (req: any, res) => {
    try {
      if (!isOwnerIdentity(req.user)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const rejectedCount = await authStorage.getRejectedCount();
      res.json({ count: rejectedCount });
    } catch (error) {
      console.error("Error fetching rejected user count:", error);
      res.status(500).json({ message: "Failed to fetch rejected user count" });
    }
  });

  app.post("/api/admin/users/clear-rejected", isAuthenticated, isApproved, async (req: any, res) => {
    try {
      if (!isOwnerIdentity(req.user)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await authStorage.clearAllRejected();
      res.json({ success: true });
    } catch (error) {
      console.error("Error clearing rejected users:", error);
      res.status(500).json({ message: "Failed to clear rejected users" });
    }
  });

  app.delete("/api/admin/users/:id", isAuthenticated, isApproved, async (req: any, res) => {
    try {
      if (!isOwnerIdentity(req.user)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const targetId = req.params.id;
      const requesterId = req.user?.claims?.sub;
      if (targetId === requesterId) {
        return res.status(400).json({ message: "Cannot reject owner" });
      }
      const existingUser = await authStorage.getUser(targetId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      await authStorage.rejectUser(targetId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error rejecting user:", error);
      res.status(500).json({ message: "Failed to reject user" });
    }
  });

  app.patch("/api/admin/users/:id/approval", isAuthenticated, isApproved, async (req: any, res) => {
    try {
      if (!isOwnerIdentity(req.user)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { approved } = req.body;
      if (typeof approved !== "boolean") {
        return res.status(400).json({ message: "approved must be a boolean" });
      }
      const targetId = req.params.id;
      const requesterId = req.user?.claims?.sub;
      if (targetId === requesterId) {
        return res.status(400).json({ message: "Cannot change owner approval" });
      }
      const existingUser = await authStorage.getUser(targetId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      const updatedUser = await authStorage.setUserApproved(targetId, approved);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user approval:", error);
      res.status(500).json({ message: "Failed to update user approval" });
    }
  });
}
