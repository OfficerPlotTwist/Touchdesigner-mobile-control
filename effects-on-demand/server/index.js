import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadConfig, DEFAULTS } from './config.js';
import { RequestQueue } from './queue.js';
import { createIntakeServer } from './intakeServer.js';

const cfgPath = process.env.EOD_CONFIG || 'config/effects.config.json';
const config = existsSync(cfgPath) ? loadConfig(cfgPath) : DEFAULTS;
const port = Number(process.env.EOD_PORT || 8090);

const queue = new RequestQueue({ bound: config.queueBound });
const intake = createIntakeServer({
  config, port, publicDir: 'public', queue,
  now: () => Date.now(), makeId: () => randomUUID().slice(0, 8),
});

// In single-process mode, the worker is started in the same process (see
// worker/index.js dual-mode note). The shared queue + intake.pushStatus connect
// them. For a two-process deployment, replace this with an IPC/WS status bridge.
globalThis.__EOD_INTAKE__ = intake;
globalThis.__EOD_QUEUE__ = queue;
console.log(`[eod] intake listening on :${port} (queue bound ${config.queueBound})`);
