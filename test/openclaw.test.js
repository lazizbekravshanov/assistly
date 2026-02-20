import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { JsonFileStore } from '../src/services/store.js';
import { StateService } from '../src/services/state.js';
import { buildOpenClawVerifier } from '../src/security/openclaw.js';

function reset() {
  fs.rmSync('.test-data', { recursive: true, force: true });
}

test('openclaw signature verifies and blocks replay nonce', async () => {
  reset();
  const store = new JsonFileStore({
    dataDir: '.test-data',
    queueFile: 'queue.json',
    logsFile: 'logs.json',
    stateFile: 'state.json'
  });
  const stateService = new StateService({ store });

  const secret = 'test-secret';
  const verifier = buildOpenClawVerifier({
    secret,
    maxSkewSeconds: 300,
    enforceSignature: true,
    stateService
  });

  const rawBody = JSON.stringify({ text: '/status' });
  const now = Date.now();
  const nonce = 'nonce-1';
  const payload = `${now}.${nonce}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  const headers = {
    'x-openclaw-signature': sig,
    'x-openclaw-timestamp': String(now),
    'x-openclaw-nonce': nonce
  };

  const first = await verifier({ headers, rawBody, nowMs: now });
  assert.equal(first.ok, true);

  const second = await verifier({ headers, rawBody, nowMs: now + 1 });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'replay_detected');
});

test('openclaw accepts rotated secrets list', async () => {
  reset();
  const store = new JsonFileStore({
    dataDir: '.test-data',
    queueFile: 'queue.json',
    logsFile: 'logs.json',
    stateFile: 'state.json'
  });
  const stateService = new StateService({ store });

  const verifier = buildOpenClawVerifier({
    secret: 'old-secret,new-secret',
    maxSkewSeconds: 300,
    enforceSignature: true,
    stateService
  });

  const rawBody = JSON.stringify({ text: '/status' });
  const now = Date.now();
  const nonce = 'nonce-2';
  const payload = `${now}.${nonce}.${rawBody}`;
  const sig = crypto.createHmac('sha256', 'new-secret').update(payload).digest('hex');

  const headers = {
    'x-openclaw-signature': sig,
    'x-openclaw-timestamp': String(now),
    'x-openclaw-nonce': nonce
  };

  const result = await verifier({ headers, rawBody, nowMs: now });
  assert.equal(result.ok, true);
});
