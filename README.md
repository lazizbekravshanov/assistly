# assistly

Single-owner social media assistant bot scaffold for Twitter (X), Telegram, and LinkedIn, optimized for OpenClaw webhook delivery.

## Implemented optimization set
1. OpenClaw message envelope support (`user_id`, `channel`, `thread_id`, `message_id`, `timestamp`, `locale`, `timezone`, `trace_id`).
2. Verified webhook security (HMAC signature + timestamp skew + nonce replay protection).
3. Persistent state model (sessions, approvals, idempotency, nonces, metrics).
4. Policy layer for command allow/deny + approval-required command classes.
5. Structured command pipeline (`parse -> authorize -> validate -> execute -> confirm -> log`).
6. Approval gates for risky commands (`/delete`, `/edit`, `/post all`).
7. Observability with trace IDs, latency, request/error/command counters, and audit logs.
8. Idempotency protection keyed by `channel + message_id + command`.
9. Prompt/config/build versioning surfaced in status/audit responses.
10. Regression tests for auth lockout, signature replay, schedule conflict, content safety, idempotency, and partial post failures.

## Key files
- Runtime config: `config/runtime_config.json`
- Env template: `.env.example`
- Webhook server: `src/server.js`
- Bot core: `src/bot.js`
- Command pipeline: `src/commands.js`
- OpenClaw signature verifier: `src/security/openclaw.js`
- Policy engine: `src/security/policy.js`
- Persistent state: `src/services/state.js`

## Configure
Set environment variables from `.env.example` in production, especially:
- `OWNER_ID`
- `OWNER_PASSPHRASE`
- `OPENCLAW_WEBHOOK_SECRET`
- `OPENCLAW_ENFORCE_SIGNATURE=true`
- Platform credentials for Twitter/Telegram/LinkedIn

## Run
```bash
npm start
```

## OpenClaw webhook contract
`POST /webhook` JSON body example:
```json
{
  "user_id": "owner_user_1",
  "channel": "telegram",
  "thread_id": "thread-123",
  "message_id": "msg-123",
  "timestamp": "2026-02-17T12:00:00Z",
  "locale": "en-US",
  "timezone": "America/New_York",
  "trace_id": "tr_external_1",
  "text": "/status"
}
```

Signature headers (when enforced):
- `x-openclaw-timestamp`
- `x-openclaw-nonce`
- `x-openclaw-signature` = `hex(hmac_sha256(secret, "timestamp.nonce.rawBody"))`

## Test
```bash
npm test
```
