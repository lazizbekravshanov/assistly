import { Pool } from 'pg';

export class PostgresMirrorService {
  constructor({
    connectionString,
    enabled = false
  } = {}) {
    this.enabled = enabled && Boolean(connectionString);
    this.connectionString = connectionString;
    this.pool = this.enabled ? new Pool({ connectionString }) : null;
    this.initPromise = null;
    this.queue = [];
    this.flushing = false;
  }

  async #init() {
    if (!this.enabled || !this.pool) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.pool.query(`
      CREATE TABLE IF NOT EXISTS assistly_store (
        kind TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS assistly_events (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.initPromise;
  }

  enqueueSnapshot(kind, payload) {
    if (!this.enabled) return;
    this.queue.push({ type: 'snapshot', kind, payload, createdAt: new Date().toISOString() });
    this.#flushSoon();
  }

  enqueueEvent(eventType, payload) {
    if (!this.enabled) return;
    this.queue.push({ type: 'event', eventType, payload, createdAt: new Date().toISOString() });
    this.#flushSoon();
  }

  #flushSoon() {
    if (this.flushing) return;
    this.flushing = true;
    setImmediate(() => {
      this.flush().catch(() => {}).finally(() => {
        this.flushing = false;
        if (this.queue.length > 0) this.#flushSoon();
      });
    });
  }

  async flush() {
    if (!this.enabled || !this.pool || this.queue.length === 0) return;
    await this.#init();

    const batch = this.queue.splice(0, this.queue.length);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of batch) {
        if (item.type === 'snapshot') {
          await client.query(
            `INSERT INTO assistly_store (kind, payload, updated_at)
             VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (kind)
             DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
            [item.kind, JSON.stringify(item.payload)]
          );
        } else {
          await client.query(
            `INSERT INTO assistly_events (event_type, payload, created_at)
             VALUES ($1, $2::jsonb, NOW())`,
            [item.eventType, JSON.stringify(item.payload)]
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('postgres_mirror flush error:', error.message);
    } finally {
      client.release();
    }
  }

  async close() {
    if (!this.pool) return;
    await this.flush();
    await this.pool.end();
  }
}
