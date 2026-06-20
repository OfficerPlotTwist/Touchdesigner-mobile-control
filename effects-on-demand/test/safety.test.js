import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenRequest, sanitizeAuthor } from '../server/safety.js';

const LIM = { requestMaxLen: 280 };

test('accepts a normal effect request', () => {
  const r = screenRequest('make the flame bluer', LIM);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'make the flame bluer');
});

test('rejects empty / whitespace', () => {
  assert.equal(screenRequest('   ', LIM).ok, false);
});

test('rejects over-length', () => {
  const r = screenRequest('a'.repeat(281), LIM);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'rejected');
});

test('rejects an abusive marker', () => {
  const r = screenRequest('fuck the projection', LIM);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'rejected');
});

test('sanitizeAuthor strips control chars and caps length', () => {
  assert.equal(sanitizeAuthor('Alice\n', { nameMaxLen: 40 }), 'Alice');
  assert.equal(sanitizeAuthor('A  l', { nameMaxLen: 40 }), 'A l');
  assert.equal(sanitizeAuthor('   ', { nameMaxLen: 40 }), 'anonymous');
  assert.equal(sanitizeAuthor('x'.repeat(99), { nameMaxLen: 40 }).length, 40);
});
