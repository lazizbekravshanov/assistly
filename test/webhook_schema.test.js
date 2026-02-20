import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWebhookPayload } from '../src/http/webhook_schema.js';

test('validateWebhookPayload accepts valid payload', () => {
  const result = validateWebhookPayload({
    user_id: 'owner',
    channel: 'telegram',
    text: '/status',
    timestamp: '2026-02-20T12:00:00.000Z'
  });
  assert.equal(result.ok, true);
});

test('validateWebhookPayload rejects invalid field types', () => {
  const result = validateWebhookPayload({
    user_id: 123,
    text: '/status'
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid_field_type/);
});

test('validateWebhookPayload rejects invalid timestamp format', () => {
  const result = validateWebhookPayload({
    user_id: 'owner',
    timestamp: 'yesterday'
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_timestamp');
});

