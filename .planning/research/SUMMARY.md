# SUMMARY.md — gons-works Research Synthesis

## Critical Research Corrections

Five findings from research contradict claims in DESIGN.md and must be locked before roadmap planning. Any phase plan that contradicts these is invalid.

| # | Incorrect Claim (Source) | Correction | Impact |
|---|--------------------------|------------|--------|
| 1 | "Claude Haiku embedding 사용" (DESIGN.md Issue #10) | Anthropic has no embedding endpoint. Use **Voyage AI `voyage-4-lite`** via `voyageai@0.2.1`. | Phase 1 RAG implementation changes entirely. |
| 2 | "dockerode for container control" (implicit in DESIGN.md) | dockerode cannot use Docker named contexts (`dserver`). Use `Bun.$ \`docker --context dserver ...\`` for all remote control. | Phase 1 tool implementation approach. |
| 3 | `zod-to-json-schema` for tool schemas (assumed pattern) | Broken with Zod v4. Use `z.toJSONSchema(schema)` — built into Zod v4 as a top-level function. | Tool schema generation in Phase 1 agent loop. |
| 4 | htmx 2.x includes SSE natively (assumed) | SSE was removed from htmx 2.x core. Requires `htmx-ext-sse@2.2.4` loaded separately. | Phase 1 UI streaming setup. |
| 5 | "5-key approval gate is standard UX" (implied by brief mention) | `y/n/e/d/a` is a custom UX with no pre-trained muscle memory. **Must display inline legend** on every approval prompt. | Phase 2 UI DX — legend is not optional. |

---

## Stack Lockdown

All packages pinned. No alternatives. Deviations require explicit re-research.

| Package | Version | Role | Why Not X |
|---------|---------|------|-----------|
| `bun` | 1.2+ | Runtime, shell, SQLite, test runner | No Node overhead; native `Bun.$`, `bun:sqlite`, built-in test runner |
| `hono` | 4.x | HTTP + SSE | Lightweight; `hono/streaming` `streamSSE` works in Bun |
| `@anthropic-ai/sdk` | 0.93.0 | LLM streaming | `messages.stream()` + `for await` over events |
| `voyageai` | 0.2.1 | Embeddings | Only viable option; Claude API has no embedding endpoint |
| `diff` (jsdiff) | 9.0.0 | Unified diff for proposePatch | `createPatch()` + `parsePatch()` tested in Bun |
| `zod` | 4.x | Validation + tool schemas | `z.toJSONSchema()` built-in; v4 is breaking-different from v3 |
| htmx | 2.x (CDN) | UI reactivity | No build step; SSE via extension only |
| `htmx-ext-sse` | 2.2.4 | SSE in htmx 2.x | SSE removed from htmx core in 2.x; this is the only restore path |
| `bun:sqlite` | built-in | State + conversation history | Native, no `better-sqlite3`; open with `{ strict: true, safeIntegers: true }` |

**LLM model split (env-var controlled):**
- `COPILOT_MODEL_READONLY` = `claude-sonnet-4-6` (Phase 1 read-only queries)
- `COPILOT_MODEL_PROPOSE` = `claude-opus-4-7` (Phase 2 propose/apply)

---

## Phase Mapping

### Phase 0 — Bootstrap (1-2h)

**Objective:** Generate `services.yaml` draft from live `docker ps` output. Protect Phase 1 time budget.

| Feature | Pitfalls Guarded | Notes |
|---------|-----------------|-------|
| Run `docker --context dserver ps --format json` | SSH timeout (HIGH) | Must verify context resolves before any other work |
| Parse container output → services.yaml scaffold | services.yaml drift (HIGH) | AI-generated draft, human review required |
| Commit initial services.yaml to state/ | Git fast-forward-only | First git commit in state/ directory |
| Run 5 spikes (see Phase 0 Spike List below) | All CRITICAL pitfalls blocked until spikes pass | Spikes are go/no-go gates |

**Build order:**
1. Verify `Bun.$ \`docker --context dserver ps\`` produces parseable JSON
2. Verify `voyageai@0.2.1` + `voyage-4-lite` embedding roundtrip works
3. Verify `Bun.$ \`git commit\`` in `state/` produces correct commit with body
4. Verify `streamSSE` → htmx-ext-sse roundtrip delivers chunks without duplication
5. Verify `z.toJSONSchema()` produces valid Claude tool_use input_schema

**Checkpoint:** All 5 spikes green. `services.yaml` committed. Phase 1 unblocked.

---

### Phase 1 — Read-Only Knowledge Layer (8h)

**Objective:** AI answers operator questions about live environment using services.yaml knowledge + live docker state.

| Feature | Pitfalls Guarded | Notes |
|---------|-----------------|-------|
| services.yaml knowledge layer (RAG) | RAG recall degradation (MEDIUM) | Voyage AI embeddings; chunk size 512 tokens |
| Read-only queries: `listContainers`, `readLogs`, `readCompose` | DOCKER_CONTEXT per-call drift (HIGH) | Context must be set in each `Bun.$` call, not env |
| Live log query with 200-line cap | Log injection (CRITICAL) | Sanitize: drop SECRET/KEY/PASSWORD lines before indexing |
| `agent/loop.ts` tool-use loop | Orphaned tool_use blocks (CRITICAL), cost runaway (CRITICAL) | Hard caps: 8 tool iterations/loop, 30 API calls/session |
| Streaming SSE UI | SSE reconnect duplicates (CRITICAL) | Use named SSE event IDs; htmx-ext-sse 2.2.4 required |
| Error envelope `{ problem, cause, fix, retryable }` | Per-session error shapes (anti-pattern) | All tool wrappers use `tools/_envelope.ts` |
| services.yaml staleness detection | services.yaml drift (HIGH) | `docker ps` diff vs yaml; show header warning |
| History compaction | Conversation cost runaway (CRITICAL) | 50K token threshold; keep system + last 6 exchanges |

**Build order:**
1. `tools/_envelope.ts` — error envelope shape (all tools depend on this)
2. `lib/sse.ts` — SSE event emitter abstraction (UI depends on this)
3. `agent/loop.ts` — tool-use loop with hard caps (core agent logic)
4. `tools/docker.ts` — `listContainers`, `readLogs`, `readCompose` using `Bun.$`
5. `lib/rag.ts` — Voyage AI embed + cosine search over services.yaml chunks
6. `routes/chat.ts` — Hono SSE endpoint wiring loop → SSE events
7. `public/index.html` — htmx 2.x + htmx-ext-sse SSE consumer
8. `state/` init — empty git repo with WAL-mode SQLite

**Checkpoint:** `curl` query returns streaming answer about live container state. `git log state/` shows conversation history.

---

### Phase 2 — Propose/Apply with Approval Gate (8h)

**Objective:** AI can propose Docker Compose changes; operator approves via 5-key gate; change is applied atomically with rollback.

| Feature | Pitfalls Guarded | Notes |
|---------|-----------------|-------|
| `proposePatch` → unified diff display | Commit message injection (HIGH) | Sanitize AI-generated commit message body |
| Approval gate state machine `proposed → applying → applied/rejected/edited/rolled-back` | Approval-gate race condition (CRITICAL) | Nonce per proposal, 2-min expiry, `consumed` flag set atomically |
| `applyPatch` 2-phase commit: docker exec BEFORE git commit | applyPatch non-atomicity (CRITICAL) | Git commit only after docker confirm; rollback on failure |
| 5-key UX `y/n/e/d/a` with inline legend | 5-key is custom UX (CRITICAL correction) | Legend required on every approval prompt |
| Rollback path on failure | applyPatch non-atomicity (CRITICAL) | Stash diff before apply; restore on docker failure |
| Opus 4.7 for propose/apply | Cost runaway (CRITICAL) | Hard cap: 30 API calls/session; model via env var |

**Build order:**
1. `state/db.ts` — SQLite with `{ strict: true, safeIntegers: true }` + WAL pragma (approval nonce store)
2. `tools/patch.ts` — `proposePatch` + `applyPatch` with 2PC logic
3. `agent/approval.ts` — nonce generation, expiry, consumed-flag atomic set
4. Route: `POST /approve/:nonce` — approval gate endpoint
5. UI: approval card with inline legend `y=apply, n=reject, e=edit, d=diff, a=abort`
6. `lib/git.ts` — `Bun.$` git wrapper for state/ commits with body

**Checkpoint:** `proposePatch` → diff displayed → `y` → docker change applied → `git log state/` shows commit with AI reasoning body.

---

## Phase 0 Spike List

Risk-ordered. All spikes must pass before Phase 1 implementation begins.

| Priority | Spike | Pass Criterion | Failure Path |
|----------|-------|----------------|--------------|
| 1 | `Bun.$ \`docker --context dserver ps --format json\`` | Parses to container array without error | All remote tool use blocked; investigate SSH/context setup |
| 2 | Voyage AI `voyage-4-lite` embed roundtrip | Vector returned; cosine search returns correct chunk | Switch to local embedding model (Ollama `nomic-embed`); re-research |
| 3 | `streamSSE` → htmx-ext-sse chunk delivery | Browser receives `text-delta` events in real-time | Debug SSE event name mismatch; check `Content-Type: text/event-stream` header |
| 4 | `Bun.$ \`git commit -m "msg" --allow-empty\`` in `state/` | Commit appears in `git log` with full body | Investigate git config in Bun shell environment |
| 5 | `z.toJSONSchema(schema)` Zod v4 | Output matches Claude `input_schema` shape | Zod v3 fallback only if forced; document schema manually |

**Note on Spike 1:** The research discarded dockerode (cannot use named contexts). Spike 1 is not "does dockerode work" — it is "does `Bun.$` + `--context dserver` resolve the remote Docker daemon reliably in the Bun shell environment."

---

## Differentiators

Exactly 2. Both are absent in all surveyed competitors (Portainer, Dockge, Dozzle, k8sgpt, HolmesGPT, homelab-agent, Komodo).

| Differentiator | Description | Absent In |
|----------------|-------------|-----------|
| Environment-specific knowledge layer | `services.yaml` encodes domain knowledge (service roles, dependencies, ports, ownership). AI answers questions using this context + live state. Generic tools cannot know "ais-prod redis serves the whisper worker cache." | All competitors (generic by design) |
| Action-as-git-commit with AI reasoning | Every tool invocation (read or write) produces a `state/` git commit. Commit body contains user prompt + AI reasoning. `git log` is simultaneously the audit trail, incident log, and reproduction guide. | All competitors (no per-action attribution) |

---

## Anti-Features Confirmed

Do not build these. Any requirement that implies them is out of scope by PROJECT.md contract.

| Anti-Feature | Reason |
|--------------|--------|
| Metrics/graphs dashboard | Beszel covers this; not the differentiation axis |
| Multi-user / RBAC | 1-person tool; SaaS generalization is anti-goal |
| OAuth / magic link | Single operator, no authentication needed |
| k8s / multi-host | 192.168.0.5 single-host only |
| Alerts / notification system | Not in Phase 1-2 scope |
| Time-series DB (Postgres TSDB) | SQLite is sufficient for state; TSDB is a different product |
| OpenWebUI LLM pipeline | Claude API direct; OpenWebUI is a fallback option for v2+ |
| Postgres (Phase 1-2) | SQLite starts; Postgres migration is Phase 2.5+ if needed |
| React / Next.js / FSD frontend | htmx + plain HTML per PROJECT.md constraints |

---

## Build Order Spine

The dependency graph that determines what must exist before what can be built.

```
_envelope.ts              (no deps — define error shape first)
    └── lib/sse.ts        (SSE emitter abstraction)
    └── tools/docker.ts   (all tools use envelope)
    └── tools/patch.ts    (all tools use envelope)

lib/rag.ts                (depends on: voyageai@0.2.1 spike passing)
    └── routes/chat.ts    (depends on: loop.ts + sse.ts + rag.ts)

agent/loop.ts             (depends on: all tools registered)
    └── routes/chat.ts

state/db.ts               (depends on: bun:sqlite + WAL config)
    └── agent/approval.ts (depends on: db.ts for nonce store)
    └── lib/git.ts        (depends on: Bun.$ git spike passing)

public/index.html         (depends on: htmx-ext-sse spike passing)
```

**Invariant:** `_envelope.ts` is the very first file written. No tool wrapper exists without it.

---

## Failure-Mode-to-Component Mapping

Ported from ARCHITECTURE.md. Each failure mode has an owner component.

| Failure Mode | Detection | Owner Component | Mitigation |
|--------------|-----------|-----------------|------------|
| Orphaned `tool_use` block | Response has `tool_use` block with no matching `tool_result` | `agent/loop.ts` | Always pair every `tool_use` with `tool_result` before next API call |
| applyPatch non-atomicity | Docker apply succeeds, git commit fails (or vice versa) | `tools/patch.ts` | 2-phase commit: docker first, git second; rollback on failure |
| Approval-gate race condition | Two requests consume same nonce | `agent/approval.ts` + `state/db.ts` | `consumed` flag set atomically in SQLite; 2-min expiry |
| SSE reconnect duplicate calls | htmx reconnects SSE → duplicate tool-use loop invocations | `lib/sse.ts` + `routes/chat.ts` | Named SSE event IDs; idempotency token per conversation turn |
| Conversation cost runaway | Token count / API call count exceeds budget | `agent/loop.ts` | Hard cap: 8 tool iterations/loop, 30 calls/session; history compaction at 50K tokens |
| Log injection / secret leakage | Container log contains SECRET/KEY/PASSWORD lines | `tools/docker.ts` | Sanitize before RAG indexing; drop injection-marker chunks entirely |
| dockerode Bun socket compat | (Already resolved — use `Bun.$` instead) | N/A | Use `Bun.$ \`docker --context ...\`` exclusively |
| DOCKER_CONTEXT per-call drift | Context env var not set per-call → wrong host | `tools/docker.ts` | Pass `--context` flag in every `Bun.$` docker call; never rely on env |
| Commit message injection | AI-generated commit body contains shell metacharacters | `lib/git.ts` | Sanitize commit message body; use `--` separator; no shell interpolation of AI output |
| services.yaml drift | `docker ps` shows containers not in services.yaml | `lib/staleness.ts` | Compare at startup; show header warning in UI |

---

## Cost Ceilings

| Resource | Estimated Cost | Hard Cap |
|----------|---------------|----------|
| Voyage AI embeddings (one-time index) | ~$0.0004 | $1 limit in Voyage dashboard |
| Sonnet 4.6 per turn (Phase 1) | ~$0.003 | 30 API calls/session |
| Opus 4.7 per turn (Phase 2) | ~$0.045 | 30 API calls/session |
| Monthly total (normal use) | < $5/mo | $20/mo alert threshold |
| Phase 0-2 build cost (dogfood) | ~$2-3 | No hard cap on build sessions |

**Hard caps in code:**
- `agent/loop.ts`: `MAX_TOOL_ITERATIONS = 8` per loop
- `agent/loop.ts`: `MAX_API_CALLS_PER_SESSION = 30`
- History compaction triggers at 50K tokens (keep system + last 6 exchanges)

---

## Executive Summary

gons-works is a single-operator AI copilot for a home server running 6-10 Docker Compose stacks. The product's differentiation is not control surface (Portainer does that) but **memory**: the AI holds environment-specific knowledge via a services.yaml RAG layer, and every action it takes becomes a git commit with the user prompt and AI reasoning in the body. `git log` doubles as the audit trail, incident timeline, and reproduction guide — something no generic tool provides because generic tools cannot hold domain-specific context by design.

The recommended approach is to build in three phases totaling ≤18 hours. Phase 0 (1-2h) runs five go/no-go spikes and generates the initial services.yaml from live `docker ps` output — this protects Phase 1's time budget and front-loads the highest-risk technical unknowns. Phase 1 (8h) delivers the read-only knowledge layer: the operator can ask natural-language questions about live container state and get answers grounded in both services.yaml and real-time docker data, with full SSE streaming. Phase 2 (8h) adds the propose/apply loop with an atomic 2-phase commit and a 5-key approval gate — every change is git-committed with AI reasoning before and after execution.

The key risks are all implementation-level, not conceptual. Five research corrections must be locked before any code is written: Claude has no embedding endpoint (use Voyage AI), dockerode cannot use named Docker contexts (use `Bun.$` shell), Zod v4 broke `zod-to-json-schema` (use `z.toJSONSchema()` built-in), htmx 2.x dropped native SSE (use `htmx-ext-sse@2.2.4`), and the 5-key approval UX has no pre-trained muscle memory (inline legend is mandatory, not optional). Six CRITICAL pitfalls exist — all are addressable at the architecture level if the build order is followed: `_envelope.ts` first, then `lib/sse.ts`, then `agent/loop.ts`, then tools on top.

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Stack | HIGH | All packages version-pinned with rationale; incompatibilities identified and resolved in STACK.md |
| Features | HIGH | Competitive baseline surveyed; differentiators verified absent in all 7 competitors |
| Architecture | HIGH | Component boundaries, file paths, build order, and failure modes all specified in ARCHITECTURE.md |
| Pitfalls | HIGH | 16 pitfalls documented across 3 severity levels with prevention strategies and phase assignments |
| Timeline | MEDIUM | 18h budget is tight; Phase 0 spikes are the only real unknown. If Spike 1 (Bun.$ docker context) fails, Phase 1 tool implementation needs re-architecture. |

**Gaps to address during planning:**
- `state/` directory: same repo vs. git submodule. PROJECT.md says same repo for Phase 1; document submodule migration path for Phase 2+ in roadmap.
- SSH connectivity test: Phase 0 Spike 1 assumes `dserver` context already resolves from 192.168.0.8. If it doesn't, SSH config must be established before any Phase 0 work.
- Voyage AI account: requires API key. Document in `.env.example` before Phase 0.

---

## Research Flags

| Phase | Needs `/gsd-research-phase`? | Reason |
|-------|------------------------------|--------|
| Phase 0 | No | Spikes are defined precisely; execute, don't research |
| Phase 1 | No (with caveat) | All patterns well-documented. Only exception: if Voyage AI spike fails, re-research local embedding alternatives |
| Phase 2 | No | 2PC + approval gate patterns fully specified in PITFALLS.md and ARCHITECTURE.md |

---

## Roadmap Implications

Suggested phases: 3

1. **Phase 0 — Bootstrap & Spikes** — Run 5 go/no-go probes in 1-2h to derisk every CRITICAL pitfall before Phase 1 starts; generate services.yaml from live `docker ps`
2. **Phase 1 — Read-Only Knowledge Layer** — Build `_envelope.ts → sse.ts → loop.ts → docker tools → RAG → chat route → htmx UI` in dependency order; deliver streaming Q&A grounded in services.yaml + live docker state
3. **Phase 2 — Propose/Apply with Approval Gate** — Add 2PC patch workflow, atomic nonce-based approval gate, and Opus 4.7 model split; complete the audit-trail flywheel

---

## Sources

| Source | Type | Key Contributions |
|--------|------|------------------|
| `@anthropic-ai/sdk` changelog 0.93.0 | Primary | `messages.stream()` API, `for await` event iteration |
| Voyage AI docs (`voyageai@0.2.1`) | Primary | Confirmed no Anthropic embedding endpoint; `voyage-4-lite` model name |
| htmx 2.x release notes + `htmx-ext-sse` README | Primary | SSE removal from core; `htmx-ext-sse@2.2.4` restore path |
| Zod v4 changelog | Primary | `z.toJSONSchema()` built-in; `zod-to-json-schema` breakage |
| Docker CLI docs (`--context` flag) | Primary | Named contexts not available to dockerode; `Bun.$` pattern |
| Hono docs (`hono/streaming`) | Primary | `streamSSE` Bun compatibility |
| `bun:sqlite` docs | Primary | `{ strict: true, safeIntegers: true }` requirement, WAL pragma |
| Portainer/Dockge/Dozzle/k8sgpt/HolmesGPT/homelab-agent/Komodo | Comparative | Feature gap analysis; confirmed differentiators absent |
| PROJECT.md + DESIGN.md | Project | Phase structure, constraints, out-of-scope items, failure mode registry |
