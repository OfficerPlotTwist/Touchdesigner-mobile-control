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
export EOD_MCP_URL=ws://127.0.0.1:9980   # TD-MCP WebServer DAT (ws:// for the worker bridge)
# Note: the Agent SDK session uses the SSE/HTTP form of this URL (e.g. http://127.0.0.1:9980).
# Confirm the correct per-transport URL against the TD-MCP server during the manual run.
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
