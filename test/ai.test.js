import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SocialMediaBot } from '../src/bot.js';
import { config } from '../src/config.js';

function reset() {
  fs.rmSync('.test-data', { recursive: true, force: true });
}

function makeClients() {
  const posted = [];
  return {
    clients: {
      twitter: {
        async post(content) {
          posted.push({ platform: 'twitter', content });
          return { platform: 'twitter', id: 'tw1', url: null, chars: content.length };
        },
        async analytics() { return { impressions: 10 }; }
      },
      telegram: {
        async post(content) {
          posted.push({ platform: 'telegram', content });
          return { platform: 'telegram', id: 'tg1', url: null, chars: content.length };
        },
        async analytics() { return { subscribers: 1 }; }
      },
      linkedin: {
        async post(content) {
          posted.push({ platform: 'linkedin', content });
          return { platform: 'linkedin', id: 'li1', url: null, chars: content.length };
        },
        async analytics() { return { followers: 2 }; }
      }
    },
    posted
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

async function authedBot(clients) {
  const bot = new SocialMediaBot({ platformClients: clients });
  await bot.processEvent(envelope({ text: config.owner.passphrase }));
  return bot;
}

function mockFetchSuccess(drafts) {
  return async function fakeFetch(url, opts) {
    if (!url.includes('api.anthropic.com')) {
      throw new Error(`Unexpected fetch to ${url}`);
    }
    const body = JSON.parse(opts.body);
    assert.equal(body.messages[0].role, 'user');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify(drafts) }]
      })
    };
  };
}

function mockFetchFailure(message) {
  return async function fakeFetch() {
    return {
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: { message } })
    };
  };
}

function withAiEnabled(fn) {
  return async () => {
    const original = { ...config.ai };
    config.ai.enabled = true;
    config.ai.apiKey = 'test-key-123';
    try {
      await fn();
    } finally {
      Object.assign(config.ai, original);
    }
  };
}

function withFetchMock(mockFn, fn) {
  return async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFn;
    try {
      await fn();
    } finally {
      globalThis.fetch = originalFetch;
    }
  };
}

test('/ai without topic returns usage error', withAiEnabled(async () => {
  reset();
  const { clients } = makeClients();
  const bot = await authedBot(clients);
  const result = await bot.processEvent(envelope({ text: '/ai' }));
  assert.equal(result.ok, false);
  assert.match(result.message, /Usage.*\/ai/);
}));

test('/ai when disabled returns helpful error', async () => {
  reset();
  const original = config.ai.enabled;
  config.ai.enabled = false;
  try {
    const { clients } = makeClients();
    const bot = await authedBot(clients);
    const result = await bot.processEvent(envelope({ text: '/ai Some topic' }));
    assert.equal(result.ok, false);
    assert.match(result.message, /disabled/i);
  } finally {
    config.ai.enabled = original;
  }
});

test('/ai with API failure returns error message', withAiEnabled(
  withFetchMock(mockFetchFailure('rate limit exceeded'), async () => {
    reset();
    const { clients } = makeClients();
    const bot = await authedBot(clients);
    const result = await bot.processEvent(envelope({ text: '/ai Why AI agents matter' }));
    assert.equal(result.ok, false);
    assert.match(result.message, /AI generation failed/);
  })
));

test('/ai success creates 3 approvals and returns drafts with IDs', withAiEnabled(
  withFetchMock(mockFetchSuccess({
    twitter: 'AI agents are the future. #AI',
    telegram: '**AI Agents**\n\nHere is why they matter for your workflow.',
    linkedin: 'AI Agents Will Replace SaaS\n\nMost teams miss this.\n\n#AI #Leadership'
  }), async () => {
    reset();
    const { clients } = makeClients();
    const bot = await authedBot(clients);
    const result = await bot.processEvent(envelope({ text: '/ai Why AI agents will replace SaaS' }));

    assert.equal(result.ok, true);
    assert.ok(result.data);
    assert.equal(result.data.topic, 'Why AI agents will replace SaaS');

    // Check drafts exist for all platforms
    for (const platform of ['twitter', 'telegram', 'linkedin']) {
      assert.ok(result.data.drafts[platform].text.length > 0);
      assert.ok(result.data.drafts[platform].chars > 0);
      assert.ok(result.data.approvals[platform]);
      assert.match(result.data.approvals[platform], /^appr_/);
    }

    // Check 3 distinct approval IDs
    const ids = Object.values(result.data.approvals);
    assert.equal(new Set(ids).size, 3);
  })
));

test('approve an AI draft posts to correct platform', withAiEnabled(
  withFetchMock(mockFetchSuccess({
    twitter: 'Short tweet about AI. #AI',
    telegram: '**AI Topic**\n\nDetailed post here.',
    linkedin: 'Professional AI post.\n\n#AI #Tech'
  }), async () => {
    reset();
    const { clients, posted } = makeClients();
    const bot = await authedBot(clients);
    const aiResult = await bot.processEvent(envelope({ text: '/ai AI topic' }));
    assert.equal(aiResult.ok, true);

    const twitterApprovalId = aiResult.data.approvals.twitter;
    const approveResult = await bot.processEvent(envelope({ text: `/approve ${twitterApprovalId}` }));
    assert.equal(approveResult.ok, true);

    // Verify it posted to twitter with the draft text
    assert.equal(posted.length, 1);
    assert.equal(posted[0].platform, 'twitter');
    assert.equal(posted[0].content, 'Short tweet about AI. #AI');
  })
));

test('reject an AI draft marks it as rejected', withAiEnabled(
  withFetchMock(mockFetchSuccess({
    twitter: 'Tweet text. #AI',
    telegram: '**Telegram**\n\nBody.',
    linkedin: 'LinkedIn post.\n\n#AI'
  }), async () => {
    reset();
    const { clients } = makeClients();
    const bot = await authedBot(clients);
    const aiResult = await bot.processEvent(envelope({ text: '/ai Some topic' }));
    assert.equal(aiResult.ok, true);

    const linkedinApprovalId = aiResult.data.approvals.linkedin;
    const rejectResult = await bot.processEvent(envelope({ text: `/reject ${linkedinApprovalId}` }));
    assert.equal(rejectResult.ok, true);
    assert.match(rejectResult.message, /Rejected/);

    // Try to approve it after rejection — should fail
    const lateApprove = await bot.processEvent(envelope({ text: `/approve ${linkedinApprovalId}` }));
    assert.equal(lateApprove.ok, false);
    assert.match(lateApprove.message, /not found/i);
  })
));

test('/ai handles code-fenced JSON response', withAiEnabled(
  withFetchMock(async function fakeFetch() {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: 'text', text: '```json\n{"twitter":"Tweet.","telegram":"TG post.","linkedin":"LI post."}\n```' }]
      })
    };
  }, async () => {
    reset();
    const { clients } = makeClients();
    const bot = await authedBot(clients);
    const result = await bot.processEvent(envelope({ text: '/ai Test topic' }));
    assert.equal(result.ok, true);
    assert.equal(result.data.drafts.twitter.text, 'Tweet.');
  })
));
