export class RealtimeAuthorizationTracker {
  private readonly versions = new Map<number, number>();

  invalidate(sessionId: number): void {
    this.versions.set(sessionId, (this.versions.get(sessionId) ?? 0) + 1);
  }

  async authorizeConsistently<T>(
    sessionId: number,
    authorize: () => Promise<T>,
  ): Promise<T> {
    while (true) {
      const version = this.versions.get(sessionId) ?? 0;
      const result = await authorize();
      if ((this.versions.get(sessionId) ?? 0) === version) {
        return result;
      }
    }
  }
}

export type AuthorizationChangeOutcome =
  | "account_rejected"
  | "approval_removed"
  | "rejected_users_cleared"
  | "removed_collaborator"
  | "role_changed"
  | "ownership_changed"
  | "denied_join"
  | "identity_changed"
  | "pending"
  | "rejected";

export type AuthorizationChangeHandler = (
  userId: string,
  outcome: AuthorizationChangeOutcome,
) => void;

let authorizationChangeHandler: AuthorizationChangeHandler | null = null;

export function authorizationChangeMessage(
  outcome: AuthorizationChangeOutcome,
): string {
  switch (outcome) {
    case "account_rejected":
      return "Your account access was rejected.";
    case "approval_removed":
      return "Your account approval was removed.";
    case "rejected_users_cleared":
      return "Your account access changed.";
    case "removed_collaborator":
      return "Your access to this session was removed.";
    case "role_changed":
      return "Your session permissions changed. Updating access.";
    case "ownership_changed":
      return "Session ownership changed. Updating access.";
    case "denied_join":
      return "You are not authorized to join this session.";
    case "pending":
      return "Your account is waiting for approval.";
    case "rejected":
      return "Your account access was rejected.";
    case "identity_changed":
      return "Your signed-in identity changed.";
  }
}

/**
 * Auth routes live in a separate module from the WebSocket room registry.
 * Registering this small boundary lets account approval changes evict sockets
 * without introducing a circular import between the two modules.
 */
export function registerAuthorizationChangeHandler(
  handler: AuthorizationChangeHandler,
): void {
  authorizationChangeHandler = handler;
}

export function notifyAuthorizationChange(
  userId: string,
  outcome: AuthorizationChangeOutcome,
): void {
  authorizationChangeHandler?.(userId, outcome);
}

type SessionSocketInfo = {
  sessionId: number | null;
  userId: string | null;
  role: string | null;
};

type ClosableSocket = {
  readyState: number;
  send(data: string): void;
  close(code: number, reason: string): void;
};

export function evictSessionUserSockets<Socket extends ClosableSocket>(
  sessionRooms: Map<number, Set<Socket>>,
  socketUsers: Map<Socket, SessionSocketInfo>,
  sessionId: number,
  userId: string,
  openReadyState: number,
  reason: string,
  outcome: AuthorizationChangeOutcome = "removed_collaborator",
): void {
  const room = sessionRooms.get(sessionId);
  if (!room) return;

  for (const socket of [...room]) {
    const info = socketUsers.get(socket);
    if (info?.userId !== userId) continue;
    room.delete(socket);
    info.sessionId = null;
    info.role = null;
    if (socket.readyState === openReadyState) {
      try {
        socket.send(JSON.stringify({
          type: "authorization_changed",
          outcome,
          message: authorizationChangeMessage(outcome),
        }));
      } catch {}
      socket.close(1008, reason);
    }
  }

  if (room.size === 0) sessionRooms.delete(sessionId);
}

export function evictUserSockets<Socket extends ClosableSocket>(
  sessionRooms: Map<number, Set<Socket>>,
  socketUsers: Map<Socket, SessionSocketInfo>,
  userId: string,
  openReadyState: number,
  reason: string,
  outcome: AuthorizationChangeOutcome,
): void {
  const affectedSessionIds = new Set<number>();
  for (const [, info] of socketUsers) {
    if (info.userId === userId && info.sessionId !== null) {
      affectedSessionIds.add(info.sessionId);
    }
  }

  for (const sessionId of affectedSessionIds) {
    evictSessionUserSockets(
      sessionRooms,
      socketUsers,
      sessionId,
      userId,
      openReadyState,
      reason,
      outcome,
    );
  }
}

export function evictAllSessionSockets<Socket extends ClosableSocket>(
  sessionRooms: Map<number, Set<Socket>>,
  socketUsers: Map<Socket, SessionSocketInfo>,
  sessionId: number,
  openReadyState: number,
  reason: string,
): void {
  const room = sessionRooms.get(sessionId);
  if (!room) return;

  sessionRooms.delete(sessionId);
  for (const socket of room) {
    const info = socketUsers.get(socket);
    if (info) {
      info.sessionId = null;
      info.role = null;
    }
    if (socket.readyState === openReadyState) {
      try {
        socket.send(JSON.stringify({
          type: "authorization_changed",
          outcome: "ownership_changed",
          message: authorizationChangeMessage("ownership_changed"),
        }));
      } catch {}
      socket.close(1008, reason);
    }
  }
}