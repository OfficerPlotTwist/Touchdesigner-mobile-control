import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createIntakeServer } from '../server/intakeServer.js';
import { RequestQueue } from '../server/queue.js';
import { DEFAULTS } from '../server/config.js';

function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const w = waiters.shift();
    if (w) { w(m); } else { inbox.push(m); }
  });
  const next = () => new Promise((res) => {
    if (inbox.length) return res(inbox.shift());
    waiters.push(res);
  });
  const open = new Promise((res) => ws.on('open', res));
  return { ws, next, open, send: (o) => ws.send(JSON.stringify(o)) };
}

test('accepts a request, enqueues it, and reports queued position', async () => {
  const queue = new RequestQueue({ bound: 20 });
  let n = 0;
  const srv = createIntakeServer({ config: DEFAULTS, port: 0, publicDir: 'effects-on-demand/public', queue, now: () => 1, makeId: () => `id${++n}` });
  const port = srv.httpServer.address().port;
  const c = connect(port);
  await c.open;
  c.send({ type: 'hello', clientId: 'c1', name: 'Al' });
  const welcome = await c.next();
  assert.equal(welcome.type, 'welcome');
  c.send({ type: 'request', text: 'add rain' });
  const accepted = await c.next();
  assert.equal(accepted.type, 'accepted');
  assert.equal(accepted.position, 1);
  assert.equal(queue.length, 1);
  c.ws.close();
  await srv.stop();
});

test('screened request is rejected, not enqueued', async () => {
  const queue = new RequestQueue({ bound: 20 });
  const srv = createIntakeServer({ config: DEFAULTS, port: 0, publicDir: 'effects-on-demand/public', queue, now: () => 1, makeId: () => 'id1' });
  const port = srv.httpServer.address().port;
  const c = connect(port);
  await c.open;
  c.send({ type: 'hello', clientId: 'c1', name: 'Al' });
  await c.next();
  c.send({ type: 'request', text: 'fuck this' });
  const err = await c.next();
  assert.equal(err.type, 'error');
  assert.equal(err.code, 'rejected');
  assert.equal(queue.length, 0);
  c.ws.close();
  await srv.stop();
});

test('pushStatus fans a status message to the originating client', async () => {
  const queue = new RequestQueue({ bound: 20 });
  const srv = createIntakeServer({ config: DEFAULTS, port: 0, publicDir: 'effects-on-demand/public', queue, now: () => 1, makeId: () => 'rid1' });
  const port = srv.httpServer.address().port;
  const c = connect(port);
  await c.open;
  c.send({ type: 'hello', clientId: 'c1', name: 'Al' });
  await c.next();
  c.send({ type: 'request', text: 'add rain' });
  await c.next(); // accepted
  srv.pushStatus('rid1', 'live', 'on the wall');
  const status = await c.next();
  assert.equal(status.type, 'status');
  assert.equal(status.state, 'live');
  c.ws.close();
  await srv.stop();
});
