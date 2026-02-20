import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

function randomPort() {
  return 40000 + Math.floor(Math.random() * 20000);
}

function startServer(env = {}) {
  const port = randomPort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: '.test-data',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return new Promise((resolve, reject) => {
    let started = false;
    const timeout = setTimeout(() => {
      if (started) return;
      child.kill('SIGTERM');
      reject(new Error('server start timeout'));
    }, 5000);

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (text.includes('assistly-social-bot listening on port')) {
        started = true;
        clearTimeout(timeout);
        resolve({
          port,
          stop: () => new Promise((res) => {
            child.once('exit', () => res());
            child.kill('SIGTERM');
          })
        });
      }
    });

    child.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`server exited early: ${code} ${stderr}`.trim()));
      }
    });
  });
}

function signPayload(secret, timestamp, nonce, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${nonce}.${rawBody}`).digest('hex');
}

test('webhook rejects replayed signed payload', async (t) => {
  const secret = 'secret-1';
  let srv;
  try {
    srv = await startServer({
      OPENCLAW_ENFORCE_SIGNATURE: 'true',
      OPENCLAW_WEBHOOK_SECRET: secret
    });
  } catch (error) {
    if (String(error.message).includes('EPERM')) return t.skip('sandbox blocks local listen');
    throw error;
  }

  try {
    const now = Date.now();
    const nonce = 'n-1';
    const body = JSON.stringify({ user_id: 'owner_user_1', channel: 'telegram', text: 'owner-passphrase-2026' });
    const sig = signPayload(secret, now, nonce, body);

    const headers = {
      'Content-Type': 'application/json',
      'x-openclaw-timestamp': String(now),
      'x-openclaw-nonce': nonce,
      'x-openclaw-signature': sig
    };

    const first = await fetch(`http://127.0.0.1:${srv.port}/webhook`, { method: 'POST', headers, body });
    assert.equal(first.status, 200);

    const second = await fetch(`http://127.0.0.1:${srv.port}/webhook`, { method: 'POST', headers, body });
    assert.equal(second.status, 401);
  } finally {
    await srv.stop();
  }
});

test('webhook validates schema and rejects invalid payload', async (t) => {
  let srv;
  try {
    srv = await startServer({ OPENCLAW_ENFORCE_SIGNATURE: 'false' });
  } catch (error) {
    if (String(error.message).includes('EPERM')) return t.skip('sandbox blocks local listen');
    throw error;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 123, text: '/status' })
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error.code, 'invalid_payload');
  } finally {
    await srv.stop();
  }
});

test('webhook enforces rate limit window', async (t) => {
  let srv;
  try {
    srv = await startServer({
      OPENCLAW_ENFORCE_SIGNATURE: 'false',
      OPENCLAW_RATE_LIMIT_MAX_REQUESTS: '1',
      OPENCLAW_RATE_LIMIT_WINDOW_SECONDS: '60'
    });
  } catch (error) {
    if (String(error.message).includes('EPERM')) return t.skip('sandbox blocks local listen');
    throw error;
  }

  try {
    const req = () => fetch(`http://127.0.0.1:${srv.port}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'owner_user_1', text: '/status' })
    });
    const first = await req();
    assert.equal(first.status, 200);
    const second = await req();
    assert.equal(second.status, 429);
  } finally {
    await srv.stop();
  }
});
