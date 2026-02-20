import { Pool } from 'pg';

const METRICS_DEFAULT = {
  requestCount: 0,
  errorCount: 0,
  commandCount: 0,
  latencyMs: { count: 0, total: 0, max: 0 }
};

function defaultSession() {
  return {
    authenticatedAt: null,
    lastSeenAt: null,
    failedAttempts: [],
    lockedUntil: null,
    mode: 'default',
    pendingApprovals: []
  };
}

function parseQueueId(id) {
  if (typeof id === 'number') return id;
  const normalized = String(id || '').replace(/^q_/, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToQueueItem(row) {
  return {
    id: `q_${row.id}`,
    status: row.status,
    retries: row.retries,
    createdAt: row.created_at?.toISOString() || null,
    platform: row.platform,
    scheduledAt: row.scheduled_at?.toISOString() || null,
    content: row.content,
    idempotencyKey: row.idempotency_key,
    nextRetryAt: row.next_retry_at?.toISOString() || null,
    remoteId: row.remote_id,
    postedAt: row.posted_at?.toISOString() || null,
    lastError: row.last_error,
    deadLetterAt: row.dead_letter_at?.toISOString() || null,
    deadLetterReason: row.dead_letter_reason,
    replayedAt: row.replayed_at?.toISOString() || null
  };
}

export class PostgresBackend {
  constructor({ databaseUrl, retryIntervalMinutes = 5, maxRetries = 3, poolSize = 10 }) {
    this.pool = new Pool({ connectionString: databaseUrl, max: poolSize });
    this.retryIntervalMs = retryIntervalMinutes * 60 * 1000;
    this.maxRetries = maxRetries;
    this.usesDatabaseLock = true;
    this.initPromise = null;
  }

  async close() {
    await this.pool.end();
  }

  async #init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.pool.query(`
      CREATE TABLE IF NOT EXISTS assistly_sessions (
        user_id TEXT PRIMARY KEY,
        session JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS assistly_approvals (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assistly_idempotency (
        key TEXT PRIMARY KEY,
        saved_at TIMESTAMPTZ NOT NULL,
        value JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assistly_nonces (
        nonce TEXT PRIMARY KEY,
        timestamp_ms BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assistly_metrics (
        id SMALLINT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS assistly_worker_lock (
        id SMALLINT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        acquired_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assistly_queue_jobs (
        id BIGSERIAL PRIMARY KEY,
        status TEXT NOT NULL,
        retries INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        platform TEXT NOT NULL,
        scheduled_at TIMESTAMPTZ NOT NULL,
        content TEXT NOT NULL,
        idempotency_key TEXT NULL,
        next_retry_at TIMESTAMPTZ NULL,
        remote_id TEXT NULL,
        posted_at TIMESTAMPTZ NULL,
        last_error TEXT NULL,
        dead_letter_at TIMESTAMPTZ NULL,
        dead_letter_reason TEXT NULL,
        replayed_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_queue_due
        ON assistly_queue_jobs (scheduled_at, next_retry_at)
        WHERE status IN ('scheduled', 'retrying');

      CREATE INDEX IF NOT EXISTS idx_queue_conflict
        ON assistly_queue_jobs (platform, scheduled_at)
        WHERE status IN ('scheduled', 'retrying', 'processing');

      CREATE INDEX IF NOT EXISTS idx_queue_dead_letter
        ON assistly_queue_jobs (id)
        WHERE status = 'dead_letter';

      CREATE INDEX IF NOT EXISTS idx_approvals_created
        ON assistly_approvals (created_at);

      CREATE INDEX IF NOT EXISTS idx_idempotency_saved
        ON assistly_idempotency (saved_at);

      CREATE INDEX IF NOT EXISTS idx_nonces_timestamp
        ON assistly_nonces (timestamp_ms);
    `);
    await this.initPromise;
  }

  async getSession(userId) {
    await this.#init();
    const found = await this.pool.query('SELECT session FROM assistly_sessions WHERE user_id = $1', [userId]);
    if (found.rowCount > 0) return found.rows[0].session;

    const session = defaultSession();
    await this.saveSession(userId, session);
    return session;
  }

  async saveSession(userId, session) {
    await this.#init();
    await this.pool.query(
      `INSERT INTO assistly_sessions (user_id, session, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET session = EXCLUDED.session, updated_at = NOW()`,
      [userId, JSON.stringify(session)]
    );
  }

  async addApproval(approval) {
    await this.#init();
    await this.pool.query(
      `INSERT INTO assistly_approvals (id, status, created_at, payload)
       VALUES ($1, $2, $3::timestamptz, $4::jsonb)`,
      [approval.id, approval.status, approval.createdAt, JSON.stringify(approval)]
    );
    return approval;
  }

  async getApproval(id) {
    await this.#init();
    const found = await this.pool.query('SELECT payload FROM assistly_approvals WHERE id = $1', [id]);
    return found.rowCount > 0 ? found.rows[0].payload : null;
  }

  async listApprovals() {
    await this.#init();
    const found = await this.pool.query('SELECT payload FROM assistly_approvals ORDER BY created_at DESC');
    return found.rows.map((row) => row.payload);
  }

  async updateApproval(id, patch) {
    const result = await this.pool.query(
      `UPDATE assistly_approvals
       SET status = COALESCE($2, status),
           payload = payload || $3::jsonb
       WHERE id = $1
       RETURNING payload`,
      [id, patch.status || null, JSON.stringify(patch)]
    );
    return result.rowCount > 0 ? result.rows[0].payload : null;
  }

  async setIdempotency(key, value, savedAt = new Date().toISOString()) {
    await this.#init();
    await this.pool.query(
      `INSERT INTO assistly_idempotency (key, saved_at, value)
       VALUES ($1, $2::timestamptz, $3::jsonb)
       ON CONFLICT (key)
       DO UPDATE SET saved_at = EXCLUDED.saved_at, value = EXCLUDED.value`,
      [key, savedAt, JSON.stringify(value)]
    );
  }

  async getIdempotency(key) {
    await this.#init();
    const found = await this.pool.query('SELECT value FROM assistly_idempotency WHERE key = $1', [key]);
    return found.rowCount > 0 ? found.rows[0].value : null;
  }

  async seenNonce(nonce) {
    await this.#init();
    const found = await this.pool.query('SELECT 1 FROM assistly_nonces WHERE nonce = $1', [nonce]);
    return found.rowCount > 0;
  }

  async registerNonce(nonce, timestampMs) {
    await this.#init();
    await this.pool.query(
      `INSERT INTO assistly_nonces (nonce, timestamp_ms)
       VALUES ($1, $2)
       ON CONFLICT (nonce)
       DO UPDATE SET timestamp_ms = EXCLUDED.timestamp_ms`,
      [nonce, timestampMs]
    );
  }

  async pruneNonces(cutoffMs) {
    await this.#init();
    await this.pool.query('DELETE FROM assistly_nonces WHERE timestamp_ms < $1', [cutoffMs]);
  }

  async pruneRetention(nowMs = Date.now(), retention = {}) {
    await this.#init();
    const approvalsCutoff = new Date(nowMs - (retention.approvalsMaxAgeDays ?? 30) * 24 * 60 * 60 * 1000);
    const idempotencyCutoff = new Date(nowMs - (retention.idempotencyMaxAgeDays ?? 14) * 24 * 60 * 60 * 1000);
    const noncesCutoff = nowMs - (retention.noncesMaxAgeDays ?? 1) * 24 * 60 * 60 * 1000;

    await this.pool.query('DELETE FROM assistly_approvals WHERE created_at < $1::timestamptz', [approvalsCutoff.toISOString()]);
    await this.pool.query('DELETE FROM assistly_idempotency WHERE saved_at < $1::timestamptz', [idempotencyCutoff.toISOString()]);
    await this.pool.query('DELETE FROM assistly_nonces WHERE timestamp_ms < $1', [noncesCutoff]);
  }

  async #metrics() {
    await this.#init();
    const found = await this.pool.query('SELECT payload FROM assistly_metrics WHERE id = 1');
    if (found.rowCount > 0) return found.rows[0].payload;
    await this.pool.query(
      `INSERT INTO assistly_metrics (id, payload, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(METRICS_DEFAULT)]
    );
    return { ...METRICS_DEFAULT, latencyMs: { ...METRICS_DEFAULT.latencyMs } };
  }

  async incrementMetric(key, by = 1) {
    await this.#metrics();
    await this.pool.query(
      `UPDATE assistly_metrics
       SET payload = jsonb_set(payload, $1::text[], to_jsonb((COALESCE((payload->>$2)::numeric, 0) + $3)::numeric)),
           updated_at = NOW()
       WHERE id = 1`,
      [`{${key}}`, key, by]
    );
  }

  async observeLatency(ms) {
    await this.#metrics();
    await this.pool.query(
      `UPDATE assistly_metrics
       SET payload = jsonb_set(
         jsonb_set(
           jsonb_set(
             payload,
             '{latencyMs,count}',
             to_jsonb(COALESCE((payload->'latencyMs'->>'count')::numeric, 0) + 1)
           ),
           '{latencyMs,total}',
           to_jsonb(COALESCE((payload->'latencyMs'->>'total')::numeric, 0) + $1)
         ),
         '{latencyMs,max}',
         to_jsonb(GREATEST(COALESCE((payload->'latencyMs'->>'max')::numeric, 0), $1))
       ),
       updated_at = NOW()
       WHERE id = 1`,
      [ms]
    );
  }

  async getMetrics() {
    return this.#metrics();
  }

  async acquireWorkerLock(ownerId, ttlMs, nowMs = Date.now()) {
    await this.#init();
    const result = await this.pool.query(
      `INSERT INTO assistly_worker_lock (id, owner_id, acquired_at, expires_at)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET owner_id = EXCLUDED.owner_id,
             acquired_at = EXCLUDED.acquired_at,
             expires_at = EXCLUDED.expires_at
         WHERE assistly_worker_lock.expires_at <= $2
            OR assistly_worker_lock.owner_id = $1
       RETURNING id`,
      [ownerId, nowMs, nowMs + ttlMs]
    );
    return result.rowCount > 0;
  }

  async renewWorkerLock(ownerId, ttlMs, nowMs = Date.now()) {
    await this.#init();
    const result = await this.pool.query(
      `UPDATE assistly_worker_lock
       SET expires_at = $2
       WHERE id = 1 AND owner_id = $1`,
      [ownerId, nowMs + ttlMs]
    );
    return result.rowCount > 0;
  }

  async releaseWorkerLock(ownerId) {
    await this.#init();
    const result = await this.pool.query('DELETE FROM assistly_worker_lock WHERE id = 1 AND owner_id = $1', [ownerId]);
    return result.rowCount > 0;
  }

  async currentWorkerLock() {
    await this.#init();
    const found = await this.pool.query('SELECT owner_id, acquired_at, expires_at FROM assistly_worker_lock WHERE id = 1');
    if (found.rowCount === 0) return null;
    const row = found.rows[0];
    return {
      ownerId: row.owner_id,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at
    };
  }

  async schedule(item) {
    await this.#init();
    const inserted = await this.pool.query(
      `INSERT INTO assistly_queue_jobs (
        status, retries, created_at, platform, scheduled_at, content, idempotency_key, updated_at
      ) VALUES ('scheduled', 0, NOW(), $1, $2::timestamptz, $3, $4, NOW())
      RETURNING *`,
      [item.platform, item.scheduledAt, item.content, item.idempotencyKey || null]
    );
    return rowToQueueItem(inserted.rows[0]);
  }

  async listQueue({ limit = 500, offset = 0 } = {}) {
    await this.#init();
    const rows = await this.pool.query(
      'SELECT * FROM assistly_queue_jobs ORDER BY id ASC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return rows.rows.map(rowToQueueItem);
  }

  async getQueueItem(id) {
    await this.#init();
    const parsed = parseQueueId(id);
    if (parsed === null) return null;
    const found = await this.pool.query('SELECT * FROM assistly_queue_jobs WHERE id = $1', [parsed]);
    return found.rowCount > 0 ? rowToQueueItem(found.rows[0]) : null;
  }

  async findScheduleConflict({ platform, scheduledAt, minGapHours }) {
    await this.#init();
    const thresholdMs = minGapHours * 60 * 60 * 1000;
    const lower = new Date(Date.parse(scheduledAt) - thresholdMs).toISOString();
    const upper = new Date(Date.parse(scheduledAt) + thresholdMs).toISOString();
    const found = await this.pool.query(
      `SELECT * FROM assistly_queue_jobs
       WHERE platform = $1
         AND status IN ('scheduled', 'retrying', 'processing')
         AND scheduled_at >= $2::timestamptz
         AND scheduled_at <= $3::timestamptz
       ORDER BY scheduled_at ASC
       LIMIT 1`,
      [platform, lower, upper]
    );
    return found.rowCount > 0 ? rowToQueueItem(found.rows[0]) : null;
  }

  async due(nowIso = new Date().toISOString()) {
    await this.#init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        `SELECT id
         FROM assistly_queue_jobs
         WHERE status IN ('scheduled', 'retrying')
           AND scheduled_at <= $1::timestamptz
           AND (next_retry_at IS NULL OR next_retry_at <= $1::timestamptz)
         ORDER BY scheduled_at ASC
         FOR UPDATE SKIP LOCKED`,
        [nowIso]
      );
      if (claimed.rowCount === 0) {
        await client.query('COMMIT');
        return [];
      }
      const ids = claimed.rows.map((x) => x.id);
      const updated = await client.query(
        `UPDATE assistly_queue_jobs
         SET status = 'processing', updated_at = NOW()
         WHERE id = ANY($1::bigint[])
         RETURNING *`,
        [ids]
      );
      await client.query('COMMIT');
      return updated.rows.map(rowToQueueItem);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailed(id, errorMessage, nowMs = Date.now()) {
    await this.#init();
    const parsed = parseQueueId(id);
    if (parsed === null) return null;
    const found = await this.pool.query('SELECT retries FROM assistly_queue_jobs WHERE id = $1', [parsed]);
    if (found.rowCount === 0) return null;
    const retries = Number(found.rows[0].retries || 0) + 1;
    const nowIso = new Date(nowMs).toISOString();

    if (retries >= this.maxRetries) {
      const updated = await this.pool.query(
        `UPDATE assistly_queue_jobs
         SET retries = $2, status = 'dead_letter', last_error = $3, dead_letter_at = $4::timestamptz,
             dead_letter_reason = $3, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [parsed, retries, String(errorMessage || 'Unknown publish error'), nowIso]
      );
      return updated.rowCount > 0 ? rowToQueueItem(updated.rows[0]) : null;
    }

    const nextRetryAt = new Date(nowMs + this.retryIntervalMs).toISOString();
    const updated = await this.pool.query(
      `UPDATE assistly_queue_jobs
       SET retries = $2, status = 'retrying', last_error = $3, next_retry_at = $4::timestamptz, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [parsed, retries, String(errorMessage || 'Unknown publish error'), nextRetryAt]
    );
    return updated.rowCount > 0 ? rowToQueueItem(updated.rows[0]) : null;
  }

  async markPosted(id, remoteId, nowMs = Date.now()) {
    await this.#init();
    const parsed = parseQueueId(id);
    if (parsed === null) return null;
    const updated = await this.pool.query(
      `UPDATE assistly_queue_jobs
       SET status = 'posted', remote_id = $2, posted_at = $3::timestamptz, next_retry_at = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [parsed, remoteId, new Date(nowMs).toISOString()]
    );
    return updated.rowCount > 0 ? rowToQueueItem(updated.rows[0]) : null;
  }

  async remove(id) {
    await this.#init();
    const parsed = parseQueueId(id);
    if (parsed === null) return false;
    const result = await this.pool.query('DELETE FROM assistly_queue_jobs WHERE id = $1', [parsed]);
    return result.rowCount > 0;
  }

  async deadLetters() {
    await this.#init();
    const found = await this.pool.query(`SELECT * FROM assistly_queue_jobs WHERE status = 'dead_letter' ORDER BY id ASC`);
    return found.rows.map(rowToQueueItem);
  }

  async replayDeadLetter(id, scheduledAt = new Date().toISOString()) {
    await this.#init();
    const parsed = parseQueueId(id);
    if (parsed === null) return null;
    const updated = await this.pool.query(
      `UPDATE assistly_queue_jobs
       SET status = 'scheduled', retries = 0, next_retry_at = NULL, last_error = NULL,
           dead_letter_at = NULL, dead_letter_reason = NULL, replayed_at = NOW(),
           scheduled_at = $2::timestamptz, updated_at = NOW()
       WHERE id = $1 AND status = 'dead_letter'
       RETURNING *`,
      [parsed, scheduledAt]
    );
    return updated.rowCount > 0 ? rowToQueueItem(updated.rows[0]) : null;
  }
}

