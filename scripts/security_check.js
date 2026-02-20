import fs from 'node:fs';

const envExample = fs.readFileSync('.env.example', 'utf8');
const requiredVars = [
  'OPENCLAW_WEBHOOK_SECRET',
  'OPENCLAW_ENFORCE_SIGNATURE',
  'OPENCLAW_RATE_LIMIT_MAX_REQUESTS',
  'OPENCLAW_RATE_LIMIT_WINDOW_SECONDS',
  'OWNER_SESSION_SECRET'
];

const missing = requiredVars.filter((name) => !envExample.includes(`${name}=`));
if (missing.length > 0) {
  console.error(`security check failed: missing env vars: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('security check passed');
