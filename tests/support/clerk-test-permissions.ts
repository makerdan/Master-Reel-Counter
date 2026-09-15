import { isClerkAPIResponseError } from "@clerk/shared/error";

type ClerkTestPermissionClient = {
  users: {
    createUser: (params: never) => Promise<unknown>;
    deleteUser: (userId: string) => Promise<unknown>;
  };
  testingTokens: {
    createTestingToken: () => Promise<{ token?: string }>;
  };
};

function clerkErrorStatus(error: unknown): number | undefined {
  return isClerkAPIResponseError(error) ? error.status : undefined;
}

function clerkErrorCodes(error: unknown): string[] {
  if (!isClerkAPIResponseError(error)) return [];
  return error.errors
    .map(({ code }) => code)
    .filter((code): code is string => typeof code === "string");
}

function permissionPreflightError(
  capability: "disposable-user creation" | "testing-token creation",
  status: number | undefined,
): Error {
  const statusLabel = status === undefined ? "unknown status" : `HTTP ${status}`;
  const guidance =
    capability === "disposable-user creation"
      ? "Grant the configured Clerk secret permission to manage users."
      : "Grant the configured Clerk secret permission to create testing tokens.";
  return new Error(
    `Clerk test permission preflight blocked ${capability} (${statusLabel}). ${guidance} Browser validation did not start.`,
  );
}

export async function assertClerkTestPermissions(
  clerk: ClerkTestPermissionClient,
): Promise<void> {
  try {
    // An empty request reaches the create-user authorization boundary without
    // creating a disposable user or retaining any fixture identifier.
    const probeResult = await clerk.users.createUser({} as never);
    const probeUserId =
      typeof probeResult === "object" &&
      probeResult !== null &&
      "id" in probeResult &&
      typeof probeResult.id === "string"
        ? probeResult.id
        : undefined;
    if (probeUserId) {
      try {
        await clerk.users.deleteUser(probeUserId);
      } catch {
        throw new Error(
          "Clerk test permission preflight unexpectedly created a user and could not clean it up. Browser validation did not start.",
        );
      }
    }
    throw new Error(
      "Clerk test permission preflight unexpectedly accepted an incomplete user request. Browser validation did not start.",
    );
  } catch (error) {
    const status = clerkErrorStatus(error);
    const codes = clerkErrorCodes(error);
    if (status === 403) {
      throw permissionPreflightError("disposable-user creation", status);
    }
    if (status === 422 && codes.includes("form_data_missing")) {
      // Clerk accepted the authenticated request and rejected only the
      // intentionally incomplete fixture payload.
    } else {
      throw permissionPreflightError("disposable-user creation", status);
    }
  }

  try {
    const testingToken = await clerk.testingTokens.createTestingToken();
    if (!testingToken?.token) {
      throw new Error("missing testing token");
    }
  } catch (error) {
    throw permissionPreflightError(
      "testing-token creation",
      clerkErrorStatus(error),
    );
  }
}