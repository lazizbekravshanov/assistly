import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedWindowRateLimiter } from '../src/http/rate_limiter.js';

test('FixedWindowRateLimiter blocks after limit within window', () => {
  const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 1000 });
  const now = 1000;

  assert.equal(limiter.consume('ip-1', now).allowed, true);
  assert.equal(limiter.consume('ip-1', now + 1).allowed, true);
  const third = limiter.consume('ip-1', now + 2);
  assert.equal(third.allowed, false);
});

test('FixedWindowRateLimiter resets after window passes', () => {
  const limiter = new FixedWindowRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.consume('ip-1', 1000).allowed, true);
  assert.equal(limiter.consume('ip-1', 1001).allowed, false);
  assert.equal(limiter.consume('ip-1', 2001).allowed, true);
});

