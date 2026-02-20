import { SocialMediaBot } from './bot.js';

const bot = new SocialMediaBot();
const intervalMs = Number(process.env.WORKER_INTERVAL_MS || 30_000);

async function tick() {
  try {
    await bot.processDueQueue();
  } catch (_error) {
    // Processing errors are logged through logger service.
  }
}

const timer = setInterval(tick, intervalMs);
tick();

function shutdown(signal) {
  clearInterval(timer);
  console.log(`assistly-worker shutdown complete (${signal})`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

