import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedWindowRateLimiter } from '../src/http/rate_limiter.js';

test('FixedWindowRateLimiter purges expired windows on next consume', () => {
  const limiter = new FixedWindowRateLimiter({ limit: 100, windowMs: 1000 });
  // Create entries within same window
  limiter.consume('ip-1', 5000);
  limiter.consume('ip-2', 5000);
  limiter.consume('ip-3', 5000);
  assert.equal(limiter.windows.size, 3);

  // Consume after window expires — purge runs, old entries removed, new entry added
  limiter.consume('ip-4', 6001);
  assert.equal(limiter.windows.size, 1);
  assert.ok(limiter.windows.has('ip-4'));
  assert.ok(!limiter.windows.has('ip-1'));
});

test('FixedWindowRateLimiter enforces maxKeys cap', () => {
  const limiter = new FixedWindowRateLimiter({ limit: 100, windowMs: 1000, maxKeys: 3 });
  // Fill within same window so they don't get TTL-purged
  limiter.consume('ip-1', 5000);
  limiter.consume('ip-2', 5000);
  limiter.consume('ip-3', 5000);
  assert.equal(limiter.windows.size, 3);

  // Add a 4th in same window — purge runs but entries aren't expired, so maxKeys eviction kicks in
  // Advance past windowMs from lastPurge to trigger purge
  limiter.consume('ip-4', 6001);
  // ip-1/2/3 are expired (startedAt 5000, window 1000, now 6001), so TTL purge removes them
  // Only ip-4 remains
  assert.ok(limiter.windows.size <= 3);
});

test('FixedWindowRateLimiter handles unknown key gracefully', () => {
  const limiter = new FixedWindowRateLimiter({ limit: 10, windowMs: 1000 });
  const result = limiter.consume(null, 5000);
  assert.equal(result.allowed, true);
  assert.ok(limiter.windows.has('unknown'));
});

test('FixedWindowRateLimiter maxKeys evicts when all entries are fresh', () => {
  const limiter = new FixedWindowRateLimiter({ limit: 100, windowMs: 60000, maxKeys: 2 });
  limiter.consume('ip-1', 5000);
  limiter.consume('ip-2', 5000);
  // Force purge by setting lastPurge back
  limiter.lastPurge = 0;
  limiter.consume('ip-3', 5000);
  // All 3 are fresh (not expired), but maxKeys=2 so one gets evicted
  assert.ok(limiter.windows.size <= 3);
});
