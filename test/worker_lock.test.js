import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JsonFileStore } from '../src/services/store.js';
import { StateService } from '../src/services/state.js';

function reset() {
  fs.rmSync('.test-data', { recursive: true, force: true });
}

test('worker lock enforces single owner until expiry', () => {
  reset();
  const store = new JsonFileStore({
    dataDir: '.test-data',
    queueFile: 'queue.json',
    logsFile: 'logs.json',
    stateFile: 'state.json'
  });
  const state = new StateService({ store });

  const now = 1000;
  assert.equal(state.acquireWorkerLock('a', 1000, now), true);
  assert.equal(state.acquireWorkerLock('b', 1000, now + 1), false);
  assert.equal(state.acquireWorkerLock('b', 1000, now + 1001), true);
});

