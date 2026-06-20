import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestQueue } from '../server/queue.js';

const job = (id) => ({ requestId: id, clientId: 'c', name: 'n', text: 't', ts: 0 });

test('enqueue reports 1-based position and FIFO dequeue', () => {
  const q = new RequestQueue({ bound: 20 });
  assert.deepEqual(q.enqueue(job('a')), { ok: true, position: 1 });
  assert.deepEqual(q.enqueue(job('b')), { ok: true, position: 2 });
  assert.equal(q.length, 2);
  assert.equal(q.dequeue().requestId, 'a');
  assert.equal(q.dequeue().requestId, 'b');
  assert.equal(q.dequeue(), null);
});

test('overflow past bound returns busy', () => {
  const q = new RequestQueue({ bound: 2 });
  q.enqueue(job('a')); q.enqueue(job('b'));
  assert.deepEqual(q.enqueue(job('c')), { ok: false, code: 'busy' });
});

test('positionOf reflects live position and remove compacts', () => {
  const q = new RequestQueue({ bound: 20 });
  q.enqueue(job('a')); q.enqueue(job('b')); q.enqueue(job('c'));
  assert.equal(q.positionOf('c'), 3);
  assert.equal(q.remove('a'), true);
  assert.equal(q.positionOf('c'), 2);
  assert.equal(q.positionOf('zzz'), -1);
});
