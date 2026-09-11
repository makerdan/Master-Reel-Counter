import {
  authenticateRequest,
  clerkClient,
  getAuth,
} from "@clerk/express";
import {
  buildPublishableKey,
  publishableKeyFromHost,
} from "@clerk/shared/keys";
import type { Request, RequestHandler } from "express";
import { authStorage } from "./storage";
import { getClerkProxyHost } from "../../middlewares/clerkProxyMiddleware";

type NormalizedUser = {
  claims: {
    sub: string;
    email?: string;
    firstName?: string;
    first_name?: string;
    lastName?: string;
    last_name?: string;
    profileImageUrl?: string;
    username?: string;
  };
  expires_at: number;
  role: "Admin" | "User";
};
function claimsValue(claims: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

export function isProtectedOwnerIdentity(input: {
  existing: object | undefined;
  userId: string;
  username?: string;
  replOwner?: string;
  binding: "legacy-claim" | "clerk-external-id" | "native-clerk";
}): boolean {
  return Boolean(
    input.existing &&
    input.binding !== "native-clerk" &&
    !input.userId.startsWith("user_") &&
    input.username &&
    input.replOwner === input.username,
  );
}

type ClerkProfile = {
  id: string;
  externalId: string | null;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
};

const CLERK_PROFILE_CACHE_LIMIT = 100;
const clerkProfileCache = new Map<string, Promise<ClerkProfile>>();

async function getClerkProfile(clerkUserId: string): Promise<ClerkProfile> {
  const cached = clerkProfileCache.get(clerkUserId);
  if (cached) return cached;
  const pending = clerkClient.users.getUser(clerkUserId).then((user) => {
    const privateUsername =
      typeof user.privateMetadata.username === "string"
        ? user.privateMetadata.username
        : undefined;
    const publicUsername =
      typeof user.publicMetadata.username === "string"
        ? user.publicMetadata.username
        : undefined;
    const externalUsername = user.externalAccounts
      .map((account) => account.username)
      .find((value): value is string => typeof value === "string" && value.length > 0);
    return {
      id: user.id,
      externalId: user.externalId,
      username:
        user.username ??
        privateUsername ??
        publicUsername ??
        externalUsername,
      email: user.primaryEmailAddress?.emailAddress,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      profileImageUrl: user.imageUrl,
    };
  });
  clerkProfileCache.set(clerkUserId, pending);
  try {
    const profile = await pending;
    if (clerkProfileCache.size > CLERK_PROFILE_CACHE_LIMIT) {
      const oldest = clerkProfileCache.keys().next().value;
      if (oldest) clerkProfileCache.delete(oldest);
    }
    return profile;
  } catch (error) {
    clerkProfileCache.delete(clerkUserId);
    throw error;
  }
}

async function clerkIdentity(req: Request): Promise<NormalizedUser | undefined> {
  const auth = getAuth(req);
  if (!auth.userId) return undefined;
  const claims = (auth.sessionClaims ?? {}) as Record<string, unknown>;
  let clerkProfile: ClerkProfile | undefined;
  const legacyUserId = claimsValue(claims, "userId");
  const claimedExternalId = claimsValue(claims, "externalId", "external_id");
  let userId = legacyUserId ?? claimedExternalId;
  let identityBinding: "legacy-claim" | "clerk-external-id" | "native-clerk" =
    legacyUserId
      ? legacyUserId.startsWith("user_")
        ? "native-clerk"
        : "legacy-claim"
      : claimedExternalId
        ? "clerk-external-id"
        : "native-clerk";
  let existing = userId
    ? await authStorage.getUser(userId)
    : await authStorage.getUser(auth.userId);
  if (!userId || identityBinding === "native-clerk") {
    if (existing) {
      userId = auth.userId;
    } else {
      clerkProfile = await getClerkProfile(auth.userId);
      userId = clerkProfile.externalId ?? clerkProfile.id;
      identityBinding = clerkProfile.externalId
        ? "clerk-external-id"
        : "native-clerk";
      existing = await authStorage.getUser(userId);
    }
  }

  const email =
    claimsValue(claims, "email") ??
    clerkProfile?.email;
  const firstName =
    claimsValue(claims, "firstName", "first_name") ??
    clerkProfile?.firstName ??
    undefined;
  const lastName =
    claimsValue(claims, "lastName", "last_name") ??
    clerkProfile?.lastName ??
    undefined;
  const profileImageUrl =
    claimsValue(claims, "profileImageUrl", "profile_image_url") ??
    clerkProfile?.profileImageUrl;

  // Prefer the legacy Replit subject or Clerk externalId for migrated
  // accounts. New external-Clerk identities safely provision under their
  // native user_ identifier and cannot satisfy the initial-owner check.
  if (!existing) {
    await authStorage.createUserIfMissing({
      id: userId,
      email,
      firstName,
      lastName,
      profileImageUrl,
    });
    existing = await authStorage.getUser(userId);
  }

  // Owner access is only retained for the migrated local record. A new Clerk
  // identity with the same username must not become owner through JIT creation.
  const username = claimsValue(claims, "username") ?? clerkProfile?.username;
  const isVerifiedExistingOwner = isProtectedOwnerIdentity({
    existing,
    userId,
    username,
    replOwner: process.env.REPL_OWNER,
    binding: identityBinding,
  });
  if (isVerifiedExistingOwner && existing?.role !== "Admin") {
    existing = await authStorage.ensureInitialAdmin(userId);
  }
  return {
    claims: {
      sub: userId,
      email,
      firstName,
      first_name: firstName,
      lastName,
      last_name: lastName,
      profileImageUrl,
      username,
    },
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    role: existing?.role ?? "User",
  };
}
async function resolveIdentity(req: Request): Promise<NormalizedUser | undefined> {
  return clerkIdentity(req);
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    const user = await resolveIdentity(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    (req as Request & { user?: NormalizedUser }).user = user;
    next();
  } catch (error) {
    if (req.originalUrl === "/api/auth/user" || req.originalUrl.startsWith("/api/auth/user?")) {
      console.error("Identity bridge lookup failed:", error);
      return res.status(503).json({ message: "identity_bridge_unavailable" });
    }
    next(error);
  }
};
export async function authenticateWebSocketRequest(req: Request): Promise<NormalizedUser | undefined> {
  const requestHost = getClerkProxyHost(req) ?? "";
  const configuredFrontendHost =
    /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(requestHost)
      ? process.env.VITE_CLERK_PUBLIC_HOST
      : undefined;
  const state = await authenticateRequest({
    clerkClient,
    request: req,
    options: {
      publishableKey: configuredFrontendHost
        ? buildPublishableKey(configuredFrontendHost)
        : publishableKeyFromHost(
            requestHost,
            process.env.CLERK_PUBLISHABLE_KEY,
          ),
    },
  });
  (req as any).auth = state.toAuth();
  return resolveIdentity(req);
}
