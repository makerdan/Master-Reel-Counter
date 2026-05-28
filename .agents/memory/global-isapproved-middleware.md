---
name: Global isApproved middleware
description: All /api/* routes (except a skipPaths whitelist) are gated by the isApproved middleware in routes.ts; new public endpoints must be added to skipPaths.
---

In `server/routes.ts` (~line 283), after `registerAuthRoutes` and `registerObjectStorageRoutes`, there is:

```ts
app.use("/api", (req, res, next) => {
  const skipPaths = [ ... ];
  ...
  isApproved(req, res, next);
});
```

`isApproved` (from `server/replit_integrations/auth/routes.ts`) checks `user.claims.sub` and returns 401 if missing.

**Why:** Any unauthenticated POST to an `/api/*` endpoint will get 401 unless it's in `skipPaths`. Only the listed paths skip this gate.

**How to apply:** When adding a new public (no-auth) endpoint under `/api/*`, add its path string to the `skipPaths` array in the same block.
