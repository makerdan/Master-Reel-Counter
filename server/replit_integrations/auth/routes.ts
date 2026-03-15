import type { Express, RequestHandler } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";

function isAppOwner(user: any): boolean {
  const replOwner = process.env.REPL_OWNER;
  if (!replOwner) return false;
  const claims = user?.claims || {};
  const username = claims.username || "";
  return username === replOwner;
}

export const isApproved: RequestHandler = async (req: any, res, next) => {
  const user = req.user as any;
  if (user?.isTester) return next();

  const userId = user?.claims?.sub;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  if (isAppOwner(user)) return next();

  const dbUser = await authStorage.getUser(userId);
  if (!dbUser || !dbUser.approved) {
    return res.status(403).json({ message: "pending_approval" });
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
          firstName: user.claims.firstName,
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

      if (dbUser && isAppOwner(req.user) && !dbUser.approved) {
        const updatedUser = await authStorage.setUserApproved(userId, true);
        return res.json(updatedUser);
      }

      res.json(dbUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/admin/users", isAuthenticated, async (req: any, res) => {
    try {
      if (!isAppOwner(req.user)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const allUsers = await authStorage.getAllUsers();
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/admin/users/:id/approval", isAuthenticated, async (req: any, res) => {
    try {
      if (!isAppOwner(req.user)) {
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
