# Architecture Research

**Domain:** Single-host Bun+Hono+SSE AI operator copilot with knowledge RAG, remote Docker control, and git audit trail
**Researched:** 2026-05-06
**Confidence:** HIGH (derived directly from DESIGN.md + PROJECT.md + autoplan review output)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                  192.168.0.8  (Bun runtime)                     │
│                                                                 │
│  public/index.html (htmx)                                       │
│       │  SSE stream (named events)                              │
│       │  POST /chat, POST /approval/:id                         │
│       ▼                                                         │
│  server.ts (Hono)                                               │
│       │  thin SSE pump                                          │
│       ▼                                                         │
│  agent/loop.ts  ──────────────────────────►  Claude API         │
│       │  drives tool-use loop                  (model env-var)  │
│       │                                                         │
│  agent/sse.ts   ◄──── named event emitter                       │
│       │  text-delta / tool-start / tool-result                  │
│       │  approval-required / final / error                      │
│       │                                                         │
│  tools/                                                         │
│  ├── _envelope.ts  ← shared try-catch + timeout wrapper         │
│  ├── _index.ts     ← barrel + JSON schema for Claude            │
│  ├── listContainers.ts                                          │
│  ├── readLogs.ts   ← includes sanitizer                         │
│  ├── readCompose.ts                                             │
│  ├── proposePatch.ts                                            │
│  └── applyPatch.ts ← 2-phase commit orchestrator               │
│       │                                                         │
│  kb/                                                            │
│  ├── services.yaml  ← domain knowledge (Phase 0: AI draft)      │
│  ├── stale-check.ts ← docker ps vs yaml semantic diff           │
│  └── index.ts       ← Haiku embeddings → SQLite FTS             │
│                                                                 │
│  state/             ← git-versioned AI intent log               │
│  ├── actions/       ← one .md per committed action              │
│  └── snapshots/     ← docker ps output at commit time           │
│                                                                 │
│  approval/          (in-memory, see §6)                         │
│  └── store.ts       ← Map<approvalId, ApprovalState>            │
│                                                                 │
└─────────────────────────────┬───────────────────────────────────┘
                              │  SSH / docker context "dserver"
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              192.168.0.5  (managed services)                    │
│  news-prod / ais-prod / voice / krdn-fx / n8n / open-webui …   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | File(s) | Responsibility | Communicates With |
|-----------|---------|----------------|-------------------|
| Hono server | `server.ts` | Route registration, SSE stream lifecycle, startup probes | `agent/loop.ts`, `approval/store.ts` |
| SSE serializer | `agent/sse.ts` | Named-event type definitions, framing helpers | `server.ts`, `agent/loop.ts` |
| Tool-use loop | `agent/loop.ts` | Send → Claude, parse tool_use blocks, dispatch, append tool_result, repeat until end_turn | `agent/sse.ts`, `tools/`, Claude API |
| Error envelope | `tools/_envelope.ts` | Wrap every tool in 30s AbortController + try-catch → `{ problem, cause, fix, retryable }` | All tools import this |
| Tool schema barrel | `tools/_index.ts` | Export array of JSON Schema tool definitions for Claude API call | `agent/loop.ts` |
| listContainers | `tools/listContainers.ts` | `docker --context dserver ps --format json` → parsed list | `_envelope.ts` |
| readLogs | `tools/readLogs.ts` | `docker --context dserver logs` + sanitizer (SECRET/KEY/PASSWORD regex) | `_envelope.ts` |
| readCompose | `tools/readCompose.ts` | SSH cat of compose file on 192.168.0.5 | `_envelope.ts` |
| proposePatch | `tools/proposePatch.ts` | Generate unified diff, store in `state/pending/`, emit `approval-required` SSE | `_envelope.ts`, `approval/store.ts`, `agent/sse.ts` |
| applyPatch | `tools/applyPatch.ts` | 2-phase commit orchestrator (git first, docker exec second, rollback on failure) | `_envelope.ts`, `state/commit.ts` |
| KB index | `kb/index.ts` | Claude Haiku embeddings → SQLite FTS; top-k retrieval for RAG context injection | `agent/loop.ts` |
| Staleness check | `kb/stale-check.ts` | Semantic diff: docker ps output vs services.yaml; three-bucket result | `server.ts` (boot + per-query) |
| State writer | `state/commit.ts` | Git commit with sanitized message (newline strip, 200-char cap), fast-forward only pre-commit hook | `applyPatch.ts` |
| Approval store | `approval/store.ts` | In-memory Map, state machine: proposed → approved/rejected/edited/aborted → applying → applied/rolled-back | `proposePatch.ts`, `server.ts` |
| htmx UI | `public/index.html` | One-line prompt input, SSE `sse-swap` for each named event, 5-key approval form | Browser; no server rendering |

---

## Recommended Project Structure

```
gons-works/
├── server.ts               # Hono app: route /chat (SSE), /approval/:id (POST), startup probes
├── agent/
│   ├── loop.ts             # Tool-use loop: send → parse → dispatch → repeat
│   └── sse.ts              # Named SSE event types + framing (text-delta, tool-start, etc.)
├── tools/
│   ├── _envelope.ts        # Shared wrapper: 30s timeout + try-catch → { problem, cause, fix, retryable }
│   ├── _index.ts           # Tool schema barrel (JSON Schema array for Claude API)
│   ├── listContainers.ts   # docker --context dserver ps
│   ├── readLogs.ts         # docker logs + SECRET/KEY/PASSWORD sanitizer
│   ├── readCompose.ts      # ssh cat compose file
│   ├── proposePatch.ts     # unified diff → state/pending/ → approval-required SSE
│   └── applyPatch.ts       # 2PC: git commit → docker exec → rollback
├── kb/
│   ├── services.yaml       # Domain knowledge (Phase 0: AI draft; Phase 1+: manual edits)
│   ├── stale-check.ts      # Semantic drift detection: docker ps vs yaml
│   └── index.ts            # Haiku embeddings → SQLite FTS → top-k retrieval
├── state/                  # git-versioned AI intent log (same repo, first milestone)
│   ├── actions/            # One .md per committed action
│   ├── snapshots/          # docker ps at commit time
│   └── pending/            # Uncommitted diffs awaiting approval (ephemeral)
├── approval/
│   └── store.ts            # In-memory ApprovalState machine
├── public/
│   └── index.html          # htmx UI: prompt input + SSE stream + 5-key approval
└── package.json
```

### Structure Rationale

- **`agent/` separated from `server.ts`:** The tool-use loop is the most complex and testable piece. Burying it in the route handler makes unit tests painful. `loop.ts` takes `(prompt, emit)` — pure async function, no HTTP knowledge.
- **`tools/_envelope.ts` as separate file:** Every tool imports this. If the shape changes (e.g., adding `retryable`), only one file changes.
- **One file per tool:** Five tools, each ~60-100 LOC. One-file-per-tool makes Phase 1→2 additions (proposePatch, applyPatch) add files, not bloat existing ones.
- **`kb/` separate from `tools/`:** Knowledge retrieval is a distinct concern from tool execution. stale-check.ts runs at boot and per-query independently of any tool call.
- **`state/` in same repo (Phase 0-2):** Per Key Decision in PROJECT.md — simplest first. Submodule extraction is Phase 2.5 option.
- **`approval/store.ts` in-memory:** Single user, single process. SQLite upgrade path if restart-durability becomes needed.

---

## Architectural Patterns

### Pattern 1: Named SSE Events

**What:** Each observable step in the tool-use loop emits a distinct SSE event type (`event:` field), not just data blobs.

**When to use:** Any time the UI needs to react differently to tool start vs tool result vs approval gate.

**Trade-offs:** Slightly more complex htmx `sse-swap` selectors vs. opaque text streaming. Worth it because the approval gate UI cannot appear from a raw text event.

**SSE event taxonomy:**

```typescript
// agent/sse.ts
export type SseEvent =
  | { type: 'text-delta';       delta: string }
  | { type: 'tool-start';       name: string; args: unknown }
  | { type: 'tool-result';      name: string; ok: boolean; summary: string }
  | { type: 'approval-required'; id: string; diff: string }
  | { type: 'final' }
  | { type: 'error';            problem: string; cause: string; fix: string }

export function emit(res: Response, ev: SseEvent): void {
  // write `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`
}
```

### Pattern 2: Error Envelope at Tool Boundary

**What:** `_envelope.ts` wraps every tool execution. The wrapper owns the AbortController (30s), the try-catch, and the `{ problem, cause, fix, retryable }` shape.

**When to use:** Every tool — no exceptions. Tool implementation throws; wrapper catches.

**Trade-offs:** Extra indirection, but critical for system-prompt contract. Claude must be told: "if `retryable: false` or `fix` contains user-action language, surface verbatim and stop."

```typescript
// tools/_envelope.ts
export interface ToolError {
  problem: string   // what failed
  cause: string     // why (stack-safe excerpt)
  fix: string       // "retry" | "check SSH" | "user-action: ..."
  retryable: boolean
}

export async function run<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 30_000
): Promise<T | ToolError> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fn(ac.signal)
  } catch (err) {
    return toEnvelope(err)
  } finally {
    clearTimeout(timer)
  }
}
```

### Pattern 3: Tool-Use Loop as Separate Module

**What:** `agent/loop.ts` exports `async function iterate(prompt: string, emit: EmitFn): Promise<void>`. It owns the Claude API call, parses `content` blocks, dispatches tool calls, appends `tool_result` blocks, and loops until `stop_reason === 'end_turn'`.

**When to use:** All chat requests go through this.

**Trade-offs:** Adds one function call layer vs. inline handler. Worth it — `loop.ts` can be unit-tested with a mock Claude client and a mock `emit`.

```typescript
// agent/loop.ts (skeleton)
export async function iterate(
  prompt: string,
  context: string,      // RAG-retrieved kb context
  emit: (ev: SseEvent) => void
): Promise<void> {
  const messages: Message[] = [{ role: 'user', content: prompt }]
  while (true) {
    const response = await claude.messages.create({ messages, tools: toolSchemas })
    for (const block of response.content) {
      if (block.type === 'text') emit({ type: 'text-delta', delta: block.text })
      if (block.type === 'tool_use') {
        emit({ type: 'tool-start', name: block.name, args: block.input })
        const result = await dispatch(block.name, block.input)
        emit({ type: 'tool-result', name: block.name, ok: !isError(result), summary: summarize(result) })
        messages.push({ role: 'assistant', content: response.content })
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) }] })
      }
    }
    if (response.stop_reason === 'end_turn') break
  }
  emit({ type: 'final' })
}
```

### Pattern 4: 2-Phase Commit for applyPatch

**What:** `applyPatch.ts` commits to `state/` first (cheap, reversible), then runs the docker exec command. If docker fails, it runs `git revert <sha>` (preserves history, does not reset). If git fails, it aborts before any docker action.

**When to use:** Every write action that modifies running Docker state.

**Known crash window:** If the process dies between git commit and docker exec, the next startup will find HEAD message with `applied: pending` marker. Recovery procedure: on boot, `state/commit.ts` checks for pending marker and emits a warning banner.

```
applyPatch flow:
  1. validate diff (dry-run check)
        │ FAIL → ToolError { fix: "diff invalid", retryable: false }
        ▼
  2. git commit state/ with sanitized message
        │ FAIL → ToolError { fix: "git commit failed — resolve manually", retryable: false }
        ▼
  3. docker exec on 192.168.0.5 via dserver context
        │ FAIL → git revert <commitSha> + emit rolled-back SSE
        │          ToolError { fix: "docker exec failed, state rolled back to <prev-sha>", retryable: false }
        ▼
  4. emit applied SSE with commit SHA
```

---

## Data Flow

### Primary Request Flow (Read-only, Phase 1)

```
Browser (htmx POST /chat)
    │
    ▼
server.ts  — opens SSE stream
    │
    ├─► kb/stale-check.ts  ─── runs async, may prepend warning banner via SSE
    │
    ├─► kb/index.ts  ──────── top-k retrieval on prompt → RAG context string
    │
    ▼
agent/loop.ts  iterate(prompt, ragContext, emit)
    │
    ├─► Claude API (messages.create with tools)
    │       │  stop_reason: tool_use
    │       ▼
    │   emit(tool-start)
    │       │
    │       ▼
    │   tools/listContainers | readLogs | readCompose
    │       │  via _envelope.ts (30s timeout)
    │       │  via SSH / docker --context dserver
    │       ▼
    │   emit(tool-result)
    │       │
    │       ▼
    │   Claude API (messages.create with tool_result appended)
    │       │  stop_reason: end_turn
    │       ▼
    │   emit(text-delta...)  emit(final)
    │
    ▼
server.ts  — closes SSE stream
    │
    ▼
Browser  — htmx sse-swap renders response
```

### Write Flow with Approval Gate (Phase 2)

```
Browser POST /chat ("krdn-fx 중지해줘")
    │
    ▼
agent/loop.ts  — Claude calls proposePatch
    │
    ▼
tools/proposePatch.ts
    ├── generate unified diff
    ├── write to state/pending/<id>.diff
    ├── approval/store.ts.set(id, { state: 'proposed', diff })
    └── emit(approval-required { id, diff })
    │
    ▼
Browser  — htmx renders 5-key approval form
    │
    (user presses y / n / e / d / a)
    │
    ▼
Browser POST /approval/:id  { key: 'y' }
    │
    ▼
server.ts  — approval/store.ts.transition(id, 'approved')
    │
    ▼
tools/applyPatch.ts  (2PC, see Pattern 4 above)
    ├── git commit state/                ← Phase 1 of 2PC
    └── docker exec on 192.168.0.5       ← Phase 2 of 2PC
    │
    ├─ SUCCESS → emit(applied { sha }) + cleanup state/pending/<id>.diff
    └─ FAIL    → git revert → emit(rolled-back { reason }) + approval/store.ts.transition(id, 'rolled-back')
```

### State Divergence Model

`state/` is the **AI's intent log**, not a mirror of Docker reality. Docker is the source of truth for what is actually running.

```
state/snapshots/latest.json   ← "what AI last observed"
docker ps (live)              ← "what is actually running"
         │
         ▼
kb/stale-check.ts  semantic diff
    Three buckets:
    [1] yaml-only entry   → stale in knowledge base (service removed/renamed)
    [2] docker-only entry → unknown service (should be added to services.yaml)
    [3] both but fields differ → yaml content is stale

    Result: banner warning emitted via SSE before any response
    "services.yaml may be stale: 2 docker-only services found"
    Action affordance: "Ask AI to update services.yaml" button
```

Reconciliation is **detection only** (no auto-merge). Auto-merge would silently overwrite knowledge that may be intentional (e.g., a stopped service intentionally omitted from yaml).

---

## Approval Gate State Machine

```
                   ┌───────────────────────────────┐
                   │                               │
    proposePatch ──► proposed                       │
                   │                               │
                   │  y (approve)  ── applying ──► applied
                   │  n (reject)   ──────────────► rejected
                   │  e (edit)     ──────────────► [re-proposes]
                   │  d (diff)     ──────────────► [stay proposed, show diff again]
                   │  a (abort)    ──────────────► aborted
                   │                               │
                   │  [docker exec fails]  ────────► rolled-back
                   │                               │
                   └───────────────────────────────┘
```

**Storage:** In-memory `Map<string, ApprovalState>` in `approval/store.ts`. Rationale: single-user, single-process. A restarted server loses any pending proposals, which is acceptable — the user can re-request. SQLite upgrade path adds one migration; design is isolated enough to swap.

**htmx reads state:** Via SSE `approval-required` event (not polling). The form appears inline in the SSE stream. `POST /approval/:id` with `{ key }` body — Hono handler transitions the state machine and triggers applyPatch.

---

## services.yaml Lifecycle

```
Phase 0 (1-2h):
  AI receives docker ps + compose file list
  → generates services.yaml draft via Claude
  → user reviews, light edits
  → committed to repo

Phase 1 (8h):
  Manual edits based on queries
  stale-check.ts runs on boot and per-query
  Staleness = semantic diff (not mtime/hash)
  Warning banner if drift detected

Phase 2 (after MVP):
  Auto-sync trigger: "Ask AI to update services.yaml"
  AI calls listContainers + readCompose
  proposes services.yaml patch via proposePatch
  user approves → state/ commit

Phase 2.5 (future):
  Scheduled cron (n8n trigger or systemd timer)
  Auto-diff + PR for services.yaml changes
```

**Staleness detection algorithm (`kb/stale-check.ts`):**
1. Run `docker --context dserver ps --format json --all`
2. Parse container names → derive service identifiers
3. Load `services.yaml` → extract service keys
4. Set difference: `dockerSet - yamlSet` = docker-only (unknown to KB)
5. Set difference: `yamlSet - dockerSet` = yaml-only (stale entries)
6. For intersection: compare `image`, `ports`, `status` fields
7. Emit `StalenessReport { unknown: string[], stale: string[], drifted: string[] }`

---

## Scaling Considerations

This is a single-user personal tool. Scaling is not a goal. What breaks first if abused:

| Concern | At 1 user (target) | If abused |
|---------|---------------------|-----------|
| Claude API rate limit | Fine for conversational use | Exponential backoff in loop.ts catches 429 |
| SSE connection leak | Single connection, closes on final | 60s chunk timeout in sse.ts, finally-close |
| state/ repo growth | Negligible — text files | Periodic `git gc`; not automated |
| SQLite FTS size | Tiny (services.yaml is <5KB source) | N/A for MVP |
| In-memory approval store | Never more than 1-2 pending | If server restarts, pending proposals lost — acceptable |

---

## Anti-Patterns

### Anti-Pattern 1: Tool-use loop inside the route handler

**What people do:** Write the `while(true)` Claude API loop directly inside the `app.get('/chat', ...)` handler.

**Why it's wrong:** Impossible to unit test without HTTP. Any shared tool invocation state leaks through closure. SSE error handling tangles with Claude API error handling.

**Do this instead:** `agent/loop.ts` exports `iterate(prompt, context, emit)`. Route handler is a thin pump: open SSE → call `iterate` → close.

### Anti-Pattern 2: Treating `state/` as a Docker state mirror

**What people do:** After every `docker ps` call, update `state/snapshots/latest.json` to reflect live Docker state and treat it as the source of truth for "what's running."

**Why it's wrong:** `state/` is the AI's **intent log** — what it decided and committed. Real Docker state can diverge silently (someone ran `docker stop` manually, a container crashed, etc.). Pretending `state/` is the mirror hides these divergences.

**Do this instead:** `state/` records AI actions. Live docker state comes from `listContainers` on demand. `stale-check.ts` detects divergence and reports it. Never auto-merge without user approval.

### Anti-Pattern 3: Per-session error shape negotiation

**What people do:** Each tool returns its own error format. The loop.ts normalizes them ad-hoc before passing to Claude.

**Why it's wrong:** Every new tool adds a normalization case. Claude's system prompt cannot describe a consistent contract.

**Do this instead:** `_envelope.ts` is the single error factory. The system prompt references `{ problem, cause, fix, retryable }` by name. Claude is instructed to surface `fix` verbatim when `retryable: false`.

### Anti-Pattern 4: mtime/hash-based staleness detection

**What people do:** Compare `services.yaml` last-modified time or file hash against last `docker ps` timestamp.

**Why it's wrong:** A file edited 5 minutes ago may still be stale (if docker state changed in those 5 minutes). A file that hasn't changed may match docker reality perfectly. mtime and hash are file-system properties, not semantic properties.

**Do this instead:** Semantic diff — compare container names and key fields between live `docker ps` and parsed `services.yaml` on every meaningful query.

---

## Integration Points

### External Services

| Service | Integration Pattern | Timeout | Notes |
|---------|---------------------|---------|-------|
| Claude API | `@anthropic-ai/sdk` messages.create | 60s stream, 30s tool | Phase 1: Sonnet 4.6; Phase 2: Opus 4.7 (env var) |
| Docker (remote) | `docker --context dserver` subprocess | 30s AbortController | Startup probe: verify dserver context exists |
| SSH (192.168.0.5) | `ssh gon@192.168.0.5 cat ...` subprocess | 15s | Used by readCompose only; could migrate to docker exec |
| Git (state/) | `git commit`, `git revert` subprocess | 10s | fast-forward only, pre-commit hook enforced |
| SQLite | `bun:sqlite` native | sync | KB FTS + embeddings cache |

### Internal Boundaries

| Boundary | Communication | Contract |
|----------|---------------|----------|
| `server.ts` ↔ `agent/loop.ts` | Function call `iterate(prompt, context, emit)` | Loop is HTTP-agnostic; emit is the only coupling |
| `agent/loop.ts` ↔ `tools/*` | `dispatch(name, args)` → `ToolResult \| ToolError` | All tools return one of these two shapes |
| `tools/proposePatch.ts` ↔ `approval/store.ts` | Direct import | Proposal written to store; server.ts reads from store on POST /approval/:id |
| `kb/stale-check.ts` ↔ `server.ts` | Async call on boot; emits `StalenessReport` | Server decides whether to banner-warn based on report |
| `tools/applyPatch.ts` ↔ `state/commit.ts` | Function call | Commit returns `{ sha, timestamp }` or throws |

---

## Build Order Within Each Phase

### Phase 0 (1-2h: Skeleton + AI services.yaml draft)

```
1. package.json (Bun init, Hono, @anthropic-ai/sdk, bun:sqlite)
2. server.ts skeleton (Hono app, /health route, startup probe for DOCKER_CONTEXT)
3. agent/sse.ts (SseEvent types — nothing else compiles without these)
4. tools/_envelope.ts (run() wrapper — must exist before any tool)
5. tools/listContainers.ts (simplest tool — validates envelope + docker context)
6. agent/loop.ts (skeleton that calls Claude with one tool, no KB yet)
7. server.ts /chat route (wire loop → SSE — first end-to-end smoke test)
8. [Manual] Run "docker ps, give me services.yaml draft" via the chat UI
9. kb/services.yaml (commit AI draft after light review)
```

Checkpoint: `curl http://localhost:3000/chat` → SSE stream → "listContainers called…" → answer.

### Phase 1 (8h: Read-only tools + RAG + htmx)

```
1. tools/_index.ts (barrel + JSON Schema for all tools — needed before expanding loop)
2. tools/readLogs.ts (+ sanitizer regex — second concrete tool)
3. tools/readCompose.ts (third read tool)
4. kb/index.ts (Haiku embeddings → SQLite FTS)
5. kb/stale-check.ts (semantic diff + StalenessReport)
6. agent/loop.ts (full version: RAG context injection + stale warning SSE)
7. public/index.html (htmx: prompt input + SSE sse-swap targets per event type)
8. Integration test: mock Claude responses, verify SSE frame format
9. E2E smoke: "ais-prod redis 어디 쓰여?" → services.yaml + live docker response
```

Checkpoint: Full read-only session works end-to-end with real Claude API and live dserver.

### Phase 2 (8h: Write tools + approval gate + state-as-git)

```
1. approval/store.ts (ApprovalState machine — needed before proposePatch)
2. state/commit.ts (git wrapper with message sanitizer + pending-marker)
3. server.ts /approval/:id route (POST handler → state machine transition)
4. tools/proposePatch.ts (diff generation + approval-required SSE)
5. tools/applyPatch.ts (2PC orchestrator using state/commit.ts)
6. tools/_index.ts update (add proposePatch + applyPatch schemas)
7. public/index.html update (5-key approval form, htmx swap on approval-required event)
8. Unit test: approval state machine transitions (all 5 keys)
9. Unit test: 2PC rollback path (mock docker exec failure → git revert)
10. E2E on local test stack (192.168.0.8 test docker-compose, NOT prod)
```

Checkpoint: "test-svc 중지해줘" → diff → y → state/ commit + docker stop confirmed + `git log state/` shows entry.

---

## Failure Mode Registry — Architecture Mapping

Each failure mode from DESIGN.md Failure Modes Registry mapped to the component that catches it:

| Failure Mode | Caught At | Propagates As |
|-------------|-----------|---------------|
| Claude API 429 (rate limit) | `agent/loop.ts` catch on messages.create | SSE `error` event; loop backoffs 30s and retries once, then surfaces |
| SSH timeout (readCompose) | `tools/_envelope.ts` AbortController 30s | ToolError `{ fix: "SSH 접속 실패 — 서버 상태 확인", retryable: false }` |
| applyPatch partial failure (docker exec) | `tools/applyPatch.ts` after Phase 2 of 2PC | SSE `rolled-back` event; git revert committed; ToolError surfaced |
| Git conflict in state/ | `state/commit.ts` pre-commit hook (FF only) | Commit rejected; ToolError `{ fix: "git conflict — manual resolution required", retryable: false }` |
| services.yaml drift | `kb/stale-check.ts` on boot + per-query | SSE `text-delta` warning banner prepended before response |
| Log prompt injection | `tools/readLogs.ts` sanitizer (SECRET/KEY/PASSWORD regex) | Lines removed before tool result returned to Claude |
| SSE leak on rate limit / long tool | `agent/sse.ts` 60s chunk timeout; `server.ts` finally-close | Stream closes gracefully; client sees connection close and can retry |
| Git commit message injection | `state/commit.ts` newline strip + 200-char cap | Silent truncation; commit proceeds with cleaned message |
| DOCKER_CONTEXT unset | `server.ts` startup probe | Server refuses to start; logs `FATAL: DOCKER_CONTEXT not set` |
| Crash between git commit and docker exec | `state/commit.ts` pending-marker + boot check | Next boot: banner "Uncommitted action detected at <sha> — verify manually" |

---

## Sources

- DESIGN.md (gons-works project design doc, 2026-05-05) — architectural decisions, phase plan, failure modes registry
- PROJECT.md (gons-works, 2026-05-06) — constraints, key decisions, out-of-scope
- Hono documentation — SSE handler patterns, Bun runtime compatibility
- Anthropic Claude API — tool_use message format, stop_reason semantics, messages.create streaming
- Bun sqlite docs — `bun:sqlite` synchronous API

---

*Architecture research for: Single-host Bun+Hono+SSE AI operator copilot*
*Researched: 2026-05-06*
