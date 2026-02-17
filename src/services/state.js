export class StateService {
  constructor({ store }) {
    this.store = store;
    this.state = store.readState();
  }

  #persist() {
    this.store.writeState(this.state);
  }

  getSession(userId) {
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
    this.state.sessions[userId] = session;
    this.#persist();
  }

  addApproval(approval) {
    this.state.approvals.push(approval);
    this.#persist();
    return approval;
  }

  getApproval(id) {
    return this.state.approvals.find((a) => a.id === id) || null;
  }

  listApprovals() {
    return [...this.state.approvals];
  }

  updateApproval(id, patch) {
    const item = this.state.approvals.find((a) => a.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    this.#persist();
    return item;
  }

  setIdempotency(key, value) {
    this.state.idempotency[key] = value;
    this.#persist();
  }

  getIdempotency(key) {
    return this.state.idempotency[key] || null;
  }

  seenNonce(nonce) {
    return Boolean(this.state.nonces[nonce]);
  }

  registerNonce(nonce, timestampMs) {
    this.state.nonces[nonce] = timestampMs;
    this.#persist();
  }

  pruneNonces(cutoffMs) {
    for (const [nonce, ts] of Object.entries(this.state.nonces)) {
      if (Number(ts) < cutoffMs) delete this.state.nonces[nonce];
    }
    this.#persist();
  }

  incrementMetric(key, by = 1) {
    this.state.metrics[key] = (this.state.metrics[key] || 0) + by;
    this.#persist();
  }

  observeLatency(ms) {
    const bucket = this.state.metrics.latencyMs;
    bucket.count += 1;
    bucket.total += ms;
    bucket.max = Math.max(bucket.max, ms);
    this.#persist();
  }

  getMetrics() {
    return this.state.metrics;
  }
}
