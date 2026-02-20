# Rollback Guide

## Application Rollback

1. Identify the target commit or tag:
   ```bash
   git log --oneline -10
   ```

2. Deploy the previous version:
   ```bash
   git checkout <commit-hash>
   npm install
   ```

3. Restart both processes:
   ```bash
   npm run start:api
   npm run start:worker
   ```
   Both processes handle graceful shutdown — send `SIGTERM` to the running processes first and wait for clean exit before starting the old version.

## Storage Engine Rollback

If PostgreSQL is causing issues, switch back to JSON storage:

1. Set `STORAGE_ENGINE=json` in environment.
2. Restart API and worker.
3. The JSON store will start fresh from `data/` files. If `data/` is empty, state starts clean.
4. PostgreSQL tables can be left in place — the migration is additive and safe to keep.

## Database Schema Rollback

All auto-created tables and indexes use `IF NOT EXISTS`, so they are safe to leave in place across version changes. If you need to fully remove them:

```sql
-- Drop application tables (irreversible)
DROP TABLE IF EXISTS assistly_queue_jobs;
DROP TABLE IF EXISTS assistly_worker_lock;
DROP TABLE IF EXISTS assistly_metrics;
DROP TABLE IF EXISTS assistly_nonces;
DROP TABLE IF EXISTS assistly_idempotency;
DROP TABLE IF EXISTS assistly_approvals;
DROP TABLE IF EXISTS assistly_sessions;
DROP TABLE IF EXISTS assistly_events;
DROP TABLE IF EXISTS assistly_store;
```

## Validation

After rollback, verify the deployment is healthy:

1. Health check returns 200:
   ```bash
   curl http://localhost:8787/healthz
   ```

2. Readiness shows no lock contention:
   ```bash
   curl http://localhost:8787/readyz
   ```

3. Queue state is intact:
   - Send `/status` via webhook to check queue and approval counts.
   - Send `/dlq list` to check for dead-letter items.
   - Send `/queue` to browse scheduled items.

4. Check logs for errors:
   - Send `/logs limit=20` via webhook.
   - Look for `worker.tick_error`, `alert.delivery_failed`, or `webhook.error` events.

## Emergency: Worker Lock Stuck

If the worker lock is stuck (visible in `/readyz` output), the lock has a TTL (`SCHEDULE_WORKER_LOCK_SECONDS`, default 45s) and will auto-expire. For immediate release with PostgreSQL:

```sql
DELETE FROM assistly_worker_lock WHERE id = 1;
```

For JSON storage, edit `data/state.json` and set `"workerLock": null`.
