import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectName, effectPath, registryRow, scaffoldScript, REGISTRY_COLUMNS } from '../worker/contract.js';
import { DEFAULTS } from '../server/config.js';

const C = DEFAULTS.contract;

test('effect naming correlates id across comp/registry', () => {
  assert.equal(effectName('abc'), 'fx_abc');
  assert.equal(effectPath(C, 'abc'), '/project1/effects/fx_abc');
});

test('registryRow emits cells in column order as strings', () => {
  const row = registryRow({ index: 3, compPath: '/project1/effects/fx_abc', title: 'rain', author: 'Al', createdTs: 1700000000 });
  assert.deepEqual(REGISTRY_COLUMNS, ['index', 'comp_path', 'title', 'author', 'created_ts']);
  assert.deepEqual(row, ['3', '/project1/effects/fx_abc', 'rain', 'Al', '1700000000']);
});

test('scaffold script references all contract ops and is parameterized by paths', () => {
  const s = scaffoldScript(C);
  assert.match(s, /\/project1\/effects/);
  assert.match(s, /fx_switch/);
  assert.match(s, /fx_registry/);
  assert.match(s, /index\s*\|?\s*comp_path/i); // header awareness
  assert.match(s, /idempotent|op\(|if .*is None/i); // guards before create
});
