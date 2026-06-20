import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processJob } from '../worker/worker.js';
import { DEFAULTS } from '../server/config.js';
import { MockTdBridge } from '../tools/mock-td.js';

const cfg = () => ({ ...DEFAULTS, contract: { ...DEFAULTS.contract } });
const job = (id) => ({ requestId: id, clientId: 'c', name: 'Al', text: 'add rain', ts: 1 });
const okRunner = async ({ bridge, effectPath }) => { bridge.state.ops.add(effectPath); return { built: true }; };
const now = () => 1700000000000;

test('happy path: builds, verifies, registers, switches, reports live', async () => {
  const bridge = new MockTdBridge();
  const seen = [];
  const r = await processJob({ job: job('abc'), config: cfg(), bridge, runAgentSession: okRunner, now, onStatus: (id, s) => seen.push(s) });
  assert.equal(r.state, 'live');
  assert.equal(await bridge.getSwitch(), r.index);
  const reg = await bridge.readRegistry();
  assert.ok(reg.some((e) => e.index === r.index && e.author === 'Al'));
  assert.deepEqual(seen, ['building', 'live']);
});

test('bridge down → failed, switch untouched', async () => {
  const bridge = new MockTdBridge({ bridgeDown: true });
  const before = await bridge.getSwitch();
  const r = await processJob({ job: job('abc'), config: cfg(), bridge, runAgentSession: okRunner, now, onStatus: () => {} });
  assert.equal(r.state, 'failed');
  assert.equal(await bridge.getSwitch(), before);
});

test('verify-fail (blank render) → discard container, failed, switch untouched', async () => {
  const bridge = new MockTdBridge({ blankForRequestId: 'abc' });
  const r = await processJob({ job: job('abc'), config: cfg(), bridge, runAgentSession: okRunner, now, onStatus: () => {} });
  assert.equal(r.state, 'failed');
  assert.equal(await bridge.getSwitch(), 0);
  // container discarded
  assert.equal([...bridge.state.ops].some((p) => p.includes('fx_abc')), false);
});

test('agent throws → failed and container discarded', async () => {
  const bridge = new MockTdBridge();
  const boom = async ({ bridge, effectPath }) => { bridge.state.ops.add(effectPath); throw new Error('agent died'); };
  const r = await processJob({ job: job('abc'), config: cfg(), bridge, runAgentSession: boom, now, onStatus: () => {} });
  assert.equal(r.state, 'failed');
  assert.equal([...bridge.state.ops].some((p) => p.includes('fx_abc')), false);
});

test('at cap, LRU recycles oldest non-live before adding', async () => {
  const bridge = new MockTdBridge();
  const c = cfg(); c.galleryCap = 2;
  // pre-seed: safe(0) + one effect(1)
  bridge.state.registry.push({ index: 0, compPath: '/p/safe', title: 'safe', author: '', createdTs: 0 });
  bridge.state.registry.push({ index: 1, compPath: '/project1/effects/fx_old', title: 't', author: 'x', createdTs: 5 });
  bridge.state.ops.add('/project1/effects/fx_old');
  const r = await processJob({ job: job('new'), config: c, bridge, runAgentSession: okRunner, now, onStatus: () => {} });
  assert.equal(r.state, 'live');
  assert.equal(r.index, 1);                                          // reused the freed slot (capped gallery)
  const reg = await bridge.readRegistry();
  assert.equal(reg.length, 2);                                       // safe(0) + new(1); old recycled
  assert.equal(reg.some((e) => e.compPath.includes('fx_old')), false); // old effect gone from registry
  assert.equal(bridge.state.ops.has('/project1/effects/fx_old'), false);
});
