import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SocialMediaBot, UNAUTHORIZED } from '../src/bot.js';
import { config } from '../src/config.js';

function reset() {
  fs.rmSync('.test-data', { recursive: true, force: true });
}

function envelope(overrides = {}) {
  return {
    user_id: config.owner.id,
    channel: 'telegram',
    thread_id: 'thr-1',
    message_id: `m-${Date.now()}-${Math.random()}`,
    timestamp: new Date().toISOString(),
    locale: 'en-US',
    timezone: config.owner.timezone,
    text: '',
    ...overrides
  };
}

test('returns unauthorized before authentication', async () => {
  reset();
  const bot = new SocialMediaBot();
  const result = await bot.processEvent(envelope({ text: '/status' }));
  assert.equal(result.message, UNAUTHORIZED);
});

test('accepts passphrase for owner and opens session', async () => {
  reset();
  const bot = new SocialMediaBot();
  const result = await bot.processEvent(envelope({ text: config.owner.passphrase }));
  assert.equal(result.ok, true);
  assert.match(result.message, /Session active/);
  assert.equal(typeof result.sessionToken, 'string');
});

test('rejects non-owner even with correct passphrase', async () => {
  reset();
  const bot = new SocialMediaBot();
  const result = await bot.processEvent(envelope({ user_id: 'intruder', text: config.owner.passphrase }));
  assert.equal(result.ok, false);
  assert.equal(result.message, UNAUTHORIZED);
});

test('locks out after 5 failed attempts in window', async () => {
  reset();
  const bot = new SocialMediaBot();
  for (let i = 0; i < 5; i += 1) {
    await bot.processEvent(envelope({ text: `wrong-${i}` }));
  }

  const result = await bot.processEvent(envelope({ text: config.owner.passphrase }));
  assert.equal(result.ok, false);
  assert.equal(result.message, UNAUTHORIZED);
});

test('accepts signed session token to restore session', async () => {
  reset();
  const bot = new SocialMediaBot();
  const login = await bot.processEvent(envelope({ text: config.owner.passphrase }));
  const signoff = await bot.processEvent(envelope({ text: '/signoff' }));
  assert.equal(signoff.ok, true);

  const restored = await bot.processEvent(
    envelope({
      text: '/status',
      session_token: login.sessionToken
    })
  );
  assert.equal(restored.ok, true);
});
