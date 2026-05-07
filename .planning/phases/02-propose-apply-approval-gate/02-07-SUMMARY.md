---
phase: 02-propose-apply-approval-gate
plan: 07
subsystem: agent
tags:
  - phase-2
  - sse-events
  - loop-interrupt-resume
  - watchdog-keep-alive
  - apply-02
  - ui-02-plus3
  - loop-04-pitfall-1
  - di-seam

# Dependency graph
requires:
  - phase: 02-propose-apply-approval-gate
    provides: 02-02 approval/store.ts (setPending / consumeApproval / expirePending / ApprovalDecision union 5-key)
  - phase: 02-propose-apply-approval-gate
    provides: 02-05 tools/proposePatch.ts (ProposePatchResult + ApprovalDecision Promise)
  - phase: 02-propose-apply-approval-gate
    provides: 02-06 tools/applyPatch.ts (2PC orchestrator + ApplyPatchOutcome union applied/rolled-back)
  - phase: 02-propose-apply-approval-gate
    provides: 02-04 state/compose 4-stack mirror + REMOTE_COMPOSE_PATH 매핑 5경로 lock
  - phase: 01-read-only-knowledge-layer
    provides: agent/sse.ts SseEvent 6-union + createChunkWatchdog (Phase 1 carry-forward)
  - phase: 01-read-only-knowledge-layer
    provides: agent/loop.ts iterate() + dispatch() 3 read tool case (Phase 1)
provides:
  - agent/sse.ts SseEvent 9-union (Phase 1 6 + Phase 2 +3 — approval-required / applied / rolled-back)
  - agent/loop.ts dispatch('proposePatch') 분기 — interrupt+resume + applyPatch internal call + tool_result push
  - agent/loop.ts dispatchProposePatch() 함수 — 5-key 분기 6 outcome (approved/edited→applied, approved/edited→rolled-back, rejected, aborted, expired)
  - agent/loop.ts REMOTE_COMPOSE_PATH 4-stack 매핑 (news/ais/n8n/krdn-fx) — module-level export
  - agent/loop.ts 30s keep-alive interval — `_keepAliveIntervalMs` let + setter (Bun no fake timers 우회)
  - agent/loop.ts AbortController abort handler wire — chunk timeout 등으로 abort 시 expirePending(sessionId) 호출
  - agent/loop.ts 신규 DI seam — _setKeepAliveIntervalForTest / _setProposePatchForTest / _setApplyPatchForTest
affects:
  - 02-08 src/server.ts /chat 핸들러 — iterate() 호출은 변경 없음 (signature 그대로). 추가로 POST /approval/:id 핸들러가 consumeApproval 호출하여 dispatch가 await하는 decision Promise를 resolve.
  - 02-09 public/index.html — 9-event taxonomy의 3 신규 event(approval-required / applied / rolled-back)을 hx-sse swap으로 wire (ApprovalCard + result indicator)
  - 02-10 E2E 검증 — APPLY_TEST_MODE=1 라이브 흐름에서 5-key 게이트 → applyPatch → applied/rolled-back 전체 wire 검증

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated union 9-type expansion (Phase 1 6 carry-forward + Phase 2 +3 incremental)"
    - "TS exhaustive switch for compile-time completeness (sse.test.ts 'type union completeness' check)"
    - "Interrupt + resume in single dispatch round (Open Q 2 lock — proposePatch await decision → applyPatch internal call → 단일 tool_result로 LLM에 push)"
    - "30s keep-alive interval — empty 'text-delta delta=\"\"' emit으로 60s SSE chunk watchdog reset (advisor lock)"
    - "AbortController abort handler — chunk timeout / 사용자 disconnect 시 expirePending(sessionId) → decision resolve('expired')"
    - "DI seam (let _impl = default; _setForTest(fn|null) 패턴) — Bun no fake timers 환경에서 mock 주입 + 타이머 가속"
    - "LOOP-04 PITFALL #1 invariant carry-forward — 모든 분기에서 tool_result emit + truthy return (orphan tool_use 방지)"
    - "Raw `prompt` forward (ragContext 제외) — D-D1 git commit body source는 운영자 의도만 담아야 함 (advisor lock)"

key-files:
  modified:
    - agent/sse.ts (124 → 169 LoC) — SseEvent union 6→9 확장, 헤더 docstring 갱신, Phase 2 추가 3 event 주석
    - agent/sse.test.ts (143 → 235 LoC) — exhaustive switch 3 case + 4 신규 toSSEFrame 시나리오 (approval-required / applied / rolled-back × 2)
    - agent/loop.ts (435 → 753 LoC) — REMOTE_COMPOSE_PATH 매핑 + KEEP_ALIVE_INTERVAL_MS let + 3 DI seam + dispatch 시그니처 확장 + dispatchProposePatch() 분기 함수 + iterate() 호출부 갱신
    - agent/loop.test.ts (340 → 738 LoC) — 9 신규 시나리오 (6 분기 + keep-alive + LOOP-04 invariant + REMOTE_COMPOSE_PATH lock 검증)

decisions:
  - "Open Q 1 lock — edited decision의 newContent override는 applyPatch.args.decision으로 forward (proposal.fileEdit.newContent를 교체하지 않고, applyPatch가 decision.type === 'edited'일 때 decision.newContent 사용)"
  - "Open Q 2 lock — proposePatch dispatch 내부에서 await decision → 즉시 applyPatch 호출 → 단일 tool_result로 outcome JSON 푸시 (새 dispatch round 안 만듦, LOOP-04 PITFALL #1 보호)"
  - "Advisor lock — 30s keep-alive interval로 60s SSE chunk watchdog 충돌 회피. approval 대기 2분 동안 'text-delta delta=\"\"' emit으로 wire 유지"
  - "Advisor lock — userPrompt는 raw `prompt`만 dispatch에 forward (ragContext + prompt 아님). D-D1 git commit body source는 운영자 의도만 담아야 함"
  - "Advisor lock — KEEP_ALIVE_INTERVAL_MS는 const 아닌 let + setter (Bun no fake timers + monkey-patch 안 됨). _resetForTest()에서 30_000ms 복구"
  - "advisor 권고 #1 적용 — sse.test.ts 기존 exhaustive switch에 3 case 추가 (TS strict 컴파일 에러 회피)"
  - "advisor 권고 #2 적용 — dispatch 시그니처 확장 시 iterate() 호출부도 동시 갱신 (3 read tool case 그대로 컴파일)"
  - "Plan 02-07 hotfix lock — REMOTE_COMPOSE_PATH 4-stack scope (open-webui 제외, plain docker run, v2 backlog)"
  - "applyPatch 60s timeout — compose up -d image pull trigger 시 60s 초과 가능. retryable=true envelope으로 재제안 가능하므로 차단 사유 아님 (advisor 검증)"

metrics:
  duration_min: 25
  completed: "2026-05-07"
  task_count: 3
  files_modified: 4
  loc_delta: +850
  tests_added: 13  # SSE 4 + Loop 9
  tests_total_pass: 39  # 15 SSE + 24 Loop (Phase 1 15 + Phase 2 9)
---

# Phase 2 Plan 07: agent/loop.ts proposePatch dispatch + 3 SSE Events 확장

APPLY-02 (loop interrupt+resume) + UI-02 +3 events (approval-required / applied / rolled-back) + 60s SSE chunk watchdog 충돌 회피용 30s keep-alive interval 통합. proposePatch tool dispatch가 5-key 승인을 await하고 승인 시 즉시 applyPatch internal call → 단일 tool_result로 LLM에 outcome 푸시 (Open Q 2 lock — 새 dispatch round 안 만듦, LOOP-04 PITFALL #1 보호 carry-forward).

## One-liner

interrupt+resume dispatch + 9-type SSE union + 30s keep-alive로 2분 approval 대기 + 5-key 분기 6 outcome (approved/edited→applied, approved/edited→rolled-back, rejected, aborted, expired) 모두 LOOP-04 invariant 만족.

## Tasks

### Task 1 — agent/sse.ts SseEvent 6→9 union 확장 + 4 신규 sse.test.ts 시나리오 (TDD)

- **RED:** sse.test.ts에 4 신규 toSSEFrame 시나리오 작성 + 기존 exhaustive switch에 3 case 추가 → `bunx tsc` 7 type 에러 (advisor 권고 #1).
- **GREEN:** sse.ts SseEvent union에 approval-required / applied / rolled-back 3 type 추가 + 헤더 docstring 6→9 갱신 → `bun test agent/sse.test.ts` 15/15 PASS, tsc clean.
- **commit:** `51a53da feat(02-07): SseEvent union 9-type 확장 (UI-02 +3 — approval-required/applied/rolled-back)`

### Task 2 — agent/loop.ts dispatch('proposePatch') interrupt+resume + keep-alive + abort wire

- **확장:** dispatch 시그니처 (name, input, turnId) → (name, input, turnId, sessionId, userPrompt, emit, ac). iterate() 호출부도 동시 갱신 (advisor 권고 #2). userPrompt는 raw `prompt`만 forward (ragContext 제외, advisor 권고 #4).
- **신규 함수:** dispatchProposePatch() — _envelope.run(30s)으로 proposePatch wrap → emit approval-required → setInterval(_keepAliveIntervalMs) 30s keep-alive → ac.signal abort handler → await decision → 5-key 분기 (approved|edited → applyPatch internal call(60s) → emit applied|rolled-back; rejected|aborted|expired → ToolError envelope).
- **신규 module-level:** REMOTE_COMPOSE_PATH 4-stack 매핑 (news/ais/n8n/krdn-fx — 02-04 SUMMARY lock). open-webui 제외 (v2 backlog).
- **신규 DI seam:** `_setKeepAliveIntervalForTest`, `_setProposePatchForTest`, `_setApplyPatchForTest` (advisor 권고 #3 — Bun no fake timers + monkey-patch 안 됨, let + setter 패턴).
- **commit:** `bbd6125 feat(02-07): agent/loop.ts dispatch('proposePatch') interrupt+resume + keep-alive (APPLY-02)`

### Task 3 — agent/loop.test.ts 9 신규 시나리오 (TDD)

| # | 시나리오 | 검증 |
| - | -------- | ---- |
| 1 | approved → applied | emit 시퀀스(approval-required → applied → final) + applyPatch.remoteComposePath wire + tool-result ok=true |
| 2 | approved → rolled-back (docker fail) | emit rolled-back + rollback_command/ok forward + tool-result ok=false |
| 3 | edited → applied | decision.newContent가 applyPatch.args.decision으로 forward (Open Q 1) |
| 4 | rejected | applyPatch 미호출 + tool-result ok=false summary 'rejected' |
| 5 | expired | tool-result ok=false summary 'expired' (retryable=true envelope) |
| 6 | abort 외부 trigger | 실 store.setPending + ac.abort() → expirePending → expired (real wire 검증) |
| 7 | keep-alive interval | _setKeepAliveIntervalForTest(50) 가속 후 approval-required와 applied 사이 empty text-delta 1+ emit |
| 8 | LOOP-04 invariant | 4 분기(approved/rejected/aborted/expired) 모두 tool-result emit + final 도달 |
| 9 | REMOTE_COMPOSE_PATH lock | 4-stack scope 정확히(news/ais/n8n/krdn-fx, open-webui 제외) |

- **commit:** `107dbdb test(02-07): proposePatch dispatch 9 시나리오 (interrupt+resume + keep-alive + LOOP-04 invariant)`

## Verification

| Check | Required | Actual |
| ----- | -------- | ------ |
| `bun test agent/sse.test.ts agent/loop.test.ts` PASS | yes | **39/39 PASS** (15 SSE + 24 Loop, 142 expect calls, 2.64s) |
| `grep -c "approval-required\|applied\|rolled-back" agent/sse.ts` ≥ 3 | yes | 7 (3 union + 헤더 docstring 4) |
| Unique 'type:' literals in sse.ts | 9 | 9 (text-delta / tool-start / tool-result / final / error / drift / approval-required / applied / rolled-back) |
| `case "proposePatch":` in loop.ts | = 1 | 1 |
| `setInterval` (keep-alive) | ≥ 1 | 2 (구현 1, comment 참조 1) |
| `expirePending` (abort wire) | ≥ 1 | 5 (import 1, abortHandler 1, comment 3) |
| `applyPatch` references in loop.ts | ≥ 1 | 17 (import + 함수 호출 + 주석) |
| Phase 1 회귀 | none | 15 Phase 1 test 모두 PASS |

## Decisions Made

### Open Q 1 lock — edited decision newContent override

`ApprovalDecision { type: 'edited', newContent }`가 도착하면 applyPatch.args.decision으로 forward. proposePatch.result.fileEdit.newContent는 교체하지 않고 (immutability), applyPatch 본체가 `decision.type === 'edited'`일 때 `decision.newContent`를 사용. tools/applyPatch.ts:421-446에 이미 구현되어 있어 dispatch는 단순히 forward만.

### Open Q 2 lock — 단일 dispatch round (LOOP-04 PITFALL #1 보호 carry-forward)

proposePatch dispatch가 await decision → 즉시 applyPatch internal call → 단일 tool_result로 outcome JSON 푸시. 새 dispatch round 안 만듦. 이유:
1. tool_use → tool_result 1:1 invariant 유지 (LOOP-04 PITFALL #1)
2. LLM이 applyPatch tool에 직접 access 못 하게 (D-B2 lock — apply는 internal only, TOOL_SCHEMAS에 없음)
3. 사용자 입장에서 단일 "제안 → 결과" UX

### Advisor lock #1 — 30s keep-alive interval (60s chunk watchdog 충돌 회피)

`createChunkWatchdog(60_000)`이 server.ts에서 60s no-chunk 시 stream을 죽이는데, 사용자는 2분 approval 대기 가능. dispatch가 30s마다 `text-delta delta=""` empty emit하여 chunk watchdog reset. server.ts의 `watchdog.reset()`은 매 emit마다 호출되므로 빈 delta 1회면 충분.

### Advisor lock #2 — userPrompt = raw `prompt` (ragContext 제외)

iterate()는 `messages = [{role:user, content: ragContext + prompt}]`로 시작하지만, dispatch에는 raw `prompt`만 forward. 이유: D-D1 git commit body의 `User-Prompt` 필드는 운영자 의도만 담아야 함. RAG context (services.yaml 등 KB 검색 결과)가 git log에 박히면 운영자 진의 가독성 훼손.

### Advisor lock #3 — KEEP_ALIVE_INTERVAL_MS는 const 아닌 let + setter

Bun에 useFakeTimers 없음. const export는 monkey-patch 안 됨. `let _keepAliveIntervalMs = 30_000` + `_setKeepAliveIntervalForTest(ms)` setter 패턴으로 테스트 가속 (50ms → 100-150ms 후 emit 1+ 검증). _resetForTest()에서 30_000ms로 복구.

### Plan 02-07 hotfix lock — REMOTE_COMPOSE_PATH 4-stack

`/home/gon/deploy/news-sentiment-prod/docker-compose.yml`, `/home/gon/actions-runner/_work/ai-signalcraft/ai-signalcraft/docker/docker-compose.prod.yml`, `/home/gon/docker-n8n/docker-compose.yml`, `/home/gon/projects/krdn-fx/docker-compose.yml`. open-webui는 192.168.0.5에서 plain docker run (no compose)이므로 v2 backlog. 02-04 executor가 `docker inspect com.docker.compose.project.config_files` label + ssh `test -f`로 검증 완료.

## Deviations from Plan

### Auto-fixed (Rule 2 — 누락된 Critical functionality)

**1. [Rule 2 - Missing functionality] dispatch 시그니처 확장 시 iterate() 호출부도 갱신 필요 (advisor 권고 #2)**
- **Found during:** Task 2 구현 직전 advisor 호출 시 식별
- **Issue:** plan에는 dispatch 시그니처를 `(name, input, turnId, sessionId, userPrompt, emit, ac)`로 확장하라고 했지만, iterate() 본체의 호출부 `await dispatch(block.name, block.input, turnId)`는 plan에 명시 안 됨. 같이 안 갱신하면 컴파일 에러.
- **Fix:** iterate() 호출부도 동시 갱신, userPrompt는 raw `prompt`만 forward (ragContext 제외, advisor lock #4)
- **Files modified:** agent/loop.ts:467-478
- **Commit:** bbd6125

**2. [Rule 2 - Missing functionality] sse.test.ts 기존 exhaustive switch에 3 case 추가 필요 (advisor 권고 #1)**
- **Found during:** Task 1 RED 단계에서 식별 (advisor가 사전에 지적)
- **Issue:** plan은 sse.ts SseEvent union만 6→9 확장하라고 했지만, 기존 sse.test.ts:75-94의 exhaustive switch는 6 case만 있음. union 9-type 확장 시 TS strict가 type 에러 발생.
- **Fix:** sse.test.ts:88-95에 approval-required / applied / rolled-back 3 case 추가
- **Files modified:** agent/sse.test.ts
- **Commit:** 51a53da

**3. [Rule 2 - Missing functionality] KEEP_ALIVE_INTERVAL_MS를 const 대신 let + setter로 (advisor 권고 #3)**
- **Found during:** Task 2 설계 시 advisor 호출 시 식별
- **Issue:** plan Task 3는 "module-level constant export → test에서 monkey-patch"라고 했지만 const는 monkey-patch 불가. Bun no fake timers라 시간 단축 필수.
- **Fix:** `let _keepAliveIntervalMs = 30_000` + `_setKeepAliveIntervalForTest(ms)` setter로 export. _resetForTest()에서 default 복구.
- **Files modified:** agent/loop.ts (DI seam 영역)
- **Commit:** bbd6125

### Auto-fixed (Rule 3 — 작업 시작 시 잘못된 워크트리 디렉토리에 편집)

**4. [Rule 3 - Blocking issue] 초기 편집이 main worktree에 잘못 적용됨 → agent worktree로 복구**
- **Found during:** Task 1 GREEN 후 commit pre-check 시 HEAD가 main 브랜치로 표시
- **Issue:** Bash tool의 cwd reset 동작으로 `cd /home/gon/projects/gon/gons-works`가 main worktree (별도 디렉토리, .git directory 보유)로 이동. 절대경로 편집이지만 path 자체가 main worktree 경로였음.
- **Fix:** `git checkout -- agent/sse.ts agent/sse.test.ts`로 main worktree 원복 + 모든 후속 편집은 `/home/gon/projects/gon/gons-works/.claude/worktrees/agent-ab1df4fae4428abc1/...` 절대경로로 정확히 지정. 이후 git 명령은 모두 `git -C $WT ...` 형태로 worktree 명시.
- **추가 보호:** SUMMARY 작성 후 모든 commit이 worktree branch (worktree-agent-ab1df4fae4428abc1)에 정확히 들어갔는지 확인 (51a53da/bbd6125/107dbdb 모두 OK).

## Self-Check: PASSED

**Files Modified:**
- `agent/sse.ts`: FOUND
- `agent/sse.test.ts`: FOUND
- `agent/loop.ts`: FOUND
- `agent/loop.test.ts`: FOUND

**Commits (verified via `git log --oneline 142646e..HEAD`):**
- `51a53da feat(02-07): SseEvent union 9-type 확장 (UI-02 +3 — approval-required/applied/rolled-back)`: FOUND
- `bbd6125 feat(02-07): agent/loop.ts dispatch('proposePatch') interrupt+resume + keep-alive (APPLY-02)`: FOUND
- `107dbdb test(02-07): proposePatch dispatch 9 시나리오 (interrupt+resume + keep-alive + LOOP-04 invariant)`: FOUND

**Tests:** 39/39 PASS (15 SSE + 24 Loop, Phase 1 회귀 0).

**Verification commands all pass:** 9-type union ✓, case proposePatch=1 ✓, setInterval≥1 ✓, expirePending≥1 ✓, applyPatch internal call ≥1 ✓.

## Threat Flags

None — 본 plan은 기존 SSE wire와 dispatch 분기 확장만, 신규 network endpoint / auth 경로 / file access 패턴 / schema change 없음. proposePatch / applyPatch는 02-05 / 02-06에서 이미 threat model lock 완료.

## Known Stubs

None — dispatch 6 분기 모두 실 코드 + 테스트로 wire 완료. UI 측 (public/index.html의 ApprovalCard + result indicator)는 02-09 plan scope.

## Notes for Next Plan

- **02-08 (server.ts /approval/:id):** POST /approval/:id 핸들러가 consumeApproval(sessionId, clientNonce, decision)을 호출하면 dispatch 내부의 await decision Promise가 resolve되어 흐름 재개. server는 dispatch 내부 흐름 모름 (HTTP-agnostic invariant 유지).
- **02-09 (public/index.html):** 9-event union의 3 신규 event를 hx-sse swap으로 wire. approval-required는 ApprovalCard 생성, applied/rolled-back은 카드 update + status badge. UI-SPEC.md "SSE 이벤트 → DOM 매핑" 표 갱신 필요.
- **02-10 (E2E 검증):** APPLY_TEST_MODE=1 라이브 흐름에서 NL prompt → proposePatch → 5-key 게이트 (실 키보드 input 또는 fetch) → applied/rolled-back wire 전체 검증.
