import { SocialMediaBot } from './bot.js';

const bot = new SocialMediaBot();
const intervalMs = Number(process.env.WORKER_INTERVAL_MS || 30_000);

async function tick() {
  try {
    await bot.processDueQueue();
  } catch (error) {
    bot.logger.log('worker.tick_error', { error: error.message || 'unknown' });
  }
}

const timer = setInterval(tick, intervalMs);
tick();

async function shutdown(signal) {
  clearInterval(timer);
  if (bot.backend) {
    await bot.backend.close().catch(() => {});
  }
  if (bot.store?.mirror) {
    await bot.store.mirror.close().catch(() => {});
  }
  console.log(`assistly-worker shutdown complete (${signal})`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
