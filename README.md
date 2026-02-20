# assistly

Assistly is a **single-owner social media AI assistant backend** that receives commands via OpenClaw webhook events and helps run content operations across:
- Twitter (X)
- Telegram
- LinkedIn

## What This App Really Does

Assistly is not just a chatbot. It is an execution engine for social media workflows:
- Authenticates one real owner only
- Accepts slash commands like `/post`, `/schedule`, `/analytics`, `/queue`
- Applies policy checks before actions
- Queues and retries failed posts with dead-letter handling
- Logs actions for audit and security review
- Protects against replay attacks and duplicate command execution

## Architecture

Assistly runs as two processes:

| Process | Command | Purpose |
|---------|---------|---------|
| **API** | `npm run start:api` | HTTP webhook server, command parsing, immediate actions |
| **Worker** | `npm run start:worker` | Queue processing, scheduled posts, retries |

### Storage

| Engine | Config | Use case |
|--------|--------|----------|
| **JSON** (default) | `STORAGE_ENGINE=json` | Single-instance, file-based persistence (`data/`) |
| **PostgreSQL** | `STORAGE_ENGINE=postgres` | Multi-instance, durable deployments with connection pooling |

## Core Capabilities

- OpenClaw-style event envelope support
- Webhook signature verification (HMAC-SHA256 + nonce + timestamp window)
- Timing-safe token and signature comparison throughout
- Session state and owner-only auth with configurable lockout policy
- Approval gates for risky commands (`/delete`, `/edit`, `/post all`)
- Idempotency protection (`channel + message_id + command`)
- Content safety pre-checks (PII detection, prompt injection scanning)
- Persistent queue/log/state with optional PostgreSQL mirror
- Metrics and audit visibility (`/audit`, `/logs`, `/metrics`)
- Alert webhooks for critical security and queue events

## Commands

| Command | Description |
|---------|-------------|
| `/post [platform\|all] [content]` | Publish immediately |
| `/schedule [platform] [ISO time] [content]` | Schedule a post |
| `/draft [topic]` | Generate platform-specific drafts |
| `/approve [id]` | Approve a pending action |
| `/reject [id]` | Reject a pending action |
| `/delete [id]` | Remove a queue item |
| `/queue [page] [pageSize]` | Browse the queue |
| `/dlq [list\|replay] [id]` | Dead-letter queue operations |
| `/status` | Queue and approval summary |
| `/logs [limit] [offset]` | Query event logs |
| `/audit` | Comprehensive audit view |
| `/analytics [platform\|all] [period]` | Platform analytics |
| `/session` | Show session info |
| `/signoff` | End session |

## Security Model

- **Single-owner authority** (`OWNER_ID` + passphrase)
- **Brute-force protection** — configurable lockout after failed attempts
- **Timing-safe comparison** for all HMAC signatures and session tokens
- **Prompt injection detection** — 10 pattern categories
- **Content safety scanning** — email, phone, injection phrase detection
- **Replay prevention** — nonce tracking with check-before-prune ordering
- **Rate limiting** — per-IP fixed-window with TTL eviction (OOM-safe)
- **Secret redaction** — 12 key patterns automatically redacted in logs
- Optional strict webhook signature enforcement:
  - `x-openclaw-timestamp`
  - `x-openclaw-nonce`
  - `x-openclaw-signature`

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Status + metrics + versions |
| `GET` | `/healthz` | Health check |
| `GET` | `/readyz` | Readiness (queue status, worker lock) |
| `GET` | `/metrics` | Prometheus-format metrics |
| `POST` | `/webhook` | OpenClaw webhook handler |

## Project Structure

```
src/
  server.js                  HTTP webhook entrypoint
  worker.js                  Background queue processor
  bot.js                     Orchestration + auth + pipeline
  commands.js                Command parsing and execution
  config.js                  Config loader and validator
  errors.js                  API error formatting
  http/
    rate_limiter.js           Per-IP rate limiting with TTL eviction
    request_body.js           Streaming body parser
    webhook_schema.js         Payload validation
  security/
    auth.js                   Session auth with configurable lockout
    content.js                Content safety scanner
    injection.js              Prompt injection detection
    openclaw.js               Webhook signature + replay protection
    policy.js                 Command policies and approval gates
  platforms/
    http.js                   Shared HTTP client with retry/backoff
    twitter.js                Twitter API v2 client
    telegram.js               Telegram Bot API client
    linkedin.js               LinkedIn UGC API client
  services/
    alerts.js                 Alert webhook notifications
    logger.js                 Event logging with secret redaction
    queue.js                  Post scheduling and retry logic
    state.js                  Session/approval/nonce/metrics state
    store.js                  JSON file storage (atomic writes)
    postgres_backend.js       PostgreSQL persistence layer
    postgres_mirror.js        Async PostgreSQL mirroring
config/
  runtime_config.json         Runtime defaults
migrations/
  001_init_postgres.sql       PostgreSQL schema + indexes
```

## Setup

1. Copy `.env.example` to `.env` and configure:

```bash
# Required
OWNER_ID=your_user_id
OWNER_PASSPHRASE=a-strong-passphrase
OWNER_SESSION_SECRET=a-separate-secret

# Recommended for production
OPENCLAW_WEBHOOK_SECRET=your-webhook-secret
OPENCLAW_ENFORCE_SIGNATURE=true

# Platform credentials (configure at least one)
TWITTER_ACCESS_TOKEN=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHANNEL_ID=...
LINKEDIN_ACCESS_TOKEN=...
LINKEDIN_PROFILE_ID=...

# Optional: PostgreSQL storage
STORAGE_ENGINE=postgres
DATABASE_URL=postgres://user:pass@host:5432/assistly
```

2. Install dependencies:

```bash
npm install
```

3. For PostgreSQL, run migrations:

```bash
npm run migrate:postgres
```

## Run

```bash
# Both API + worker (development)
npm start

# Separate processes (production)
npm run start:api
npm run start:worker
```

## OpenClaw Webhook Payload Example

`POST /webhook`

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

## Test

```bash
npm test
```

30 tests covering auth, commands, webhook verification, rate limiting, schema validation, state retention, and worker locking.
