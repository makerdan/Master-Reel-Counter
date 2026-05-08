let _count = 0;

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
};
