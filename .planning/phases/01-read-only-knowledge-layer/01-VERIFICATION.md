---
phase: 01-read-only-knowledge-layer
plan: 09
document: VERIFICATION
mode: documentation-only
date: 2026-05-07
basis: plans 01-01..01-07 SUMMARY.md (post-Wave-3 merge)
---

# Phase 1 Verification Report (Documentation-Only Snapshot)

**Date:** 2026-05-07
**Phase:** 01-read-only-knowledge-layer
**Coverage basis:** Plans 01-01 through 01-07 SUMMARY.md (Wave 1 + Wave 2 + Wave 3 merged into main)
**Mode:** Documentation-only (orchestrator override — live `bun run dev` / curl / drift simulation skipped)
**Reporter:** Plan 01-09 executor (parallel worktree, documentation slot)

## Scope Note

This document is the **documentation-only** verification produced by Plan 01-09 in the parallel
documentation slot. The orchestrator explicitly instructed to skip the live verification steps
specified in `01-09-PLAN.md` (live `bun run dev`, curl SSE smoke, services.yaml drift mutation,
SQLite SELECT inspection, hard-cap live spot check). Reasons:

- Plan 01-08 (frontend `public/index.html` + htmx-ext-sse wire) has **not yet been merged** —
  see `find .planning/phases/01-read-only-knowledge-layer -type f` output: no `01-08-SUMMARY.md`.
- The two ROADMAP Success Criteria that depend on browser/htmx UI (#1, #2 visible *streaming
  in the browser*) cannot be live-verified until 01-08 lands.
- This documentation-only snapshot provides the per-REQ-ID evidence trail extracted from the
  seven completed plan SUMMARY.md files plus the orchestrator-supplied test regression
  totals. A subsequent **live** Plan 01-09 run will retest after Plan 01-08 ships, replacing
  this snapshot.

The `2/22 PENDING` entries below are honest blockers, not failures.

## Test Regression — Phase 1 Wave 1+2+3 (orchestrator-supplied)

Aggregate `bun test` regression after the Wave 3 merge resolution:

| Metric | Count |
|--------|-------|
| Total tests | 157 |
| Passed | **153** (97%) |
| Skipped | **4** (E2E gated — `process.env.E2E !== "1"`) |
| Failed | **0** |

Per-plan breakdown (from each plan's SUMMARY.md):

| Plan | Subsystem | Test files | Tests pass | Skipped | Notes |
|------|-----------|------------|-----------:|--------:|-------|
| 01-01 | KB schema (Zod v4) | `kb/schema.test.ts` | 8 | 0 | services.yaml E2E parse + 5×4 slot non-empty |
| 01-02 | tools envelope + index | `tools/_envelope.test.ts`, `tools/_index.test.ts` | 18 | 0 | Note: `_envelope` count grows to 10 after 01-04 audit-hook wire |
| 01-03 | audit/log SQLite | `audit/log.test.ts` | 8 | 0 | Includes PITFALL #10 (strict-mode) live-verify test |
| 01-04 | 3 read tools + KB-04 | `tools/listContainers.test.ts`, `tools/readLogs.test.ts`, `tools/readCompose.test.ts`, `tools/_envelope.test.ts` (extended) | 23 | 2 | E2E skips: docker live `listContainers`, SSH live `readCompose` |
| 01-05 | KB chunker + Voyage index + stale-check | `kb/chunker.test.ts`, `kb/index.test.ts`, `kb/stale-check.test.ts` | 28 | 2 | E2E skips: `kb/index.test.ts` Voyage live calls |
| 01-06 | agent system-prompt + sse + loop | `agent/system-prompt.test.ts`, `agent/sse.test.ts`, `agent/loop.test.ts` | 31 | 0 | All mock-only (no live Anthropic call) |
| 01-07 | server + env hardening | `src/env.test.ts`, `src/server.test.ts`, `agent/sse.test.ts` (re-counted) | 28 | 0 | env subprocess tests added; sse re-resolved post-merge |
| **Total** | — | 19 files | **153** | **4** | Pre-existing Phase 0 spike tests (~10) included in regression |

Source: orchestrator post-Wave-3 merge regression report; matches per-plan SUMMARY counts (modulo Wave 3 merge dedup of `agent/sse.test.ts` between 01-06 and 01-07).

## REQ-ID Verification (22 Phase 1 requirements)

Mapping per ROADMAP.md Phase 1 `Requirements:` line and per-plan SUMMARY `requirements-completed:` frontmatter.

| # | REQ-ID | Status | Evidence (file + plan + test/grep) |
|---|--------|--------|------------------------------------|
| 1 | KB-01 | PASS | `state/services.yaml` 5 stack × 4 slots populated (Plan 01-01); `kb/schema.test.ts` E2E parse round-trip ALL PASS; `kb/index.ts ensureIndexed()` indexes 25 chunks via Voyage `voyage-4-lite` (Plan 01-05 live-verified once with chunkCount=25, top-1 sim=0.4944) |
| 2 | KB-02 | PASS | `kb/index.ts queryTopK(query, 5)` cosine top-k retrieval (Plan 01-05); 11 unit + 2 E2E tests pass; live spike returned 5 hits with semantically correct top-1 stack=ais\|news for "redis 어디 쓰여" |
| 3 | KB-03 | PASS | `kb/stale-check.ts staleCheck()` two-way Set diff between `docker ps` NDJSON and `services.yaml` stacks; 30 s TTL cache (D-13.4); 7 unit tests pass; `drifted: []` is the Phase 1 lock per `<key-decisions>` |
| 4 | KB-04 | PASS | `tools/readLogs.ts sanitizeLogs()` — INJECTION_MARKERS DROP + SENSITIVE_PATTERNS REDACT (API_KEY/PASSWORD/JWT/sk-prefix); 8 dedicated test cases ALL PASS (Plan 01-04) |
| 5 | READ-01 | PASS | `tools/listContainers.ts` — `Bun.$ docker --context ${env.DOCKER_CONTEXT} ps -a --format json` with application-layer state filter (PITFALL #8 mitigated, never `process.env`); 4 sanity unit tests + 1 E2E skip |
| 6 | READ-02 | PASS | `tools/readLogs.ts` — `containerName + lines (1-1000) + since/until` envelope-wrapped, sanitized output; 9 unit tests pass; lines max=1000 enforced at Zod layer (`tools/_index.ts ReadLogsInput`) |
| 7 | READ-03 | PASS | `tools/readCompose.ts` — `Bun.spawn` SSH cat with `ConnectTimeout=10 / ServerAliveInterval=5 / ServerAliveCountMax=2 / BatchMode=yes` (PITFALL #12 mitigated); 1 sanity test + 1 E2E skip |
| 8 | READ-04 | PASS | `agent/loop.ts iterate()` orchestrates `messages.create({ tools: TOOL_SCHEMAS })` → tool dispatch → result feedback (Plan 01-06); `src/server.ts /chat-stream` wires it with `staleCheck` + `queryTopK` + RAG context injection (Plan 01-07). Live NL-query smoke deferred to post-01-08 |
| 9 | READ-05 | PASS | Same as READ-04 — `iterate()` is generic over the tool set; `readLogs --since/--until` is reachable. Live NL "지난밤 새벽 1-3시 voice 에러" smoke deferred to post-01-08 |
| 10 | UI-01 | **PENDING — BLOCKED on 01-08** | `public/index.html` + htmx 2.x form + `htmx-ext-sse@2.2.4` wire is Plan 01-08 scope. `01-08-SUMMARY.md` does not exist on disk. `src/server.ts` route `GET /` returns a stub HTML if `public/index.html` is missing (Plan 01-07) — server side is ready, client side is not |
| 11 | UI-02 | PASS | `agent/sse.ts SseEvent` 6-type union (`text-delta` / `tool-start` / `tool-result` / `final` / `error` / `drift`) + `toSSEFrame(ev)` Hono-streamSSE-compatible encoder; 11 unit tests pass (Plan 01-06; re-verified Plan 01-07) |
| 12 | UI-03 | **PENDING — BLOCKED on 01-08** | "Each tool call visualized in stream (calling listContainers...)" requires browser-side `htmx:sseMessage` switch on `tool-start` / `tool-result`. Server-side emit is wired (UI-02 PASS) but the visible browser rendering needs `public/index.html` + htmx-ext-sse — Plan 01-08 |
| 13 | UI-04 | PASS | `src/server.ts /chat-stream` enters with `await staleCheck(env)` and emits `event: drift` if `unknown.length \|\| stale.length > 0` before `iterate()` runs (Plan 01-07) |
| 14 | LOOP-01 | PASS | `agent/loop.ts iterate(prompt, opts)` is HTTP-agnostic — accepts `{ sessionId, ragContext?, emit, abortSignal? }` callbacks only. Hono/Express not imported. 12 unit tests pass against mock client (Plan 01-06) |
| 15 | LOOP-02 | PASS | `tools/_envelope.ts` — `ToolError = { problem, cause, fix, retryable }` + `run<T>(name, fn, timeoutMs?, auditParentId?, auditInput?)` wrapper; D-15.3 lock; 10 tests pass (7 base + 3 audit-hook integration) |
| 16 | LOOP-03 | PASS | `agent/loop.ts MAX_TOOL_ITERATIONS=8` + `MAX_API_CALLS_PER_SESSION=30`; cap-exceed branches emit error envelope with `retryable: false` and `break`. Unit-tested via `_setSessionCallsForTest` injection (Plan 01-06) |
| 17 | LOOP-04 | PASS | `dispatch()` switch + `default` case both return ToolError envelope (never throws); each `tool_use` block has a paired `toolResultBlocks.push` regardless of success/failure (PITFALL #1 invariant). Acceptance grep: literal `throw` count in `agent/loop.ts` ≤ 2 |
| 18 | LOOP-05 | PASS | `compactHistory(50_000)` with `estimateTokens` (`Math.floor(text.length / 4)`); preserves `system + last 6 exchanges`; `messages.length ≤ 7` floor prevents pathological loss; 5 scenario tests pass (Plan 01-06) |
| 19 | LOOP-06 | PASS | `agent/sse.ts createChunkWatchdog(emit, 60_000)` — `emit` callback resets the timer, `final/error` events cancel, `finally` cancels; `tools/_envelope.ts run()` 30 s `AbortController` for tool timeout. Wired in `src/server.ts /chat-stream` at 4 sites (Plan 01-07) |
| 20 | LOOP-07 | PASS | `agent/loop.ts inFlight: Map<sessionId+queryHash, AbortController>` — duplicate (sessionId, prompt-hash) key on reconnect emits `text-delta delta="(재연결 감지 — 기존 응답 유지)"` and returns without re-calling Anthropic. Mock-tested with `deferred()` (Plan 01-06) |
| 21 | AUDIT-01 | PASS | `tools/_envelope.ts run()` extended with optional `auditParentId/auditInput` → `audit/log.ts logTool()` finally-block call; all 3 read tools wrapped (Plan 01-04). `data/copilot.db` in `.gitignore` per D-14.2 |
| 22 | AUDIT-03 | PASS | `audit/schema.sql events` hybrid table records `ts`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `total_tool_calls`, `duration_ms`, `error_envelope` per turn row (D-14.3); `audit/log.ts beginTurn / endTurn` API; 8 unit tests pass including PITFALL #10 strict-mode live-verify (Plan 01-03) |

**Counts:** 20 PASS / 2 PENDING (BLOCKED ON 01-08) / 0 FAIL.

## ROADMAP Phase 1 Success Criteria (5 items)

These are the Phase-level acceptance criteria from ROADMAP.md. They differ from REQ-IDs and
require *integrated, browser-visible* behavior.

| # | Criterion (ROADMAP wording) | Status | Notes |
|---|------------------------------|--------|-------|
| 1 | "ais-prod redis 어디 쓰여?" → services.yaml RAG + `docker ps` 결합 답변이 브라우저에 스트리밍 | **PENDING — BLOCKED on 01-08 + live verify** | RAG path verified end-to-end at module level (KB-02 PASS, READ-04 PASS); `iterate()` mock-tested. Browser streaming requires Plan 01-08 + a live Plan 01-09 retest |
| 2 | "지난밤 새벽 1-3시 voice 에러 패턴" → 라이브 로그 요약 답변 | **PENDING — BLOCKED on 01-08 + live verify** | `readLogs --since/--until` reachable through tool-use loop (READ-05 PASS); live Anthropic + docker exec smoke deferred |
| 3 | services.yaml drift → UI header drift warning | **PENDING — BLOCKED on 01-08** | Server-side `event: drift` emission verified (UI-04 PASS); UI banner render needs Plan 01-08 |
| 4 | curl 쿼리 후 SQLite event log에 timestamp + model + tool call 횟수 기록 | **PENDING live verify (code-path PASS)** | All emit sites wired (AUDIT-01/03 PASS, audit-hook integration tested in `tools/_envelope.test.ts` step 9-10). Live `bunx sqlite3 data/copilot.db SELECT` deferred (no `.env` in worktree, doc-only mode) |
| 5 | tool iter 8 / session API 30 → hard cap | **PASS (unit)** + **PENDING live spot check** | `agent/loop.test.ts` cap branches PASS via `_setSessionCallsForTest`; live `MAX_API_CALLS_PER_SESSION = 1` patch + repeat-query smoke deferred |

**Counts:** 0 fully PASS at criterion level / 1 unit-PASS + live-pending / 4 BLOCKED-or-PENDING.

This is consistent with the Phase 1 reality: code is shipped through Plan 01-07, but the
end-to-end browser+live verification gate cannot complete until Plan 01-08 lands and a
subsequent Plan 01-09 run executes the live curl/drift/SQLite/cap automation specified in
this plan's `<tasks>` block.

## Outstanding Items (User Action Required)

1. **Voyage AI key rotation (HIGH — security):** Plan 01-05 executor copied the parent
   `.env` into the worktree to enable a one-shot live `voyage-4-lite` call; the
   `VOYAGE_API_KEY` value was exposed in the sub-agent transcript at the `grep` step. Per
   Plan 01-05 SUMMARY "⚠ Security Notice" section, the operator must rotate the key at
   <https://dashboard.voyageai.com/> and replace the value in `.env`. **Status: pending.**
2. **Empty `ANTHROPIC_API_KEY` shell export (HIGH — operator UX, FRICTION #8):** The
   user's shell exports an empty `ANTHROPIC_API_KEY=`, which Bun honors over the `.env`
   file. Plan 01-07 ships `src/env.ts` with a friendly BOOT-05 envelope that detects this
   case and prints the exact `unset ANTHROPIC_API_KEY` remediation. **Status: mitigated by
   code; operator awareness still required for live runs.**
3. **Plan 01-08 (frontend) execution.** Without `public/index.html` + `htmx-ext-sse@2.2.4`
   wire, UI-01 + UI-03 + ROADMAP Success Criterion #1/#2/#3 cannot be live-verified.
4. **Plan 01-09 live re-run.** After 01-08 ships, this documentation snapshot must be
   replaced by an actual live verification: server start → curl SSE → drift mutation →
   SQLite SELECT → hard-cap spot check. The procedure is fully specified in
   `01-09-PLAN.md` `<tasks>` block 1.

## 8 h Budget Usage

Per plan SUMMARY metrics (sum of completed plans 01-01..01-07):

| Plan | Reported duration |
|------|-------------------|
| 01-01 | ~15 min |
| 01-02 | ~3 min (190 s) |
| 01-03 | ~6 min (336 s) |
| 01-04 | ~30 min |
| 01-05 | ~16 min |
| 01-06 | ~52 min |
| 01-07 | ~30 min |
| **Sum (Wave 1+2+3)** | **~152 min ≈ 2 h 32 min** |

Plus this Plan 01-09 documentation slot (~est. 10-15 min wall-clock). Plan 01-08 budget is
unconsumed.

**Conclusion:** Substantially under the 8 h ROADMAP cap. Phase 2 entry will not be gated
by overage clauses.

## Phase 2 Entry Gate

- [ ] All 22 Phase 1 REQ-IDs PASS — currently 20/22; UI-01 + UI-03 require Plan 01-08.
- [ ] All 5 ROADMAP Success Criteria live-verified — currently 0/5 fully PASS at the
      criterion level (4 BLOCKED on 01-08 + live re-run; 1 unit-PASS).
- [ ] FRICTION.md (Phase 1) authored — see sibling `FRICTION.md` produced by this plan.
- [ ] Operator explicit approval after reading this VERIFICATION + sibling FRICTION.

**Recommendation:** Phase 2 entry is **NOT YET GATED OPEN** by this snapshot. The next
required action is Plan 01-08 execution, followed by a live Plan 01-09 re-run that
overwrites this document with PASS rows backed by real `curl` / `sqlite3` / drift-mutation
evidence.

---

*Documentation-only snapshot. To be replaced by a live-evidence VERIFICATION.md after
Plan 01-08 ships and a fresh `gsd-execute-phase 1` round visits Plan 01-09 with the live
verification flag enabled.*
