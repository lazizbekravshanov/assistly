# Changelog

## 2026-02-20 (b)

### Security
- Fixed session token HMAC verification to use `crypto.timingSafeEqual` instead of string comparison, closing a timing-attack vector.
- Fixed regex global-flag state leak in content safety scanner — `EMAIL` and `PHONE` checks now work reliably on every call.
- Fixed nonce replay check ordering — nonces are now verified before pruning, closing a replay window.
- Made worker lock acquisition atomic in Postgres via single `INSERT ON CONFLICT DO UPDATE WHERE`, preventing race conditions.
- Expanded prompt injection detection from 3 to 10 patterns.
- Expanded secret redaction to cover `apikey`, `api_key`, `password`, `pwd`, `credential`, `private_key`, `privatekey`.
- Replaced hardcoded dev secrets in `runtime_config.json` with `CHANGE-ME` placeholders.
- Empty-string platform tokens now fail `assertConfigured` validation.

### Performance
- Added 6 partial database indexes: `idx_queue_due`, `idx_queue_conflict`, `idx_queue_dead_letter`, `idx_approvals_created`, `idx_idempotency_saved`, `idx_nonces_timestamp`.
- Made `incrementMetric` and `observeLatency` atomic in Postgres using `jsonb_set` arithmetic instead of read-modify-write.
- Made `updateApproval` a single `UPDATE ... RETURNING` query instead of SELECT + UPDATE.
- Added `listQueue` pagination support (`limit`/`offset`) in Postgres backend.
- Debounced `pruneRetention` to run at most once per minute instead of on every request.

### Reliability
- Added TTL-based eviction and `maxKeys` cap (10k) to rate limiter to prevent OOM under high-cardinality traffic.
- Added graceful shutdown to both API server and worker — drains PG pool, flushes mirror, 10s forced-exit timeout.
- Worker tick errors are now logged via `worker.tick_error` instead of silently swallowed.
- Alert delivery failures are now logged via `alert.delivery_failed` instead of silently caught.
- Mirror flush errors now logged to stderr on rollback.
- Added `close()` method to `PostgresBackend` for proper connection draining.
- Added configurable `poolSize` parameter for Postgres connection pool (default 10).

### Observability
- Added structured `webhook.response` and `webhook.error` log events to the server request path.

### Configuration
- Made auth lockout thresholds configurable: `maxFailedAttempts`, `failedWindowMinutes`, `lockoutMinutes`.
- Added config validation for `SESSION_TIMEOUT_MINUTES`, `SCHEDULE_MAX_RETRIES`, `SCHEDULE_WORKER_LOCK_SECONDS`.
- Removed unused config fields: `voice`, `weeklySchedule`, `autoPostCategories`, `dailySummaryTime`, `mentionCheckIntervalMinutes`, `autoUnpinDays`, `subscriberDropThresholdPercent`, `commentCheckIntervalMinutes`.

## 2026-02-20

- Added API/worker runtime split with `start:api` and `start:worker`.
- Added Postgres durability mirror and migration script.
- Added signed admin session tokens and token-based session restore.
- Added DLQ operator commands (`/dlq list`, `/dlq replay <id>`).
- Added server contract tests for replay/signature/schema/rate limit checks.
- Added alert hook service for critical security and queue events.

