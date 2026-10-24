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
  revoked?: boolean;
};

type ClosableSocket = {
  readyState: number;
  send(data: string): void;
  close(code: number, reason: string): void;
};

export function broadcastRealtimeRoom<Socket extends ClosableSocket>(
  sessionRooms: Map<number, Set<Socket>>,
  sessionId: number,
  message: unknown,
  openReadyState: number,
  excludeSocket?: Socket,
): void {
  const room = sessionRooms.get(sessionId);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const socket of room) {
    if (socket !== excludeSocket && socket.readyState === openReadyState) socket.send(data);
  }
}

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
  for (const [socket, info] of socketUsers) {
    if (info.userId !== userId) continue;
    // Latch denial before close: pending joins may still hold this info object.
    info.revoked = true;
    if (info.sessionId !== null) {
      const room = sessionRooms.get(info.sessionId);
      room?.delete(socket);
      if (room?.size === 0) sessionRooms.delete(info.sessionId);
    }
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
}

/**
 * Shared production room-admission boundary. No async work may occur between
 * the final lifecycle check and membership insertion.
 */
export async function joinRealtimeRoom<Socket extends ClosableSocket>(
  socket: Socket,
  sessionId: number,
  options: {
    sessionRooms: Map<number, Set<Socket>>;
    socketUsers: Map<Socket, SessionSocketInfo>;
    openReadyState: number;
    authorization: RealtimeAuthorizationTracker;
    authorizeSession: (sessionId: number, userId: string) => Promise<{ role: string } | null>;
    accountOutcome: (userId: string) => Promise<"approved" | AuthorizationChangeOutcome>;
    broadcastPresence: (sessionId: number) => void;
  },
): Promise<void> {
  const { sessionRooms, socketUsers, openReadyState } = options;
  const info = socketUsers.get(socket);
  const isLive = () => Boolean(
    info?.userId && !info.revoked &&
    socketUsers.get(socket) === info && socket.readyState === openReadyState,
  );
  if (!isLive()) return;
  const userId = info!.userId!;
  const { access, outcome } = await options.authorization.authorizeConsistently(
    sessionId, async () => {
      const access = await options.authorizeSession(sessionId, userId);
      const outcome = await options.accountOutcome(userId);
      return { access, outcome };
    },
  );
  if (!isLive()) return;
  // Session ownership/collaboration alone does not grant account admission.
  if (outcome !== "approved") {
    evictUserSockets(sessionRooms, socketUsers, userId, openReadyState,
      "Account authorization required", outcome);
    return;
  }
  if (!access) {
    socket.send(JSON.stringify({
      type: "authorization_changed",
      outcome: "denied_join",
      message: authorizationChangeMessage("denied_join"),
    }));
    socket.close(1008, "Session access denied");
    return;
  }
  const prevSessionId = info!.sessionId;
  if (prevSessionId !== null) {
    const previousRoom = sessionRooms.get(prevSessionId);
    previousRoom?.delete(socket);
    if (previousRoom?.size === 0) sessionRooms.delete(prevSessionId);
    options.broadcastPresence(prevSessionId);
  }
  info!.sessionId = sessionId;
  info!.role = access.role;
  if (!sessionRooms.has(sessionId)) sessionRooms.set(sessionId, new Set());
  sessionRooms.get(sessionId)!.add(socket);
  socket.send(JSON.stringify({ type: "joined", sessionId }));
  options.broadcastPresence(sessionId);
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