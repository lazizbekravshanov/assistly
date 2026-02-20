import fs from 'node:fs';
import path from 'node:path';

const configPath = path.resolve(process.cwd(), 'config/runtime_config.json');
const raw = fs.readFileSync(configPath, 'utf8');
const fileConfig = JSON.parse(raw);

function fromEnv(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function mergeConfig(base) {
  return {
    ...base,
    owner: {
      ...base.owner,
      id: fromEnv('OWNER_ID', base.owner.id),
      name: fromEnv('OWNER_NAME', base.owner.name),
      passphrase: fromEnv('OWNER_PASSPHRASE', base.owner.passphrase),
      timezone: fromEnv('OWNER_TIMEZONE', base.owner.timezone)
    },
    bot: {
      ...base.bot,
      name: fromEnv('BOT_NAME', base.bot.name),
      sessionTimeoutMinutes: parseNumber(
        fromEnv('SESSION_TIMEOUT_MINUTES', base.bot.sessionTimeoutMinutes),
        base.bot.sessionTimeoutMinutes
      )
    },
    versions: {
      ...base.versions,
      promptVersion: fromEnv('PROMPT_VERSION', base.versions.promptVersion),
      configVersion: fromEnv('CONFIG_VERSION', base.versions.configVersion),
      buildVersion: fromEnv('BUILD_VERSION', base.versions.buildVersion)
    },
    openclaw: {
      ...base.openclaw,
      webhookSecret: fromEnv('OPENCLAW_WEBHOOK_SECRET', base.openclaw.webhookSecret),
      maxSkewSeconds: parseNumber(
        fromEnv('OPENCLAW_MAX_SKEW_SECONDS', base.openclaw.maxSkewSeconds),
        base.openclaw.maxSkewSeconds
      ),
      maxBodyBytes: parseNumber(
        fromEnv('OPENCLAW_MAX_BODY_BYTES', base.openclaw.maxBodyBytes),
        base.openclaw.maxBodyBytes
      ),
      enforceSignature: parseBool(
        fromEnv('OPENCLAW_ENFORCE_SIGNATURE', base.openclaw.enforceSignature),
        base.openclaw.enforceSignature
      )
    },
    retention: {
      ...base.retention,
      postDataDays: parseNumber(fromEnv('RETENTION_POST_DATA_DAYS', base.retention.postDataDays), base.retention.postDataDays),
      logsDays: parseNumber(fromEnv('RETENTION_LOGS_DAYS', base.retention.logsDays), base.retention.logsDays),
      approvalsDays: parseNumber(
        fromEnv('RETENTION_APPROVALS_DAYS', base.retention.approvalsDays),
        base.retention.approvalsDays
      ),
      idempotencyDays: parseNumber(
        fromEnv('RETENTION_IDEMPOTENCY_DAYS', base.retention.idempotencyDays),
        base.retention.idempotencyDays
      ),
      noncesDays: parseNumber(fromEnv('RETENTION_NONCES_DAYS', base.retention.noncesDays), base.retention.noncesDays),
      maxApprovals: parseNumber(fromEnv('RETENTION_MAX_APPROVALS', base.retention.maxApprovals), base.retention.maxApprovals),
      maxIdempotency: parseNumber(
        fromEnv('RETENTION_MAX_IDEMPOTENCY', base.retention.maxIdempotency),
        base.retention.maxIdempotency
      )
    },
    platforms: {
      ...base.platforms,
      twitter: {
        ...base.platforms.twitter,
        accessToken: fromEnv('TWITTER_ACCESS_TOKEN', base.platforms.twitter.accessToken)
      },
      telegram: {
        ...base.platforms.telegram,
        botToken: fromEnv('TELEGRAM_BOT_TOKEN', base.platforms.telegram.botToken),
        channelId: fromEnv('TELEGRAM_CHANNEL_ID', base.platforms.telegram.channelId)
      },
      linkedin: {
        ...base.platforms.linkedin,
        accessToken: fromEnv('LINKEDIN_ACCESS_TOKEN', base.platforms.linkedin.accessToken),
        profileId: fromEnv('LINKEDIN_PROFILE_ID', base.platforms.linkedin.profileId)
      }
    },
    storage: {
      ...base.storage,
      dataDir: fromEnv('DATA_DIR', base.storage.dataDir),
      queueFile: fromEnv('QUEUE_FILE', base.storage.queueFile),
      logsFile: fromEnv('LOGS_FILE', base.storage.logsFile),
      stateFile: fromEnv('STATE_FILE', base.storage.stateFile)
    }
  };
}

function validateConfig(cfg) {
  if (!cfg.owner.passphrase) {
    throw new Error('Missing OWNER_PASSPHRASE.');
  }
  if (!cfg.owner.id) {
    throw new Error('Missing OWNER_ID.');
  }
  if (cfg.openclaw.enforceSignature && !cfg.openclaw.webhookSecret) {
    throw new Error('OPENCLAW_ENFORCE_SIGNATURE=true requires OPENCLAW_WEBHOOK_SECRET.');
  }
  if (!Number.isFinite(cfg.openclaw.maxBodyBytes) || cfg.openclaw.maxBodyBytes <= 0) {
    throw new Error('OPENCLAW_MAX_BODY_BYTES must be a positive number.');
  }
}

export const config = mergeConfig(fileConfig);
validateConfig(config);
