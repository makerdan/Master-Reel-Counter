import {
  authenticateRequest,
  clerkClient,
  getAuth,
} from "@clerk/express";
import {
  resolveClerkEnvironmentPublishableKey,
  resolveClerkRequestPublishableKey,
} from "@shared/clerk-config";
import type { Request, RequestHandler } from "express";
import { authStorage } from "./storage";
import { getClerkProxyHost } from "../../middlewares/clerkProxyMiddleware";

type NormalizedUser = {
  claims: {
    sub: string;
    identityAliases?: string[];
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

type ResolvedClerkAccount = {
  userId: string;
  existing: Awaited<ReturnType<typeof authStorage.getUser>>;
  clerkProfile?: ClerkProfile;
  identityBinding: "clerk-external-id" | "native-clerk";
};

const CLERK_PROFILE_CACHE_LIMIT = 100;
const CLERK_PROFILE_CACHE_TTL_MS = 60_000;
const clerkProfileCache = new Map<string, {
  expiresAt: number;
  promise: Promise<ClerkProfile>;
}>();

async function getClerkProfile(clerkUserId: string): Promise<ClerkProfile> {
  const cached = clerkProfileCache.get(clerkUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) clerkProfileCache.delete(clerkUserId);
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
  clerkProfileCache.set(clerkUserId, {
    expiresAt: Date.now() + CLERK_PROFILE_CACHE_TTL_MS,
    promise: pending,
  });
  try {
    const profile = await pending;
    if (clerkProfileCache.size > CLERK_PROFILE_CACHE_LIMIT) {
      const oldest = clerkProfileCache.keys().next().value;
      if (oldest) clerkProfileCache.delete(oldest);
    }
    return profile;
  } catch (error) {
    if (clerkProfileCache.get(clerkUserId)?.promise === pending) {
      clerkProfileCache.delete(clerkUserId);
    }
    throw error;
  }
}

export async function resolveClerkAccount(
  clerkUserId: string,
  loadProfile: (id: string) => Promise<ClerkProfile> = getClerkProfile,
): Promise<ResolvedClerkAccount> {
  let existing = await authStorage.getUserByClerkUserId(clerkUserId);
  if (existing) {
    return {
      userId: existing.id,
      existing,
      identityBinding: existing.id === clerkUserId
        ? "native-clerk"
        : "clerk-external-id",
    };
  }

  const clerkProfile = await loadProfile(clerkUserId);
  const userId = clerkProfile.externalId ?? clerkProfile.id;
  const identityBinding = clerkProfile.externalId
    ? "clerk-external-id" as const
    : "native-clerk" as const;
  existing = await authStorage.getUser(userId);
  if (existing) {
    existing = await authStorage.bindClerkUserId(existing.id, clerkProfile.id);
    if (!existing) {
      throw new Error("Local account is already linked to another Clerk identity");
    }
  }
  return { userId, existing, clerkProfile, identityBinding };
}

export async function getPersistedIdentityAliases(
  clerkUserId: string,
  canonicalUserId: string,
): Promise<string[]> {
  const linkedUser = await authStorage.getUserByClerkUserId(clerkUserId);
  if (linkedUser?.id !== canonicalUserId) return [];
  return clerkUserId === canonicalUserId ? [] : [clerkUserId];
}

export async function getVerifiedIdentityAliases(req: Request, canonicalUserId: string): Promise<string[]> {
  const auth = getAuth(req);
  if (!auth.userId) return [];
  return getPersistedIdentityAliases(auth.userId, canonicalUserId);
}

async function clerkIdentity(req: Request): Promise<NormalizedUser | undefined> {
  const auth = getAuth(req);
  if (!auth.userId) return undefined;
  const claims = (auth.sessionClaims ?? {}) as Record<string, unknown>;
  const resolved = await resolveClerkAccount(auth.userId);
  let {
    clerkProfile,
    existing,
    identityBinding,
    userId,
  } = resolved;
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
    existing = await authStorage.createUserForClerkIdentity({
      id: userId,
      email,
      firstName,
      lastName,
      profileImageUrl,
    }, auth.userId);
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
  const clerkPublishableKey = resolveClerkEnvironmentPublishableKey({
    serverPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    clientPublishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY,
    allowClientFallback: process.env.NODE_ENV !== "production",
  });
  const state = await authenticateRequest({
    clerkClient,
    request: req,
    options: {
      publishableKey: resolveClerkRequestPublishableKey({
        requestHost: getClerkProxyHost(req) ?? "",
        publishableKey: clerkPublishableKey,
        proxyEnabled: process.env.NODE_ENV === "production",
      }),
    },
  });
  (req as any).auth = state.toAuth();
  return resolveIdentity(req);
}
