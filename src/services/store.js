import fs from 'node:fs';
import path from 'node:path';
import { PostgresMirrorService } from './postgres_mirror.js';

export class JsonFileStore {
  constructor({ dataDir, queueFile, logsFile, stateFile, mirror } = {}) {
    this.dataDir = path.resolve(process.cwd(), dataDir);
    this.queuePath = path.join(this.dataDir, queueFile);
    this.logsPath = path.join(this.dataDir, logsFile);
    this.statePath = path.join(this.dataDir, stateFile);
    this.mirror = mirror || null;
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  readQueue() {
    return this.#readJson(this.queuePath, []);
  }

  writeQueue(items) {
    this.#writeJson(this.queuePath, items);
    this.mirror?.enqueueSnapshot('queue', items);
  }

  readLogs() {
    return this.#readJson(this.logsPath, []);
  }

  writeLogs(entries) {
    this.#writeJson(this.logsPath, entries);
    this.mirror?.enqueueSnapshot('logs', entries);
  }

  readState() {
    return this.#readJson(this.statePath, {
      sessions: {},
      approvals: [],
      idempotency: {},
      nonces: {},
      workerLock: null,
      metrics: {
        requestCount: 0,
        errorCount: 0,
        commandCount: 0,
        latencyMs: { count: 0, total: 0, max: 0 }
      }
    });
  }

  writeState(state) {
    this.#writeJson(this.statePath, state);
    this.mirror?.enqueueSnapshot('state', state);
  }

  #readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  #writeJson(filePath, data) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  }
}

export function createStore(storageConfig = {}) {
  const mirror = new PostgresMirrorService({
    enabled: storageConfig.engine === 'postgres',
    connectionString: storageConfig.databaseUrl
  });
  return new JsonFileStore({
    ...storageConfig,
    mirror
  });
}
