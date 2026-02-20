import { config } from './config.js';
import { SessionAuth } from './security/auth.js';
import { hasInjectionRisk } from './security/injection.js';
import { Logger } from './services/logger.js';
import { PostQueue } from './services/queue.js';
import { JsonFileStore } from './services/store.js';
import { StateService } from './services/state.js';
import { PolicyEngine } from './security/policy.js';
import { TwitterClient } from './platforms/twitter.js';
import { TelegramClient } from './platforms/telegram.js';
import { LinkedInClient } from './platforms/linkedin.js';
import { handleCommand } from './commands.js';

const UNAUTHORIZED = '⛔ Unauthorized. This bot operates under single-owner authority.';

function traceId() {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class SocialMediaBot {
  constructor({ platformClients } = {}) {
    this.instanceId = `bot_${Math.random().toString(36).slice(2, 10)}`;
    this.store = new JsonFileStore(config.storage);
    this.stateService = new StateService({
      store: this.store,
      retention: {
        approvalsMaxAgeDays: config.retention.approvalsDays,
        idempotencyMaxAgeDays: config.retention.idempotencyDays,
        noncesMaxAgeDays: config.retention.noncesDays,
        maxApprovals: config.retention.maxApprovals,
        maxIdempotencyKeys: config.retention.maxIdempotency
      }
    });
    this.logger = new Logger({
      store: this.store,
      maxAgeDays: config.retention.logsDays
    });
    this.auth = new SessionAuth({
      passphrase: config.owner.passphrase,
      timeoutMinutes: config.bot.sessionTimeoutMinutes,
      ownerId: config.owner.id,
      logger: this.logger,
      stateService: this.stateService
    });
    this.policyEngine = new PolicyEngine(config.policy);
    this.queue = new PostQueue({
      retryIntervalMinutes: config.schedule.retryIntervalMinutes,
      maxRetries: config.schedule.maxRetries,
      store: this.store
    });
    this.platformClients = platformClients || {
      twitter: new TwitterClient(config.platforms.twitter),
      telegram: new TelegramClient(config.platforms.telegram),
      linkedin: new LinkedInClient(config.platforms.linkedin)
    };
  }

  startupMessage() {
    return `${config.bot.name} is online. 🔒 Please authenticate to proceed.`;
  }

  metricsSnapshot() {
    return this.stateService.getMetrics();
  }

  readinessSnapshot() {
    const lock = this.stateService.currentWorkerLock();
    const queueItems = this.queue.list();
    return {
      ready: true,
      queueSize: queueItems.length,
      queueScheduled: queueItems.filter((x) => x.status === 'scheduled').length,
      queueRetrying: queueItems.filter((x) => x.status === 'retrying').length,
      queueDeadLetter: queueItems.filter((x) => x.status === 'dead_letter').length,
      workerLock: lock
    };
  }

  async processDueQueue(nowIso = new Date().toISOString()) {
    this.stateService.pruneRetention();
    const nowMs = Date.parse(nowIso);
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const lockTtlMs = config.schedule.workerLockSeconds * 1000;
    const lockAcquired = this.stateService.acquireWorkerLock(this.instanceId, lockTtlMs, safeNowMs);
    if (!lockAcquired) {
      this.logger.log('queue.lock.skipped', { instanceId: this.instanceId });
      return [];
    }

    const dueItems = this.queue.due(nowIso);
    const results = [];

    try {
      for (const item of dueItems) {
        this.stateService.renewWorkerLock(this.instanceId, lockTtlMs, safeNowMs);
        const client = this.platformClients[item.platform];
        if (!client) {
          this.queue.markFailed(item.id, `Unsupported platform: ${item.platform}`);
          continue;
        }

        try {
          const posted = await client.post(item.content);
          this.queue.markPosted(item.id, posted.id, safeNowMs);
          this.logger.log('post.published.scheduled', {
            queueId: item.id,
            platform: item.platform,
            remoteId: posted.id,
            apiStatus: 200
          });
          results.push({ id: item.id, status: 'posted', remoteId: posted.id });
        } catch (error) {
          const failed = this.queue.markFailed(item.id, error.message, safeNowMs);
          this.logger.log('post.failed', {
            queueId: item.id,
            platform: item.platform,
            retries: failed?.retries ?? 0,
            error: error.message,
            apiStatus: 500,
            deadLetter: failed?.status === 'dead_letter'
          });
          results.push({ id: item.id, status: failed?.status || 'failed', error: error.message });
        }
      }

      return results;
    } finally {
      this.stateService.releaseWorkerLock(this.instanceId);
    }
  }

  async processEvent(envelope) {
    const started = Date.now();
    const reqTraceId = envelope.trace_id || traceId();
    this.stateService.pruneRetention();
    this.stateService.incrementMetric('requestCount');

    const incoming = {
      user_id: envelope.user_id || 'unknown',
      channel: envelope.channel || 'unknown',
      thread_id: envelope.thread_id || null,
      message_id: envelope.message_id || null,
      timestamp: envelope.timestamp || new Date().toISOString(),
      locale: envelope.locale || 'en-US',
      timezone: envelope.timezone || config.owner.timezone,
      text: typeof envelope.text === 'string' ? envelope.text : ''
    };

    if (hasInjectionRisk(incoming.text)) {
      this.logger.log('security.injection_attempt', {
        traceId: reqTraceId,
        userId: incoming.user_id,
        text: incoming.text
      });
    }

    const now = Date.now();
    if (this.auth.isLocked(incoming.user_id, now)) {
      this.stateService.incrementMetric('errorCount');
      return { ok: false, traceId: reqTraceId, message: UNAUTHORIZED };
    }

    if (!this.auth.isAuthenticated(incoming.user_id, now)) {
      const authResult = this.auth.authenticate({
        userId: incoming.user_id,
        candidate: incoming.text,
        now
      });
      if (!authResult.ok) {
        this.stateService.incrementMetric('errorCount');
        return { ok: false, traceId: reqTraceId, message: UNAUTHORIZED };
      }

      const latencyMs = Date.now() - started;
      this.stateService.observeLatency(latencyMs);
      return {
        ok: true,
        traceId: reqTraceId,
        message: `✅ Welcome back, ${config.owner.name}. Session active. Ready. Send a command or content to get started.`,
        versions: config.versions
      };
    }

    this.auth.touch(incoming.user_id, now);

    const result = await handleCommand({
      envelope: incoming,
      traceId: reqTraceId,
      auth: this.auth,
      queue: this.queue,
      logger: this.logger,
      platformClients: this.platformClients,
      policyEngine: this.policyEngine,
      stateService: this.stateService,
      config
    });

    const latencyMs = Date.now() - started;
    this.stateService.observeLatency(latencyMs);
    if (!result.ok) this.stateService.incrementMetric('errorCount');

    return {
      ...result,
      traceId: reqTraceId,
      versions: config.versions
    };
  }

  async processMessage(text) {
    return this.processEvent({
      user_id: config.owner.id,
      channel: 'local',
      thread_id: 'local-thread',
      message_id: `local-${Date.now()}`,
      timestamp: new Date().toISOString(),
      locale: 'en-US',
      timezone: config.owner.timezone,
      text
    });
  }
}

export { UNAUTHORIZED };
