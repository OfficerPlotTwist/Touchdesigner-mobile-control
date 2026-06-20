import { initialView, nextView, statusNote } from './ui-logic.js';

const $ = (id) => document.getElementById(id);
const clientId = localStorage.getItem('eod-clientId') || (() => {
  const id = crypto.randomUUID(); localStorage.setItem('eod-clientId', id); return id;
})();
$('name').value = localStorage.getItem('eod-name') || '';

let view = initialView();
const render = () => { $('status').textContent = statusNote(view); };

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'hello', clientId, name: $('name').value || 'anonymous' }));
});
ws.addEventListener('message', (e) => {
  view = nextView(view, JSON.parse(e.data));
  render();
  if (view.phase === 'live' || view.phase === 'failed' || view.phase === 'error') $('send').disabled = false;
});

$('send').addEventListener('click', () => {
  const text = $('text').value.trim();
  if (!text || ws.readyState !== WebSocket.OPEN) return;
  localStorage.setItem('eod-name', $('name').value || '');
  ws.send(JSON.stringify({ type: 'request', text }));
  $('send').disabled = true;
  view = { ...view, phase: 'submitting' };
  render();
});
