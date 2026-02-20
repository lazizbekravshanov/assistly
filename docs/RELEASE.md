# Release Guide

1. Run quality gates:
   - `npm run lint`
   - `npm run security`
   - `npm test`
2. For Postgres deployments:
   - Set `STORAGE_ENGINE=postgres`
   - Set `DATABASE_URL`
   - Run `npm run migrate:postgres`
3. Start API and worker:
   - `npm run start:api`
   - `npm run start:worker`
4. Verify health:
   - `GET /healthz`
   - `GET /readyz`
   - `GET /metrics`

