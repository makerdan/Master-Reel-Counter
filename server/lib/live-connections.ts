export interface LiveConnectionLimits {
  maxConnections: number;
  maxPendingAuthentication: number;
  maxConnectionsPerUser: number;
}

export const LIVE_CONNECTION_LIMITS: Readonly<LiveConnectionLimits> = Object.freeze({
  maxConnections: 128,
  maxPendingAuthentication: 32,
  maxConnectionsPerUser: 8,
});

export interface ManagedLiveSocket {
  close(code?: number, reason?: string): void;
  terminate(): void;
  once(event: "close" | "error", listener: () => void): unknown;
}

export interface LiveConnectionLease {
  readonly isReleased: boolean;
  attach(socket: ManagedLiveSocket): void;
  identify(userId: string): boolean;
  release(): void;
}

export class LiveConnectionTracker {
  private readonly leases = new Set<InternalLease>();
  private readonly connectionsByUser = new Map<string, number>();
  private pendingAuthentication = 0;
  private accepting = true;

  constructor(
    private readonly limits: Readonly<LiveConnectionLimits> = LIVE_CONNECTION_LIMITS,
  ) {}

  tryAcquire(): LiveConnectionLease | null {
    if (
      !this.accepting ||
      this.leases.size >= this.limits.maxConnections ||
      this.pendingAuthentication >= this.limits.maxPendingAuthentication
    ) {
      return null;
    }

    let socket: ManagedLiveSocket | null = null;
    let userId: string | null = null;
    let authenticationSettled = false;
    let released = false;
    this.pendingAuthentication += 1;

    const lease: InternalLease = {
      get isReleased() {
        return released;
      },
      attach: (nextSocket) => {
        if (released) {
          nextSocket.terminate();
          return;
        }
        socket = nextSocket;
        nextSocket.once("close", lease.release);
        nextSocket.once("error", lease.release);
        if (!this.accepting) {
          try {
            nextSocket.close(1012, "Service restarting");
          } catch {
            nextSocket.terminate();
          }
        }
      },
      identify: (nextUserId) => {
        if (released || authenticationSettled || !nextUserId) return false;
        authenticationSettled = true;
        this.pendingAuthentication = Math.max(0, this.pendingAuthentication - 1);

        const currentUserConnections = this.connectionsByUser.get(nextUserId) ?? 0;
        if (currentUserConnections >= this.limits.maxConnectionsPerUser) return false;

        userId = nextUserId;
        this.connectionsByUser.set(nextUserId, currentUserConnections + 1);
        return true;
      },
      release: () => {
        if (released) return;
        released = true;
        this.leases.delete(lease);

        if (!authenticationSettled) {
          this.pendingAuthentication = Math.max(0, this.pendingAuthentication - 1);
          authenticationSettled = true;
        }
        if (userId !== null) {
          const nextCount = (this.connectionsByUser.get(userId) ?? 1) - 1;
          if (nextCount <= 0) this.connectionsByUser.delete(userId);
          else this.connectionsByUser.set(userId, nextCount);
          userId = null;
        }
        socket = null;
      },
      closeForDrain: () => {
        if (!socket) return;
        try {
          socket.close(1012, "Service restarting");
        } catch {
          socket.terminate();
        }
      },
      terminate: () => {
        if (!socket) {
          lease.release();
          return;
        }
        try {
          socket.terminate();
        } finally {
          lease.release();
        }
      },
    };

    this.leases.add(lease);
    return lease;
  }

  beginDrain(): void {
    if (!this.accepting) return;
    this.accepting = false;
    for (const lease of this.leases) {
      try {
        // Closing with 1012 lets collaboration clients distinguish a restart
        // from an authorization failure and reconnect to the replacement.
        lease.closeForDrain();
      } catch {
        lease.release();
      }
    }
  }

  terminateAll(): number {
    let terminated = 0;
    for (const lease of [...this.leases]) {
      try {
        lease.terminate();
        terminated += 1;
      } catch {
        lease.release();
      }
    }
    return terminated;
  }

  get activeCount(): number {
    return this.leases.size;
  }

  get pendingAuthenticationCount(): number {
    return this.pendingAuthentication;
  }

  get authenticatedCount(): number {
    return this.leases.size - this.pendingAuthentication;
  }

  get isAccepting(): boolean {
    return this.accepting;
  }
}

interface InternalLease extends LiveConnectionLease {
  closeForDrain(): void;
  terminate(): void;
}