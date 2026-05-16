export interface CrashRecord {
  timestamp: string;
  type: "uncaughtException" | "unhandledRejection";
  /** true = process will/did exit; false = non-fatal, process continued running */
  fatal: boolean;
  message: string;
  stack?: string;
}

const CRASH_HISTORY_MAX = 10;

let _count = 0;
let _lastCrash: CrashRecord | null = null;
let _crashHistory: CrashRecord[] = [];

export type SessionTaskType = "pdf" | "excel" | "scan";

interface SessionTaskCounts {
  pdf: number;
  excel: number;
  scan: number;
}

const _sessionTasks = new Map<number, SessionTaskCounts>();

export const taskTracker = {
  increment(): void { _count++; },
  decrement(): void { if (_count > 0) _count--; },
  count(): number { return _count; },

  startSession(sessionId: number, type: SessionTaskType): void {
    const cur = _sessionTasks.get(sessionId) ?? { pdf: 0, excel: 0, scan: 0 };
    _sessionTasks.set(sessionId, { ...cur, [type]: cur[type] + 1 });
  },

  endSession(sessionId: number, type: SessionTaskType): void {
    const cur = _sessionTasks.get(sessionId);
    if (!cur) return;
    const next: SessionTaskCounts = { ...cur, [type]: Math.max(0, cur[type] - 1) };
    if (next.pdf === 0 && next.excel === 0 && next.scan === 0) {
      _sessionTasks.delete(sessionId);
    } else {
      _sessionTasks.set(sessionId, next);
    }
  },

  getSessionTasks(sessionId: number): { pdf: boolean; excel: boolean; scan: boolean } {
    const cur = _sessionTasks.get(sessionId);
    if (!cur) return { pdf: false, excel: false, scan: false };
    return { pdf: cur.pdf > 0, excel: cur.excel > 0, scan: cur.scan > 0 };
  },

  recordCrash(type: CrashRecord["type"], err: unknown, fatal: boolean): CrashRecord {
    const error = err instanceof Error ? err : new Error(String(err));
    _lastCrash = {
      timestamp: new Date().toISOString(),
      type,
      fatal,
      message: error.message,
      stack: error.stack,
    };
    _crashHistory = [..._crashHistory, _lastCrash].slice(-CRASH_HISTORY_MAX);
    return _lastCrash;
  },

  /**
   * Seed the full crash history from persisted storage (called once on startup).
   * Sets lastCrash to the most recent record in the array.
   */
  seedCrashHistory(records: CrashRecord[]): void {
    _crashHistory = records.slice(-CRASH_HISTORY_MAX);
    _lastCrash = _crashHistory.length > 0 ? _crashHistory[_crashHistory.length - 1] : null;
  },

  /** @deprecated Use seedCrashHistory for full history. Kept for compatibility. */
  seedCrash(record: CrashRecord): void {
    _crashHistory = [..._crashHistory, record].slice(-CRASH_HISTORY_MAX);
    _lastCrash = record;
  },

  crashHistory(): CrashRecord[] { return _crashHistory; },
  lastCrash(): CrashRecord | null { return _lastCrash; },

  clearCrashHistory(): void {
    _crashHistory = [];
    _lastCrash = null;
  },
};
