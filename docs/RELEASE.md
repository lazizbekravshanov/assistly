# Release Guide

## Pre-release Checklist

1. Run quality gates:
   ```bash
   npm run lint
   npm run security
   npm test
   ```
   All 30 tests must pass.

2. Verify configuration:
   - All `CHANGE-ME` placeholders in `config/runtime_config.json` must be overridden via environment variables.
   - Required env vars: `OWNER_ID`, `OWNER_PASSPHRASE`, `OWNER_SESSION_SECRET`.
   - If `OPENCLAW_ENFORCE_SIGNATURE=true`, set `OPENCLAW_WEBHOOK_SECRET` or `OPENCLAW_WEBHOOK_SECRETS`.
   - Config validation will reject invalid values for `SESSION_TIMEOUT_MINUTES`, `SCHEDULE_MAX_RETRIES`, and `SCHEDULE_WORKER_LOCK_SECONDS` at startup.

3. Configure at least one platform with valid credentials:
   - `TWITTER_ACCESS_TOKEN`
   - `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHANNEL_ID`
   - `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_PROFILE_ID`
   - Empty-string tokens will fail at post time with a clear error.

## Deploying with JSON Storage (default)

1. Set environment variables (see `.env.example`).
2. Start both processes:
   ```bash
   npm run start:api
   npm run start:worker
   ```
3. Data persists in `data/` directory (queue.json, state.json, logs.json).

## Deploying with PostgreSQL

1. Set environment variables:
   ```bash
   STORAGE_ENGINE=postgres
   DATABASE_URL=postgres://user:pass@host:5432/assistly
   ```
2. Run migrations:
   ```bash
   npm run migrate:postgres
   ```
   This creates `assistly_store` and `assistly_events` tables. The application auto-creates remaining tables (`assistly_sessions`, `assistly_approvals`, `assistly_queue_jobs`, etc.) and indexes on first startup.

3. Start API and worker:
   ```bash
   npm run start:api
   npm run start:worker
   ```

## Post-deploy Verification

1. Health check:
   ```bash
   curl http://localhost:8787/healthz
   # {"ok":true,"status":"healthy"}
   ```

2. Readiness check:
   ```bash
   curl http://localhost:8787/readyz
   # {"ready":true,"queueSize":0,...}
   ```

3. Metrics:
   ```bash
   curl http://localhost:8787/metrics
   # Prometheus-format output
   ```

4. Verify webhook processing:
   - Send a test webhook to `POST /webhook` with the owner passphrase.
   - Confirm authentication succeeds and session token is returned.
   - Send `/status` to verify command pipeline.

## Graceful Shutdown

Both API and worker handle `SIGTERM` and `SIGINT`:
- API server stops accepting new connections, drains in-flight requests, closes PostgreSQL pool and mirror service, then exits. Forces exit after 10 seconds if draining stalls.
- Worker stops the poll timer, closes PostgreSQL pool and mirror service, then exits.

## Alerts

To enable alert webhooks for critical events (auth lockout, dead-letter items, rate limiting):
```bash
ALERTS_ENABLED=true
ALERTS_WEBHOOK_URL=https://your-webhook-endpoint
ALERTS_TIMEOUT_MS=5000
```
Alert delivery failures are logged as `alert.delivery_failed` events.
