const STRING_FIELDS = ['user_id', 'channel', 'thread_id', 'message_id', 'timestamp', 'locale', 'timezone', 'trace_id', 'text'];

export function validateWebhookPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'payload_must_be_object' };
  }

  for (const field of STRING_FIELDS) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== 'string') {
      return { ok: false, reason: `invalid_field_type:${field}` };
    }
  }

  if (typeof value.text === 'string' && value.text.length > 10000) {
    return { ok: false, reason: 'text_too_long' };
  }

  if (value.timestamp) {
    const ms = Date.parse(value.timestamp);
    if (!Number.isFinite(ms)) {
      return { ok: false, reason: 'invalid_timestamp' };
    }
  }

  return { ok: true };
}

