# Migrations

## Postgres Init (`001_init_postgres.sql`)

**SQL:** `migrations/001_init_postgres.sql`
**Runner:** `npm run migrate:postgres`

Creates mirror tables:
- `assistly_store` — JSONB snapshots for queue, state, and logs (keyed by `kind`).
- `assistly_events` — append-only event log with `event_type` and JSONB payload.
- `idx_events_type_created` — index on `(event_type, created_at)` for event queries.

## Auto-created Tables

On first startup with `STORAGE_ENGINE=postgres`, the application auto-creates the following tables via `PostgresBackend.#init()`:

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `assistly_sessions` | User session state | `user_id` (PK), `session` (JSONB) |
| `assistly_approvals` | Pending/completed approvals | `id` (PK), `status`, `created_at`, `payload` (JSONB) |
| `assistly_idempotency` | Duplicate command prevention | `key` (PK), `saved_at`, `value` (JSONB) |
| `assistly_nonces` | Webhook replay prevention | `nonce` (PK), `timestamp_ms` |
| `assistly_metrics` | Aggregated request metrics | `id` (PK), `payload` (JSONB) |
| `assistly_worker_lock` | Distributed worker locking | `id` (PK), `owner_id`, `acquired_at`, `expires_at` |
| `assistly_queue_jobs` | Scheduled/retrying/posted jobs | `id` (serial PK), `status`, `platform`, `scheduled_at`, `content`, etc. |

## Auto-created Indexes

The following partial indexes are created automatically for query performance:

| Index | Table | Columns / Condition |
|-------|-------|---------------------|
| `idx_queue_due` | `assistly_queue_jobs` | `(scheduled_at, next_retry_at)` WHERE status IN ('scheduled', 'retrying') |
| `idx_queue_conflict` | `assistly_queue_jobs` | `(platform, scheduled_at)` WHERE status IN ('scheduled', 'retrying', 'processing') |
| `idx_queue_dead_letter` | `assistly_queue_jobs` | `(id)` WHERE status = 'dead_letter' |
| `idx_approvals_created` | `assistly_approvals` | `(created_at)` |
| `idx_idempotency_saved` | `assistly_idempotency` | `(saved_at)` |
| `idx_nonces_timestamp` | `assistly_nonces` | `(timestamp_ms)` |

## Connection Pool

The PostgreSQL connection pool defaults to 10 connections. Configure via the `poolSize` constructor parameter in `PostgresBackend`.

## Retention

Automated retention pruning runs at most once per minute and cleans up:
- Approvals older than `RETENTION_APPROVALS_DAYS` (default 30) or exceeding `RETENTION_MAX_APPROVALS` (default 5000).
- Idempotency keys older than `RETENTION_IDEMPOTENCY_DAYS` (default 14) or exceeding `RETENTION_MAX_IDEMPOTENCY` (default 10000).
- Nonces older than `RETENTION_NONCES_DAYS` (default 1).

## Adding New Migrations

1. Create a new SQL file: `migrations/002_description.sql`.
2. Add a runner entry in `scripts/migrate_postgres.js`.
3. Test with a fresh database and with an existing database.
4. Document changes in this file.
