import type { Express, RequestHandler } from "express";
import { authStorage } from "./storage";
import { getVerifiedIdentityAliases, isAuthenticated } from "./replitAuth";
import type { User } from "@shared/models/auth";
import { notifyAuthorizationChange } from "../../realtime-authorization";

export type IdentityAuthorizationOutcome =
  | "approved"
  | "pending"
  | "rejected"
  | "identity_changed";

export type AuthUserLookupResult =
  | { kind: "user"; user: User }
  | { kind: "not_provisioned" };

export type AuthenticatedUserResponse = User & {
  identityAliases: string[];
};

export function classifyAuthUserLookup(
  _user: unknown,
  dbUser: User | undefined,
): AuthUserLookupResult {
  return dbUser ? { kind: "user", user: dbUser } : { kind: "not_provisioned" };
}

export async function isIdentityApproved(user: any): Promise<boolean> {
  const userId = user?.claims?.sub;
  if (!userId) return false;
  const dbUser = await authStorage.getUser(userId);
  return Boolean(dbUser?.approved && !dbUser.rejected);
}

export async function isWebSocketIdentityAuthorized(
  user: any,
  connectedUser?: any,
): Promise<boolean> {
  if (!user || !(await isIdentityApproved(user))) return false;
  if (!connectedUser) return true;
  return user.claims?.sub === connectedUser.claims?.sub;
}

export const isApproved: RequestHandler = async (req: any, res, next) => {
  if (!req.user?.claims?.sub) return res.status(401).json({ message: "Unauthorized" });
  if (!(await isIdentityApproved(req.user))) {
    return res.status(403).json({ message: "pending_approval" });
  }
  return next();
};

/** Shared server-authoritative Admin boundary for support/admin operations. */
export const adminOnly: RequestHandler = (req: any, res, next) => {
  if (!isAdminIdentity(req.user)) return res.status(403).json({ message: "Forbidden" });
  return next();
};

/** @deprecated Use adminOnly. Kept temporarily for internal route compatibility. */
export const ownerOnly = adminOnly;

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const result = classifyAuthUserLookup(req.user, await authStorage.getUser(req.user.claims.sub));
      if (result.kind === "not_provisioned") {
        return res.status(404).json({ message: "not_provisioned" });
      }
      const identityAliases = await getVerifiedIdentityAliases(req, result.user.id);
      return res.json({ ...result.user, identityAliases });
    } catch (error) {
      console.error("Error fetching user:", error);
      return res.status(503).json({ message: "identity_bridge_unavailable" });
    }
  });

  app.get("/api/admin/users", isAuthenticated, isApproved, adminOnly, async (_req: any, res) => {
    try {
      return res.json(await authStorage.getAllUsers());
    } catch (error) {
      console.error("Error fetching users:", error);
      return res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get(
    "/api/admin/rejected-users/count",
    isAuthenticated,
    isApproved,
    adminOnly,
    async (_req: any, res) => {
      try {
        return res.json({ count: await authStorage.getRejectedCount() });
      } catch (error) {
        console.error("Error fetching rejected user count:", error);
        return res.status(500).json({ message: "Failed to fetch rejected user count" });
      }
    },
  );

  app.post(
    "/api/admin/users/clear-rejected",
    isAuthenticated,
    isApproved,
    adminOnly,
    async (_req: any, res) => {
      try {
        const restoredUserIds = await authStorage.clearAllRejected();
        for (const userId of restoredUserIds) {
          notifyAuthorizationChange(userId, "rejected_users_cleared");
        }
        return res.json({ success: true });
      } catch (error) {
        console.error("Error clearing rejected users:", error);
        return res.status(500).json({ message: "Failed to clear rejected users" });
      }
    },
  );

  app.delete(
    "/api/admin/users/:id",
    isAuthenticated,
    isApproved,
    adminOnly,
    async (req: any, res) => {
      try {
        const targetId = req.params.id;
        if (targetId === req.user?.claims?.sub) {
          return res.status(400).json({ message: "Cannot reject your own account" });
        }
        if (!(await authStorage.getUser(targetId))) {
          return res.status(404).json({ message: "User not found" });
        }
        if (!(await authStorage.canRemoveAdmin(targetId))) {
          return res.status(409).json({ message: "Cannot remove the final Admin" });
        }
        await authStorage.rejectUser(targetId);
        notifyAuthorizationChange(targetId, "account_rejected");
        return res.json({ success: true });
      } catch (error) {
        console.error("Error rejecting user:", error);
        return res.status(500).json({ message: "Failed to reject user" });
      }
    },
  );

  app.patch(
    "/api/admin/users/:id/approval",
    isAuthenticated,
    isApproved,
    adminOnly,
    async (req: any, res) => {
      try {
        const { approved } = req.body;
        if (typeof approved !== "boolean") {
          return res.status(400).json({ message: "approved must be a boolean" });
        }
        const targetId = req.params.id;
        if (targetId === req.user?.claims?.sub) {
          return res.status(400).json({ message: "Cannot change your own admission" });
        }
        if (!(await authStorage.getUser(targetId))) {
          return res.status(404).json({ message: "User not found" });
        }
        if (!approved && !(await authStorage.canRemoveAdmin(targetId))) {
          return res.status(409).json({ message: "Cannot disable the final Admin" });
        }
        const updatedUser = await authStorage.setUserApproved(targetId, approved);
        if (!approved) notifyAuthorizationChange(targetId, "approval_removed");
        return res.json(updatedUser);
      } catch (error) {
        console.error("Error updating user approval:", error);
        return res.status(500).json({ message: "Failed to update user approval" });
      }
    },
  );
}

export async function getIdentityAuthorizationOutcome(
  user: any,
): Promise<IdentityAuthorizationOutcome> {
  const userId = user?.claims?.sub;
  if (!userId) return "identity_changed";
  const dbUser = await authStorage.getUser(userId);
  if (!dbUser) return "identity_changed";
  if (dbUser.rejected) return "rejected";
  if (!dbUser.approved) return "pending";
  return "approved";
}

/** Admin status is read from the persisted local account, never from claims. */
export function isAdminIdentity(user: any): boolean {
  return user?.role === "Admin";
}

/** @deprecated Use isAdminIdentity. Kept temporarily for internal route compatibility. */
export const isOwnerIdentity = isAdminIdentity;