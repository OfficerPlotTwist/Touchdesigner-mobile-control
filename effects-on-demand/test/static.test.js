import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStaticPath } from '../server/static.js';
import { resolve, sep } from 'node:path';

const ROOT = resolve('effects-on-demand/public');

test('maps / to index.html inside root', () => {
  const p = resolveStaticPath(ROOT, '/');
  assert.equal(p, resolve(ROOT, 'index.html'));
});

test('blocks parent traversal', () => {
  assert.equal(resolveStaticPath(ROOT, '/../server/config.js'), null);
  assert.equal(resolveStaticPath(ROOT, '/..%2f..%2fetc/passwd'), null);
});

test('resolves a nested asset within root', () => {
  const p = resolveStaticPath(ROOT, '/app.js');
  assert.ok(p.startsWith(ROOT + sep));
});
