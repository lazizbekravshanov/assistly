import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { JsonFileStore } from '../src/services/store.js';
import { StateService } from '../src/services/state.js';
import { buildOpenClawVerifier } from '../src/security/openclaw.js';

function setup() {
  fs.rmSync('.test-data', { recursive: true, force: true });
  const store = new JsonFileStore({
    dataDir: '.test-data',
    queueFile: 'queue.json',
    logsFile: 'logs.json',
    stateFile: 'state.json'
  });
  const stateService = new StateService({ store });
  return { stateService };
}

function sign(secret, timestamp, nonce, body) {
  const payload = `${timestamp}.${nonce}.${body}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

test('openclaw rejects timestamp too far in the past', async () => {
  const { stateService } = setup();
  const secret = 'test-secret';
  const verifier = buildOpenClawVerifier({
    secret,
    maxSkewSeconds: 300,
    enforceSignature: true,
    stateService
  });

  const now = Date.now();
  const tooOld = now - 301 * 1000;
  const nonce = 'nonce-old';
  const rawBody = '{}';
  const sig = sign(secret, tooOld, nonce, rawBody);

  const result = await verifier({
    headers: {
      'x-openclaw-signature': sig,
      'x-openclaw-timestamp': String(tooOld),
      'x-openclaw-nonce': nonce
    },
    rawBody,
    nowMs: now
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timestamp_out_of_window');
});

test('openclaw rejects timestamp too far in the future', async () => {
  const { stateService } = setup();
  const secret = 'test-secret';
  const verifier = buildOpenClawVerifier({
    secret,
    maxSkewSeconds: 300,
    enforceSignature: true,
    stateService
  });

  const now = Date.now();
  const tooNew = now + 301 * 1000;
  const nonce = 'nonce-future';
  const rawBody = '{}';
  const sig = sign(secret, tooNew, nonce, rawBody);

  const result = await verifier({
    headers: {
      'x-openclaw-signature': sig,
      'x-openclaw-timestamp': String(tooNew),
      'x-openclaw-nonce': nonce
    },
    rawBody,
    nowMs: now
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timestamp_out_of_window');
});

test('openclaw accepts timestamp at boundary of skew window', async () => {
  const { stateService } = setup();
  const secret = 'test-secret';
  const verifier = buildOpenClawVerifier({
    secret,
    maxSkewSeconds: 300,
    enforceSignature: true,
    stateService
  });

  const now = Date.now();
  const atBoundary = now - 299 * 1000;
  const nonce = 'nonce-boundary';
  const rawBody = '{}';
  const sig = sign(secret, atBoundary, nonce, rawBody);

  const result = await verifier({
    headers: {
      'x-openclaw-signature': sig,
      'x-openclaw-timestamp': String(atBoundary),
      'x-openclaw-nonce': nonce
    },
    rawBody,
    nowMs: now
  });
  assert.equal(result.ok, true);
});

test('openclaw rejects missing headers', async () => {
  const { stateService } = setup();
  const verifier = buildOpenClawVerifier({
    secret: 'test-secret',
    maxSkewSeconds: 300,
    enforceSignature: true,
    stateService
  });

  const result = await verifier({ headers: {}, rawBody: '{}' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_headers');
});

test('openclaw rejects non-numeric timestamp', async () => {
  const { stateService } = setup();
  const verifier = buildOpenClawVerifier({
    secret: 'test-secret',
    maxSkewSeconds: 300,
    enforceSignature: true,
    stateService
  });

  const result = await verifier({
    headers: {
      'x-openclaw-signature': 'abc',
      'x-openclaw-timestamp': 'not-a-number',
      'x-openclaw-nonce': 'n1'
    },
    rawBody: '{}'
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad_timestamp');
});
