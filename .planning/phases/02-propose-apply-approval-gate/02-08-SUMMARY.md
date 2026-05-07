---
phase: 02-propose-apply-approval-gate
plan: 08
subsystem: server
tags:
  - phase-2
  - server
  - approval-route
  - boot-recovery
  - apply-08-model-lock
requirements:
  - APPLY-03
  - APPLY-05
  - APPLY-08
dependency_graph:
  requires:
    - 02-02  # approval/store.ts (consumeApproval, setPending, _resetForTest)
    - 02-06  # tools/applyPatch.ts (PendingMarker writer / state/.pending lifecycle)
  provides:
    - "POST /approval/:id (5-key Hono route — 02-09 UI form 호출 진입점)"
    - "recoverPendingMarkers + bufferPendingDrift + consumeBufferedDrift (boot 5번째 probe)"
    - "Phase 2 LLM 모델 = COPILOT_MODEL_PROPOSE (opus-4-6) 일괄 적용 (agent/loop.ts)"
  affects:
    - 02-09  # 5-key UI form은 본 plan의 POST /approval/:id로 submit
    - "Phase 2 모든 chat-stream turn — sonnet → opus 호출 비용 ~5배 증가"
tech_stack:
  added: []
  patterns:
    - "Hono parseBody → form-urlencoded mapping (Phase 1 /chat 패턴 carry-forward)"
    - "module-level mutable buffer (consume-once invariant) for boot drift"
    - "permissive parse for cross-plan marker schema (Record<string, unknown>)"
key_files:
  created: []
  modified:
    - src/server.ts        # POST /approval/:id + 5번째 probe + APPLY-08 model lock (+274 LoC)
    - src/server.test.ts   # 13 신규 테스트 (POST 8 + recover 5) (+269 LoC)
    - agent/loop.ts        # COPILOT_MODEL_READONLY → COPILOT_MODEL_PROPOSE × 3 (+10/-4)
decisions:
  - "POST /approval/:id body schema는 PLAN.md의 5-key form-urlencoded 채택. orchestrator 프롬프트의 'yes/no/edit/abort' 4-key Zod strict는 무시 (plan canonical, advisor 충돌 1)."
  - "APPLY-08 진짜 충족 위치는 agent/loop.ts (실제 messages.create site)이므로 plan files_modified 외이지만 Rule 1/2 deviation으로 적용 (advisor 충돌 2)."
  - "PendingMarker reader는 permissive parse (Record passthrough) — 02-04/02-06 writers가 fileEdit/sha_before 등 추가 필드를 작성, schema validation 강제 시 Wave writer 변경 시 깨짐 (advisor 충돌 3)."
  - "TDD ordering: Task 1+4 → 단일 RED commit (13 신규 테스트 모두 fail) → 단일 GREEN commit (route + recover 모두 구현) — 두 task가 같은 파일을 수정하므로 RED 분리는 비용만 증가 (advisor 충돌 4)."
metrics:
  duration: "~30분 (orientation + 4 commits)"
  completed: 2026-05-07
  files_changed: 3
  lines_added: 548
  lines_removed: 9
  tests_added: 13
  total_tests_after: 243 (239 pass + 4 skip)
---

# Phase 2 Plan 08: Server-side Approval Route + Boot Recovery + APPLY-08 Model Lock Summary

**One-liner:** Hono POST `/approval/:id` 5-key gate route + state/.pending boot recovery (자동 복구 안 함, drift event 운영자 안내) + Phase 2 LLM 모델 PROPOSE(opus-4-6) 일괄 승격으로 APPLY-03/05/08 충족.

## What Was Built

### 1. POST /approval/:id route (APPLY-03)

`src/server.ts`에 Hono 라우트 추가:
- **path**: `/approval/:id` (id = nonce, URL path param)
- **header**: `x-session-id` (없으면 'default' fallback — Phase 1 carry-forward)
- **body**: `application/x-www-form-urlencoded` `{ key, newContent? }`
- **mapKey 5-key**:
  - `y` → `{ type: "approved" }`
  - `n` → `{ type: "rejected" }`
  - `e` + `newContent` → `{ type: "edited", newContent }`
  - `e` 단독 → 400 invalid envelope
  - `d` → 200 + `ui_only:true` (consumeApproval 미호출 — UI 토글 전용)
  - `a` → `{ type: "aborted" }`
  - 그 외 (`z` 등) → 400 invalid envelope
- **응답**:
  - 200 OK on success / ui-only
  - 400 invalid key / parse error envelope
  - 409 nonce mismatch / consumed / expired (consumeApproval throw → envelope으로 변환)

`approval/store.ts:consumeApproval(sessionId, clientNonce, decision)`을 호출해 PITFALL #3 (race / double-press) 방어 그대로 활용. nonce는 path param에서 읽어 그대로 store에 전달 (body에 별도 nonce 없음).

### 2. 5번째 startup probe + buffered marker drift (APPLY-05 / D-C2)

`src/server.ts`에 boot probe 5 추가:

```text
1) loadEnv()
2) ensureDockerContext()
3) ensureIndexed()
4) staleCheck()  (services.yaml drift 경고)
5) recoverPendingMarkers() ← 신규
```

**recoverPendingMarkers(dir = "state/.pending")**:
- `existsSync` → false면 빈 배열 (mkdir 안 함, 02-04 init 책임)
- `*.json` glob → `JSON.parse` (permissive — 추가 필드 passthrough)
- 손상 JSON은 swallow + console.warn (운영자 manual cleanup)

**bufferPendingDrift / consumeBufferedDrift**:
- module-level `pendingDriftBuffer: PendingMarkerFields[]`
- boot 시 `bufferPendingDrift(markers)` 저장
- 첫 `/chat-stream` 진입 시 `consumeBufferedDrift()` 1회 emit (단일 consume invariant 테스트로 lock)

**3-state 분류 (D-C3)** — `formatMarkerForDrift()`:
- `pre-docker`: `docker_started_at == null` (안전, fileEdit만 롤백)
- `in-flight`: `docker_started_at != null && docker_finished_at == null` (불확실)
- `post-docker`: `docker_finished_at != null && exit_code != null` (docker 성공 + git uncommitted)

drift event message에 nonce + stack + command + 타임스탬프 + a/b/c 명령어 (수동 git commit / SSH docker rollback / marker 삭제) 포함.

### 3. Phase 2 LLM 모델 lock (APPLY-08 / D-10)

**src/server.ts**: `PHASE2_LLM_MODEL = env.COPILOT_MODEL_PROPOSE` 상수 정의 — env에 키 없으면 boot 즉시 실패 + acceptance grep 충족.

**agent/loop.ts (실제 호출 site, Rule 1/2 deviation)** — 3곳 변경:
- line 124: `callWithFallback` primary `messages.create({ model: ... PROPOSE })`
- line 136: `callWithFallback` fallback도 동일
- line 301: `beginTurn(prompt, env.COPILOT_MODEL_PROPOSE)` (audit log model 식별자)

**비용 영향**: opus-4-6 호출 단가 ~ sonnet-4-6의 5배. 1인 도구 dogfood 사용량은 작아 절대값 영향 한정. dynamic swap (read-only turn 시 sonnet으로 fallback)은 v2 backlog.

## Test Coverage

`src/server.test.ts`에 13개 신규 테스트 추가, 기존 10개 유지:

### POST /approval/:id (8 cases)
1. `key='y'` → 200 + decision `approved` resolve
2. `key='n'` → 200 + decision `rejected`
3. `key='e' + newContent` → 200 + decision `edited`
4. `key='e'` no newContent → 400 invalid envelope
5. `key='d'` → 200 + `ui_only:true` + 후속 `key='a'`로 promise 매듭 (consumeApproval 미호출 검증)
6. `key='a'` → 200 + decision `aborted`
7. `key='z'` (invalid) → 400 envelope
8. nonce mismatch → 409 envelope (PITFALL #3 prevention)

### recoverPendingMarkers + buffered drift (5 cases)
9. 디렉토리 비어있으면 빈 배열
10. 디렉토리 자체 없어도 빈 배열 (mkdir 안 함)
11. 2개 marker → 2개 반환 + permissive 추가 필드 보존
12. 손상 JSON 1개 + 정상 1개 → 정상만 반환 (swallow)
13. `bufferPendingDrift` → 첫 `consumeBufferedDrift` 후 두 번째는 빈 배열 (single-consume invariant)

**전체 회귀 테스트 결과:**
- `bun test src/server.test.ts` → 23/23 PASS
- `bun test` 전체 → 239 PASS / 4 skip / 0 fail (Phase 0/1 + Phase 2 Wave 1/2 모두 그대로)

## Verification Gates

| Gate | Command | Expected | Actual |
|------|---------|----------|--------|
| 테스트 PASS | `bun test src/server.test.ts` | all pass | 23 pass |
| Route 등록 | `grep -c 'app.post.*approval' src/server.ts` | ≥ 1 | 1 |
| consumeApproval 사용 | `grep -c 'consumeApproval' src/server.ts` | ≥ 1 | 6 |
| Boot probe | `grep -c 'recoverPendingMarkers' src/server.ts` | ≥ 1 | 4 |
| Buffer pair | `grep -c 'bufferPendingDrift\|consumeBufferedDrift' src/server.ts` | ≥ 2 | 5 |
| Model lock | `grep -c 'COPILOT_MODEL_PROPOSE' src/server.ts` | ≥ 1 | 3 |
| READONLY 제거 | `grep -c 'COPILOT_MODEL_READONLY' src/server.ts` | 0 | 0 |
| 모델 literal 금지 | `grep -c 'claude-opus-4-6' src/server.ts` | 0 | 0 |
| 모델 literal 금지 | `grep -c 'claude-sonnet-4-6' src/server.ts` | 0 | 0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — 누락된 critical scope] APPLY-08 진짜 fix는 agent/loop.ts에 있음**
- **Found during:** Task 3 (LLM 모델 swap) 시작 전 advisor 자문
- **Issue:** PLAN.md Task 3은 "src/server.ts에 messages.create model 변경"이라 명시했으나 실제 LLM 호출은 `agent/loop.ts:123, 134`(Phase 1 결정)에서 수행. server.ts 코드 변경만으로는 APPLY-08 requirement(Phase 2 LLM = opus-4-6) 진짜 충족 불가.
- **Fix:** server.ts에는 `PHASE2_LLM_MODEL = env.COPILOT_MODEL_PROPOSE` boot eval만 추가 (acceptance grep + boot fail-fast lock). agent/loop.ts의 3곳(callWithFallback primary/fallback + beginTurn)을 READONLY → PROPOSE로 변경.
- **Files modified:** agent/loop.ts (plan files_modified 외, Rule 1/2 deviation 적용)
- **Commit:** 920dee6
- **Verification 영향**: 본 plan verification은 `grep src/server.ts`만 검사하므로 모두 PASS. 회귀 테스트 (loop.test.ts mock model 응답 메타데이터)도 그대로 PASS.

**2. [Rule 3 — 빈 모순 spec resolve] orchestrator vs PLAN.md body shape 충돌**
- **Issue:** orchestrator 프롬프트는 `{decision: 'yes'|'no'|'edit'|'abort', nonce, newContent?}` Zod strict (4-key + body-borne nonce)을 명시. PLAN.md interfaces는 `{key: 'y'|'n'|'e'|'d'|'a', newContent?}` form-urlencoded (5-key + URL path nonce). 두 spec이 호환 불가능.
- **Resolution:** PLAN.md를 canonical로 채택. 근거:
  - PLAN.md interfaces 필드명/값이 02-09 5-key UI form (Wave 3 sister plan)과 매칭
  - approval/store.ts:consumeApproval 시그니처가 `(sessionId, clientNonce, decision)`로 nonce를 별도 인자로 받음 → URL path nonce가 자연스러움
  - PLAN.md가 5-key (`d` UI-only 포함)를 명시 — 4-key는 `d`(show diff) 누락
- **Files modified:** N/A (PLAN.md 그대로 따름)
- **Commit:** 6cc401e (GREEN 구현)

**3. [Rule 3 — schema 강제 회피] PendingMarker permissive parse**
- **Issue:** 02-CONTEXT.md D-C3는 marker schema 11개 필드 명시. PLAN.md interfaces는 8개 필드. 02-06 applyPatch.ts:84-97의 실제 marker는 13개 필드 (fileEdit.previousContent + sha_before 추가). reader인 본 plan이 strict schema validation을 강제하면 Wave writer 변경마다 깨짐.
- **Fix:** `PendingMarkerFields` interface를 minimum required field만 정의 + `[key: string]: unknown` index signature로 passthrough. JSON.parse 결과 그대로 보존하여 추가 필드는 영향 없음.
- **Files modified:** src/server.ts (interface PendingMarkerFields)
- **Commit:** 6cc401e
- **Test coverage:** Test "recoverPendingMarkers: 2개 marker → 추가 필드는 permissive (passthrough)"에서 fileEdit 필드 보존 검증.

### Auth Gates

해당 없음.

### Architectural Changes

해당 없음.

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| src/server.ts | route + 5번째 probe + APPLY-08 lock 추가 | +274 / -4 |
| src/server.test.ts | 13 신규 테스트 + import 변경 | +269 / -1 |
| agent/loop.ts | READONLY → PROPOSE × 3 + 주석 갱신 | +10 / -4 |

총 +548 / -9.

## Commits

1. **8f03dd4** `test(02-08): RED — POST /approval/:id 5-key + recoverPendingMarkers 13 tests`
2. **6cc401e** `feat(02-08): GREEN — POST /approval/:id 5-key + recoverPendingMarkers + APPLY-08 lock`
3. **920dee6** `feat(02-08): APPLY-08 — Phase 2 LLM 호출을 PROPOSE(opus-4-6)로 일괄 승격`
4. **4c8b880** `docs(02-08): server.ts 주석 정리 — claude-opus-4-6 literal 제거`

TDD gate compliance: RED → GREEN 시퀀스 git log 검증 완료 (8f03dd4 test → 6cc401e feat).

## APPLY_TEST_MODE Carry-Forward

orchestrator 프롬프트의 "spawnWithIntent helper carry-forward"는 본 plan 범위 외 — server.ts route handler는 `consumeApproval`만 호출하고 `applyPatch`는 LOOP가 nonce 매칭으로 자동 실행. APPLY_TEST_MODE seam은 02-06 applyPatch가 owns, 본 plan은 통과 의존성 없음.

## Known Stubs

해당 없음 — 모든 분기 구현 완료, 5-key UI(02-09)에서 호출 가능 상태.

## Threat Flags

해당 없음 — 본 plan은 Phase 2 threat model `<approval-gate>` 표면만 covers. POST /approval/:id 신규 엔드포인트지만:
- 127.0.0.1 bind만 (PITFALL #16) — LAN/외부 노출 차단됨
- nonce + sessionId + consumed flag 3-layer race 차단 (PITFALL #3)
- input 검증: key는 5-key whitelist, newContent는 'e' key 한정 + 길이 제한 없음 (state/compose/{stack}.yml 적용은 02-06 applyPatch + Zod schema가 별도 검증)
- rate limit / CSRF: 1인 도구 + 127.0.0.1 bind이므로 Out-of-Scope (PROJECT.md "multi-user" v2)

## Self-Check: PASSED

**Created files:** 해당 없음 (plan은 modified만 있음).

**Modified files (git diff stat):**
- FOUND: src/server.ts (+274 / -4)
- FOUND: src/server.test.ts (+269 / -1)
- FOUND: agent/loop.ts (+10 / -4)

**Commits in `git log`:**
- FOUND: 8f03dd4
- FOUND: 6cc401e
- FOUND: 920dee6
- FOUND: 4c8b880

**Verification gate results:** 9/9 PASS (위 Verification Gates 표 참조).

**Test results:** `bun test src/server.test.ts` → 23/23 PASS, `bun test` 전체 → 239 pass / 4 skip / 0 fail.

Worktree HEAD at start: 142646e
Worktree HEAD at end: 4c8b880
Branch: worktree-agent-a1232cea37ac4ba24
