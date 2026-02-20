import http from 'node:http';
import { SocialMediaBot } from './bot.js';
import { config } from './config.js';
import { buildOpenClawVerifier } from './security/openclaw.js';
import { readRequestBody } from './http/request_body.js';

const bot = new SocialMediaBot();
const PORT = process.env.PORT || 8787;

const verifyOpenClaw = buildOpenClawVerifier({
  secret: config.openclaw.webhookSecret,
  maxSkewSeconds: config.openclaw.maxSkewSeconds,
  enforceSignature: config.openclaw.enforceSignature,
  stateService: bot.stateService
});

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function toHeaderMap(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

setInterval(async () => {
  try {
    await bot.processDueQueue();
  } catch (_error) {
    // Scheduler failures are logged during queue processing.
  }
}, 30 * 1000);

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    return sendJson(res, 200, {
      status: 'ok',
      message: bot.startupMessage(),
      metrics: bot.metricsSnapshot(),
      versions: config.versions
    });
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    return sendJson(res, 404, { error: 'Not found' });
  }

  try {
    const body = await readRequestBody(req, { maxBytes: config.openclaw.maxBodyBytes });
    const headers = toHeaderMap(req.headers);
    const verification = verifyOpenClaw({ headers, rawBody: body });
    if (!verification.ok) {
      return sendJson(res, 401, {
        ok: false,
        error: 'Invalid webhook signature',
        reason: verification.reason
      });
    }

    const parsed = JSON.parse(body || '{}');
    const envelope = {
      user_id: parsed.user_id || headers['x-openclaw-user-id'] || 'unknown',
      channel: parsed.channel || headers['x-openclaw-channel'] || 'unknown',
      thread_id: parsed.thread_id || null,
      message_id: parsed.message_id || headers['x-openclaw-message-id'] || null,
      timestamp: parsed.timestamp || headers['x-openclaw-timestamp'] || new Date().toISOString(),
      locale: parsed.locale || 'en-US',
      timezone: parsed.timezone || config.owner.timezone,
      trace_id: parsed.trace_id || headers['x-openclaw-trace-id'] || null,
      text: typeof parsed.text === 'string' ? parsed.text : ''
    };

    const result = await bot.processEvent(envelope);
    sendJson(res, 200, {
      ok: result.ok,
      trace_id: result.traceId,
      confirmation: result.confirmation || null,
      result
    });
  } catch (error) {
    if (error?.code === 'payload_too_large') {
      return sendJson(res, 413, { ok: false, error: 'Payload too large.' });
    }
    sendJson(res, 400, { ok: false, error: 'Invalid JSON payload.' });
  }
});

server.listen(PORT, () => {
  console.log(`assistly-social-bot listening on port ${PORT}`);
});
