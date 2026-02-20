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
        return { impressions: 10, followers: 500 };
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
        throw new Error('linkedin api error');
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

// === /session ===

test('/session returns session info for authenticated user', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/session' }));
  assert.equal(result.ok, true);
  assert.equal(result.data.authenticated, true);
  assert.equal(result.data.userId, config.owner.id);
  assert.equal(result.data.ownerId, config.owner.id);
  assert.equal(result.data.timeoutMinutes, config.bot.sessionTimeoutMinutes);
});

// === /signoff ===

test('/signoff ends session and subsequent commands fail', async () => {
  reset();
  const bot = await authedBot();
  const signoff = await bot.processEvent(envelope({ text: '/signoff' }));
  assert.equal(signoff.ok, true);
  assert.match(signoff.message, /Session ended/);

  const after = await bot.processEvent(envelope({ text: '/status' }));
  assert.equal(after.ok, false);
});

// === /reject ===

test('/reject rejects a pending approval', async () => {
  reset();
  const bot = await authedBot();

  const deleteReq = await bot.processEvent(envelope({ text: '/delete q_1' }));
  assert.equal(deleteReq.requiresApproval, true);

  const rejected = await bot.processEvent(envelope({ text: `/reject ${deleteReq.approvalId}` }));
  assert.equal(rejected.ok, true);
  assert.match(rejected.message, /Rejected/);
});

test('/reject fails for non-existent approval id', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/reject appr_nonexistent' }));
  assert.equal(result.ok, false);
  assert.match(result.message, /not found/i);
});

test('/reject fails without approval id argument', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/reject' }));
  assert.equal(result.ok, false);
  assert.match(result.message, /Usage/);
});

// === /logs ===

test('/logs returns recent log entries', async () => {
  reset();
  const bot = await authedBot();
  // Generate some log entries via commands
  await bot.processEvent(envelope({ text: '/status' }));
  await bot.processEvent(envelope({ text: '/status' }));

  const result = await bot.processEvent(envelope({ text: '/logs' }));
  assert.equal(result.ok, true);
  assert.ok(result.data.total > 0);
  assert.ok(Array.isArray(result.data.items));
});

test('/logs with limit and offset', async () => {
  reset();
  const bot = await authedBot();
  await bot.processEvent(envelope({ text: '/status' }));
  await bot.processEvent(envelope({ text: '/status' }));
  await bot.processEvent(envelope({ text: '/status' }));

  const result = await bot.processEvent(envelope({ text: '/logs 2 0' }));
  assert.equal(result.ok, true);
  assert.ok(result.data.items.length <= 2);
});

test('/logs with event filter', async () => {
  reset();
  const bot = await authedBot();
  await bot.processEvent(envelope({ text: '/status' }));

  const result = await bot.processEvent(envelope({ text: '/logs event=auth.success' }));
  assert.equal(result.ok, true);
  assert.ok(result.data.items.every((e) => e.event === 'auth.success'));
});

test('/logs returns empty result for no matches', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/logs event=nonexistent.event' }));
  assert.equal(result.ok, true);
  assert.equal(result.data.total, 0);
  assert.equal(result.data.items.length, 0);
});

// === /audit ===

test('/audit returns metrics, versions, and recent events', async () => {
  reset();
  const bot = await authedBot();
  await bot.processEvent(envelope({ text: '/status' }));

  const result = await bot.processEvent(envelope({ text: '/audit' }));
  assert.equal(result.ok, true);
  assert.ok(result.data.metrics);
  assert.ok(result.data.versions);
  assert.ok(Array.isArray(result.data.recentEvents));
  assert.ok(Array.isArray(result.data.pendingApprovals));
  assert.ok(Number.isFinite(result.data.totalMatchingEvents));
});

test('/audit with event filter', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/audit event=auth.success' }));
  assert.equal(result.ok, true);
  assert.equal(result.data.filters.event, 'auth.success');
});

// === /analytics ===

test('/analytics all returns data from all platforms', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/analytics all 7d' }));
  assert.equal(result.ok, true);
  assert.ok(result.data.twitter);
  assert.ok(result.data.telegram);
  assert.ok(result.data.linkedin);
});

test('/analytics handles platform errors gracefully', async () => {
  reset();
  const bot = await authedBot();
  // linkedin.analytics throws in our mock
  const result = await bot.processEvent(envelope({ text: '/analytics all' }));
  assert.equal(result.ok, true);
  assert.ok(result.data.linkedin.error);
  assert.equal(result.data.twitter.impressions, 10);
});

test('/analytics single platform', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/analytics twitter 30d' }));
  assert.equal(result.ok, true);
  assert.equal(result.data.impressions, 10);
});

test('/analytics rejects unsupported platform', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/analytics fakebook' }));
  assert.equal(result.ok, false);
  assert.match(result.message, /Unsupported platform/);
});

// === /status ===

test('/status returns queue and approval summary', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/status' }));
  assert.equal(result.ok, true);
  assert.ok(typeof result.data.queueSize === 'number');
  assert.ok(typeof result.data.scheduled === 'number');
  assert.ok(typeof result.data.deadLetter === 'number');
  assert.ok(typeof result.data.pendingApprovals === 'number');
  assert.ok(result.data.versions);
});

// === Unknown command ===

test('unknown command returns not implemented', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: '/foobar' }));
  assert.equal(result.ok, false);
  assert.match(result.message, /not implemented/i);
});

// === Non-slash input ===

test('non-slash text returns unknown input', async () => {
  reset();
  const bot = await authedBot();
  const result = await bot.processEvent(envelope({ text: 'hello world' }));
  assert.equal(result.ok, false);
  assert.match(result.message, /slash command/i);
});
