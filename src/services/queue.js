let nextId = 1;

function toMs(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export class PostQueue {
  constructor({ retryIntervalMinutes = 5, maxRetries = 3, store } = {}) {
    this.retryIntervalMs = retryIntervalMinutes * 60 * 1000;
    this.maxRetries = maxRetries;
    this.store = store;
    this.items = store ? store.readQueue() : [];

    const seen = this.items
      .map((item) => Number(String(item.id || '').replace('q_', '')))
      .filter((n) => Number.isFinite(n));
    if (seen.length > 0) {
      nextId = Math.max(nextId, Math.max(...seen) + 1);
    }
  }

  #persist() {
    if (this.store) this.store.writeQueue(this.items);
  }

  schedule(item) {
    const queued = {
      id: `q_${nextId++}`,
      status: 'scheduled',
      retries: 0,
      createdAt: new Date().toISOString(),
      ...item
    };
    this.items.push(queued);
    this.#persist();
    return queued;
  }

  list() {
    return [...this.items];
  }

  findScheduleConflict({ platform, scheduledAt, minGapHours }) {
    const candidateMs = toMs(scheduledAt);
    if (!candidateMs) return null;
    const threshold = minGapHours * 60 * 60 * 1000;

    for (const item of this.items) {
      if (item.platform !== platform) continue;
      if (!['scheduled', 'retrying'].includes(item.status)) continue;
      const itemMs = toMs(item.scheduledAt);
      if (itemMs === null) continue;
      if (Math.abs(itemMs - candidateMs) < threshold) {
        return item;
      }
    }

    return null;
  }

  due(nowIso = new Date().toISOString()) {
    return this.items.filter(
      (item) =>
        (item.status === 'scheduled' || item.status === 'retrying') &&
        item.scheduledAt <= nowIso &&
        (!item.nextRetryAt || item.nextRetryAt <= nowIso)
    );
  }

  markFailed(id, errorMessage, nowMs = Date.now()) {
    const item = this.items.find((x) => x.id === id);
    if (!item) return null;

    item.retries += 1;
    item.lastError = String(errorMessage || 'Unknown publish error');

    if (item.retries >= this.maxRetries) {
      item.status = 'dead_letter';
      item.deadLetterAt = new Date(nowMs).toISOString();
      item.deadLetterReason = item.lastError;
      this.#persist();
      return item;
    }

    item.status = 'retrying';
    item.nextRetryAt = new Date(nowMs + this.retryIntervalMs).toISOString();
    this.#persist();
    return item;
  }

  markPosted(id, remoteId, nowMs = Date.now()) {
    const item = this.items.find((x) => x.id === id);
    if (!item) return null;
    item.status = 'posted';
    item.remoteId = remoteId;
    item.postedAt = new Date(nowMs).toISOString();
    item.nextRetryAt = null;
    this.#persist();
    return item;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    const changed = this.items.length < before;
    if (changed) this.#persist();
    return changed;
  }

  deadLetters() {
    return this.items.filter((item) => item.status === 'dead_letter');
  }
}
