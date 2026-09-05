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
      try { socket.send(JSON.stringify({ type: "authorization_changed" })); } catch {}
      socket.close(1008, reason);
    }
  }

  if (room.size === 0) sessionRooms.delete(sessionId);
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
      try { socket.send(JSON.stringify({ type: "authorization_changed" })); } catch {}
      socket.close(1008, reason);
    }
  }
}