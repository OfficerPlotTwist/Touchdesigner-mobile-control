import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextView, initialView } from '../public/ui-logic.js';

test('accepted → queued with position', () => {
  const s = nextView(initialView(), { type: 'accepted', requestId: 'r1', position: 3 });
  assert.equal(s.phase, 'queued');
  assert.equal(s.position, 3);
  assert.equal(s.requestId, 'r1');
});

test('status building/live/failed map to phases', () => {
  let s = nextView(initialView(), { type: 'status', requestId: 'r1', state: 'building', note: 'b' });
  assert.equal(s.phase, 'building');
  s = nextView(s, { type: 'status', requestId: 'r1', state: 'live', note: 'on the wall' });
  assert.equal(s.phase, 'live');
  s = nextView(s, { type: 'status', requestId: 'r1', state: 'failed', note: 'nope' });
  assert.equal(s.phase, 'failed');
});

test('error message surfaces as error phase with note', () => {
  const s = nextView(initialView(), { type: 'error', code: 'busy', message: 'queue full' });
  assert.equal(s.phase, 'error');
  assert.match(s.note, /full/);
});
