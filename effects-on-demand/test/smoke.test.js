import { test } from 'node:test';
import assert from 'node:assert/strict';

test('node:test runs in the effects-on-demand package', () => {
  assert.equal(1 + 1, 2);
});
