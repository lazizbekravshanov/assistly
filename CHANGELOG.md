# Changelog

## 2026-02-20

- Added API/worker runtime split with `start:api` and `start:worker`.
- Added Postgres durability mirror and migration script.
- Added signed admin session tokens and token-based session restore.
- Added DLQ operator commands (`/dlq list`, `/dlq replay <id>`).
- Added server contract tests for replay/signature/schema/rate limit checks.
- Added alert hook service for critical security and queue events.

