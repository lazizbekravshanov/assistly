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

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
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
    return sendJson(res, 200, {
      status: 'ok',
      message: bot.startupMessage(),
      metrics: await bot.metricsSnapshot(),
      versions: config.versions
    });
  }

  if (req.method === 'GET' && req.url === '/healthz') {
    return sendJson(res, 200, { ok: true, status: 'healthy' });
  }

  if (req.method === 'GET' && req.url === '/readyz') {
    return sendJson(res, 200, await bot.readinessSnapshot());
  }

  if (req.method === 'GET' && req.url === '/metrics') {
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
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    return res.end(`${body}\n`);
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    return sendError(res, 404, 'not_found', 'Not found');
  }

  const ip = req.socket.remoteAddress || 'unknown';
  try {
    const rate = rateLimiter.consume(ip);
    if (!rate.allowed) {
      bot.alertService.notify('security.rate_limited', { ip });
      res.setHeader('Retry-After', Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000)));
      return sendError(res, 429, 'rate_limit_exceeded', 'Rate limit exceeded.');
    }

    const body = await readRequestBody(req, { maxBytes: config.openclaw.maxBodyBytes });
    const headers = toHeaderMap(req.headers);
    const verification = await verifyOpenClaw({ headers, rawBody: body });
    if (!verification.ok) {
      bot.alertService.notify('security.invalid_signature', {
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

server.listen(PORT, () => {
  console.log(`assistly-social-bot listening on port ${PORT}`);
});

async function shutdown(signal) {
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
