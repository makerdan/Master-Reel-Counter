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

export interface PreAuthWebSocketLimits {
  maxMessages: number;
  maxAggregateBytes: number;
  maxPayloadBytes: number;
  timeoutMs: number;
}

export const PRE_AUTH_WEBSOCKET_LIMITS: Readonly<PreAuthWebSocketLimits> = Object.freeze({
  maxMessages: 32,
  maxAggregateBytes: 64 * 1024,
  maxPayloadBytes: 16 * 1024,
  timeoutMs: 5_000,
});

export type PreAuthEnqueueResult =
  | "accepted"
  | "inactive"
  | "message_limit"
  | "aggregate_limit"
  | "payload_limit";

export class PreAuthWebSocketBuffer<Message> {
  private messages: Array<{ message: Message; bytes: number }> = [];
  private aggregateBytes = 0;
  private accepting = true;

  constructor(
    private readonly limits: Pick<
      PreAuthWebSocketLimits,
      "maxMessages" | "maxAggregateBytes" | "maxPayloadBytes"
    > = PRE_AUTH_WEBSOCKET_LIMITS,
  ) {}

  enqueue(message: Message, bytes: number): PreAuthEnqueueResult {
    if (!this.accepting) return "inactive";
    if (bytes > this.limits.maxPayloadBytes) return "payload_limit";
    if (this.messages.length >= this.limits.maxMessages) return "message_limit";
    if (this.aggregateBytes + bytes > this.limits.maxAggregateBytes) {
      return "aggregate_limit";
    }
    this.messages.push({ message, bytes });
    this.aggregateBytes += bytes;
    return "accepted";
  }

  release(): void {
    this.accepting = false;
    this.messages.length = 0;
    this.aggregateBytes = 0;
  }

  async drain(
    process: (message: Message) => void | Promise<void>,
    canContinue: () => boolean,
  ): Promise<boolean> {
    if (!this.accepting || !canContinue()) {
      this.release();
      return false;
    }
    this.accepting = false;
    const queued = this.messages;
    this.messages = [];
    this.aggregateBytes = 0;
    for (const { message } of queued) {
      if (!canContinue()) return false;
      await process(message);
    }
    return true;
  }

  get retainedMessageCount(): number {
    return this.messages.length;
  }

  get retainedBytes(): number {
    return this.aggregateBytes;
  }

  get isAccepting(): boolean {
    return this.accepting;
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
  | "capabilities_changed"
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
    case "capabilities_changed":
      return "Your account permissions changed. Updating access.";
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