let _count = 0;

export const taskTracker = {
  increment(): void { _count++; },
  decrement(): void { if (_count > 0) _count--; },
  count(): number { return _count; },
};
