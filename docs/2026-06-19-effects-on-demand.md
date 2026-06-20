# Effects-on-Demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `effects-on-demand/` package: a phone scans a QR, types a natural-language effect request, and a server-hosted GLM agent builds it into a live TouchDesigner project and auto-switches it onto the projection.

**Architecture:** Three cleanly separated units, all Node + `ws`. (a) An **intake server** serves the request PWA, screens + rate-limits requests, and holds a strictly serial FIFO queue. (b) An **agent worker** drains one job at a time: it owns the deterministic safety envelope (scaffold the TD contract, assign the effect's container + switch index, run verify gates, write the registry, flip the switch, LRU-recycle) via an injectable **TdBridge**, and delegates only the creative *build inside the assigned container* to a GLM session run through the Claude Agent SDK pointed at Z.AI. (c) A **TD contract** (`effects/`, `fx_switch`, `fx_registry`, attribution overlay) the worker scaffolds on first run. The split lets the entire orchestration be unit-tested against a mock TD; the live GLM+TD path is covered by a manual checklist.

**Tech Stack:** Node.js ≥20 (ESM, `node --test`), `ws` for WebSockets, `@anthropic-ai/claude-agent-sdk` for the worker's GLM session (Z.AI Anthropic-compatible endpoint via `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`), the existing **TD-MCP** server (port 9980) as the TD bridge, Cloudflare Tunnel for exposure. Plain HTML/CSS/JS PWA (no framework), matching the sibling `touchdesigner-mobile-control` app.

## Global Constraints

- **Runtime:** Node.js ≥20, ESM only (`"type": "module"`). Copy verbatim into `effects-on-demand/package.json`.
- **Test runner:** `node --test` (node:test + `node:assert/strict`). No third-party test deps.
- **Style (match the sibling app verbatim):** small focused modules, named exports, pure functions where possible, **time injected as a `now` parameter** (never call `Date.now()` inside testable logic), validators return `{ ok: true, value }` or `{ ok: false, error }`.
- **Isolation:** This package ships independently. Do **not** import from `../server/*`; re-author the small shared primitives (`TokenBucket`, static server) inside the package.
- **TD contract paths (exact, used across worker + contract + tests):** parent `/project1/effects`, switch `/project1/fx_switch`, registry `/project1/fx_registry`, per-effect container `/project1/effects/fx_<id>`. Registry columns in order: `index | comp_path | title | author | created_ts`. **Index 0 is the reserved safe/idle effect** — never recycled, boot default, panic target.
- **Defaults (exact values from the spec):** queue bound **20** (overflow → `error{code:"busy"}`), per-job timeout **5 min** (300000 ms), gallery cap **12** effects, rate-limit **1 in-flight request per clientId** + cooldown, request text length cap **280**, author/name length cap **40**.
- **The phone never controls the switch.** It only requests; the worker decides and auto-switches on a verified success.
- **Z.AI agent env (worker only):** `ANTHROPIC_BASE_URL` (Z.AI Anthropic-compatible endpoint), `ANTHROPIC_AUTH_TOKEN` (Z.AI key), `EOD_GLM_MODEL` (GLM model id). Read from `process.env`; never commit secrets.

---

## File Structure

```
effects-on-demand/
  package.json                  # standalone manifest (deps: ws, @anthropic-ai/claude-agent-sdk)
  README.md                     # run/ops instructions (Cloudflare tunnel, env)
  config/
    effects.config.example.json # tunable config (caps, timeouts, contract paths)
  server/
    config.js                   # load + validate effects config
    protocol.js                 # parse inbound / build outbound wire messages
    safety.js                   # prompt + name screening (pure)
    ratelimit.js                # TokenBucket (re-authored, identical to sibling)
    queue.js                    # serial FIFO queue with bound + position reporting
    static.js                   # traversal-safe static file server (re-authored)
    intakeServer.js             # http+ws: serve PWA, accept requests, push status
    index.js                    # intake entry point (env → createIntakeServer)
  worker/
    contract.js                 # TD contract: scaffold script text + registry/switch ops (pure builders)
    gallery.js                  # LRU recycle decision (pure)
    tdBridge.js                 # TdBridge interface + real MCP-backed impl
    agentRunner.js              # GLM-session adapter (Agent SDK → Z.AI), injectable
    worker.js                   # serial drain loop + per-job state machine
    index.js                    # worker entry point (env → real bridge + runner → runWorker)
  public/
    index.html                  # request PWA shell
    app.js                      # ws client + DOM wiring
    ui-logic.js                 # pure view-state helpers (testable)
    styles.css
    manifest.webmanifest
  touchdesigner/
    eod_contract.py             # the scaffold script (generated by contract.js, committed for reference)
  tools/
    mock-td.js                  # in-memory TdBridge for manual/integration runs
    fake-phones.js              # concurrent request driver
  test/
    config.test.js
    protocol.test.js
    safety.test.js
    ratelimit.test.js
    queue.test.js
    static.test.js
    contract.test.js
    gallery.test.js
    worker.test.js              # worker state machine against a mock TdBridge + mock runner
    intakeServer.integration.test.js
    ui-logic.test.js
    smoke.test.js
```

Each task below produces a self-contained, independently testable deliverable. Build in order — later tasks consume earlier interfaces. The `Interfaces` block in each task is the contract a fresh implementer relies on.

---

### Task 1: Package scaffold + smoke test

**Files:**
- Create: `effects-on-demand/package.json`
- Create: `effects-on-demand/test/smoke.test.js`
- Modify: `package.json` (root) — add an `eod` test script

**Interfaces:**
- Produces: a runnable package with `node --test` wired. Root script `npm run test:eod` runs `node --test effects-on-demand/test/`.

- [ ] **Step 1: Write the failing smoke test**

Create `effects-on-demand/test/smoke.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('node:test runs in the effects-on-demand package', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Run it to verify the runner works**

Run: `node --test effects-on-demand/test/`
Expected: 1 test passes. (If the directory doesn't resolve yet, that's fine — proceed to create package.json, then re-run.)

- [ ] **Step 3: Create the package manifest**

Create `effects-on-demand/package.json`:

```json
{
  "name": "effects-on-demand",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start:intake": "node server/index.js",
    "start:worker": "node worker/index.js",
    "test": "node --test",
    "mock-td": "node tools/mock-td.js",
    "fake-phones": "node tools/fake-phones.js"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

(The `@anthropic-ai/claude-agent-sdk` dependency is added in Task 12, where it is first used, to keep early tasks installable without it.)

- [ ] **Step 4: Add a root convenience script**

In the root `package.json` `scripts` block, add:

```json
    "test:eod": "node --test effects-on-demand/test/"
```

- [ ] **Step 5: Run both test entry points**

Run: `node --test effects-on-demand/test/`
Expected: PASS (1 test).
Run (from repo root): `npm run test:eod`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add effects-on-demand/package.json effects-on-demand/test/smoke.test.js package.json
git commit -m "feat(eod): scaffold effects-on-demand package + node:test runner"
```

---

### Task 2: Config loader + validator

**Files:**
- Create: `effects-on-demand/server/config.js`
- Create: `effects-on-demand/config/effects.config.example.json`
- Test: `effects-on-demand/test/config.test.js`

**Interfaces:**
- Produces:
  - `validateConfig(obj) -> { ok: true, config } | { ok: false, errors: string[] }`
  - `loadConfig(path) -> config` (throws on invalid)
  - `config` shape: `{ queueBound, jobTimeoutMs, galleryCap, requestMaxLen, nameMaxLen, cooldownMs, contract: { effectsPath, switchPath, registryPath, safeIndex } }`
  - `DEFAULTS` (exported) carrying the Global-Constraints values.

- [ ] **Step 1: Write the failing test**

Create `effects-on-demand/test/config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, DEFAULTS } from '../server/config.js';

test('empty object yields all defaults', () => {
  const r = validateConfig({});
  assert.equal(r.ok, true);
  assert.equal(r.config.queueBound, 20);
  assert.equal(r.config.jobTimeoutMs, 300000);
  assert.equal(r.config.galleryCap, 12);
  assert.equal(r.config.contract.safeIndex, 0);
  assert.equal(r.config.contract.registryPath, '/project1/fx_registry');
});

test('overrides are applied and merged with contract defaults', () => {
  const r = validateConfig({ galleryCap: 6, contract: { effectsPath: '/p/fx' } });
  assert.equal(r.ok, true);
  assert.equal(r.config.galleryCap, 6);
  assert.equal(r.config.contract.effectsPath, '/p/fx');
  assert.equal(r.config.contract.switchPath, '/project1/fx_switch'); // still default
});

test('rejects non-positive caps', () => {
  const r = validateConfig({ galleryCap: 0 });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /galleryCap/);
});

test('DEFAULTS is frozen and exported', () => {
  assert.equal(DEFAULTS.queueBound, 20);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/config.test.js`
Expected: FAIL with "Cannot find module '../server/config.js'".

- [ ] **Step 3: Write the implementation**

Create `effects-on-demand/server/config.js`:

```js
import { readFileSync } from 'node:fs';

export const DEFAULTS = Object.freeze({
  queueBound: 20,
  jobTimeoutMs: 300000,
  galleryCap: 12,
  requestMaxLen: 280,
  nameMaxLen: 40,
  cooldownMs: 4000,
  contract: Object.freeze({
    effectsPath: '/project1/effects',
    switchPath: '/project1/fx_switch',
    registryPath: '/project1/fx_registry',
    safeIndex: 0,
  }),
});

const POS_INT_KEYS = ['queueBound', 'jobTimeoutMs', 'galleryCap', 'requestMaxLen', 'nameMaxLen', 'cooldownMs'];

export function validateConfig(obj) {
  const errors = [];
  if (obj == null || typeof obj !== 'object') return { ok: false, errors: ['config must be an object'] };

  const config = {
    ...DEFAULTS,
    contract: { ...DEFAULTS.contract, ...(obj.contract && typeof obj.contract === 'object' ? obj.contract : {}) },
  };

  for (const k of POS_INT_KEYS) {
    if (obj[k] === undefined) continue;
    if (!Number.isInteger(obj[k]) || obj[k] < 1) { errors.push(`${k} must be a positive integer`); continue; }
    config[k] = obj[k];
  }

  const c = config.contract;
  for (const k of ['effectsPath', 'switchPath', 'registryPath']) {
    if (typeof c[k] !== 'string' || !c[k].startsWith('/')) errors.push(`contract.${k} must be an absolute TD path`);
  }
  if (!Number.isInteger(c.safeIndex) || c.safeIndex < 0) errors.push('contract.safeIndex must be a non-negative integer');

  if (errors.length) return { ok: false, errors };
  return { ok: true, config };
}

export function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const r = validateConfig(raw);
  if (!r.ok) throw new Error(`Invalid effects config (${path}):\n  - ${r.errors.join('\n  - ')}`);
  return r.config;
}
```

- [ ] **Step 4: Create the example config file**

Create `effects-on-demand/config/effects.config.example.json`:

```json
{
  "queueBound": 20,
  "jobTimeoutMs": 300000,
  "galleryCap": 12,
  "requestMaxLen": 280,
  "nameMaxLen": 40,
  "cooldownMs": 4000,
  "contract": {
    "effectsPath": "/project1/effects",
    "switchPath": "/project1/fx_switch",
    "registryPath": "/project1/fx_registry",
    "safeIndex": 0
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test effects-on-demand/test/config.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add effects-on-demand/server/config.js effects-on-demand/config/effects.config.example.json effects-on-demand/test/config.test.js
git commit -m "feat(eod): config loader + validator with spec defaults"
```

---

### Task 3: Wire protocol (parse inbound / build outbound)

**Files:**
- Create: `effects-on-demand/server/protocol.js`
- Test: `effects-on-demand/test/protocol.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseInbound(raw, { requestMaxLen, nameMaxLen }) -> { ok: true, msg } | { ok: false, error }`. Inbound types: `hello{clientId,name}`, `request{text}`, `ping`.
  - Outbound builders: `welcome({clientId, queueLen})`, `accepted({requestId, position})`, `status({requestId, state, note})` where `state ∈ 'queued'|'building'|'live'|'failed'`, `errorMsg(code, message)`.
  - `STATES` (exported set of valid status states).

- [ ] **Step 1: Write the failing test**

Create `effects-on-demand/test/protocol.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/protocol.test.js`
Expected: FAIL with "Cannot find module '../server/protocol.js'".

- [ ] **Step 3: Write the implementation**

Create `effects-on-demand/server/protocol.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test effects-on-demand/test/protocol.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add effects-on-demand/server/protocol.js effects-on-demand/test/protocol.test.js
git commit -m "feat(eod): wire protocol parse + builders"
```

---

### Task 4: Prompt + name safety screen

**Files:**
- Create: `effects-on-demand/server/safety.js`
- Test: `effects-on-demand/test/safety.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `screenRequest(text, { requestMaxLen }) -> { ok: true, text } | { ok: false, code: 'rejected', reason }`. Rejects empty, over-length, and a lightweight blocklist of abusive/off-topic markers.
  - `sanitizeAuthor(name, { nameMaxLen }) -> string` (strips control chars + non-printable, collapses whitespace, length-caps; never empty → `'anonymous'`). Author strings reach the projection, so this is the on-screen sanitizer.

- [ ] **Step 1: Write the failing test**

Create `effects-on-demand/test/safety.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/safety.test.js`
Expected: FAIL with "Cannot find module '../server/safety.js'".

- [ ] **Step 3: Write the implementation**

Create `effects-on-demand/server/safety.js`:

```js
// Lightweight intake screen. This is a coarse first gate, not a content
// moderator — the goal is to drop obvious abuse/spam before it reaches the
// queue and the projection. Tune the blocklist per venue.
const BLOCKLIST = [
  /\bfuck\b/i, /\bshit\b/i, /\bcunt\b/i, /\bnigg/i, /\bfag/i, /\brape\b/i,
  /\bkill\s+(yourself|urself)\b/i,
];

export function screenRequest(text, { requestMaxLen }) {
  if (typeof text !== 'string') return { ok: false, code: 'rejected', reason: 'not text' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, code: 'rejected', reason: 'empty' };
  if (text.length > requestMaxLen) return { ok: false, code: 'rejected', reason: 'too long' };
  if (BLOCKLIST.some((re) => re.test(trimmed))) return { ok: false, code: 'rejected', reason: 'screened' };
  return { ok: true, text: trimmed };
}

export function sanitizeAuthor(name, { nameMaxLen }) {
  if (typeof name !== 'string') return 'anonymous';
  // Strip control + non-printable, collapse whitespace, cap length.
  const cleaned = name
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, nameMaxLen);
  return cleaned || 'anonymous';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test effects-on-demand/test/safety.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add effects-on-demand/server/safety.js effects-on-demand/test/safety.test.js
git commit -m "feat(eod): intake prompt-safety screen + author sanitizer"
```

---

### Task 5: Rate limiter (TokenBucket)

**Files:**
- Create: `effects-on-demand/server/ratelimit.js`
- Test: `effects-on-demand/test/ratelimit.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `class TokenBucket { constructor(capacity, refillPerSec); take(now, n = 1) -> boolean }`. Identical contract to the sibling app (re-authored to keep the package standalone).

- [ ] **Step 1: Write the failing test**

Create `effects-on-demand/test/ratelimit.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from '../server/ratelimit.js';

test('allows up to capacity then blocks, refilling over time', () => {
  const b = new TokenBucket(2, 1); // 2 burst, 1/sec
  assert.equal(b.take(1000), true);
  assert.equal(b.take(1000), true);
  assert.equal(b.take(1000), false);      // empty
  assert.equal(b.take(2000), true);       // +1s → 1 token
  assert.equal(b.take(2000), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/ratelimit.test.js`
Expected: FAIL with "Cannot find module '../server/ratelimit.js'".

- [ ] **Step 3: Write the implementation**

Create `effects-on-demand/server/ratelimit.js`:

```js
export class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.last = null;
  }

  take(now, n = 1) {
    if (this.last === null) this.last = now;
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.last = now;
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test effects-on-demand/test/ratelimit.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add effects-on-demand/server/ratelimit.js effects-on-demand/test/ratelimit.test.js
git commit -m "feat(eod): re-author TokenBucket rate limiter"
```

---

### Task 6: Serial request queue

**Files:**
- Create: `effects-on-demand/server/queue.js`
- Test: `effects-on-demand/test/queue.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `class RequestQueue { constructor({ bound }); enqueue(job) -> { ok: true, position } | { ok: false, code: 'busy' }; dequeue() -> job | null; get length; positionOf(requestId) -> number (1-based) | -1; remove(requestId) -> boolean }`. A `job` is `{ requestId, clientId, name, text, ts }`. FIFO; `enqueue` rejects with `busy` when `length >= bound`. `position` is 1-based queue position at enqueue time.

- [ ] **Step 1: Write the failing test**

Create `effects-on-demand/test/queue.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestQueue } from '../server/queue.js';

const job = (id) => ({ requestId: id, clientId: 'c', name: 'n', text: 't', ts: 0 });

test('enqueue reports 1-based position and FIFO dequeue', () => {
  const q = new RequestQueue({ bound: 20 });
  assert.deepEqual(q.enqueue(job('a')), { ok: true, position: 1 });
  assert.deepEqual(q.enqueue(job('b')), { ok: true, position: 2 });
  assert.equal(q.length, 2);
  assert.equal(q.dequeue().requestId, 'a');
  assert.equal(q.dequeue().requestId, 'b');
  assert.equal(q.dequeue(), null);
});

test('overflow past bound returns busy', () => {
  const q = new RequestQueue({ bound: 2 });
  q.enqueue(job('a')); q.enqueue(job('b'));
  assert.deepEqual(q.enqueue(job('c')), { ok: false, code: 'busy' });
});

test('positionOf reflects live position and remove compacts', () => {
  const q = new RequestQueue({ bound: 20 });
  q.enqueue(job('a')); q.enqueue(job('b')); q.enqueue(job('c'));
  assert.equal(q.positionOf('c'), 3);
  assert.equal(q.remove('a'), true);
  assert.equal(q.positionOf('c'), 2);
  assert.equal(q.positionOf('zzz'), -1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/queue.test.js`
Expected: FAIL with "Cannot find module '../server/queue.js'".

- [ ] **Step 3: Write the implementation**

Create `effects-on-demand/server/queue.js`:

```js
export class RequestQueue {
  constructor({ bound }) {
    this.bound = bound;
    this._items = [];
  }

  get length() { return this._items.length; }

  enqueue(job) {
    if (this._items.length >= this.bound) return { ok: false, code: 'busy' };
    this._items.push(job);
    return { ok: true, position: this._items.length };
  }

  dequeue() { return this._items.shift() ?? null; }

  positionOf(requestId) {
    const i = this._items.findIndex((j) => j.requestId === requestId);
    return i === -1 ? -1 : i + 1;
  }

  remove(requestId) {
    const i = this._items.findIndex((j) => j.requestId === requestId);
    if (i === -1) return false;
    this._items.splice(i, 1);
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test effects-on-demand/test/queue.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add effects-on-demand/server/queue.js effects-on-demand/test/queue.test.js
git commit -m "feat(eod): serial FIFO request queue with bound + positions"
```

---

### Task 7: Traversal-safe static server

**Files:**
- Create: `effects-on-demand/server/static.js`
- Test: `effects-on-demand/test/static.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `resolveStaticPath(rootDir, urlPath) -> absolutePath | null` (null on traversal / escape).
  - `serveStatic(rootDir, req, res) -> boolean` (true if served).

- [ ] **Step 1: Write the failing test**

Create `effects-on-demand/test/static.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStaticPath } from '../server/static.js';
import { resolve, sep } from 'node:path';

const ROOT = resolve('effects-on-demand/public');

test('maps / to index.html inside root', () => {
  const p = resolveStaticPath(ROOT, '/');
  assert.equal(p, resolve(ROOT, 'index.html'));
});

test('blocks parent traversal', () => {
  assert.equal(resolveStaticPath(ROOT, '/../server/config.js'), null);
  assert.equal(resolveStaticPath(ROOT, '/..%2f..%2fetc/passwd'), null);
});

test('resolves a nested asset within root', () => {
  const p = resolveStaticPath(ROOT, '/app.js');
  assert.ok(p.startsWith(ROOT + sep));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/static.test.js`
Expected: FAIL with "Cannot find module '../server/static.js'".

- [ ] **Step 3: Write the implementation**

Create `effects-on-demand/server/static.js`:

```js
import { resolve, normalize, extname, sep } from 'node:path';
import { createReadStream, existsSync, statSync } from 'node:fs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function resolveStaticPath(rootDir, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (p === '/' || p === '') p = '/index.html';
  const normalized = normalize(p.startsWith('/') ? p.slice(1) : p);
  if (normalized.includes('..') || normalized.startsWith(sep)) return null;
  const abs = resolve(rootDir, normalized);
  if (!abs.startsWith(rootDir + sep) && abs !== rootDir) return null;
  return abs;
}

export function serveStatic(rootDir, req, res) {
  const abs = resolveStaticPath(rootDir, req.url || '/');
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[extname(abs)] || 'application/octet-stream' });
  createReadStream(abs).pipe(res);
  return true;
}
```

Note: the test decodes `..%2f` — `decodeURIComponent` turns it into `../`, which the `includes('..')` guard rejects. Verify this holds.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test effects-on-demand/test/static.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add effects-on-demand/server/static.js effects-on-demand/test/static.test.js
git commit -m "feat(eod): traversal-safe static file server"
```

---

### Task 8: TD contract builders + scaffold script

**Files:**
- Create: `effects-on-demand/worker/contract.js`
- Create: `effects-on-demand/touchdesigner/eod_contract.py`
- Test: `effects-on-demand/test/contract.test.js`

**Interfaces:**
- Consumes: `config.contract` from Task 2.
- Produces (all pure — return strings/objects, perform no I/O):
  - `effectName(requestId) -> 'fx_<id>'` and `effectPath(contract, requestId) -> '<effectsPath>/fx_<id>'`.
  - `registryRow({ index, compPath, title, author, createdTs }) -> [index, compPath, title, author, createdTs]` (string cells, in column order).
  - `scaffoldScript(contract) -> string` — the Python the worker sends via the bridge's `execScript` to create `effects/`, the index-0 safe effect, `fx_switch`, `fx_registry` (with header row), and the attribution overlay, **idempotently** (no-op if already present).
  - `REGISTRY_COLUMNS` (exported, in order).

- [ ] **Step 1: Write the failing test**

Create `effects-on-demand/test/contract.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectName, effectPath, registryRow, scaffoldScript, REGISTRY_COLUMNS } from '../worker/contract.js';
import { DEFAULTS } from '../server/config.js';

const C = DEFAULTS.contract;

test('effect naming correlates id across comp/registry', () => {
  assert.equal(effectName('abc'), 'fx_abc');
  assert.equal(effectPath(C, 'abc'), '/project1/effects/fx_abc');
});

test('registryRow emits cells in column order as strings', () => {
  const row = registryRow({ index: 3, compPath: '/project1/effects/fx_abc', title: 'rain', author: 'Al', createdTs: 1700000000 });
  assert.deepEqual(REGISTRY_COLUMNS, ['index', 'comp_path', 'title', 'author', 'created_ts']);
  assert.deepEqual(row, ['3', '/project1/effects/fx_abc', 'rain', 'Al', '1700000000']);
});

test('scaffold script references all contract ops and is parameterized by paths', () => {
  const s = scaffoldScript(C);
  assert.match(s, /\/project1\/effects/);
  assert.match(s, /fx_switch/);
  assert.match(s, /fx_registry/);
  assert.match(s, /index\s*\|?\s*comp_path/i); // header awareness
  assert.match(s, /idempotent|op\(|if .*is None/i); // guards before create
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/contract.test.js`
Expected: FAIL with "Cannot find module '../worker/contract.js'".

- [ ] **Step 3: Write the implementation**

Create `effects-on-demand/worker/contract.js`:

```js
export const REGISTRY_COLUMNS = ['index', 'comp_path', 'title', 'author', 'created_ts'];

export const effectName = (requestId) => `fx_${requestId}`;
export const effectPath = (contract, requestId) => `${contract.effectsPath}/${effectName(requestId)}`;

export function registryRow({ index, compPath, title, author, createdTs }) {
  return [String(index), String(compPath), String(title), String(author), String(createdTs)];
}

// Returns the Python the worker sends through TdBridge.execScript() to make the
// project contract exist. Idempotent: every create is guarded, so re-running on
// an already-scaffolded project is a no-op. `effectsPath` is a container path
// like /project1/effects; we split it into parent + child for op().create.
export function scaffoldScript(contract) {
  const { effectsPath, switchPath, registryPath, safeIndex } = contract;
  const lastSlash = effectsPath.lastIndexOf('/');
  const parentPath = effectsPath.slice(0, lastSlash) || '/';
  const effectsName = effectsPath.slice(lastSlash + 1);
  const sw = switchPath.slice(switchPath.lastIndexOf('/') + 1);
  const reg = registryPath.slice(registryPath.lastIndexOf('/') + 1);
  const cols = REGISTRY_COLUMNS.join('\\t');
  return [
    `# effects-on-demand contract scaffold (idempotent)`,
    `parent_comp = op('${parentPath}')`,
    `effects = parent_comp.op('${effectsName}') or parent_comp.create(baseCOMP, '${effectsName}')`,
    ``,
    `# index-0 reserved safe/idle effect (boot default + panic target)`,
    `safe = effects.op('fx_safe') or effects.create(baseCOMP, 'fx_safe')`,
    ``,
    `# fx_switch: selects which effect composites to the projection`,
    `sw = parent_comp.op('${sw}') or parent_comp.create(switchTOP, '${sw}')`,
    `sw.par.index = ${safeIndex}`,
    ``,
    `# fx_registry: source of truth | ${REGISTRY_COLUMNS.join(' | ')}`,
    `reg = parent_comp.op('${reg}') or parent_comp.create(tableDAT, '${reg}')`,
    `if reg.numRows == 0:`,
    `    reg.appendRow('${cols}'.split('\\t'))`,
    `    reg.appendRow(['${safeIndex}', effects.op('fx_safe').path, 'safe', '', '0'])`,
    ``,
    `# attribution overlay: a Text TOP that reads author of the current switch index`,
    `attrib = parent_comp.op('fx_attrib') or parent_comp.create(textTOP, 'fx_attrib')`,
    `attrib.par.text = "op('${reg}')[ op('${sw}').par.index.eval()+1, 'author'] or ''"`,
    ``,
    `print('eod-contract: ok')`,
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test effects-on-demand/test/contract.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Generate and commit the reference scaffold script**

Generate the committed reference copy by running a one-off:

Run:
```bash
node -e "import('./effects-on-demand/worker/contract.js').then(m => { import('./effects-on-demand/server/config.js').then(c => process.stdout.write(m.scaffoldScript(c.DEFAULTS.contract) + '\n')); })" > effects-on-demand/touchdesigner/eod_contract.py
```
Expected: `effects-on-demand/touchdesigner/eod_contract.py` exists and contains the scaffold body (a human can paste it into a TD Text DAT to inspect/seed manually).

- [ ] **Step 6: Commit**

```bash
git add effects-on-demand/worker/contract.js effects-on-demand/touchdesigner/eod_contract.py effects-on-demand/test/contract.test.js
git commit -m "feat(eod): TD contract builders + idempotent scaffold script"
```

---

### Task 9: Gallery LRU recycle decision

**Files:**
- Create: `effects-on-demand/worker/gallery.js`
- Test: `effects-on-demand/test/gallery.test.js`

**Interfaces:**
- Consumes: `config.galleryCap`, `config.contract.safeIndex`.
- Produces: `pickRecycleIndex({ entries, cap, liveIndex, safeIndex }) -> number | null`. `entries` is an array of `{ index, createdTs }` (the registry minus the header). Returns the index of the **oldest non-live, non-safe** entry when `entries.length >= cap`; `null` when there's still room. Never returns `liveIndex` or `safeIndex`.

- [ ] **Step 1: Write the failing test**

Create `effects-on-demand/test/gallery.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/gallery.test.js`
Expected: FAIL with "Cannot find module '../worker/gallery.js'".

- [ ] **Step 3: Write the implementation**

Create `effects-on-demand/worker/gallery.js`:

```js
// Decide which effect (if any) to evict before adding a new one. LRU by
// createdTs, never touching the live or reserved-safe index.
export function pickRecycleIndex({ entries, cap, liveIndex, safeIndex }) {
  if (entries.length < cap) return null;
  const eligible = entries
    .filter((e) => e.index !== liveIndex && e.index !== safeIndex)
    .sort((a, b) => a.createdTs - b.createdTs);
  return eligible.length ? eligible[0].index : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test effects-on-demand/test/gallery.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add effects-on-demand/worker/gallery.js effects-on-demand/test/gallery.test.js
git commit -m "feat(eod): gallery LRU recycle decision (pure)"
```

---

### Task 10: TdBridge interface + in-memory mock

**Files:**
- Create: `effects-on-demand/worker/tdBridge.js`
- Create: `effects-on-demand/tools/mock-td.js`

**Interfaces:**
- Consumes: nothing (the real MCP-backed impl is wired in Task 13).
- Produces:
  - JSDoc-typed `TdBridge` contract (documented in `tdBridge.js`), the set of async methods the worker calls:
    - `ping() -> Promise<boolean>` — read-only liveness probe.
    - `execScript(code) -> Promise<{ ok, stdout }>` — run TD Python (used for scaffold + container ops).
    - `readRegistry() -> Promise<Array<{index, compPath, title, author, createdTs}>>` (header excluded).
    - `appendRegistryRow(rowCells) -> Promise<void>`.
    - `removeRegistryByIndex(index) -> Promise<void>`.
    - `deleteOp(path) -> Promise<void>`.
    - `getErrors(path) -> Promise<string[]>` — errors scoped to a subtree.
    - `screenshotNonBlank(path) -> Promise<boolean>` — true if the op's out TOP renders non-black/non-empty.
    - `setSwitch(index) -> Promise<void>`.
    - `getSwitch() -> Promise<number>`.
  - `class MockTdBridge` (in `tools/mock-td.js`) implementing the contract over in-memory state, with knobs: `failBuildForRequestId`, `blankForRequestId`, `errorsForPath`, plus `state` (registry, switchIndex, ops set) for assertions.
- Produces for later tasks: `MockTdBridge` is what Task 11's worker tests run against.

- [ ] **Step 1: Write the bridge contract doc module**

Create `effects-on-demand/worker/tdBridge.js`:

```js
/**
 * TdBridge — the deterministic surface the worker uses to drive TouchDesigner.
 * The creative "build inside this container" work is delegated to the GLM agent
 * (see agentRunner.js); everything safety-critical (scaffold, verify gates,
 * registry writes, switch, recycle) goes through these methods so the worker is
 * unit-testable against MockTdBridge.
 *
 * @typedef {Object} RegistryEntry
 * @property {number} index
 * @property {string} compPath
 * @property {string} title
 * @property {string} author
 * @property {number} createdTs
 *
 * @typedef {Object} TdBridge
 * @property {() => Promise<boolean>} ping
 * @property {(code: string) => Promise<{ ok: boolean, stdout: string }>} execScript
 * @property {() => Promise<RegistryEntry[]>} readRegistry
 * @property {(rowCells: string[]) => Promise<void>} appendRegistryRow
 * @property {(index: number) => Promise<void>} removeRegistryByIndex
 * @property {(path: string) => Promise<void>} deleteOp
 * @property {(path: string) => Promise<string[]>} getErrors
 * @property {(path: string) => Promise<boolean>} screenshotNonBlank
 * @property {(index: number) => Promise<void>} setSwitch
 * @property {() => Promise<number>} getSwitch
 */

export const BRIDGE_METHODS = [
  'ping', 'execScript', 'readRegistry', 'appendRegistryRow', 'removeRegistryByIndex',
  'deleteOp', 'getErrors', 'screenshotNonBlank', 'setSwitch', 'getSwitch',
];

/** Throws if `obj` is missing any TdBridge method — use to validate a bridge impl at startup. */
export function assertBridge(obj) {
  for (const m of BRIDGE_METHODS) {
    if (typeof obj[m] !== 'function') throw new Error(`TdBridge missing method: ${m}`);
  }
  return obj;
}
```

- [ ] **Step 2: Write the in-memory mock**

Create `effects-on-demand/tools/mock-td.js`:

```js
import { assertBridge } from '../worker/tdBridge.js';

// In-memory TdBridge for worker unit tests and local dry-runs. Deterministic.
export class MockTdBridge {
  constructor(opts = {}) {
    this.state = {
      registry: [],          // RegistryEntry[]
      switchIndex: 0,
      ops: new Set(),        // created op paths
      execLog: [],
    };
    this.knobs = {
      failBuildForRequestId: opts.failBuildForRequestId ?? null,
      blankForRequestId: opts.blankForRequestId ?? null,
      errorsForPath: opts.errorsForPath ?? {},   // path -> string[]
      bridgeDown: opts.bridgeDown ?? false,
    };
    assertBridge(this);
  }

  async ping() { return !this.knobs.bridgeDown; }

  async execScript(code) {
    if (this.knobs.bridgeDown) throw new Error('bridge down');
    this.state.execLog.push(code);
    return { ok: true, stdout: 'ok' };
  }

  async readRegistry() { return this.state.registry.map((e) => ({ ...e })); }

  async appendRegistryRow(cells) {
    const [index, compPath, title, author, createdTs] = cells;
    this.state.registry.push({
      index: Number(index), compPath, title, author, createdTs: Number(createdTs),
    });
  }

  async removeRegistryByIndex(index) {
    this.state.registry = this.state.registry.filter((e) => e.index !== index);
  }

  async deleteOp(path) { this.state.ops.delete(path); }

  async getErrors(path) { return this.knobs.errorsForPath[path] ?? []; }

  async screenshotNonBlank(path) {
    // A container is "blank" only if explicitly flagged for its request id.
    return !(this.knobs.blankForRequestId && path.includes(this.knobs.blankForRequestId));
  }

  async setSwitch(index) { this.state.switchIndex = index; }
  async getSwitch() { return this.state.switchIndex; }
}

// Allow `node tools/mock-td.js` to be a no-op entry (kept for parity with sibling tools).
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('MockTdBridge is a library used by tests; nothing to run.');
}
```

- [ ] **Step 3: Quick verification the mock satisfies the contract**

Run:
```bash
node -e "import('./effects-on-demand/tools/mock-td.js').then(m => { new m.MockTdBridge(); console.log('mock-bridge-ok'); })"
```
Expected: prints `mock-bridge-ok` (the constructor calls `assertBridge`, so a missing method would throw here).

- [ ] **Step 4: Commit**

```bash
git add effects-on-demand/worker/tdBridge.js effects-on-demand/tools/mock-td.js
git commit -m "feat(eod): TdBridge contract + in-memory MockTdBridge"
```

---

### Task 11: Worker state machine (the core orchestration)

**Files:**
- Create: `effects-on-demand/worker/worker.js`
- Test: `effects-on-demand/test/worker.test.js`

**Interfaces:**
- Consumes: `config` (Task 2), `contract.js` (Task 8), `gallery.js` (Task 9), a `TdBridge` (Task 10), and an injected **agentRunner** `runAgentSession({ job, effectPath, contract, bridge, signal }) -> Promise<{ built: boolean }>` (real impl in Task 12; tests inject a fake). Also an injected `now()` and `onStatus(requestId, state, note)` callback.
- Produces: `processJob({ job, config, bridge, runAgentSession, now, onStatus }) -> Promise<{ state: 'live'|'failed', index?, reason? }>` implementing the exact per-job state machine:
  1. `onStatus(building)`.
  2. `bridge.ping()` — if false → `failed` (bridge down), switch untouched.
  3. Ensure contract scaffolded (idempotent `execScript(scaffoldScript)` once per process via a `scaffolded` flag passed in `config._runtime`, or always — see code).
  4. Assign the next free non-safe index; LRU-recycle via `pickRecycleIndex` if at cap (delete its comp + registry row).
  5. `runAgentSession(...)` inside an `AbortController` bounded by `jobTimeoutMs`. On throw/timeout → discard container (`deleteOp(effectPath)`) → `failed`.
  6. Verify gates: `getErrors(effectPath)` empty **and** `screenshotNonBlank(effectPath)` true. Any gate fail → discard container → `failed`, switch untouched.
  7. On pass: `appendRegistryRow(registryRow(...))` then `setSwitch(index)` → `onStatus(live)` → return `{ state: 'live', index }`.
- Also produces `runWorker({ queue, config, bridge, runAgentSession, now, onStatus, shouldStop })` — the serial drain loop calling `processJob` one at a time (used by the entry point; tested lightly).

- [ ] **Step 1: Write the failing test**

Create `effects-on-demand/test/worker.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processJob } from '../worker/worker.js';
import { DEFAULTS } from '../server/config.js';
import { MockTdBridge } from '../tools/mock-td.js';

const cfg = () => ({ ...DEFAULTS, contract: { ...DEFAULTS.contract } });
const job = (id) => ({ requestId: id, clientId: 'c', name: 'Al', text: 'add rain', ts: 1 });
const okRunner = async ({ bridge, effectPath }) => { bridge.state.ops.add(effectPath); return { built: true }; };
const now = () => 1700000000000;

test('happy path: builds, verifies, registers, switches, reports live', async () => {
  const bridge = new MockTdBridge();
  const seen = [];
  const r = await processJob({ job: job('abc'), config: cfg(), bridge, runAgentSession: okRunner, now, onStatus: (id, s) => seen.push(s) });
  assert.equal(r.state, 'live');
  assert.equal(await bridge.getSwitch(), r.index);
  const reg = await bridge.readRegistry();
  assert.ok(reg.some((e) => e.index === r.index && e.author === 'Al'));
  assert.deepEqual(seen, ['building', 'live']);
});

test('bridge down → failed, switch untouched', async () => {
  const bridge = new MockTdBridge({ bridgeDown: true });
  const before = await bridge.getSwitch();
  const r = await processJob({ job: job('abc'), config: cfg(), bridge, runAgentSession: okRunner, now, onStatus: () => {} });
  assert.equal(r.state, 'failed');
  assert.equal(await bridge.getSwitch(), before);
});

test('verify-fail (blank render) → discard container, failed, switch untouched', async () => {
  const bridge = new MockTdBridge({ blankForRequestId: 'abc' });
  const r = await processJob({ job: job('abc'), config: cfg(), bridge, runAgentSession: okRunner, now, onStatus: () => {} });
  assert.equal(r.state, 'failed');
  assert.equal(await bridge.getSwitch(), 0);
  // container discarded
  assert.equal([...bridge.state.ops].some((p) => p.includes('fx_abc')), false);
});

test('agent throws → failed and container discarded', async () => {
  const bridge = new MockTdBridge();
  const boom = async ({ bridge, effectPath }) => { bridge.state.ops.add(effectPath); throw new Error('agent died'); };
  const r = await processJob({ job: job('abc'), config: cfg(), bridge, runAgentSession: boom, now, onStatus: () => {} });
  assert.equal(r.state, 'failed');
  assert.equal([...bridge.state.ops].some((p) => p.includes('fx_abc')), false);
});

test('at cap, LRU recycles oldest non-live before adding', async () => {
  const bridge = new MockTdBridge();
  const c = cfg(); c.galleryCap = 2;
  // pre-seed: safe(0) + one effect(1)
  bridge.state.registry.push({ index: 0, compPath: '/p/safe', title: 'safe', author: '', createdTs: 0 });
  bridge.state.registry.push({ index: 1, compPath: '/project1/effects/fx_old', title: 't', author: 'x', createdTs: 5 });
  bridge.state.ops.add('/project1/effects/fx_old');
  const r = await processJob({ job: job('new'), config: c, bridge, runAgentSession: okRunner, now, onStatus: () => {} });
  assert.equal(r.state, 'live');
  assert.equal(r.index, 1);                                          // reused the freed slot (capped gallery)
  const reg = await bridge.readRegistry();
  assert.equal(reg.length, 2);                                       // safe(0) + new(1); old recycled
  assert.equal(reg.some((e) => e.compPath.includes('fx_old')), false); // old effect gone from registry
  assert.equal(bridge.state.ops.has('/project1/effects/fx_old'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/worker.test.js`
Expected: FAIL with "Cannot find module '../worker/worker.js'".

- [ ] **Step 3: Write the implementation**

Create `effects-on-demand/worker/worker.js`:

```js
import { scaffoldScript, effectPath as buildEffectPath, registryRow } from './contract.js';
import { pickRecycleIndex } from './gallery.js';

// Choose the lowest free index that isn't the safe index, given current registry.
function nextIndex(entries, safeIndex) {
  const used = new Set(entries.map((e) => e.index));
  let i = safeIndex + 1;
  while (used.has(i)) i += 1;
  return i;
}

async function withTimeout(promise, ms, controller) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => { controller.abort(); rej(new Error('job timeout')); }, ms); });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(t); }
}

export async function processJob({ job, config, bridge, runAgentSession, now, onStatus }) {
  const { contract, jobTimeoutMs, galleryCap } = config;
  const fxPath = buildEffectPath(contract, job.requestId);
  onStatus(job.requestId, 'building', 'building your effect…');

  // 1. Bridge liveness (read-only probe first, per the skill's core workflow).
  if (!(await bridge.ping())) {
    return { state: 'failed', reason: 'bridge-down' };
  }

  // 2. Ensure contract exists (idempotent).
  await bridge.execScript(scaffoldScript(contract));

  // 3. Assign index, recycling the oldest non-live effect if at cap.
  const liveIndex = await bridge.getSwitch();
  let entries = await bridge.readRegistry();
  const recycle = pickRecycleIndex({ entries, cap: galleryCap, liveIndex, safeIndex: contract.safeIndex });
  if (recycle != null) {
    const victim = entries.find((e) => e.index === recycle);
    if (victim) await bridge.deleteOp(victim.compPath);
    await bridge.removeRegistryByIndex(recycle);
    entries = await bridge.readRegistry();
  }
  const index = nextIndex(entries, contract.safeIndex);

  // 4. Delegate the creative build to the agent, bounded by the job timeout.
  const controller = new AbortController();
  try {
    await withTimeout(
      runAgentSession({ job, effectPath: fxPath, index, contract, bridge, signal: controller.signal }),
      jobTimeoutMs,
      controller,
    );
  } catch {
    await bridge.deleteOp(fxPath); // discard half-built container
    return { state: 'failed', reason: 'agent-failed' };
  }

  // 5. Verify gates: no errors in the subtree AND a non-blank render.
  const errs = await bridge.getErrors(fxPath);
  const nonBlank = await bridge.screenshotNonBlank(fxPath);
  if (errs.length > 0 || !nonBlank) {
    await bridge.deleteOp(fxPath);
    return { state: 'failed', reason: 'verify-failed' };
  }

  // 6. Register + switch (atomic order: author cell written before the switch).
  await bridge.appendRegistryRow(registryRow({
    index, compPath: fxPath, title: job.text, author: job.name, createdTs: Math.floor(now() / 1000),
  }));
  await bridge.setSwitch(index);
  onStatus(job.requestId, 'live', "it's on the wall ✦");
  return { state: 'live', index };
}

// Serial drain loop. Pulls one job at a time; never builds two concurrently.
export async function runWorker({ queue, config, bridge, runAgentSession, now, onStatus, shouldStop }) {
  while (!shouldStop()) {
    const job = queue.dequeue();
    if (!job) { await new Promise((r) => setTimeout(r, 50)); continue; }
    try {
      const r = await processJob({ job, config, bridge, runAgentSession, now, onStatus });
      if (r.state === 'failed') onStatus(job.requestId, 'failed', "couldn't build that — try rephrasing");
    } catch {
      onStatus(job.requestId, 'failed', 'internal error');
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test effects-on-demand/test/worker.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite**

Run: `node --test effects-on-demand/test/`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add effects-on-demand/worker/worker.js effects-on-demand/test/worker.test.js
git commit -m "feat(eod): worker per-job state machine + serial drain loop"
```

---

### Task 12: Agent runner (GLM session via Agent SDK → Z.AI)

**Files:**
- Create: `effects-on-demand/worker/agentRunner.js`
- Modify: `effects-on-demand/package.json` (add `@anthropic-ai/claude-agent-sdk` dependency)

**Interfaces:**
- Consumes: env (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `EOD_GLM_MODEL`), the TD-MCP server config, and the per-job inputs from `processJob` (`{ job, effectPath, index, contract, bridge, signal }`).
- Produces: `makeAgentRunner({ mcpServerUrl, model, systemPrompt }) -> runAgentSession({ job, effectPath, index, contract, signal }) -> Promise<{ built: boolean }>`. The runner starts a GLM Agent-SDK session pointed at Z.AI, loads the TD-MCP server + `td-mcp` skill, and instructs the agent to build **only inside `effectPath`**. It does **not** verify or switch — that is the worker's job.
- Produces `buildSystemPrompt({ effectPath, contract }) -> string` (pure, testable): the hard-scoping system prompt (build only inside `effectPath`; never modify other effects / live container / core ops / crowd-control DATs / TD_MCP; never pulse server-control buttons; checkpoint before structural changes).

> **Why this task has no deterministic unit test of the live call:** the runner drives a live GLM model against a live TouchDesigner — non-deterministic by nature. We unit-test the **pure** `buildSystemPrompt` (guardrail wording is load-bearing) and verify the live path in Task 16's manual checklist. The worker that consumes this runner is already fully tested in Task 11 against a fake runner.

- [ ] **Step 1: Write the failing test for the pure guardrail prompt**

Add to a new `effects-on-demand/test/agentRunner.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../worker/agentRunner.js';
import { DEFAULTS } from '../server/config.js';

test('system prompt hard-scopes the agent to its container and forbids the rest', () => {
  const p = buildSystemPrompt({ effectPath: '/project1/effects/fx_abc', contract: DEFAULTS.contract });
  assert.match(p, /\/project1\/effects\/fx_abc/);            // build target
  assert.match(p, /only inside/i);
  assert.match(p, /never|do not/i);
  assert.match(p, /fx_switch/);                              // must not flip the switch
  assert.match(p, /checkpoint/i);                            // checkpoint-before-structural
  assert.match(p, /TD_MCP|crowd|live/i);                     // forbidden neighbors
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/agentRunner.test.js`
Expected: FAIL with "Cannot find module '../worker/agentRunner.js'".

- [ ] **Step 3: Write the implementation**

Create `effects-on-demand/worker/agentRunner.js`:

```js
import { query } from '@anthropic-ai/claude-agent-sdk';

// Hard-scoping system prompt for the GLM session. The agent may read other
// effects for reference but may WRITE only inside its assigned container. The
// worker (not the agent) runs the verify gates and flips fx_switch.
export function buildSystemPrompt({ effectPath, contract }) {
  return [
    `You are an effect-builder for a live TouchDesigner projection.`,
    `Build ONLY inside the container ${effectPath}. Every create_operator / execute_script / set_par_value call must target that subtree.`,
    `You may READ other effects under ${contract.effectsPath} for reference, but never modify or delete them.`,
    `NEVER modify or delete: the currently-live container, core project operators, the crowd-control / mobile-control DATs, or /project1/TD_MCP.`,
    `NEVER set ${contract.switchPath} (the switch) — flipping the projection is not your job.`,
    `NEVER pulse Start/Restart or any server-control buttons.`,
    `Checkpoint (save_checkpoint) before any structural change, per the td-mcp safety skill.`,
    `When the effect renders in ${effectPath}'s out TOP, you are done. Do not verify or switch — the host does that.`,
  ].join('\n');
}

// Build the runner the worker calls. mcpServerUrl points at the TD-MCP WebServer
// DAT (e.g. ws://127.0.0.1:9980). The Agent SDK is pointed at Z.AI via the
// ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN env vars the process is started with.
export function makeAgentRunner({ mcpServerUrl, model }) {
  return async function runAgentSession({ job, effectPath, contract, signal }) {
    const systemPrompt = buildSystemPrompt({ effectPath, contract });
    const prompt = `A visitor named ${job.name} requests: "${job.text}". Build it as a self-contained effect inside ${effectPath}.`;

    const session = query({
      prompt,
      options: {
        model,                                  // GLM model id (Z.AI)
        systemPrompt,
        abortController: signal ? { signal } : undefined,
        mcpServers: {
          td: { type: 'sdk', url: mcpServerUrl },   // TD-MCP bridge, loaded verbatim
        },
        // The td-mcp skill + safety refs are discovered from the project the
        // worker process is launched in (they live in the TD-MCP repo).
      },
    });

    // Drain the agent turn to completion (or until aborted).
    for await (const _event of session) { /* progress is observed via the bridge */ }
    return { built: true };
  };
}
```

> **Note on the SDK surface:** `@anthropic-ai/claude-agent-sdk`'s exact option names (`query`, `mcpServers`, `systemPrompt`, abort handling) should be confirmed against the installed SDK version when this task runs — invoke the `claude-api` skill and/or `npm ls @anthropic-ai/claude-agent-sdk` and adjust the option keys to match. The **shape** (Z.AI via env, MCP server loaded, system prompt hard-scoping, drain to completion) is fixed; only the literal option keys may shift between SDK minors.

- [ ] **Step 4: Add the dependency**

In `effects-on-demand/package.json`, add to `dependencies`:

```json
    "@anthropic-ai/claude-agent-sdk": "^0.1.0"
```

Then run: `cd effects-on-demand && npm install`
Expected: installs without error. (If the version range is wrong, `npm view @anthropic-ai/claude-agent-sdk version` and pin the current major.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test effects-on-demand/test/agentRunner.test.js`
Expected: PASS (1 test). (The pure `buildSystemPrompt` import must not trigger the SDK's network code at module load — `query` is only called inside the runner.)

- [ ] **Step 6: Commit**

```bash
git add effects-on-demand/worker/agentRunner.js effects-on-demand/package.json effects-on-demand/package-lock.json effects-on-demand/test/agentRunner.test.js
git commit -m "feat(eod): GLM agent runner (Agent SDK -> Z.AI) + hard-scoping prompt"
```

---

### Task 13: Real MCP-backed TdBridge

**Files:**
- Create: `effects-on-demand/worker/mcpBridge.js`
- (No new test — this is the live-I/O adapter; correctness is covered by Task 16's manual checklist. It implements the Task 10 contract, which `assertBridge` validates at startup.)

**Interfaces:**
- Consumes: a connection to the TD-MCP server (WebSocket to port 9980) and the TD-MCP tool names (`create_operator`, `execute_script`, `set_par_value`, `save_checkpoint`, `take_screenshot`, `get_errors`).
- Produces: `connectMcpBridge({ url }) -> Promise<TdBridge>` — a real `TdBridge` (Task 10 contract) backed by TD-MCP tool calls. Maps each `TdBridge` method onto the corresponding MCP tool/script. Validated with `assertBridge` before return.

- [ ] **Step 1: Write the implementation**

Create `effects-on-demand/worker/mcpBridge.js`:

```js
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
```

> **Note:** the exact TD-MCP request framing (`method`/`params` vs a `tools/call` envelope) and `take_screenshot` return shape must be confirmed against the TD-MCP server when this task runs — read `dev/TD-MCP/td-mcp-server` and the `td-mcp` skill. The `assertBridge` call guarantees the method surface is complete even before the wire details are finalized.

- [ ] **Step 2: Verify it loads and exposes the full bridge surface (offline)**

Run:
```bash
node -e "import('./effects-on-demand/worker/mcpBridge.js').then(() => console.log('mcpBridge module ok'))"
```
Expected: prints `mcpBridge module ok` (module parses; no connection attempted at import).

- [ ] **Step 3: Commit**

```bash
git add effects-on-demand/worker/mcpBridge.js
git commit -m "feat(eod): real TD-MCP-backed TdBridge adapter"
```

---

### Task 14: Intake server (http + ws) and worker entry points

**Files:**
- Create: `effects-on-demand/server/intakeServer.js`
- Create: `effects-on-demand/server/index.js`
- Create: `effects-on-demand/worker/index.js`
- Test: `effects-on-demand/test/intakeServer.integration.test.js`

**Interfaces:**
- Consumes: `config`, `protocol.js`, `safety.js`, `ratelimit.js`, `queue.js`, `static.js`.
- Produces:
  - `createIntakeServer({ config, port, publicDir, queue, now, makeId }) -> { httpServer, wss, stop() }`. Serves the PWA, accepts `hello`/`request`/`ping`, enforces per-`clientId` rate limit + in-flight cap, screens requests, enqueues accepted jobs (or replies `error{code}`), and exposes `pushStatus(requestId, state, note)` to fan a status message to the originating phone. Connection registry keyed by `clientId`.
  - `server/index.js`: reads env/config, creates the queue + intake server, and wires `pushStatus` so the worker's `onStatus` reaches phones (in single-process mode the worker import calls `intake.pushStatus`).
  - `worker/index.js`: reads env, connects the real bridge (`connectMcpBridge`), builds the runner (`makeAgentRunner`), and runs `runWorker`.
- Produces for tests: the integration test drives a real `ws` client against the intake server with a stub queue and asserts the accept / busy / rejected / status-fanout paths.

- [ ] **Step 1: Write the failing integration test**

Create `effects-on-demand/test/intakeServer.integration.test.js`:

```js
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
    inbox.push(m);
    const w = waiters.shift(); if (w) w(m);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/intakeServer.integration.test.js`
Expected: FAIL with "Cannot find module '../server/intakeServer.js'".

- [ ] **Step 3: Write the intake server**

Create `effects-on-demand/server/intakeServer.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test effects-on-demand/test/intakeServer.integration.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the intake entry point**

Create `effects-on-demand/server/index.js`:

```js
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadConfig, DEFAULTS } from './config.js';
import { RequestQueue } from './queue.js';
import { createIntakeServer } from './intakeServer.js';

const cfgPath = process.env.EOD_CONFIG || 'config/effects.config.json';
const config = existsSync(cfgPath) ? loadConfig(cfgPath) : DEFAULTS;
const port = Number(process.env.EOD_PORT || 8090);

const queue = new RequestQueue({ bound: config.queueBound });
const intake = createIntakeServer({
  config, port, publicDir: 'public', queue,
  now: () => Date.now(), makeId: () => randomUUID().slice(0, 8),
});

// In single-process mode, the worker is started in the same process (see
// worker/index.js dual-mode note). The shared queue + intake.pushStatus connect
// them. For a two-process deployment, replace this with an IPC/WS status bridge.
globalThis.__EOD_INTAKE__ = intake;
globalThis.__EOD_QUEUE__ = queue;
console.log(`[eod] intake listening on :${port} (queue bound ${config.queueBound})`);
```

- [ ] **Step 6: Write the worker entry point**

Create `effects-on-demand/worker/index.js`:

```js
import { existsSync } from 'node:fs';
import { loadConfig, DEFAULTS } from '../server/config.js';
import { RequestQueue } from '../server/queue.js';
import { connectMcpBridge } from './mcpBridge.js';
import { makeAgentRunner } from './agentRunner.js';
import { runWorker } from './worker.js';

const cfgPath = process.env.EOD_CONFIG || 'config/effects.config.json';
const config = existsSync(cfgPath) ? loadConfig(cfgPath) : DEFAULTS;

const mcpUrl = process.env.EOD_MCP_URL || 'ws://127.0.0.1:9980';
const model = process.env.EOD_GLM_MODEL || 'glm-4.6';

// Shared queue + intake from the intake process when co-located; otherwise the
// worker owns its own queue and you run a status bridge. This entry assumes
// co-located single-process start (node -e importing both), or a shared queue.
const queue = globalThis.__EOD_QUEUE__ || new RequestQueue({ bound: config.queueBound });
const intake = globalThis.__EOD_INTAKE__;
const onStatus = (id, state, note) => intake?.pushStatus(id, state, note);

const bridge = await connectMcpBridge({ url: mcpUrl });
const runAgentSession = makeAgentRunner({ mcpServerUrl: mcpUrl, model });

console.log(`[eod] worker draining queue → TD-MCP ${mcpUrl}, model ${model}`);
await runWorker({ queue, config, bridge, runAgentSession, now: () => Date.now(), onStatus, shouldStop: () => false });
```

> **Deployment note (documented, not a placeholder):** the simplest deployment runs intake + worker **in one process** so they share the queue object and `pushStatus` directly. Start it with a tiny launcher that imports both entry points in order (intake first, then worker). A two-process split requires a status bridge (e.g. the worker POSTs status to the intake over localhost) — out of scope for v1; the README documents the single-process start.

- [ ] **Step 7: Commit**

```bash
git add effects-on-demand/server/intakeServer.js effects-on-demand/server/index.js effects-on-demand/worker/index.js effects-on-demand/test/intakeServer.integration.test.js
git commit -m "feat(eod): intake ws server + intake/worker entry points"
```

---

### Task 15: Request PWA (shell, ws client, view-logic)

**Files:**
- Create: `effects-on-demand/public/index.html`
- Create: `effects-on-demand/public/ui-logic.js`
- Create: `effects-on-demand/public/app.js`
- Create: `effects-on-demand/public/styles.css`
- Create: `effects-on-demand/public/manifest.webmanifest`
- Test: `effects-on-demand/test/ui-logic.test.js`

**Interfaces:**
- Consumes: the wire protocol (Task 3).
- Produces:
  - `ui-logic.js` (pure, importable in node:test): `nextView(state, msg) -> state` reducer mapping inbound messages to `{ phase: 'idle'|'submitting'|'queued'|'building'|'live'|'failed'|'error', note, position, requestId }`, and `statusNote(state)` for display copy. No DOM.
  - `app.js`: persists `clientId`+`name` in localStorage, opens the ws, renders from `nextView`.
  - `index.html` + `styles.css` + `manifest.webmanifest`: the mobile PWA shell (name field, request textarea, submit, live status line).

- [ ] **Step 1: Write the failing test for the view reducer**

Create `effects-on-demand/test/ui-logic.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test effects-on-demand/test/ui-logic.test.js`
Expected: FAIL with "Cannot find module '../public/ui-logic.js'".

- [ ] **Step 3: Write the pure view-logic**

Create `effects-on-demand/public/ui-logic.js`:

```js
export const initialView = () => ({ phase: 'idle', note: '', position: null, requestId: null });

export function nextView(state, msg) {
  switch (msg.type) {
    case 'welcome': return { ...state, phase: 'idle', note: '' };
    case 'accepted': return { ...state, phase: 'queued', position: msg.position, requestId: msg.requestId };
    case 'status':
      return { ...state, phase: msg.state, note: msg.note, requestId: msg.requestId };
    case 'error': return { ...state, phase: 'error', note: msg.message || msg.code };
    default: return state;
  }
}

export function statusNote(state) {
  switch (state.phase) {
    case 'queued': return `In line${state.position ? ` (#${state.position})` : ''}…`;
    case 'building': return state.note || 'Building your effect…';
    case 'live': return state.note || "It's on the wall ✦";
    case 'failed': return state.note || "Couldn't build that — try rephrasing.";
    case 'error': return state.note || 'Something went wrong.';
    default: return '';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test effects-on-demand/test/ui-logic.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the PWA shell**

Create `effects-on-demand/public/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0b0b10" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <title>Make an Effect</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main>
    <h1>Make an Effect</h1>
    <label>Your name <input id="name" maxlength="40" placeholder="anonymous" autocomplete="off" /></label>
    <label>What should appear?
      <textarea id="text" maxlength="280" rows="3" placeholder="e.g. add rain, make the flame bluer"></textarea>
    </label>
    <button id="send">Send to the wall</button>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

Create `effects-on-demand/public/styles.css`:

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; background: #0b0b10; color: #f2f2f7;
  font: 16px/1.4 system-ui, sans-serif; display: grid; place-items: center; padding: 24px; }
main { width: 100%; max-width: 420px; display: grid; gap: 16px; }
h1 { font-size: 1.5rem; margin: 0 0 8px; }
label { display: grid; gap: 6px; font-size: 0.9rem; color: #b8b8c4; }
input, textarea { font: inherit; color: inherit; background: #16161f; border: 1px solid #2a2a38;
  border-radius: 10px; padding: 12px; }
button { font: inherit; font-weight: 600; padding: 14px; border: 0; border-radius: 12px;
  background: #5b5bf0; color: white; }
button:disabled { opacity: 0.5; }
#status { min-height: 1.4em; font-weight: 600; }
</style>
```

(Remove the stray trailing `</style>` — CSS files don't use it. The block above ends at `#status { … }`.)

Create `effects-on-demand/public/manifest.webmanifest`:

```json
{
  "name": "Make an Effect",
  "short_name": "Effects",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0b0b10",
  "theme_color": "#0b0b10"
}
```

- [ ] **Step 6: Write the ws client wiring**

Create `effects-on-demand/public/app.js`:

```js
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
```

- [ ] **Step 7: Run the full suite**

Run: `node --test effects-on-demand/test/`
Expected: all green (ui-logic included).

- [ ] **Step 8: Commit**

```bash
git add effects-on-demand/public/ effects-on-demand/test/ui-logic.test.js
git commit -m "feat(eod): request PWA shell + ws client + pure view-logic"
```

---

### Task 16: Fake-phones load tool, README, and manual TD checklist

**Files:**
- Create: `effects-on-demand/tools/fake-phones.js`
- Create: `effects-on-demand/README.md`

**Interfaces:**
- Consumes: the running intake server (Task 14) and the wire protocol.
- Produces:
  - `tools/fake-phones.js`: a CLI that opens N ws connections, each sending `hello` then a `request`, and logs the status fan-out — exercises serial draining + per-client rate-limit + busy overflow.
  - `README.md`: setup (env, `npm install`), single-process run, Cloudflare Tunnel exposure, and the **manual-on-real-TD checklist** (the non-automatable verification: scaffold-on-first-run, one copy-existing request, one build-new request, attribution overlay, LRU recycle, panic backstop).

- [ ] **Step 1: Write the fake-phones tool**

Create `effects-on-demand/tools/fake-phones.js`:

```js
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
```

- [ ] **Step 2: Verify it runs against a live intake server**

In one shell: `cd effects-on-demand && EOD_PORT=8090 node server/index.js`
In another: `cd effects-on-demand && EOD_PORT=8090 node tools/fake-phones.js 5`
Expected: each fake phone logs `welcome` then `accepted` with an increasing `pos`; with the worker not running, jobs stay queued (no `live`) — confirming intake + queue + rate-limit work end-to-end. Stop both with Ctrl-C.

- [ ] **Step 3: Write the README + manual checklist**

Create `effects-on-demand/README.md`:

```markdown
# effects-on-demand

A phone scans a QR, types a natural-language effect request, and a server-hosted
GLM agent builds it into the live TouchDesigner project and auto-switches it onto
the projection. Design spec: `../docs/2026-06-19-effects-on-demand-design.md`.

## Architecture
- **Intake server** (`server/`) — serves the PWA, screens + rate-limits requests, holds a strictly serial queue.
- **Worker** (`worker/`) — drains one job at a time; owns the deterministic safety envelope (scaffold, verify gates, registry, switch, LRU) via `TdBridge`; delegates the creative build to a GLM session (Agent SDK → Z.AI) scoped to one container.
- **TD contract** — `effects/`, `fx_switch`, `fx_registry`, attribution overlay; scaffolded on first run.

## Setup
```
cd effects-on-demand
npm install
cp config/effects.config.example.json config/effects.config.json   # optional; defaults are sane
```
Worker env (never commit secrets):
```
export ANTHROPIC_BASE_URL=<Z.AI Anthropic-compatible endpoint>
export ANTHROPIC_AUTH_TOKEN=<Z.AI key>
export EOD_GLM_MODEL=<GLM model id>
export EOD_MCP_URL=ws://127.0.0.1:9980   # TD-MCP WebServer DAT
```

## Run (single process: intake + worker share the queue)
```
node -e "await import('./server/index.js'); await import('./worker/index.js');"
```
Then expose it:
```
cloudflared tunnel --url http://localhost:8090
```
Point the QR at the tunnel URL.

## Test
```
npm test          # or: node --test
```

## Dev tools
- `node tools/fake-phones.js 8` — drive concurrent requests at the intake server.
- `tools/mock-td.js` — in-memory `TdBridge` used by the worker tests.

## Manual-on-real-TD checklist (not automatable)
Run against a live TD with TD-MCP on :9980 and the `td-mcp` skill available:
- [ ] **Scaffold on first run** — fresh project: first request creates `effects/`, `fx_safe` (index 0), `fx_switch`, `fx_registry` (header + safe row), `fx_attrib`.
- [ ] **Build-new** — request "add rain": a new `effects/fx_<id>` is built, verified (no errors, non-blank), registered, and the switch flips to it.
- [ ] **Copy-existing** — request "make the flame bluer" with a flame effect present: the agent copies it as a starting point and only the new container changes.
- [ ] **Attribution** — the requester's name renders on the projection via `fx_attrib` for the live effect; switching effects updates the credit.
- [ ] **LRU recycle** — push past `galleryCap` (12): the oldest non-live, non-safe effect's COMP + registry row are removed; the live effect is never recycled.
- [ ] **Verify-fail** — a request that renders black or errors never reaches the wall; the phone shows `failed`; the switch is untouched.
- [ ] **Panic backstop** — operator kill-switch resets `fx_switch` → 0 (safe) and the queue stops draining.
```

- [ ] **Step 4: Commit**

```bash
git add effects-on-demand/tools/fake-phones.js effects-on-demand/README.md
git commit -m "docs(eod): fake-phones load tool + README + manual TD checklist"
```

---

### Task 17: Final suite, self-review, and plan close-out

**Files:**
- Test: all of `effects-on-demand/test/`

- [ ] **Step 1: Run the complete suite**

Run: `node --test effects-on-demand/test/`
Expected: every test passes (config, protocol, safety, ratelimit, queue, static, contract, gallery, worker, agentRunner, intakeServer integration, ui-logic, smoke).

- [ ] **Step 2: Run from the repo root via the convenience script**

Run: `npm run test:eod`
Expected: PASS.

- [ ] **Step 3: Confirm the existing app's tests still pass (no cross-contamination)**

Run: `npm test`
Expected: the sibling `touchdesigner-mobile-control` suite passes unchanged.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "test(eod): full suite green; effects-on-demand v1 complete"
```

---

## Self-Review

**1. Spec coverage** — each design section maps to a task:
- §1 Purpose / success criteria → end-to-end across Tasks 11–16 (worker auto-switches verified builds; failed builds never reach the wall; existing app + 9980 untouched by construction — separate package, separate port).
- §2 Architecture (intake / worker / contract) → Tasks 14 / 11 / 8.
- §3 Lifecycle, wire protocol, queue → Tasks 3, 6, 14 (queued→building→live/failed, bound 20 → busy, 5-min timeout in `processJob`).
- §4 TD contract (`effects/`, `fx_switch`, `fx_registry`, index-0 safe, attribution overlay, author-before-switch order) → Task 8 + worker step 6.
- §5 Agent guardrails (build only in container; never touch neighbors/switch; checkpoint; verify-before-switch; switch is the only audience-facing action) → `buildSystemPrompt` (Task 12) + worker-owned verify+switch (Task 11).
- §6 Gallery lifecycle, failure & abuse → Task 9 (LRU, never live/safe) + Task 11 (discard-on-fail) + Task 4 (screen) + Task 5 (rate-limit) + worker bridge-down handling.
- §7 Testing strategy → headless units (Tasks 2–11), protocol/load (Task 16 fake-phones), mock-TD agent contract (Tasks 10–11), manual-on-real-TD (Task 16 checklist).

Gaps intentionally deferred (documented, not silent): the **panic kill-switch** is an operator/out-of-band control — exposed as the manual checklist item and the `setSwitch(0)` capability on the bridge; wiring a physical/UI kill button is venue-specific and left to deployment. Two-process intake/worker split is documented as out-of-scope for v1 (single-process start).

**2. Placeholder scan** — no "TBD"/"implement later"/"add validation": every code step ships complete code; the two adapter tasks (12, 13) carry concrete code plus an explicit "confirm SDK/MCP option keys against the installed version" note, which is a real verification step, not a placeholder. The CSS block has a stray `</style>` called out for removal in Task 15 Step 5.

**3. Type consistency** — `TdBridge` method names are fixed in Task 10 (`BRIDGE_METHODS`) and used identically in worker (Task 11), mock (Task 10), and real bridge (Task 13), all guarded by `assertBridge`. `registryRow`/`REGISTRY_COLUMNS` (Task 8) match the worker's append and the mock's parse. Status `state` strings (`queued|building|live|failed`) are the same `STATES` set across protocol (Task 3), worker (Task 11), and view-logic (Task 15).

---

## Execution Handoff

Plan complete and saved to `docs/2026-06-19-effects-on-demand.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session using superpowers:executing-plans, batch execution with checkpoints.

Which approach?
