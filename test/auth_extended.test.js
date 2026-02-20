import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { SessionAuth } from '../src/security/auth.js';
import { JsonFileStore } from '../src/services/store.js';
import { StateService } from '../src/services/state.js';
import { Logger } from '../src/services/logger.js';

function setup() {
  fs.rmSync('.test-data', { recursive: true, force: true });
  const store = new JsonFileStore({
    dataDir: '.test-data',
    queueFile: 'queue.json',
    logsFile: 'logs.json',
    stateFile: 'state.json'
  });
  const stateService = new StateService({ store });
  const logger = new Logger({ store });
  const auth = new SessionAuth({
    passphrase: 'test-pass',
    timeoutMinutes: 60,
    ownerId: 'owner1',
    sessionSecret: 'test-secret-key',
    logger,
    stateService
  });
  return { auth, stateService, logger };
}

test('validateSessionToken rejects token without dot separator', () => {
  const { auth } = setup();
  const result = auth.validateSessionToken('owner1', 'no-dot-here');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_token');
});

test('validateSessionToken rejects null/undefined token', () => {
  const { auth } = setup();
  assert.equal(auth.validateSessionToken('owner1', null).ok, false);
  assert.equal(auth.validateSessionToken('owner1', undefined).ok, false);
  assert.equal(auth.validateSessionToken('owner1', '').ok, false);
});

test('validateSessionToken rejects token with wrong signature', () => {
  const { auth } = setup();
  const payload = Buffer.from(JSON.stringify({
    userId: 'owner1',
    iat: Date.now(),
    exp: Date.now() + 3600000
  })).toString('base64url');
  const fakeSig = crypto.createHmac('sha256', 'wrong-secret').update(payload).digest('base64url');
  const result = auth.validateSessionToken('owner1', `${payload}.${fakeSig}`);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad_signature');
});

test('validateSessionToken rejects expired token', async () => {
  const { auth } = setup();
  const login = await auth.authenticate({ userId: 'owner1', candidate: 'test-pass', now: 1000 });
  assert.equal(login.ok, true);
  // Token was created at now=1000 with 60min timeout, so at now=1000+3600001 it's expired
  const result = auth.validateSessionToken('owner1', login.sessionToken, 1000 + 3600001);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
});

test('validateSessionToken rejects token for wrong user', async () => {
  const { auth } = setup();
  const login = await auth.authenticate({ userId: 'owner1', candidate: 'test-pass' });
  assert.equal(login.ok, true);
  const result = auth.validateSessionToken('different_user', login.sessionToken);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wrong_user');
});

test('validateSessionToken rejects corrupted base64 payload', () => {
  const { auth } = setup();
  const badPayload = '!!!not-valid-base64!!!';
  const sig = crypto.createHmac('sha256', 'test-secret-key').update(badPayload).digest('base64url');
  const result = auth.validateSessionToken('owner1', `${badPayload}.${sig}`);
  assert.equal(result.ok, false);
  // Could be bad_signature or bad_payload depending on base64 parsing
  assert.ok(['bad_signature', 'bad_payload'].includes(result.reason));
});

test('valid token accepted within timeout window', async () => {
  const { auth } = setup();
  const now = Date.now();
  const login = await auth.authenticate({ userId: 'owner1', candidate: 'test-pass', now });
  assert.equal(login.ok, true);
  const result = auth.validateSessionToken('owner1', login.sessionToken, now + 1000);
  assert.equal(result.ok, true);
});
