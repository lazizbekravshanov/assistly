import crypto from 'node:crypto';

export class SessionAuth {
  constructor({ passphrase, timeoutMinutes, ownerId, sessionSecret, logger, stateService }) {
    this.passphrase = passphrase;
    this.timeoutMs = timeoutMinutes * 60 * 1000;
    this.ownerId = ownerId;
    this.sessionSecret = sessionSecret || passphrase;
    this.logger = logger;
    this.stateService = stateService;
  }

  async #session(userId) {
    return this.stateService.getSession(userId);
  }

  async #save(userId, session) {
    return this.stateService.saveSession(userId, session);
  }

  isOwner(userId) {
    return userId === this.ownerId;
  }

  async isLocked(userId, now = Date.now()) {
    const session = await this.#session(userId);
    return Boolean(session.lockedUntil && now < session.lockedUntil);
  }

  async isAuthenticated(userId, now = Date.now()) {
    const session = await this.#session(userId);
    if (!session.authenticatedAt || !session.lastSeenAt) return false;
    return now - session.lastSeenAt <= this.timeoutMs;
  }

  async touch(userId, now = Date.now()) {
    const session = await this.#session(userId);
    session.lastSeenAt = now;
    await this.#save(userId, session);
  }

  async signoff(userId) {
    const session = await this.#session(userId);
    session.authenticatedAt = null;
    session.lastSeenAt = null;
    await this.#save(userId, session);
    this.logger.log('session.signoff', { userId });
  }

  #createSessionToken(userId, now) {
    const payload = {
      userId,
      iat: now,
      exp: now + this.timeoutMs
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${sig}`;
  }

  validateSessionToken(userId, token, now = Date.now()) {
    if (!token || typeof token !== 'string' || !token.includes('.')) {
      return { ok: false, reason: 'missing_token' };
    }

    const [encoded, providedSig] = token.split('.');
    const expectedSig = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(encoded)
      .digest('base64url');
    if (providedSig !== expectedSig) return { ok: false, reason: 'bad_signature' };

    let payload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'bad_payload' };
    }

    if (payload.userId !== userId) return { ok: false, reason: 'wrong_user' };
    if (!Number.isFinite(payload.exp) || payload.exp < now) return { ok: false, reason: 'expired' };
    return { ok: true };
  }

  async establishSessionFromToken(userId, token, now = Date.now()) {
    const check = this.validateSessionToken(userId, token, now);
    if (!check.ok) return check;
    const session = await this.#session(userId);
    session.authenticatedAt = now;
    session.lastSeenAt = now;
    session.failedAttempts = [];
    session.lockedUntil = null;
    await this.#save(userId, session);
    return { ok: true };
  }

  async authenticate({ userId, candidate, now = Date.now() }) {
    const session = await this.#session(userId);

    if (!this.isOwner(userId)) {
      this.logger.log('auth.rejected_non_owner', { userId });
      return { ok: false, reason: 'non_owner' };
    }

    if (session.lockedUntil && now < session.lockedUntil) {
      return { ok: false, reason: 'locked' };
    }

    if (candidate === this.passphrase) {
      session.authenticatedAt = now;
      session.lastSeenAt = now;
      session.failedAttempts = [];
      session.lockedUntil = null;
      await this.#save(userId, session);
      this.logger.log('auth.success', { userId });
      return { ok: true, sessionToken: this.#createSessionToken(userId, now) };
    }

    session.failedAttempts.push(now);
    session.failedAttempts = session.failedAttempts.filter((ts) => now - ts <= 10 * 60 * 1000);

    if (session.failedAttempts.length >= 5) {
      session.lockedUntil = now + 30 * 60 * 1000;
      this.logger.log('auth.locked', {
        userId,
        until: new Date(session.lockedUntil).toISOString()
      });
      await this.#save(userId, session);
      return { ok: false, reason: 'locked' };
    }

    await this.#save(userId, session);
    this.logger.log('auth.failure', { userId, recentFailures: session.failedAttempts.length });
    return { ok: false, reason: 'invalid' };
  }
}
