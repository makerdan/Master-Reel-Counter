import { useCallback, useEffect } from "react";
import { useAuth as useClerkAuth, useClerk, useUser } from "@clerk/react";
import { useQuery, useQueryClient, type QueryObserverResult } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { clearIdentityScopedBrowserState } from "@/lib/storageKeys";

export type AuthUserState =
  | { kind: "unauthenticated"; user: null }
  | { kind: "not_provisioned"; user: null }
  | { kind: "authenticated"; user: User };

class IdentityBridgeError extends Error {
  constructor() {
    super("The identity service is temporarily unavailable.");
    this.name = "IdentityBridgeError";
  }
}

async function fetchUser(): Promise<AuthUserState> {
  try {
    const response = await fetch("/api/auth/user", {
      credentials: "include",
    });

    if (response.status === 401) {
      return { kind: "unauthenticated", user: null };
    }

    if (response.status === 404) {
      const body = await response.json().catch(() => null);
      if (body?.message === "not_provisioned") {
        return { kind: "not_provisioned", user: null };
      }
    }

    if (!response.ok) {
      throw new IdentityBridgeError();
    }

    return { kind: "authenticated", user: await response.json() };
  } catch (error) {
    if (error instanceof IdentityBridgeError) throw error;
    throw new IdentityBridgeError();
  }
}

async function clearProtectedOfflineData() {
  if (!("serviceWorker" in navigator)) return;

  const controller = navigator.serviceWorker.controller;
  if (controller) {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(resolve, 2_000);
      channel.port1.onmessage = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      controller.postMessage({ type: "CLEAR_API_CACHE" }, [channel.port2]);
    });
  }

  void navigator.serviceWorker.getRegistration().then((registration) => {
    const workers = new Set([
      registration?.active,
      registration?.waiting,
      registration?.installing,
    ]);
    workers.forEach((worker) => {
      if (worker !== controller) {
        worker?.postMessage({ type: "CLEAR_API_CACHE" });
      }
    });
  }).catch(() => {});
}

let lastObservedIdentity: string | null | undefined;

async function clearClientState(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.clear();
  clearIdentityScopedBrowserState();
  await clearProtectedOfflineData();
}

async function clearIdentityTransitionState(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  // Keep the auth query that is resolving the new identity. Removing it here
  // would turn an account switch into a refetch loop.
  queryClient.removeQueries({
    predicate: ({ queryKey }) => queryKey[0] !== "/api/auth/user",
  });
  clearIdentityScopedBrowserState();
  await clearProtectedOfflineData();
}
/**
 * App-state compatibility layer for Clerk identity.
 *
 * Clerk owns the browser session. The one local request is retained only for
 * approval/rejection and the deliberately separate tester session.
 */
export function useAuth() {
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();
  const {
    data: authState,
    error: identityError,
    isLoading: isLocalUserLoading,
    isFetching: isRefreshingIdentity,
    refetch,
  } = useQuery<AuthUserState>({
    // Include Clerk identity state so a completed sign-in cannot reuse a
    // signed-out null result that was cached before the redirect.
    queryKey: [
      "/api/auth/user",
      clerkUser?.id ?? (isSignedIn ? "signed-in" : "signed-out"),
    ],
    queryFn: fetchUser,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    // Wait for Clerk before asking the app server. Tester sessions are still
    // queried while Clerk is signed out, so they remain independent.
    enabled: isLoaded,
  });

  const refreshIdentity = useCallback(async (): Promise<QueryObserverResult<AuthUserState, Error>> => {
    return refetch();
  }, [refetch]);

  const localUser = authState?.kind === "authenticated" ? authState.user : null;
  const logout = useCallback(async () => {
    await clearClientState(queryClient);
    if (localUser?.isTester) {
      // Tester auth is the app's separate, password-based session.
      window.location.assign("/api/auth/tester-logout");
      return;
    }
    await signOut({ redirectUrl: import.meta.env.BASE_URL });
  }, [localUser?.isTester, queryClient, signOut]);

  // Existing app data uses the local user ID. For Clerk-native users that is
  // Clerk's external ID when present, otherwise its Clerk ID.
  const identityId = localUser?.id ?? clerkUser?.externalId ?? clerkUser?.id;
  const authIdentity = clerkUser?.id ?? (localUser?.isTester ? localUser.id : null);
  const observedAuthState = [
    authIdentity ?? "",
    localUser?.id ?? "",
    localUser ? "authorized" : "unauthorized",
  ].join(":");
  const isLoading = !isLoaded || isLocalUserLoading;

  useEffect(() => {
    if (!isLoaded || isLocalUserLoading) return;
    if (
      lastObservedIdentity !== undefined &&
      lastObservedIdentity !== observedAuthState
    ) {
      // Wait for the local-user query to settle before recording the baseline.
      // Later settled changes represent logout, expiry, rejected access, or
      // an account switch and must clear protected browser state.
      lastObservedIdentity = observedAuthState;
      void clearIdentityTransitionState(queryClient);
      return;
    }
    lastObservedIdentity = observedAuthState;
  }, [isLoaded, isLocalUserLoading, observedAuthState, queryClient]);

  return {
    user: localUser,
    identityId,
    isLoading,
    isAuthenticated: !!localUser,
    isClerkSignedIn: isSignedIn,
    authState: authState?.kind ?? (identityError ? "bridge_error" : undefined),
    identityError: identityError instanceof IdentityBridgeError,
    isNotProvisioned: authState?.kind === "not_provisioned",
    // A 401 after Clerk has established a session is a genuine unauthorized
    // response. It is distinct from a missing local row and a bridge failure.
    accessDenied: !!isSignedIn && authState?.kind === "unauthenticated" && !isLoading,
    isRefreshingIdentity,
    refreshIdentity,
    logout,
    isLoggingOut: false,
  };
}
