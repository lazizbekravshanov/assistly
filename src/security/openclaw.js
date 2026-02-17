import crypto from 'node:crypto';

function safeEqualHex(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function buildOpenClawVerifier({ secret, maxSkewSeconds, enforceSignature, stateService }) {
  return function verify({ headers, rawBody, nowMs = Date.now() }) {
    if (!enforceSignature) {
      return { ok: true };
    }

    const signature = headers['x-openclaw-signature'];
    const timestamp = headers['x-openclaw-timestamp'];
    const nonce = headers['x-openclaw-nonce'];

    if (!signature || !timestamp || !nonce) {
      return { ok: false, reason: 'missing_headers' };
    }

    const tsMs = Number(timestamp);
    if (!Number.isFinite(tsMs)) {
      return { ok: false, reason: 'bad_timestamp' };
    }

    const skewMs = Math.abs(nowMs - tsMs);
    if (skewMs > maxSkewSeconds * 1000) {
      return { ok: false, reason: 'timestamp_out_of_window' };
    }

    stateService.pruneNonces(nowMs - maxSkewSeconds * 1000);
    if (stateService.seenNonce(nonce)) {
      return { ok: false, reason: 'replay_detected' };
    }

    const payload = `${timestamp}.${nonce}.${rawBody}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const valid = safeEqualHex(expected, signature);

    if (!valid) {
      return { ok: false, reason: 'signature_mismatch' };
    }

    stateService.registerNonce(nonce, nowMs);
    return { ok: true };
  };
}
