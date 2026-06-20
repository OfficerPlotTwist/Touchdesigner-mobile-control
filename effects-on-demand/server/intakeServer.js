import { createServer as createHttp } from 'node:http';
import { WebSocketServer } from 'ws';
import { resolve } from 'node:path';
import { parseInbound, welcome, accepted, status, errorMsg } from './protocol.js';
import { screenRequest, sanitizeAuthor } from './safety.js';
import { TokenBucket } from './ratelimit.js';
import { serveStatic } from './static.js';

export function createIntakeServer({ config, port, publicDir, queue, now, makeId }) {
  const rootDir = resolve(process.cwd(), publicDir);
  const httpServer = createHttp((req, res) => {
    if (serveStatic(rootDir, req, res)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  const wss = new WebSocketServer({ noServer: true });
  // clientId -> { ws, bucket, inFlight, name }
  const clients = new Map();
  // requestId -> clientId (so pushStatus can find the phone)
  const owners = new Map();

  httpServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  const send = (ws, obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const r = parseInbound(data.toString(), config);
      if (!r.ok) { send(ws, errorMsg('badmsg', r.error)); return; }
      handle(ws, r.msg);
    });
    ws.on('close', () => {
      for (const [cid, c] of clients) if (c.ws === ws) clients.delete(cid);
    });
  });

  function handle(ws, msg) {
    switch (msg.type) {
      case 'hello': {
        const name = sanitizeAuthor(msg.name, config);
        clients.set(msg.clientId, {
          ws, name,
          bucket: new TokenBucket(1, 1000 / config.cooldownMs), // 1 burst, refill 1 per cooldown
          inFlight: 0,
        });
        ws._clientId = msg.clientId;
        send(ws, welcome({ clientId: msg.clientId, queueLen: queue.length }));
        break;
      }
      case 'request': {
        const cid = ws._clientId;
        const c = cid && clients.get(cid);
        if (!c) { send(ws, errorMsg('badmsg', 'say hello first')); break; }
        if (c.inFlight >= 1) { send(ws, errorMsg('rate', 'one request at a time')); break; }
        if (!c.bucket.take(now())) { send(ws, errorMsg('rate', 'please wait a moment')); break; }
        const screen = screenRequest(msg.text, config);
        if (!screen.ok) { send(ws, errorMsg(screen.code, screen.reason)); break; }
        const requestId = makeId();
        const job = { requestId, clientId: cid, name: c.name, text: screen.text, ts: now() };
        const en = queue.enqueue(job);
        if (!en.ok) { send(ws, errorMsg(en.code, 'queue full — try again shortly')); break; }
        c.inFlight += 1;
        owners.set(requestId, cid);
        send(ws, accepted({ requestId, position: en.position }));
        break;
      }
      case 'ping': break;
    }
  }

  // Called by the worker's onStatus. Frees the client's in-flight slot on terminal states.
  function pushStatus(requestId, state, note) {
    const cid = owners.get(requestId);
    if (!cid) return;
    const c = clients.get(cid);
    if (c) send(c.ws, status({ requestId, state, note }));
    if (state === 'live' || state === 'failed') {
      if (c) c.inFlight = Math.max(0, c.inFlight - 1);
      owners.delete(requestId);
    }
  }

  httpServer.listen(port);

  return {
    httpServer, wss, pushStatus,
    stop() {
      for (const c of clients.values()) c.ws.terminate();
      return new Promise((res) => wss.close(() => httpServer.close(() => res())));
    },
  };
}
