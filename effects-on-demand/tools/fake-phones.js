import { WebSocket } from 'ws';

const port = process.env.EOD_PORT || 8090;
const n = Number(process.argv[2] || 5);
const prompts = ['add rain', 'make the flame bluer', 'add fog', 'spin the camera', 'add sparkles'];

for (let i = 0; i < n; i++) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const clientId = `fake-${i}-${Math.floor(Math.random() * 1e6)}`;
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', clientId, name: `Phone ${i}` })));
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'welcome') ws.send(JSON.stringify({ type: 'request', text: prompts[i % prompts.length] }));
    else console.log(`[phone ${i}]`, m.type, m.state || m.code || '', m.note || m.message || `pos=${m.position ?? ''}`);
  });
  ws.on('error', (e) => console.error(`[phone ${i}] error`, e.message));
}
