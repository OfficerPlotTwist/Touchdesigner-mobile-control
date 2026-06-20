# Effects-on-Demand — Design Spec

**Date:** 2026-06-19
**Status:** Approved (brainstorming) → ready for implementation planning
**Topic:** A standalone package on top of TouchDesigner Mobile Control: a phone scans a QR, types a **natural-language effect request**, and a **server-hosted GLM agent** implements it live in TouchDesigner via the TD-MCP bridge, auto-switching it onto the projection.

> **Provenance.** This spec was reconstructed from the design conversation that produced it but was never written to disk in the original session. It is re-homed here because effects-on-demand was scoped as *"a package for the existing implementation of mobile phone project control"* — i.e. it belongs with this repo, not in `Projection_Mapping/effects_on_demand/`.
> - Design session: `e7d3043f-ba41-4b8e-b2ba-48771dd425ea`
> - Review / re-home session: `a49a62f7-98c3-4c05-9aa1-1acd1acb85ed`
> Both transcripts have been relocated so this project is resumable via `claude --resume` from this directory.

---

## 1. Purpose & scenario

A live installation where strangers' phones don't just *drive predefined controls* (that's the existing Mobile Control app) — they **request brand-new effects in natural language** and watch an AI agent build and show them in real time.

- **Scan → ask → watch it appear.** A phone scans a QR, opens the request PWA over cellular, types something like *"make the flame bluer"* or *"add rain"*, and submits.
- **A server-hosted GLM agent fulfils it.** The agent works entirely inside an offscreen effect container in the live TD project, verifies the result, then flips a single switch so it composites onto the projection — credited to the requester.
- **No fork.** The live TD project is a **gallery of self-contained effect containers**; a single switch (modeset) selects which one is shown. The agent either **copies an existing container** (good starting point for "make the flame bluer") or **builds a new one** ("add rain"), works offscreen, and the switch decides what's actually on the wall. A bad attempt simply never gets switched to — no fork, no rollback gymnastics. *(This replaced an earlier "fork the project" framing during design.)*
- **Auto-switch, no human in the loop** for the magic moment, with an operator **panic kill-switch** as a safety net (not a gate).

### Success criteria
- A phone on cellular can scan the QR, type a request, and see live status (`queued → building → live` / `failed`).
- On success, the requested effect renders **on the projection automatically**, with the requester's name credited on-screen.
- The agent never disturbs the currently-live output or any unrelated part of the project; a failed build never reaches the wall.
- The existing Mobile Control app and the `9980` MCP WebServer DAT are never touched or disturbed.
- An operator can hit a kill-switch that resets the projection to a known-safe effect and freezes the queue.

---

## 2. Architecture & topology

A standalone package running on the same machine (Khadas) as TD, exposed via its **own** Cloudflare tunnel + QR. It reuses the *patterns* of TouchDesigner Mobile Control (tunnel, WS, rate-limit, ephemeral sessions) but ships independently and drives TD through the existing **TD-MCP** bridge.

```
 Phones (cellular)        own tunnel           Khadas (runs TD)
┌──────────────┐  HTTPS/WSS   ┌────────────────────────────────────────────┐
│ request PWA  │◄────────────►│  (a) Intake server (Node + ws)             │
│  • text box  │              │      • serves PWA, QR target               │
│  • name      │              │      • rate-limit + prompt safety          │
│  • live      │              │      • serial request QUEUE                │
│    status    │              │            │ enqueue / status push          │
└──────────────┘              │            ▼                                │
                              │  (b) Agent worker (Node)                    │
                              │      • 1 job at a time                      │
                              │      • Claude Agent SDK session             │
                              │          base_url = Z.AI (Anthropic-compat) │
                              │          model    = GLM                     │
                              │          mcp      = TD-MCP server (as-is)   │
                              │          skill    = td-mcp + safety refs    │
                              │            │ MCP (localhost :9980)          │
                              │            ▼                                │
                              │  (c) TouchDesigner (live)                   │
                              │      /project1/effects/<new>  (built here)  │
                              │      /project1/fx_switch  (Switch TOP)      │
                              │      /project1/fx_registry (Table DAT)      │
                              │      9980 MCP WebServer DAT — the bridge    │
                              └────────────────────────────────────────────┘
```

**Three cleanly-separated units:**

| Unit | Purpose | Depends on |
|------|---------|------------|
| **(a) Intake server** | Serves the request PWA; accepts NL effect requests over WS; rate-limits + screens them; holds the serial queue; pushes live status back to each requester. | wire protocol |
| **(b) Agent worker** | Pulls one job at a time; runs a GLM Agent-SDK session with the TD-MCP tools + `td-mcp` skill; copies/builds a container, verifies, registers it, flips `fx_switch`; reports terminal status. | TD-MCP server; Z.AI; the TD contract |
| **(c) TD contract** | Package-defined structure the agent builds into: `effects/` parent, `fx_switch`, `fx_registry`. Scaffolded on first run if absent. | — |

The existing Mobile Control app and the `9980` MCP WebServer DAT are untouched, separate systems.

**Agent driver.** Z.AI exposes GLM through an **Anthropic-compatible API**, so the worker runs the **Claude Agent SDK** (or Claude Code headless) with `ANTHROPIC_BASE_URL` pointed at Z.AI and `model` set to GLM. It loads the existing TD-MCP server and the `td-mcp` skill **verbatim** — inheriting its safety discipline for free.

**Relationship to existing system:** standalone package, shared infra. Own server / PWA / QR; reuses the tunnel + WS + rate-limit patterns; drives the same TD through TD-MCP.

---

## 3. Request lifecycle, wire protocol & queue

**Lifecycle of one request:**

```
phone: scan QR -> PWA -> type request (+ name) -> submit
  -> intake: rate-limit + safety screen
       reject -> error to phone (reason)
       accept -> enqueue {id, clientId, name, text, ts}; status=queued
  -> worker (serial, one at a time):
       status=building  ───push──► phone ("building your effect…")
       Agent SDK session runs (checkpoint -> build/copy container -> verify)
         verify ok  -> register + set fx_switch -> status=live  ──► phone ("it's on the wall ✦") + projection switches
         verify bad -> discard container         -> status=failed ──► phone ("couldn't build that — try rephrasing")
         timeout    -> abort session             -> status=failed
```

**Wire protocol** (JSON over one WS per phone; mirrors the existing system's style):

*Phone → server*

| Type | Payload | Notes |
|------|---------|-------|
| `hello` | `{clientId, name}` | clientId + name persisted in localStorage; no name → "anonymous" |
| `request` | `{text}` | the natural-language effect ask |
| `ping` | `{}` | heartbeat |

*Server → phone*

| Type | Payload | Notes |
|------|---------|-------|
| `welcome` | `{clientId, queueLen}` | on connect |
| `accepted` | `{requestId, position}` | queued; position in line |
| `status` | `{requestId, state, note}` | `state ∈ queued\|building\|live\|failed`; `note` is a short human line |
| `error` | `{code, msg}` | rejected (rate-limited / screened / malformed) |

The phone never controls the switch directly — it only *requests*; the worker decides and auto-switches on success.

**Queue:** strictly serial (one TD, one MCP bridge = one shared mutable resource). FIFO, in-memory/ephemeral. Bounded length (default **20**); overflow → `error{code:"busy"}`. Each requester sees their live position. A per-job **timeout** (default **5 min**) aborts a runaway agent session and frees the queue.

---

## 4. TD project contract

The package defines and can scaffold the contract the agent builds against.

- **`/project1/effects/`** — parent COMP holding one self-contained container per effect, named `effects/fx_<id>` where `<id>` is the requestId (registry / comp / queue all correlate for debugging).
- **`/project1/fx_switch`** — a Switch TOP whose index selects which effect composites to the projection. **Index 0 is a reserved safe/idle effect**, scaffolded on first run: the boot default and the panic-backstop target.
- **`/project1/fx_registry`** — a Table DAT, the source of truth for the gallery:

  | index | comp_path | title | author | created_ts |
  |-------|-----------|-------|--------|------------|

- **Attribution overlay.** A single Text TOP reads the `author` of the *currently-switched* `fx_switch` index from `fx_registry` and composites it onto the output — so credit follows whatever's live and the agent doesn't rebuild text per container. (Author strings are sanitized + length-capped at intake; they reach the projection.)

On register, the agent writes the `author` cell alongside `comp_path` / `title`, **then** sets the switch — so the overlay updates atomically with the effect.

---

## 5. Agent guardrails — what GLM may and may not touch

Auto-switch + a public crowd means the agent's blast radius must be tightly bounded. The Agent-SDK session runs with the `td-mcp` skill + safety refs, plus a package system prompt that hard-scopes it:

- **Build only inside `/project1/effects/<newName>`.** Create/copy a COMP there; all `create_operator` / `execute_script` / `set_par_value` calls target that subtree. Copying an existing effect as a starting point is allowed (read others, write only its own).
- **Never modify or delete** any other effect, the currently-live container, core project ops, the Mobile Control / crowd-control DATs, or `/project1/TD_MCP`. Never pulse Start/Restart/server-control buttons (inherited from `live-bridge-safety`).
- **Checkpoint before scaffolding** (`save_checkpoint`) on first run / structural changes, per existing discipline.
- **Verify before switching:** `get_errors` clean on the new subtree **and** a `take_screenshot` of its out TOP that renders non-black / non-empty. Only then write `fx_registry` + set `fx_switch`. Fail any gate → discard the new COMP, report `failed`, leave the switch untouched.
- **Switch is the agent's only audience-facing action**, and only as the final verified step.
- **Operator panic backstop** (out of band from the agent): a kill-switch that resets `fx_switch` to index 0 and freezes the queue — the manual override over auto-switch.

---

## 6. Gallery lifecycle, failure & abuse handling

**Gallery lifecycle (containers accumulate):**

- Cap the gallery at **N effects** (default **12**). On overflow, recycle the **oldest non-live** effect (LRU): delete its COMP, free its `fx_switch` index, remove its `fx_registry` row. **Never recycle the currently-live index.**
- Index 0 is the reserved safe/idle effect (boot default + panic target).
- Naming `effects/fx_<id>` keeps registry/comp/queue correlated for debugging.

**Failure & abuse handling:**

- **Agent failure / timeout / verify-fail** → discard the half-built COMP (delete its subtree), `status=failed` to the requester with a short retry hint; switch untouched; queue advances. (The checkpoint is the safety net if a discard ever leaves cruft.)
- **Prompt safety at intake** (before queueing): length cap, reject empty / duplicate-spam, and a lightweight content screen for abusive / off-topic requests → `error{code:"rejected"}`. Author strings sanitized + length-capped.
- **Rate-limit** per `clientId` and per connection (reuse the existing ratelimit pattern): e.g. 1 in-flight request + a short cooldown between submissions.
- **TD bridge down / unresponsive** → worker fails the job gracefully with a clear status; queue keeps draining (each job re-checks the bridge with a read-only call first, per the skill's core workflow).
- **Operator kill-switch** resets `fx_switch` → 0 and freezes the queue.

---

## 7. Testing strategy

- **Intake/queue (headless unit):** rate-limit, safety screen accept/reject, queue ordering, position reporting, overflow → busy, name sanitization.
- **Protocol/load:** fake-phone script driving concurrent requests to exercise serial draining + status fan-out.
- **Agent contract (mock TD):** a mock MCP/TD that pins the scaffold + register + switch sequence and the verify gates, so the worker's logic is tested without a live TD.
- **Manual on real TD:** scaffold-on-first-run, one copy-existing request, one build-new request, attribution overlay correctness, LRU recycle, panic backstop.

---

## Open items / next step

- Decide the package's directory name + location within this repo (e.g. `effects-on-demand/`) and whether it shares `package.json` / tooling with the existing app or stands fully alone.
- Confirm Z.AI GLM model id + Agent-SDK wiring (`ANTHROPIC_BASE_URL`, auth) and how the TD-MCP server is launched for the worker.
- Pin the exact scaffold script for the TD contract (`effects/`, `fx_switch`, `fx_registry`, index-0 safe effect, attribution overlay).
- Then: write the **implementation plan** (matching `2026-06-18-touchdesigner-mobile-control.md`).
