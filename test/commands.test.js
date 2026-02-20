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

test('schedule rejects invalid ISO timestamp', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/schedule twitter not-a-time this should fail' }));
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid schedule time/);
});

test('approval ids remain unique after restart', async () => {
  reset();
  const firstBot = await authedBot();
  const first = await firstBot.processEvent(envelope({ text: '/delete q_1' }));
  assert.equal(first.requiresApproval, true);

  const secondBot = await authedBot();
  const second = await secondBot.processEvent(envelope({ text: '/delete q_2' }));
  assert.equal(second.requiresApproval, true);
  assert.notEqual(second.approvalId, first.approvalId);
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
  assert.equal(queue.data.total, 0);
  assert.equal(queue.data.items.length, 0);
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

test('queue supports pagination shape', async () => {
  reset();
  const bot = await authedBot();
  await bot.processEvent(envelope({ text: '/schedule twitter 2026-02-18T09:00:00Z post-1' }));
  await bot.processEvent(envelope({ text: '/schedule twitter 2026-02-18T13:00:00Z post-2' }));
  await bot.processEvent(envelope({ text: '/schedule twitter 2026-02-18T17:00:00Z post-3' }));

  const page1 = await bot.processEvent(envelope({ text: '/queue 1 2' }));
  assert.equal(page1.ok, true);
  assert.equal(page1.data.page, 1);
  assert.equal(page1.data.pageSize, 2);
  assert.equal(page1.data.total, 3);
  assert.equal(page1.data.items.length, 2);

  const page2 = await bot.processEvent(envelope({ text: '/queue 2 2' }));
  assert.equal(page2.data.items.length, 1);
});

test('scheduled post failures move to dead-letter after max retries', async () => {
  reset();
  const bot = await authedBot();
  await bot.processEvent(envelope({ text: '/schedule telegram 2026-02-18T09:00:00Z fail-me' }));

  await bot.processDueQueue('2026-02-18T09:00:01.000Z');
  await bot.processDueQueue('2026-02-18T09:06:00.000Z');
  await bot.processDueQueue('2026-02-18T09:12:00.000Z');

  const queue = await bot.processEvent(envelope({ text: '/queue' }));
  assert.equal(queue.data.total, 1);
  assert.equal(queue.data.items[0].status, 'dead_letter');
  assert.ok(queue.data.items[0].deadLetterAt);
});
