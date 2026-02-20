export class FixedWindowRateLimiter {
  constructor({ limit = 60, windowMs = 60 * 1000, maxKeys = 10000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.windows = new Map();
    this.lastPurge = Date.now();
  }

  consume(key, nowMs = Date.now()) {
    if (nowMs - this.lastPurge >= this.windowMs) {
      this.#purgeExpired(nowMs);
    }

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

  #purgeExpired(nowMs) {
    this.lastPurge = nowMs;
    for (const [key, window] of this.windows) {
      if (nowMs - window.startedAt >= this.windowMs) {
        this.windows.delete(key);
      }
    }
    if (this.windows.size > this.maxKeys) {
      const excess = this.windows.size - this.maxKeys;
      const iter = this.windows.keys();
      for (let i = 0; i < excess; i++) {
        this.windows.delete(iter.next().value);
      }
    }
  }
}
