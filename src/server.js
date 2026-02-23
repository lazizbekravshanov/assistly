import http from 'node:http';
import { SocialMediaBot } from './bot.js';
import { config } from './config.js';
import { buildOpenClawVerifier } from './security/openclaw.js';
import { readRequestBody } from './http/request_body.js';
import { FixedWindowRateLimiter } from './http/rate_limiter.js';
import { validateWebhookPayload } from './http/webhook_schema.js';
import { apiError } from './errors.js';

const bot = new SocialMediaBot();
const PORT = process.env.PORT || 8787;

const verifyOpenClaw = buildOpenClawVerifier({
  secret: config.openclaw.webhookSecrets || config.openclaw.webhookSecret,
  maxSkewSeconds: config.openclaw.maxSkewSeconds,
  enforceSignature: config.openclaw.enforceSignature,
  stateService: bot.stateService
});
const rateLimiter = new FixedWindowRateLimiter({
  limit: config.openclaw.rateLimitMaxRequests,
  windowMs: config.openclaw.rateLimitWindowSeconds * 1000
});

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains'
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendError(res, statusCode, code, message, details = null) {
  return sendJson(res, statusCode, apiError(code, message, details));
}

function toHeaderMap(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    try {
      return sendJson(res, 200, {
        status: 'ok',
        message: bot.startupMessage(),
        metrics: await bot.metricsSnapshot(),
        versions: config.versions
      });
    } catch {
      return sendError(res, 503, 'service_unavailable', 'Unable to retrieve status.');
    }
  }

  if (req.method === 'GET' && req.url === '/healthz') {
    return sendJson(res, 200, { ok: true, status: 'healthy' });
  }

  if (req.method === 'GET' && req.url === '/readyz') {
    try {
      return sendJson(res, 200, await bot.readinessSnapshot());
    } catch {
      return sendJson(res, 503, { ready: false, error: 'readiness check failed' });
    }
  }

  if (req.method === 'GET' && req.url === '/metrics') {
    try {
      const metrics = await bot.metricsSnapshot();
      const latencyAvg = metrics.latencyMs.count > 0 ? metrics.latencyMs.total / metrics.latencyMs.count : 0;
      const body = [
        '# TYPE assistly_requests_total counter',
        `assistly_requests_total ${metrics.requestCount}`,
        '# TYPE assistly_errors_total counter',
        `assistly_errors_total ${metrics.errorCount}`,
        '# TYPE assistly_commands_total counter',
        `assistly_commands_total ${metrics.commandCount}`,
        '# TYPE assistly_latency_ms_max gauge',
        `assistly_latency_ms_max ${metrics.latencyMs.max}`,
        '# TYPE assistly_latency_ms_avg gauge',
        `assistly_latency_ms_avg ${latencyAvg.toFixed(2)}`
      ].join('\n');
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      return res.end(`${body}\n`);
    } catch {
      return sendError(res, 503, 'service_unavailable', 'Unable to retrieve metrics.');
    }
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    return sendError(res, 404, 'not_found', 'Not found');
  }

  const ip = req.socket.remoteAddress || 'unknown';
  try {
    const rate = rateLimiter.consume(ip);
    if (!rate.allowed) {
      await bot.alertService.notify('security.rate_limited', { ip });
      res.setHeader('Retry-After', Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000)));
      return sendError(res, 429, 'rate_limit_exceeded', 'Rate limit exceeded.');
    }

    const body = await readRequestBody(req, { maxBytes: config.openclaw.maxBodyBytes });
    const headers = toHeaderMap(req.headers);
    const verification = await verifyOpenClaw({ headers, rawBody: body });
    if (!verification.ok) {
      await bot.alertService.notify('security.invalid_signature', {
        reason: verification.reason,
        ip
      });
      return sendError(res, 401, 'invalid_signature', 'Invalid webhook signature.', verification.reason);
    }

    const parsed = JSON.parse(body || '{}');
    const schema = validateWebhookPayload(parsed);
    if (!schema.ok) {
      return sendError(res, 400, 'invalid_payload', 'Invalid webhook payload.', schema.reason);
    }

    const envelope = {
      user_id: parsed.user_id || headers['x-openclaw-user-id'] || 'unknown',
      channel: parsed.channel || headers['x-openclaw-channel'] || 'unknown',
      thread_id: parsed.thread_id || null,
      message_id: parsed.message_id || headers['x-openclaw-message-id'] || null,
      timestamp: parsed.timestamp || headers['x-openclaw-timestamp'] || new Date().toISOString(),
      locale: parsed.locale || 'en-US',
      timezone: parsed.timezone || config.owner.timezone,
      trace_id: parsed.trace_id || headers['x-openclaw-trace-id'] || null,
      text: typeof parsed.text === 'string' ? parsed.text : '',
      session_token: headers['x-assistly-admin-session'] || null
    };

    const result = await bot.processEvent(envelope);
    bot.logger.log('webhook.response', {
      traceId: envelope.trace_id,
      userId: envelope.user_id,
      ok: result.ok,
      statusCode: 200
    });
    sendJson(res, 200, {
      ok: result.ok,
      trace_id: result.traceId,
      confirmation: result.confirmation || null,
      result
    });
  } catch (error) {
    if (error?.code === 'payload_too_large') {
      bot.logger.log('webhook.error', { error: 'payload_too_large', ip });
      return sendError(res, 413, 'payload_too_large', 'Payload too large.');
    }
    bot.logger.log('webhook.error', { error: 'invalid_json', ip });
    sendError(res, 400, 'invalid_json', 'Invalid JSON payload.');
  }
});

/* ── Telegram polling ─────────────────────────────────────────────── */

const TELEGRAM_COMMANDS = [
  { command: 'post', description: 'Post content to Telegram now' },
  { command: 'schedule', description: 'Schedule a post (time content)' },
  { command: 'status', description: 'Bot and queue status' },
  { command: 'queue', description: 'View scheduled posts' },
  { command: 'logs', description: 'Recent activity' },
  { command: 'analytics', description: 'Platform analytics' },
  { command: 'ai', description: 'AI-generate content drafts for all platforms' },
  { command: 'draft', description: 'Generate content drafts' },
  { command: 'help', description: 'Show all commands' },
  { command: 'signoff', description: 'End session' }
];

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatTelegramReply(result) {
  if (!result) return 'No response.';

  const icon = result.ok ? '\u2705' : '\u274c';
  const parts = [];

  if (result.message) {
    parts.push(`${icon} ${escapeHtml(result.message)}`);
  } else {
    parts.push(result.ok ? `${icon} Done.` : `${icon} Error.`);
  }

  if (result.confirmation && !result.message?.includes(result.confirmation)) {
    parts.push(escapeHtml(result.confirmation));
  }

  if (result.data?.drafts && result.data?.approvals) {
    const { topic, drafts, approvals } = result.data;
    parts.length = 0;
    parts.push(`<b>AI Drafts</b> \u2014 ${escapeHtml(topic)}`);
    for (const platform of ['twitter', 'telegram', 'linkedin']) {
      const draft = drafts[platform];
      const id = approvals[platform];
      parts.push(
        `\n<b>${escapeHtml(platform)}</b> (${draft.chars} chars):\n<pre>${escapeHtml(draft.text)}</pre>\n` +
        `\u2705 <code>/approve ${id}</code>\n\u274c <code>/reject ${id}</code>`
      );
    }
    const reply = parts.join('\n');
    return reply.length > 4000 ? reply.slice(0, 3997) + '...' : reply;
  }

  if (result.data) {
    const data = result.data;
    if (Array.isArray(data)) {
      for (const item of data.slice(0, 10)) {
        const status = item.ok ? '\u2705' : '\u274c';
        const label = item.platform || item.id || '';
        parts.push(`${status} ${escapeHtml(label)}${item.error ? ': ' + escapeHtml(item.error) : ''}`);
      }
      if (data.length > 10) parts.push(`... and ${data.length - 10} more`);
    } else if (typeof data === 'object') {
      const lines = [];
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && v !== undefined && typeof v !== 'object') {
          lines.push(`<b>${escapeHtml(k)}</b>: ${escapeHtml(String(v))}`);
        }
      }
      if (lines.length > 0) parts.push(lines.join('\n'));
    }
  }

  const reply = parts.join('\n\n');
  return reply.length > 4000 ? reply.slice(0, 3997) + '...' : reply;
}

const HELP_TEXT = `<b>Available commands:</b>

/post [platform] [content] - Post content now
/schedule [platform] [time] [content] - Schedule a post
/status - Bot and queue status
/queue - View scheduled posts
/logs - Recent activity
/analytics [platform] - Platform analytics
/ai [topic] - AI-generate drafts for all platforms
/draft [topic] - Generate content drafts
/help - Show this message
/signoff - End session`;

const telegramClient = bot.platformClients.telegram;

function startTelegramPolling() {
  if (!config.platforms.telegram.botToken) return;

  const ownerChatId = config.platforms.telegram.ownerChatId;

  telegramClient.setMyCommands(TELEGRAM_COMMANDS).then(() => {
    console.log('Telegram bot commands registered.');
  }).catch((err) => {
    console.error('Failed to register Telegram commands:', err.message);
  });

  telegramClient.startPolling(async (message) => {
    const chatId = message.chat.id;
    const fromId = String(message.from?.id || '');
    const text = (message.text || '').trim();

    if (!text) return;

    if (!ownerChatId || fromId !== String(ownerChatId)) {
      await telegramClient.sendMessage(chatId, '\u26d4 Unauthorized.');
      return;
    }

    if (text === '/help' || text === '/start') {
      await telegramClient.sendMessage(chatId, HELP_TEXT);
      return;
    }

    const now = Date.now();
    const userId = config.owner.id;

    if (!(await bot.auth.isAuthenticated(userId, now))) {
      await bot.auth.authenticate({
        userId,
        candidate: config.owner.passphrase,
        now
      });
    }

    let commandText = text.startsWith('/') ? text.replace(/@\S+/, '') : text;

    // Default /post from Telegram to target the telegram platform
    const KNOWN_PLATFORMS = ['twitter', 'telegram', 'linkedin', 'all'];
    const postMatch = commandText.match(/^\/post\s*(.*)/i);
    if (postMatch) {
      const rest = postMatch[1].trim();
      const firstWord = rest.split(/\s+/)[0]?.toLowerCase() || '';
      if (!KNOWN_PLATFORMS.includes(firstWord)) {
        commandText = rest ? `/post telegram ${rest}` : '/post telegram';
      }
    }

    const envelope = {
      user_id: userId,
      channel: 'telegram',
      thread_id: `tg_${chatId}`,
      message_id: `tg_${message.message_id}`,
      timestamp: new Date().toISOString(),
      locale: 'en-US',
      timezone: config.owner.timezone,
      text: commandText
    };

    const result = await bot.processEvent(envelope);
    const reply = formatTelegramReply(result);
    await telegramClient.sendMessage(chatId, reply);
  });

  console.log('Telegram polling started.');
}

server.listen(PORT, () => {
  console.log(`assistly-social-bot listening on port ${PORT}`);
  startTelegramPolling();
});

async function shutdown(signal) {
  telegramClient.stopPolling();
  server.close(async () => {
    try {
      if (bot.backend) await bot.backend.close().catch(() => {});
      if (bot.store?.mirror) await bot.store.mirror.close().catch(() => {});
    } catch {}
    console.log(`assistly-social-bot shutdown complete (${signal})`);
    process.exit(0);
  });
  setTimeout(() => {
    console.log('assistly-social-bot forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
