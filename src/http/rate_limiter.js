export class FixedWindowRateLimiter {
  constructor({ limit = 60, windowMs = 60 * 1000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.windows = new Map();
  }

  consume(key, nowMs = Date.now()) {
    const safeKey = key || 'unknown';
    const current = this.windows.get(safeKey);
    if (!current || nowMs - current.startedAt >= this.windowMs) {
      this.windows.set(safeKey, { startedAt: nowMs, count: 1 });
      return { allowed: true, remaining: this.limit - 1, resetMs: nowMs + this.windowMs };
    }

    current.count += 1;
    if (current.count > this.limit) {
      return { allowed: false, remaining: 0, resetMs: current.startedAt + this.windowMs };
    }
    return { allowed: true, remaining: this.limit - current.count, resetMs: current.startedAt + this.windowMs };
  }
}

