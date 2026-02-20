let nextId = 1;

function toMs(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export class PostQueue {
  constructor({ retryIntervalMinutes = 5, maxRetries = 3, store, backend = null } = {}) {
    this.retryIntervalMs = retryIntervalMinutes * 60 * 1000;
    this.maxRetries = maxRetries;
    this.backend = backend;
    this.store = store;
    this.items = this.backend ? [] : (store ? store.readQueue() : []);
    this.usesDatabaseLock = Boolean(this.backend?.usesDatabaseLock);

    const seen = this.items
      .map((item) => Number(String(item.id || '').replace('q_', '')))
      .filter((n) => Number.isFinite(n));
    if (seen.length > 0) {
      nextId = Math.max(nextId, Math.max(...seen) + 1);
    }
  }

  #persist() {
    if (this.backend) return;
    if (this.store) this.store.writeQueue(this.items);
  }

  schedule(item) {
    if (this.backend) return this.backend.schedule(item);
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
    if (this.backend) return this.backend.listQueue();
    return [...this.items];
  }

  get(id) {
    if (this.backend) return this.backend.getQueueItem(id);
    return this.items.find((item) => item.id === id) || null;
  }

  findScheduleConflict({ platform, scheduledAt, minGapHours }) {
    if (this.backend) return this.backend.findScheduleConflict({ platform, scheduledAt, minGapHours });
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
    if (this.backend) return this.backend.due(nowIso);
    return this.items.filter(
      (item) =>
        (item.status === 'scheduled' || item.status === 'retrying') &&
        item.scheduledAt <= nowIso &&
        (!item.nextRetryAt || item.nextRetryAt <= nowIso)
    );
  }

  markFailed(id, errorMessage, nowMs = Date.now()) {
    if (this.backend) return this.backend.markFailed(id, errorMessage, nowMs);
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
    if (this.backend) return this.backend.markPosted(id, remoteId, nowMs);
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
    if (this.backend) return this.backend.remove(id);
    const before = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    const changed = this.items.length < before;
    if (changed) this.#persist();
    return changed;
  }

  deadLetters() {
    if (this.backend) return this.backend.deadLetters();
    return this.items.filter((item) => item.status === 'dead_letter');
  }

  replayDeadLetter(id, scheduledAt = new Date().toISOString()) {
    if (this.backend) return this.backend.replayDeadLetter(id, scheduledAt);
    const item = this.items.find((x) => x.id === id && x.status === 'dead_letter');
    if (!item) return null;
    item.status = 'scheduled';
    item.retries = 0;
    item.nextRetryAt = null;
    item.lastError = null;
    item.deadLetterAt = null;
    item.deadLetterReason = null;
    item.scheduledAt = scheduledAt;
    item.replayedAt = new Date().toISOString();
    this.#persist();
    return item;
  }
}
