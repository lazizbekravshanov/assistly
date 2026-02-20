const SECRET_KEYS = ['passphrase', 'token', 'secret', 'authorization', 'access'];

function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length <= 8) return '***';
    return `${value.slice(0, 3)}***${value.slice(-2)}`;
  }
  return '***';
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};

  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (SECRET_KEYS.some((k) => lower.includes(k))) {
      out[key] = redact(val);
      continue;
    }

    if (val && typeof val === 'object') {
      out[key] = sanitizeObject(val);
    } else {
      out[key] = val;
    }
  }

  return out;
}

export class Logger {
  constructor({ store, maxEntries = 5000, maxAgeDays = 180 }) {
    this.store = store;
    this.maxEntries = maxEntries;
    this.maxAgeDays = maxAgeDays;
    this.entries = store ? store.readLogs() : [];
  }

  log(event, metadata = {}) {
    this.#pruneOldEntries();

    const entry = {
      ts: new Date().toISOString(),
      event,
      metadata: sanitizeObject(metadata)
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    if (this.store) {
      this.store.writeLogs(this.entries);
    }

    return entry;
  }

  getRecent(limit = 50) {
    return this.entries.slice(-limit);
  }

  #pruneOldEntries(nowMs = Date.now()) {
    const cutoff = nowMs - this.maxAgeDays * 24 * 60 * 60 * 1000;
    this.entries = this.entries.filter((entry) => {
      const ts = Date.parse(entry?.ts || '');
      return !Number.isFinite(ts) || ts >= cutoff;
    });
  }
}
