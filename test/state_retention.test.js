import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JsonFileStore } from '../src/services/store.js';
import { StateService } from '../src/services/state.js';

function reset() {
  fs.rmSync('.test-data', { recursive: true, force: true });
}

test('pruneRetention removes expired approvals, idempotency keys, and nonces', () => {
  reset();
  const store = new JsonFileStore({
    dataDir: '.test-data',
    queueFile: 'queue.json',
    logsFile: 'logs.json',
    stateFile: 'state.json'
  });

  const stateService = new StateService({
    store,
    retention: {
      approvalsMaxAgeDays: 2,
      idempotencyMaxAgeDays: 2,
      noncesMaxAgeDays: 2,
      maxApprovals: 100,
      maxIdempotencyKeys: 100
    }
  });

  const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
  const oldIso = '2026-02-15T12:00:00.000Z';
  const recentIso = '2026-02-19T12:00:00.000Z';

  stateService.addApproval({ id: 'appr-old', createdAt: oldIso, status: 'pending', command: '/delete', args: [] });
  stateService.addApproval({ id: 'appr-recent', createdAt: recentIso, status: 'pending', command: '/delete', args: [] });
  stateService.setIdempotency('old-key', { ok: true }, oldIso);
  stateService.setIdempotency('recent-key', { ok: true }, recentIso);
  stateService.registerNonce('old-nonce', Date.parse(oldIso));
  stateService.registerNonce('recent-nonce', Date.parse(recentIso));

  stateService.pruneRetention(nowMs);

  assert.equal(stateService.getApproval('appr-old'), null);
  assert.ok(stateService.getApproval('appr-recent'));
  assert.equal(stateService.getIdempotency('old-key'), null);
  assert.ok(stateService.getIdempotency('recent-key'));
  assert.equal(stateService.seenNonce('old-nonce'), false);
  assert.equal(stateService.seenNonce('recent-nonce'), true);
});
