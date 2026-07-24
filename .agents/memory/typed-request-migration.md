---
name: Typed-request migration in Express routes
description: How to add type safety to req.user access in Express handlers without changing handler signatures.
---

# Typed-request migration pattern in routes.ts

## The rule
Handler signatures must stay `async (req: any, res)` — changing them to `AuthenticatedRequest` causes TS2769 contravariance errors because Express's `req.user` is `User | undefined` but `AuthenticatedRequest.user` is non-optional `AuthenticatedUser`.

## How to apply
Use inline cast at every point of use:
```typescript
app.patch("/api/resource/:id", isAuthenticated, async (req: any, res) => {
  const userId = (req as AuthenticatedRequest).user.claims.sub;
  const owner = getTesterOwner(req as AuthenticatedRequest);
```

Or declare a local variable once at the top of the handler:
```typescript
const r = req as AuthenticatedRequest<SomeBody>;
// then use r.user, r.body
```

The existing "migrated" handlers in routes.ts use both patterns.

**Why:** TypeScript's function parameter contravariance rejects `(req: AuthenticatedRequest) => void` as a `RequestHandler` because the outer Request type has `user: User | undefined` while AuthenticatedRequest has `user: AuthenticatedUser`. The inline cast achieves type safety at the point of use without triggering the overload error.

## Bugs surfaced by migration
When routes.ts was migrated (2026-07-23), the type cast revealed three real bugs hidden by `any`:
- `claims.name` does not exist → correct property is `claims.first_name`
- `claims.firstName` does not exist → correct property is `claims.first_name`
- `req.user.id` does not exist → correct access is `(req as AuthenticatedRequest).user.claims.sub`

These are now fixed. Any future migration should watch for similar property-name typos.

## AuthenticatedUser claims shape
```typescript
interface AuthenticatedUser {
  isTester?: boolean;
  claims: {
    sub: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
    testerOwnerUserId?: string;
  };
}
```
Note: no `name`, no `firstName`, no `id` at the top level — all access goes through `claims.*`.
