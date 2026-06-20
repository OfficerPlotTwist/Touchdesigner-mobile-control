import { existsSync } from 'node:fs';
import { loadConfig, DEFAULTS } from '../server/config.js';
import { RequestQueue } from '../server/queue.js';
import { connectMcpBridge } from './mcpBridge.js';
import { makeAgentRunner } from './agentRunner.js';
import { runWorker } from './worker.js';

const cfgPath = process.env.EOD_CONFIG || 'config/effects.config.json';
const config = existsSync(cfgPath) ? loadConfig(cfgPath) : DEFAULTS;

const mcpUrl = process.env.EOD_MCP_URL || 'ws://127.0.0.1:9980';
const model = process.env.EOD_GLM_MODEL || 'glm-4.6';

// Shared queue + intake from the intake process when co-located; otherwise the
// worker owns its own queue and you run a status bridge. This entry assumes
// co-located single-process start (node -e importing both), or a shared queue.
const queue = globalThis.__EOD_QUEUE__ || new RequestQueue({ bound: config.queueBound });
const intake = globalThis.__EOD_INTAKE__;
const onStatus = (id, state, note) => intake?.pushStatus(id, state, note);

const bridge = await connectMcpBridge({ url: mcpUrl });
const runAgentSession = makeAgentRunner({ mcpServerUrl: mcpUrl, model });

console.log(`[eod] worker draining queue → TD-MCP ${mcpUrl}, model ${model}`);
await runWorker({ queue, config, bridge, runAgentSession, now: () => Date.now(), onStatus, shouldStop: () => false });
