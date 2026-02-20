export class StateService {
  constructor({ store, retention = {}, backend = null }) {
    this.store = store;
    this.backend = backend;
    this.retention = {
      approvalsMaxAgeDays: retention.approvalsMaxAgeDays ?? 30,
      idempotencyMaxAgeDays: retention.idempotencyMaxAgeDays ?? 14,
      noncesMaxAgeDays: retention.noncesMaxAgeDays ?? 1,
      maxApprovals: retention.maxApprovals ?? 5000,
      maxIdempotencyKeys: retention.maxIdempotencyKeys ?? 10000
    };
    this.state = this.backend ? null : store.readState();
    this.lastPruneMs = 0;
    this.pruneIntervalMs = 60_000;
    if (!this.backend) this.#migrateState();
  }

  #persist() {
    if (this.backend) return;
    this.store.writeState(this.state);
  }

  #migrateState() {
    let changed = false;

    if (!Array.isArray(this.state.approvals)) {
      this.state.approvals = [];
      changed = true;
    }

    if (!this.state.idempotency || typeof this.state.idempotency !== 'object') {
      this.state.idempotency = {};
      changed = true;
    }

    if (!this.state.nonces || typeof this.state.nonces !== 'object') {
      this.state.nonces = {};
      changed = true;
    }
    if (!this.state.workerLock || typeof this.state.workerLock !== 'object') {
      this.state.workerLock = null;
      changed = true;
    }

    if (!this.state.metrics || typeof this.state.metrics !== 'object') {
      this.state.metrics = {
        requestCount: 0,
        errorCount: 0,
        commandCount: 0,
        latencyMs: { count: 0, total: 0, max: 0 }
      };
      changed = true;
    }

    for (const [key, entry] of Object.entries(this.state.idempotency)) {
      if (entry && typeof entry === 'object' && Object.hasOwn(entry, 'savedAt') && Object.hasOwn(entry, 'value')) {
        continue;
      }
      this.state.idempotency[key] = {
        savedAt: new Date().toISOString(),
        value: entry
      };
      changed = true;
    }

    if (changed) this.#persist();
  }

  getSession(userId) {
    if (this.backend) return this.backend.getSession(userId);
    if (!this.state.sessions[userId]) {
      this.state.sessions[userId] = {
        authenticatedAt: null,
        lastSeenAt: null,
        failedAttempts: [],
        lockedUntil: null,
        mode: 'default',
        pendingApprovals: []
      };
      this.#persist();
    }
    return this.state.sessions[userId];
  }

  saveSession(userId, session) {
    if (this.backend) return this.backend.saveSession(userId, session);
    this.state.sessions[userId] = session;
    this.#persist();
  }

  addApproval(approval) {
    if (this.backend) return this.backend.addApproval(approval);
    this.state.approvals.push(approval);
    this.#persist();
    return approval;
  }

  getApproval(id) {
    if (this.backend) return this.backend.getApproval(id);
    return this.state.approvals.find((a) => a.id === id) || null;
  }

  listApprovals() {
    if (this.backend) return this.backend.listApprovals();
    return [...this.state.approvals];
  }

  updateApproval(id, patch) {
    if (this.backend) return this.backend.updateApproval(id, patch);
    const item = this.state.approvals.find((a) => a.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    this.#persist();
    return item;
  }

  setIdempotency(key, value, savedAt = new Date().toISOString()) {
    if (this.backend) return this.backend.setIdempotency(key, value, savedAt);
    this.state.idempotency[key] = { savedAt, value };
    this.#persist();
  }

  getIdempotency(key) {
    if (this.backend) return this.backend.getIdempotency(key);
    const entry = this.state.idempotency[key];
    if (!entry) return null;
    if (entry && typeof entry === 'object' && Object.hasOwn(entry, 'value')) {
      return entry.value;
    }
    return entry;
  }

  seenNonce(nonce) {
    if (this.backend) return this.backend.seenNonce(nonce);
    return Boolean(this.state.nonces[nonce]);
  }

  registerNonce(nonce, timestampMs) {
    if (this.backend) return this.backend.registerNonce(nonce, timestampMs);
    this.state.nonces[nonce] = timestampMs;
    this.#persist();
  }

  pruneNonces(cutoffMs) {
    if (this.backend) return this.backend.pruneNonces(cutoffMs);
    let changed = false;
    for (const [nonce, ts] of Object.entries(this.state.nonces)) {
      if (Number(ts) < cutoffMs) {
        delete this.state.nonces[nonce];
        changed = true;
      }
    }
    if (changed) this.#persist();
  }

  pruneRetention(nowMs = Date.now()) {
    if (nowMs - this.lastPruneMs < this.pruneIntervalMs) return;
    this.lastPruneMs = nowMs;
    if (this.backend) return this.backend.pruneRetention(nowMs, this.retention);
    let changed = false;

    const approvalsCutoffMs = nowMs - this.retention.approvalsMaxAgeDays * 24 * 60 * 60 * 1000;
    const idempotencyCutoffMs = nowMs - this.retention.idempotencyMaxAgeDays * 24 * 60 * 60 * 1000;
    const noncesCutoffMs = nowMs - this.retention.noncesMaxAgeDays * 24 * 60 * 60 * 1000;

    const keptApprovals = this.state.approvals.filter((item) => {
      const ts = Date.parse(item?.createdAt || '');
      return !Number.isFinite(ts) || ts >= approvalsCutoffMs;
    });
    if (keptApprovals.length !== this.state.approvals.length) {
      this.state.approvals = keptApprovals;
      changed = true;
    }

    if (this.state.approvals.length > this.retention.maxApprovals) {
      const byAgeDesc = [...this.state.approvals].sort((a, b) => {
        const ta = Date.parse(a?.createdAt || '');
        const tb = Date.parse(b?.createdAt || '');
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      });
      this.state.approvals = byAgeDesc.slice(0, this.retention.maxApprovals);
      changed = true;
    }

    const keptIdempotencyEntries = Object.entries(this.state.idempotency).filter(([, entry]) => {
      const ts = Date.parse(entry?.savedAt || '');
      return !Number.isFinite(ts) || ts >= idempotencyCutoffMs;
    });
    if (keptIdempotencyEntries.length !== Object.keys(this.state.idempotency).length) {
      this.state.idempotency = Object.fromEntries(keptIdempotencyEntries);
      changed = true;
    }

    const idempotencyEntries = Object.entries(this.state.idempotency);
    if (idempotencyEntries.length > this.retention.maxIdempotencyKeys) {
      idempotencyEntries.sort(([, a], [, b]) => {
        const ta = Date.parse(a?.savedAt || '');
        const tb = Date.parse(b?.savedAt || '');
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      });
      this.state.idempotency = Object.fromEntries(idempotencyEntries.slice(0, this.retention.maxIdempotencyKeys));
      changed = true;
    }

    for (const [nonce, ts] of Object.entries(this.state.nonces)) {
      if (Number(ts) < noncesCutoffMs) {
        delete this.state.nonces[nonce];
        changed = true;
      }
    }

    if (changed) this.#persist();
  }

  incrementMetric(key, by = 1) {
    if (this.backend) return this.backend.incrementMetric(key, by);
    this.state.metrics[key] = (this.state.metrics[key] || 0) + by;
    this.#persist();
  }

  acquireWorkerLock(ownerId, ttlMs, nowMs = Date.now()) {
    if (this.backend) return this.backend.acquireWorkerLock(ownerId, ttlMs, nowMs);
    const lock = this.state.workerLock;
    if (!lock || lock.expiresAt <= nowMs || lock.ownerId === ownerId) {
      this.state.workerLock = {
        ownerId,
        acquiredAt: nowMs,
        expiresAt: nowMs + ttlMs
      };
      this.#persist();
      return true;
    }
    return false;
  }

  renewWorkerLock(ownerId, ttlMs, nowMs = Date.now()) {
    if (this.backend) return this.backend.renewWorkerLock(ownerId, ttlMs, nowMs);
    const lock = this.state.workerLock;
    if (!lock || lock.ownerId !== ownerId) return false;
    this.state.workerLock = {
      ...lock,
      expiresAt: nowMs + ttlMs
    };
    this.#persist();
    return true;
  }

  releaseWorkerLock(ownerId) {
    if (this.backend) return this.backend.releaseWorkerLock(ownerId);
    const lock = this.state.workerLock;
    if (!lock || lock.ownerId !== ownerId) return false;
    this.state.workerLock = null;
    this.#persist();
    return true;
  }

  currentWorkerLock() {
    if (this.backend) return this.backend.currentWorkerLock();
    return this.state.workerLock;
  }

  observeLatency(ms) {
    if (this.backend) return this.backend.observeLatency(ms);
    const bucket = this.state.metrics.latencyMs;
    bucket.count += 1;
    bucket.total += ms;
    bucket.max = Math.max(bucket.max, ms);
    this.#persist();
  }

  getMetrics() {
    if (this.backend) return this.backend.getMetrics();
    return this.state.metrics;
  }
}
