# Rollback Guide

1. Revert app to previous git tag/commit.
2. Restart API and worker using previous image/build.
3. If Postgres migration caused issues:
   - Keep schema in place (migration is additive and safe to leave).
   - Switch back to `STORAGE_ENGINE=json` and redeploy.
4. Validate:
   - `/healthz` is 200
   - `/readyz` has no lock contention
   - Queue status from `/queue` and `/dlq list`

