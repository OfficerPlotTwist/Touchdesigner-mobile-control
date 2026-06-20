export const STATES = new Set(['queued', 'building', 'live', 'failed']);

const isStr = (s) => typeof s === 'string';
const clean = (s, max) => s.replace(/\s+/g, ' ').trim().slice(0, max);

export function parseInbound(raw, { requestMaxLen, nameMaxLen }) {
  let m;
  try { m = JSON.parse(raw); } catch { return { ok: false, error: 'malformed json' }; }
  if (!m || typeof m !== 'object') return { ok: false, error: 'not an object' };

  switch (m.type) {
    case 'hello': {
      if (!isStr(m.clientId) || !m.clientId) return { ok: false, error: 'hello.clientId required' };
      const name = isStr(m.name) && clean(m.name, nameMaxLen) ? clean(m.name, nameMaxLen) : 'anonymous';
      return { ok: true, msg: { type: 'hello', clientId: m.clientId.slice(0, 64), name } };
    }
    case 'request': {
      if (!isStr(m.text)) return { ok: false, error: 'request.text required' };
      const text = clean(m.text, requestMaxLen);
      if (!text) return { ok: false, error: 'request.text empty' };
      return { ok: true, msg: { type: 'request', text } };
    }
    case 'ping':
      return { ok: true, msg: { type: 'ping' } };
    default:
      return { ok: false, error: `unknown type: ${m.type}` };
  }
}

export const welcome = ({ clientId, queueLen }) => ({ type: 'welcome', clientId, queueLen });
export const accepted = ({ requestId, position }) => ({ type: 'accepted', requestId, position });
export const status = ({ requestId, state, note }) => {
  if (!STATES.has(state)) throw new Error(`invalid status state: ${state}`);
  return { type: 'status', requestId, state, note };
};
export const errorMsg = (code, message) => ({ type: 'error', code, message });
