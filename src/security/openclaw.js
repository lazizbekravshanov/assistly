import crypto from 'node:crypto';

function safeEqualHex(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function buildOpenClawVerifier({ secret, maxSkewSeconds, enforceSignature, stateService }) {
  const secrets = Array.isArray(secret)
    ? secret.filter(Boolean)
    : String(secret || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  return async function verify({ headers, rawBody, nowMs = Date.now() }) {
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

    if (await stateService.seenNonce(nonce)) {
      return { ok: false, reason: 'replay_detected' };
    }
    await stateService.pruneNonces(nowMs - maxSkewSeconds * 1000);

    const payload = `${timestamp}.${nonce}.${rawBody}`;
    const valid = secrets.some((candidate) => {
      const expected = crypto.createHmac('sha256', candidate).update(payload).digest('hex');
      return safeEqualHex(expected, signature);
    });

    if (!valid) {
      return { ok: false, reason: 'signature_mismatch' };
    }

    await stateService.registerNonce(nonce, nowMs);
    return { ok: true };
  };
}
