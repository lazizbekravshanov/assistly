# Migrations

## Postgres Init

- SQL: `migrations/001_init_postgres.sql`
- Runner: `npm run migrate:postgres`

Creates:
- `assistly_store` for latest queue/log/state snapshots.
- `assistly_events` for mirrored operational events.

