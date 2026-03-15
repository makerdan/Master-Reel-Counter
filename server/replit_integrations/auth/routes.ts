import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";

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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isTester: true,
          testerOwnerUserId: user.claims.testerOwnerUserId,
        });
      }
      const userId = req.user.claims.sub;
      const dbUser = await authStorage.getUser(userId);
      res.json(dbUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
