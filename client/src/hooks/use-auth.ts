import { useCallback } from "react";
import { useAuth as useClerkAuth, useClerk, useUser } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";

async function fetchUser(): Promise<User | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

function clearClientState(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.clear();
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "CLEAR_API_CACHE" });
  }
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
  const { data: localUser, isLoading: isLocalUserLoading } = useQuery<User | null>({
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

  const logout = useCallback(async () => {
    clearClientState(queryClient);
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
  const isLoading = !isLoaded || isLocalUserLoading;

  return {
    user: localUser,
    identityId,
    isLoading,
    isAuthenticated: !!localUser,
    isClerkSignedIn: isSignedIn,
    // A signed-in Clerk identity with no authorized app user is terminal; it
    // must not fall through to the public landing page.
    accessDenied: !!isSignedIn && !localUser && !isLoading,
    logout,
    isLoggingOut: false,
  };
}
