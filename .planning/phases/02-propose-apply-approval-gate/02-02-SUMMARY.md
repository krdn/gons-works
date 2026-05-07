---
phase: 02-propose-apply-approval-gate
plan: 02-02
subsystem: approval
type: execute
wave: 1
requirements: [APPLY-03]
tags:
  - phase-2
  - approval-gate
  - in-memory-store
  - pitfall-3-prevention
  - tdd
provides:
  - approval/store.ts (setPending / consumeApproval / expirePending / _resetForTest)
  - PendingApproval / ApprovalDecision / Stack / ComposeCommand 타입
requires:
  - agent/loop.ts (analog: inFlight Map + _resetForTest 패턴)
  - tools/_envelope.ts (carry-forward: ToolError shape — rejected/expired는 server route가 매핑)
affects:
  - 02-05 proposePatch (setPending 호출자)
  - 02-07 loop.ts (setPending 반환 Promise await + AbortController → expirePending)
  - 02-08 server.ts (POST /approval/:id → consumeApproval)
  - 02-09 public/index.html (5-key form, nonce hidden field)
key-files:
  created:
    - approval/store.ts
    - approval/store.test.ts
  modified: []
decisions:
  - PITFALL #3 prevention 코드 verbatim 적용 (consumed=true BEFORE resolve)
  - waitForApproval 헬퍼 미export (Open Q 2 lock — sessionId만으로 Promise 재 attach 불가)
  - "edited" 결정은 nonce 유지, newContent만 LOOP에 전달 (Open Q 1 lock)
  - 자동 setTimeout으로 expire 처리 (Date.now() < expiresAt 체크는 동기적 race 보호)
metrics:
  test_count: 14
  test_pass: 14
  test_fail: 0
  files_created: 2
  total_lines: 429
  duration: ~25분
  completed: 2026-05-07
---

# Phase 2 Plan 02: approval/store.ts (APPLY-03 PITFALL #3 prevention) Summary

**한줄 요약:** in-memory `Map<sessionId, PendingEntry>` 기반 승인 게이트 store. nonce + 2분 expiresAt + consumed flag 3-layer로 race condition 차단, LOOP가 setPending 반환 Promise를 await하는 단일 진실 공급원.

## Outcome

APPLY-03 (승인 nonce + 2분 만료 + consumed atomic) 구현 완료. PITFALLS.md Pitfall 3 prevention 코드 verbatim 적용으로 nonce mismatch / double-press / expired 3-race를 모두 throw로 차단하고 첫 정상 호출만 통과. 02-05(proposePatch) 등 후속 plan들이 import할 수 있는 export 시그니처 lock.

**TDD 사이클 준수:**
- RED: 14개 test 작성 후 `bun test approval/` → "Cannot find module './store'"로 실패 확인. 커밋 `de02226`.
- GREEN: store.ts 구현 후 14/14 PASS. 커밋 `8b8777a`.
- REFACTOR: 추가 정리 불필요 (PITFALL #3 prevention 코드는 lock된 형태).

## Files Touched

| 파일 | 상태 | 라인 수 | 역할 |
| --- | --- | --- | --- |
| `approval/store.ts` | created | 195 | module-level Map + setPending / consumeApproval / expirePending / _resetForTest + 타입 export |
| `approval/store.test.ts` | created | 234 | 14 test cases — 9 plan-required behaviors + 5 edge cases (multi-session, no-pending no-op 등) |

**Plan files_modified와 정확히 일치** (다른 모듈 미수정).

## Test Results

```
bun test v1.3.6 (d530ed99)

 14 pass
 0 fail
 23 expect() calls
Ran 14 tests across 1 file. [29.00ms]
```

**Test coverage map (plan `<behavior>` 9 cases + 추가):**

| # | 테스트 | Plan behavior | 상태 |
|---|--------|---------------|------|
| 1 | 정상 흐름: setPending → consumeApproval(approved) → resolve | #1 | PASS |
| 2 | nonce mismatch → throw "Stale approval" | #2 | PASS |
| 3 | double-press → throw (consumed/no-pending) | #3 | PASS |
| 4 | expired 자동 setTimeout → resolve(expired) | #4 | PASS |
| 5 | expirePending external (loop abort) → resolve(expired) | #5 | PASS |
| 6 | edited decision (newContent payload 전달) | #6 | PASS |
| 7 | rejected → resolve + 같은 sessionId 재등록 가능 | #7 | PASS |
| 8 | session conflict → "Pending approval already exists" | #8 | PASS |
| 9 | set-before-resolve invariant (double-press throw로 검증) | #9 | PASS |
| 10 | expired 동기 race (consumeApproval가 expired 분기) | extra | PASS |
| 11 | aborted decision payload 전달 | extra | PASS |
| 12 | multi-session 격리 | extra | PASS |
| 13 | expirePending no-op (race-safe) | extra | PASS |
| 14 | consumeApproval no-pending → throw | extra | PASS |

**Plan grep 검증:**
- `grep -c "consumed = true" approval/store.ts` = 1 (≥ 1 OK)
- `grep -c "Date.now() > a.expiresAt" approval/store.ts` = 1 (≥ 1 OK — PITFALL #3 prevention 인용)
- `grep -c "pending.delete" approval/store.ts` = 4 (≥ 3 OK — consume normal / consume expired / expirePending / setTimeout)
- export 시그니처 `<interfaces>` 블록과 1:1 일치 (setPending / consumeApproval / expirePending / _resetForTest + 타입 PendingApproval / ApprovalDecision / Stack / ComposeCommand).

**Type-check:**
- `bunx tsc --noEmit` — `approval/` 디렉토리 에러 0.
- 기존 `tools/_envelope.ts:85,87` TS2454 에러 2개는 본 plan 범위 밖(deviation 미적용 — Phase 1 carry-forward, 별도 hotfix 대상).

## Deviations

**없음.** Plan 02-02 명세 그대로 실행.

세부 결정 lock 모두 준수:
- PITFALL #3 prevention 코드 verbatim (consumed=true BEFORE resolve, nonce check, expired race).
- `waitForApproval` 헬퍼 미export (Open Q 2 lock — LOOP가 setPending 반환 Promise를 직접 await).
- `_resetForTest()` 노출 (`agent/loop.ts` 컨벤션 carry-forward).
- D-A1 5 stack literal + D-B1 7 command literal 타입 export.
- D-D2 `reasoning` + `user_prompt` 필드 sanitization 책임은 store가 아닌 `state/commit.ts`에 위임 (raw 보관).

추가 테스트 5개(#10~#14)는 plan `<behavior>` 9 cases를 충족하면서 race-safety 보강 (multi-session 격리 / no-op idempotency / 동기 expired 분기). plan 명시 미요구지만 verification 강화 — 명세 위반 아님.

## Notes-for-next-plan

### 02-05 (proposePatch) 작성 시 import 패턴

```typescript
import { setPending, type PendingApproval, type Stack, type ComposeCommand } from "../approval/store"

// proposePatch tool body:
const nonce = crypto.randomUUID()
const expiresAt = Date.now() + 120_000
const promise = setPending(sessionId, {
  nonce, diff, stack, command, service, fileEdit, reasoning, user_prompt, expiresAt,
})
// emit("approval-required", { nonce, diff, ... })
const decision = await promise
// decision.type === "approved" / "edited" → applyPatch 호출
// 그 외 → ToolError envelope 반환
```

**주의:** `setPending`이 동일 sessionId 두 번째 호출 시 throw — 02-05/02-07이 이미 pending 있을 때 새 proposePatch 시도 막아야 함 (또는 직전 expirePending 후 재시도).

### 02-07 (loop.ts) AbortController wire

```typescript
// agent/loop.ts:286-292 externalSignal addEventListener 패턴 참고:
ac.signal.addEventListener(
  "abort",
  () => expirePending(sessionId),
  { once: true },
)
```

`expirePending`이 race-safe (silent no-op for missing entry) 이라 chunk timeout 도중 이미 사용자가 5-key를 누른 경우에도 안전.

### 02-08 (server.ts /approval/:id POST) 응답 매핑

`consumeApproval`이 던지는 4가지 Error 메시지 → HTTP status:
- "No pending approval" → 404
- "Stale approval — nonce mismatch" → 409
- "Already consumed (double-press guard)" → 409
- "Approval expired (2 min)" → 410

ToolError envelope shape으로 클라이언트에 응답 (D-15.4 carry-forward).

### 02-09 (public/index.html) 5-key form 작성 시

- hidden field `nonce` 값을 `parsed.nonce` (SSE `approval-required` payload)에서 가져옴.
- `e`(edit) 키 누를 시 textarea의 newContent를 `decision: { type:"edited", newContent }`로 POST.
- 5-key 인라인 legend `y=apply n=reject e=edit d=diff a=abort` 항상 visible (DESIGN.md correction #5 lock).

### Worktree 초기 sync 이슈 (orchestrator 메모)

본 agent worktree(`agent-a3b2d581a1dff79fb`)는 spawn 시 main 트래킹 없이 별도 initial commit(`d4982cd`)으로 시작됨 — 빈 working tree 상태. `git reset --hard a93901f`(main HEAD)로 동기화 후 진행. 향후 orchestrator는 worktree spawn 시 main HEAD로 자동 align되도록 sync hook 점검 권장.

## Self-Check: PASSED

**Files:**
- `approval/store.ts`: FOUND (195 lines)
- `approval/store.test.ts`: FOUND (234 lines)

**Commits:**
- `de02226` test(02-02): approval/store 테스트 추가 (RED)
- `8b8777a` feat(02-02): approval/store.ts 구현 (GREEN)

**Tests:** 14/14 PASS, 0 fail (`bun test approval/`)

**Plan verification:**
- All 5 verification commands pass (grep counts + bun test).
- All 5 success criteria met (export lock, PITFALL #3 verbatim, ≥9 tests, APPLY-03 satisfied, Open Q 1 edited decision lock).

## TDD Gate Compliance

- RED gate: `de02226` `test(02-02): ...` — store.ts 미존재 상태에서 14 test 작성, "Cannot find module" 실패 확인 후 commit.
- GREEN gate: `8b8777a` `feat(02-02): ...` — store.ts 구현 후 14/14 PASS, commit.
- REFACTOR gate: 별도 commit 없음 (PITFALL #3 prevention 코드는 plan-locked 형태로 추가 정리 불필요).
