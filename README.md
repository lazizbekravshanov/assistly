# assistly 🤖

Assistly is a **single-owner social media AI assistant backend** that receives commands via OpenClaw webhook events and helps run content operations across:
- Twitter (X)
- Telegram
- LinkedIn

## 🎯 What This App Really Does

Assistly is not just a chatbot. It is an execution engine for social media workflows:
- Authenticates one real owner only
- Accepts slash commands like `/post`, `/schedule`, `/analytics`, `/queue`
- Applies policy checks before actions
- Queues and retries failed posts
- Logs actions for audit and security review
- Protects against replay attacks and duplicate command execution

## 🧠 Core Capabilities

- OpenClaw-style event envelope support
- Webhook signature verification (HMAC + nonce + timestamp window)
- Session state and owner-only auth lockout model
- Approval gates for risky commands (`/delete`, `/edit`, `/post all`)
- Idempotency protection (`channel + message_id + command`)
- Content safety pre-checks (basic PII/injection phrase detection)
- Persistent queue/log/state on disk
- Metrics and audit visibility (`/audit`, `/logs`)

## 🛡️ Security Model

- Single-owner authority (`OWNER_ID` + passphrase)
- Rejects unauthorized users even with command knowledge
- Detects and logs suspicious prompt injection patterns
- Optional strict webhook signature enforcement:
  - `x-openclaw-timestamp`
  - `x-openclaw-nonce`
  - `x-openclaw-signature`

## 🗂️ Project Structure

- `src/server.js`: HTTP webhook entrypoint
- `src/bot.js`: orchestration + auth/session + pipeline integration
- `src/commands.js`: command parsing and execution flow
- `src/security/openclaw.js`: signature and replay protection
- `src/security/policy.js`: action policy and approvals
- `src/services/state.js`: persistent sessions/approvals/idempotency/metrics
- `src/services/queue.js`: scheduling/retry logic
- `config/runtime_config.json`: runtime defaults and system settings
- `.env.example`: production environment variables template

## ⚙️ Setup

1. Configure environment variables (see `.env.example`).
2. At minimum set:
- `OWNER_ID`
- `OWNER_PASSPHRASE`
- `OPENCLAW_WEBHOOK_SECRET`
- `OPENCLAW_ENFORCE_SIGNATURE=true` (recommended for production)
- Twitter/Telegram/LinkedIn credentials

## 🚀 Run

```bash
npm start
```

## 🔌 OpenClaw Webhook Payload Example

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

## ✅ Test

```bash
npm test
```
