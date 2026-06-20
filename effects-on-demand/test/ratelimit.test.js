import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from '../server/ratelimit.js';

test('allows up to capacity then blocks, refilling over time', () => {
  const b = new TokenBucket(2, 1); // 2 burst, 1/sec
  assert.equal(b.take(1000), true);
  assert.equal(b.take(1000), true);
  assert.equal(b.take(1000), false);      // empty
  assert.equal(b.take(2000), true);       // +1s → 1 token
  assert.equal(b.take(2000), false);
});
