import { WebSocket } from 'ws';
import { assertBridge } from './tdBridge.js';

// Minimal JSON-RPC-over-WS client for the TD-MCP WebServer DAT. The exact
// request envelope must match TD-MCP's protocol; adjust `call()` if TD-MCP
// expects a different framing (see the td-mcp skill / server README).
function rpcClient(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
  });
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message || 'mcp error'));
    else p.resolve(m.result);
  });
  return {
    ready,
    call(method, params) {
      const id = `r${++seq}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

export async function connectMcpBridge({ url }) {
  const rpc = rpcClient(url);
  await rpc.ready;

  const bridge = {
    async ping() {
      try { await rpc.call('get_errors', { path: '/' }); return true; } catch { return false; }
    },
    async execScript(code) {
      const r = await rpc.call('execute_script', { code });
      return { ok: true, stdout: r?.stdout ?? '' };
    },
    async readRegistry() {
      // Read the fx_registry Table DAT as rows; drop the header row.
      const r = await rpc.call('execute_script', {
        code: `import json\nt = op('/project1/fx_registry')\nprint(json.dumps([[c.val for c in row] for row in t.rows()][1:]))`,
        capture: true,
      });
      const rows = JSON.parse(r?.stdout || '[]');
      return rows.map(([index, compPath, title, author, createdTs]) => ({
        index: Number(index), compPath, title, author, createdTs: Number(createdTs),
      }));
    },
    async appendRegistryRow(cells) {
      await rpc.call('execute_script', { code: `op('/project1/fx_registry').appendRow(${JSON.stringify(cells)})` });
    },
    async removeRegistryByIndex(index) {
      await rpc.call('execute_script', {
        code: `t = op('/project1/fx_registry')\nfor i in range(t.numRows-1, 0, -1):\n    if t[i,0].val == '${index}': t.deleteRow(i)`,
      });
    },
    async deleteOp(path) {
      await rpc.call('execute_script', { code: `o = op('${path}')\nif o: o.destroy()` });
    },
    async getErrors(path) {
      const r = await rpc.call('get_errors', { path });
      return Array.isArray(r?.errors) ? r.errors : [];
    },
    async screenshotNonBlank(path) {
      const r = await rpc.call('take_screenshot', { path: `${path}/out` });
      // TD-MCP returns image stats or a path; treat a reported non-zero luminance as non-blank.
      return Boolean(r?.nonBlank ?? r?.meanLuminance > 0.01);
    },
    async setSwitch(index) {
      await rpc.call('set_par_value', { path: '/project1/fx_switch', par: 'index', value: index });
    },
    async getSwitch() {
      const r = await rpc.call('execute_script', { code: `print(op('/project1/fx_switch').par.index.eval())`, capture: true });
      return Number((r?.stdout || '0').trim());
    },
  };

  return assertBridge(bridge);
}
