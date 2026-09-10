import session from "express-session";
import connectPg from "connect-pg-simple";
import {
  authenticateRequest,
  clerkClient,
  getAuth,
} from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import type { Express, Request, RequestHandler } from "express";
import { authStorage } from "./storage";
import { getClerkProxyHost } from "../../middlewares/clerkProxyMiddleware";

const TESTER_SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

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
    testerOwnerUserId?: string;
  };
  expires_at: number;
  isTester: boolean;
  isOwner?: boolean;
  isTestOwner?: boolean;
};

declare module "express-session" {
  interface SessionData {
    testerIdentity?: NormalizedUser;
  }
}

export function getSession() {
  const pgStore = connectPg(session);
  return session({
    secret: process.env.SESSION_SECRET!,
    store: new pgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: false,
      ttl: TESTER_SESSION_TTL / 1000,
      tableName: "sessions",
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: TESTER_SESSION_TTL,
    },
  });
}

export async function setupAuth(app: Express): Promise<{ sessionParser: ReturnType<typeof getSession> }> {
  app.set("trust proxy", 1);
  const sessionParser = getSession();
  app.use(sessionParser);
  return { sessionParser };
}

function claimsValue(claims: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

export function isProtectedOwnerIdentity(input: {
  existing: { isTester?: boolean } | undefined;
  userId: string;
  username?: string;
  replOwner?: string;
}): boolean {
  return Boolean(
    input.existing &&
    !input.existing.isTester &&
    !input.userId.startsWith("user_") &&
    input.username &&
    input.replOwner === input.username,
  );
}

async function clerkIdentity(req: Request): Promise<NormalizedUser | undefined> {
  const auth = getAuth(req);
  if (!auth.userId) return undefined;
  const claims = (auth.sessionClaims ?? {}) as Record<string, unknown>;
  const userId = claimsValue(claims, "userId");
  if (!userId) return undefined;

  // `userId` is the legacy Replit subject for migrated accounts and the local
  // bridge value for newly-created accounts. Never use Clerk's native userId
  // for local database records.
  // Do not create a local row during authentication. A missing local account
  // is a meaningful not-provisioned state that the auth-user route must
  // communicate to the client, not a pending account with default values.
  const existing = await authStorage.getUser(userId);

  // Owner access is only retained for the migrated local record. A new Clerk
  // identity with the same username must not become owner through JIT creation.
  const username = claimsValue(claims, "username");
  const isOwner = isProtectedOwnerIdentity({
    existing,
    userId,
    username,
    replOwner: process.env.REPL_OWNER,
  });
  return {
    claims: {
      sub: userId,
      email: claimsValue(claims, "email"),
      firstName: claimsValue(claims, "firstName", "first_name"),
      first_name: claimsValue(claims, "firstName", "first_name"),
      lastName: claimsValue(claims, "lastName", "last_name"),
      last_name: claimsValue(claims, "lastName", "last_name"),
      profileImageUrl: claimsValue(claims, "profileImageUrl", "profile_image_url"),
      username,
    },
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    isTester: false,
    isOwner,
  };
}

function testerIdentity(req: Request): NormalizedUser | undefined {
  const tester = req.session?.testerIdentity;
  const validDevelopmentOwner =
    process.env.NODE_ENV !== "production" && tester?.isTestOwner === true;
  if (
    (!tester?.isTester && !validDevelopmentOwner) ||
    !tester.claims?.sub ||
    tester.expires_at < Math.floor(Date.now() / 1000)
  ) {
    return undefined;
  }
  return tester;
}

async function resolveIdentity(req: Request): Promise<NormalizedUser | undefined> {
  // Clerk wins if both cookies are supplied. This deliberately prevents a
  // tester session from inheriting a concurrently signed-in Clerk identity.
  return (await clerkIdentity(req)) ?? testerIdentity(req);
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

export function establishTesterSession(req: Request, identity: NormalizedUser): Promise<void> {
  req.session.testerIdentity = identity;
  return new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

export function destroyTesterSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
}

export async function authenticateWebSocketRequest(req: Request): Promise<NormalizedUser | undefined> {
  const state = await authenticateRequest({
    clerkClient,
    request: req,
    options: {
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    },
  });
  (req as any).auth = state.toAuth();
  return resolveIdentity(req);
}