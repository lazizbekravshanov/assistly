import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SocialMediaBot } from '../src/bot.js';
import { config } from '../src/config.js';

function reset() {
  fs.rmSync('.test-data', { recursive: true, force: true });
}

function makeClients() {
  return {
    twitter: {
      async post(content) {
        return { platform: 'twitter', id: 'tw1', url: null, chars: content.length };
      },
      async analytics() {
        return { impressions: 10 };
      }
    },
    telegram: {
      async post(_content) {
        throw new Error('telegram down');
      },
      async analytics() {
        return { subscribers: 1 };
      }
    },
    linkedin: {
      async post(content) {
        return { platform: 'linkedin', id: 'li1', url: null, chars: content.length };
      },
      async analytics() {
        return { followers: 2 };
      }
    }
  };
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

async function authedBot() {
  const bot = new SocialMediaBot({ platformClients: makeClients() });
  await bot.processEvent(envelope({ text: config.owner.passphrase }));
  return bot;
}

test('draft returns three channel variants', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/draft all Build better workflows' }));
  assert.equal(result.ok, true);
  assert.ok(result.data.twitter.text.length > 0);
  assert.ok(result.data.telegram.text.length > 0);
  assert.ok(result.data.linkedin.text.length > 0);
});

test('schedule conflict is blocked by min gap policy', async () => {
  reset();
  const bot = await authedBot();
  const first = await bot.processEvent(envelope({ text: '/schedule twitter 2026-02-18T09:00:00Z first post' }));
  assert.equal(first.ok, true);

  const second = await bot.processEvent(envelope({ text: '/schedule twitter 2026-02-18T10:00:00Z second post' }));
  assert.equal(second.ok, false);
  assert.match(second.message, /Schedule conflict/);
});

test('content safety flags email leak', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/post twitter contact me at x@example.com' }));
  assert.equal(result.ok, false);
  assert.match(result.message, /contains_email/);
});

test('delete goes through approval gate', async () => {
  reset();
  const bot = await authedBot();

  const scheduled = await bot.processEvent(envelope({ text: '/schedule twitter 2026-02-18T09:00:00Z test post' }));
  const queueId = scheduled.data.id;

  const deleteReq = await bot.processEvent(envelope({ text: `/delete ${queueId}` }));
  assert.equal(deleteReq.requiresApproval, true);

  const approved = await bot.processEvent(envelope({ text: `/approve ${deleteReq.approvalId}` }));
  assert.equal(approved.ok, true);

  const queue = await bot.processEvent(envelope({ text: '/queue' }));
  assert.equal(queue.data.length, 0);
});

test('idempotency replays same message id', async () => {
  reset();
  const bot = await authedBot();

  const sameId = `same-${Date.now()}`;
  const first = await bot.processEvent(envelope({ message_id: sameId, text: '/status' }));
  const second = await bot.processEvent(envelope({ message_id: sameId, text: '/status' }));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.idempotentReplay, true);
});

test('multi-platform post supports partial failures', async () => {
  reset();
  const bot = await authedBot();
  const gated = await bot.processEvent(envelope({ text: '/post all hello world' }));
  assert.equal(gated.requiresApproval, true);

  const result = await bot.processEvent(envelope({ text: `/approve ${gated.approvalId}` }));
  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.data), true);
  assert.equal(result.data.length, 3);
  assert.equal(result.data.some((x) => x.ok === false), true);
});
