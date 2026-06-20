import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, DEFAULTS } from '../server/config.js';

test('empty object yields all defaults', () => {
  const r = validateConfig({});
  assert.equal(r.ok, true);
  assert.equal(r.config.queueBound, 20);
  assert.equal(r.config.jobTimeoutMs, 300000);
  assert.equal(r.config.galleryCap, 12);
  assert.equal(r.config.contract.safeIndex, 0);
  assert.equal(r.config.contract.registryPath, '/project1/fx_registry');
});

test('overrides are applied and merged with contract defaults', () => {
  const r = validateConfig({ galleryCap: 6, contract: { effectsPath: '/p/fx' } });
  assert.equal(r.ok, true);
  assert.equal(r.config.galleryCap, 6);
  assert.equal(r.config.contract.effectsPath, '/p/fx');
  assert.equal(r.config.contract.switchPath, '/project1/fx_switch'); // still default
});

test('rejects non-positive caps', () => {
  const r = validateConfig({ galleryCap: 0 });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /galleryCap/);
});

test('DEFAULTS is frozen and exported', () => {
  assert.equal(DEFAULTS.queueBound, 20);
});
