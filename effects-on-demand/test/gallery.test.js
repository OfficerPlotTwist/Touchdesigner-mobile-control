import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRecycleIndex } from '../worker/gallery.js';

const E = [
  { index: 0, createdTs: 0 },   // safe
  { index: 1, createdTs: 10 },
  { index: 2, createdTs: 20 },
  { index: 3, createdTs: 30 },
];

test('returns null while under cap', () => {
  assert.equal(pickRecycleIndex({ entries: E, cap: 12, liveIndex: 2, safeIndex: 0 }), null);
});

test('at cap, recycles oldest non-live non-safe', () => {
  assert.equal(pickRecycleIndex({ entries: E, cap: 4, liveIndex: 2, safeIndex: 0 }), 1);
});

test('never recycles the live index even if oldest', () => {
  assert.equal(pickRecycleIndex({ entries: E, cap: 4, liveIndex: 1, safeIndex: 0 }), 2);
});

test('returns null if nothing is eligible', () => {
  const only = [{ index: 0, createdTs: 0 }, { index: 5, createdTs: 5 }];
  assert.equal(pickRecycleIndex({ entries: only, cap: 2, liveIndex: 5, safeIndex: 0 }), null);
});
