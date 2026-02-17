export class SessionAuth {
  constructor({ passphrase, timeoutMinutes, ownerId, logger, stateService }) {
    this.passphrase = passphrase;
    this.timeoutMs = timeoutMinutes * 60 * 1000;
    this.ownerId = ownerId;
    this.logger = logger;
    this.stateService = stateService;
  }

  #session(userId) {
    return this.stateService.getSession(userId);
  }

  #save(userId, session) {
    this.stateService.saveSession(userId, session);
  }

  isOwner(userId) {
    return userId === this.ownerId;
  }

  isLocked(userId, now = Date.now()) {
    const session = this.#session(userId);
    return Boolean(session.lockedUntil && now < session.lockedUntil);
  }

  isAuthenticated(userId, now = Date.now()) {
    const session = this.#session(userId);
    if (!session.authenticatedAt || !session.lastSeenAt) return false;
    return now - session.lastSeenAt <= this.timeoutMs;
  }

  touch(userId, now = Date.now()) {
    const session = this.#session(userId);
    session.lastSeenAt = now;
    this.#save(userId, session);
  }

  signoff(userId) {
    const session = this.#session(userId);
    session.authenticatedAt = null;
    session.lastSeenAt = null;
    this.#save(userId, session);
    this.logger.log('session.signoff', { userId });
  }

  authenticate({ userId, candidate, now = Date.now() }) {
    const session = this.#session(userId);

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
      this.#save(userId, session);
      this.logger.log('auth.success', { userId });
      return { ok: true };
    }

    session.failedAttempts.push(now);
    session.failedAttempts = session.failedAttempts.filter((ts) => now - ts <= 10 * 60 * 1000);

    if (session.failedAttempts.length >= 5) {
      session.lockedUntil = now + 30 * 60 * 1000;
      this.logger.log('auth.locked', {
        userId,
        until: new Date(session.lockedUntil).toISOString()
      });
      this.#save(userId, session);
      return { ok: false, reason: 'locked' };
    }

    this.#save(userId, session);
    this.logger.log('auth.failure', { userId, recentFailures: session.failedAttempts.length });
    return { ok: false, reason: 'invalid' };
  }
}
