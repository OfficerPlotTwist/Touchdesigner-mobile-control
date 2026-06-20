import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInbound, welcome, accepted, status, errorMsg, STATES } from '../server/protocol.js';

const LIMITS = { requestMaxLen: 280, nameMaxLen: 40 };

test('parses hello with clientId + name, truncating name', () => {
  const r = parseInbound(JSON.stringify({ type: 'hello', clientId: 'c1', name: 'x'.repeat(100) }), LIMITS);
  assert.equal(r.ok, true);
  assert.equal(r.msg.clientId, 'c1');
  assert.equal(r.msg.name.length, 40);
});

test('hello with no name defaults to anonymous', () => {
  const r = parseInbound(JSON.stringify({ type: 'hello', clientId: 'c1' }), LIMITS);
  assert.equal(r.ok, true);
  assert.equal(r.msg.name, 'anonymous');
});

test('parses request and truncates text to requestMaxLen', () => {
  const r = parseInbound(JSON.stringify({ type: 'request', text: 'a'.repeat(500) }), LIMITS);
  assert.equal(r.ok, true);
  assert.equal(r.msg.text.length, 280);
});

test('rejects request with empty text', () => {
  const r = parseInbound(JSON.stringify({ type: 'request', text: '   ' }), LIMITS);
  assert.equal(r.ok, false);
});

test('rejects malformed json and unknown type', () => {
  assert.equal(parseInbound('{bad', LIMITS).ok, false);
  assert.equal(parseInbound(JSON.stringify({ type: 'nope' }), LIMITS).ok, false);
});

test('status builder rejects unknown state at build time', () => {
  assert.throws(() => status({ requestId: 'r1', state: 'bogus', note: '' }));
});

test('outbound builders have stable shape', () => {
  assert.equal(welcome({ clientId: 'c1', queueLen: 3 }).type, 'welcome');
  assert.equal(accepted({ requestId: 'r1', position: 2 }).position, 2);
  assert.equal(status({ requestId: 'r1', state: 'live', note: 'on the wall' }).state, 'live');
  assert.equal(errorMsg('busy', 'try later').code, 'busy');
  assert.ok(STATES.has('building'));
});
