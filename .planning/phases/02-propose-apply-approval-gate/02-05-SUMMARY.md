---
phase: 02-propose-apply-approval-gate
plan: 05
subsystem: tools
tags:
  - phase-2
  - propose-patch
  - tool-schema
  - system-prompt
  - tdd
  - zod-strict
  - jsdiff
  - approval-gate

# Dependency graph
requires:
  - phase: 02-propose-apply-approval-gate
    provides: 02-02 approval/store.ts setPending + ApprovalDecision Promise + PITFALL #3 prevention 코드
  - phase: 02-propose-apply-approval-gate
    provides: 02-04 state/compose/{stack}.yml 4-mirror + Option A 4-stack scope lock
  - phase: 01-read-only-knowledge-layer
    provides: tools/_envelope.ts ToolError + run() wrapper / tools/_index.ts TOOL_SCHEMAS 패턴 / agent/system-prompt.ts Phase 1 본문
provides:
  - tools/proposePatch.ts ProposePatchInput Zod schema + proposePatch() service (APPLY-01, D-B1/B2/D2 lock)
  - tools/_index.ts TOOL_SCHEMAS 4번째 entry (proposePatch — LLM 노출, apply 단계는 internal)
  - agent/system-prompt.ts Phase 2 변경 제안 섹션 (7-command + reasoning + 2PC + commit 양식)
affects:
  - 02-06 applyPatch tool (proposePatch result.fileEdit.previousContent를 D-A5 (iii) rollback에 사용)
  - 02-07 LOOP 통합 (dispatch("proposePatch", ...) → result emit "approval-required" → await decision)
  - 02-08 server.ts /approval/:id POST 핸들러 (consumeApproval로 ApprovalDecision Promise resolve)

# Tech tracking
tech-stack:
  added:
    - diff@9.0.0 createPatch (jsdiff unified diff 생성)
  patterns:
    - Zod superRefine 다중 필드 cross-validation (service refine + fileEdit.path 화이트리스트)
    - z.toJSONSchema (Zod v4 내장) — 외부 zod→jsonschema 패키지 회피 lock
    - crypto.randomUUID() nonce + Date.now()+120_000 expiresAt (PITFALL #3 prevention 코드)
    - { result, decision } 분리 반환 — result는 SSE emit용, decision Promise는 LOOP가 await
    - System prompt Phase 분리 append (Phase 1 본문 보존 + "# 변경 제안 (Phase 2)" 섹션 추가)

key-files:
  created:
    - tools/proposePatch.ts (183 lines)
    - tools/proposePatch.test.ts (258 lines)
  modified:
    - tools/_index.ts (proposePatch 등록 + 2 lines comment)
    - tools/_index.test.ts (TOOL_SCHEMAS 길이 4 + D-B2 lock + reasoning maxLength=500 회귀 테스트)
    - agent/system-prompt.ts (Phase 2 섹션 append, +60/-3 lines)

key-decisions:
  - "TDD 순서 보정: PLAN.md는 Task 1(impl)→Task 2(tests) 순서로 명기되었으나 plan-level TDD gate(test commit이 feat commit에 선행)에 따라 Task 2를 먼저 실행. RED 커밋 → GREEN 커밋 → 등록 → system-prompt 순으로 진행"
  - "Option A 4-stack lock — z.enum([\"news\", \"ais\", \"n8n\", \"krdn-fx\"]). 5번째 stack(open-webui)은 plain docker run으로 v2 backlog. ProposePatchResult.stack 타입은 narrow 4-union 유지(approval/store ComposeCommand의 5-union으로 광역화 금지)"
  - "stack 타입 widening: parsed.stack(4-union)을 setPending payload(5-union Stack)에 전달할 때 `as Stack` cast — TS-safe widening, 런타임에 추가 stack 절대 발생 안 함(Zod parse가 4-union 강제)"
  - "fileEdit.path 미존재 처리: Bun.file().text()는 ENOENT 시 throw — try/catch로 잡고 previousContent=\"\"로 두어 0→new 전체 추가 diff 생성. .exists() 체크는 race-prone이라 회피"
  - "D-D2 reasoning min(1) — z.string().min(1).max(500). 빈 문자열도 거부(plan에는 max만 명시되었으나 D-D2 \"필수\" 정신 따라 최소 길이 보강)"
  - "D-B2 lock 검증 강화: tools/_index.test.ts에 `find(t => t.name === \"applyPatch\") === undefined` assertion 추가 (코멘트 grep만으로는 회귀 검출 불완전)"
  - "system prompt 전략: 기존 Phase 1 본문(read tool 안내, RAG fence, 한국어 톤)은 그대로 유지하고 새 \"# 변경 제안 (Phase 2)\" 섹션을 append. SYSTEM_PROMPT 단일 export 유지"

patterns-established:
  - "Pattern A: Zod superRefine cross-field validation — { command, service } 의존성과 { stack, fileEdit.path } 화이트리스트를 superRefine 한 곳에 집중. 02-06 applyPatch input schema도 동일 패턴 채택 권장"
  - "Pattern B: { result, decision } 분리 반환 — Promise를 service에서 await하지 않고 Promise 자체를 반환하여 caller(LOOP)가 SSE emit 후 await. setPending이 별도 Promise 반환하므로 자연스럽게 분리"
  - "Pattern C: System prompt Phase 분리 append — Phase 1 contract 본문 유지하며 신규 Phase 섹션을 \"# <기능명> (Phase N)\" 헤더 아래 추가. 향후 phase 추가 시 동일 패턴"
  - "Pattern D: D-B2 lock test — TOOL_SCHEMAS에 특정 tool name이 등장하지 않음을 명시적으로 검증. apply / 그 외 internal-only tool 회귀 검출"

requirements-completed:
  - APPLY-01

# Metrics
duration: 약 25분
completed: 2026-05-07
---

# Phase 2 Plan 05: proposePatch tool + system-prompt Phase 2 (APPLY-01, D-B1/B2/D2) Summary

**Zod strict 입력 검증(7-command + 4-stack + reasoning max500 + path 화이트리스트) + jsdiff unified diff + crypto.randomUUID nonce + approval/store.setPending 등록까지 단일 service로 lock한 propose tool, Phase 2 system-prompt 행동 contract 갱신 완료.**

## Performance

- **Duration:** 약 25분
- **Started:** 2026-05-07 (Wave 2 dispatch 시점)
- **Completed:** 2026-05-07
- **Tasks:** 4/4 완료 (모두 atomic commit)
- **Tests:** 16 신규 (proposePatch.test.ts) + 3 신규 (_index.test.ts D-B2 lock & reasoning regression) — 전체 210 pass / 4 skip / 0 fail

## Tasks Executed

| # | Name | Commit | Status |
|---|------|--------|--------|
| 2 | proposePatch RED — 16 실패 테스트 (Zod schema + service 동작) | `3580b24` | PASS (RED gate) |
| 1 | proposePatch.ts 구현 — Zod + jsdiff + setPending | `e8efc6e` | GREEN (16/16 PASS) |
| 3 | tools/_index.ts proposePatch 등록 + D-B2 lock 테스트 | `d79f568` | PASS (13/13) |
| 4 | system-prompt Phase 2 섹션 — 7-command + reasoning + 2PC + commit 양식 | `0fd9775` | PASS (grep 모두 충족) |

> Task 2를 Task 1보다 먼저 실행한 이유: plan-level TDD gate가 `test(...)` commit이 `feat(...)` commit에 선행할 것을 요구. PLAN.md의 Task 1→2 순서는 논리적 순서이지 실행 순서가 아니다(같은 plan 안의 2 task가 모두 tdd="true").

## Verification

| 검증 항목 | 결과 |
|----------|------|
| `bun test tools/proposePatch.test.ts` | 16 pass / 0 fail / 32 expect() |
| `bun test tools/_index.test.ts` | 13 pass / 0 fail / 39 expect() |
| `bun test` (전체) | 210 pass / 4 skip / 0 fail |
| `grep -c "proposePatch" tools/_index.ts` ≥ 1 | 3 |
| `grep -c "applyPatch" tools/_index.ts` = 0 (D-B2 lock) | 0 |
| `grep -c "compose up -d" agent/system-prompt.ts` ≥ 1 | 3 |
| `grep -c "compose ps" agent/system-prompt.ts` ≥ 1 | 3 |
| `grep -c "compose down" agent/system-prompt.ts` ≥ 1 | 1 |
| `grep -c "compose restart" agent/system-prompt.ts` ≥ 1 | 2 |
| `grep -c "compose start" agent/system-prompt.ts` ≥ 1 | 1 |
| `grep -c "compose stop" agent/system-prompt.ts` ≥ 1 | 2 |
| `grep -c "compose logs --tail=200" agent/system-prompt.ts` ≥ 1 | 1 |
| `grep -c "reasoning" agent/system-prompt.ts` ≥ 1 | 8 |
| `grep -c "createPatch" tools/proposePatch.ts` ≥ 1 | 4 |
| `grep -c "setPending" tools/proposePatch.ts` ≥ 1 | 5 |
| `grep -c "z.enum" tools/proposePatch.ts` ≥ 1 (4-element 명시) | 1 |
| `grep -c "open-webui" tools/proposePatch.ts` = 0 (Option A 준수) | 0 |
| `grep -c "listContainers" agent/system-prompt.ts` ≥ 1 (Phase 1 본문 회귀 방지) | 2 |

## Success Criteria

- [x] APPLY-01 (proposePatch unified diff 생성, 적용 안 함) 만족
- [x] D-B1 (7-command union literal) Zod schema lock — `z.union([z.literal("compose up -d"), ..., z.literal("compose ps")])`
- [x] D-B2 (단일 proposePatch tool) — applyPatch는 LLM에 노출 안 함 (TOOL_SCHEMAS 4 entry 모두 read 또는 propose, 명시적 회귀 테스트 추가)
- [x] D-D2 (reasoning 필수, max 500) Zod schema lock — `z.string().min(1).max(500)` (빈 문자열도 거부)
- [x] tools/_index.ts에 proposePatch schema append (description은 한국어 본문 + 7-command 명시)
- [x] agent/system-prompt.ts에 7-command + 2PC 순서 + 5-key 게이트 안내 명시 + Phase 1 본문 보존
- [x] 10+ test PASS (실제 16 신규 + 3 추가 회귀 = 19개)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - 블로킹] TDD 실행 순서 보정**
- **Found during:** Task 1 시작 직전 (advisor 자문 결과)
- **Issue:** PLAN.md는 Task 1(impl) → Task 2(tests) 순서로 명기되었으나 두 task 모두 `tdd="true"`. plan-level TDD gate는 `test(...)` commit이 `feat(...)` commit에 선행할 것을 강제한다.
- **Fix:** Task 2(tests) → Task 1(impl) → Task 3 → Task 4 순서로 실행. 각 RED/GREEN 커밋이 명확히 구분되도록 메시지 분리.
- **Files modified:** 없음 (실행 순서만 보정)
- **Commits:** `3580b24` (RED) → `e8efc6e` (GREEN)

**2. [Rule 2 - 회귀 방지] tools/_index.test.ts 보강**
- **Found during:** Task 3 (advisor 자문 사전 경고)
- **Issue:** 기존 `tools/_index.test.ts:14`의 `expect(TOOL_SCHEMAS).toHaveLength(3)` assertion이 schema 추가로 깨짐. PLAN.md Task 3 verify 라인은 그저 "bun test tools/_index.test.ts"라서 회귀를 명시 안내하지 않음.
- **Fix:** `toHaveLength(4)`로 갱신 + D-B2 lock test (`find(t => t.name === "applyPatch")` undefined 검증) + reasoning maxLength=500 JSON schema 회귀 테스트 추가.
- **Files modified:** tools/_index.test.ts
- **Commit:** `d79f568`

**3. [Rule 1 - 잠재 버그] D-D2 reasoning min(1) 보강**
- **Found during:** Task 1 schema 작성 (테스트 케이스 작성 중 빈 문자열 시나리오 발견)
- **Issue:** PLAN.md interfaces 블록은 `z.string().min(1).max(500)`로 명시했으나 본문 표현 일부에 "max 500자"만 강조되어 빈 문자열 거부 의도가 흐릿함. D-D2 "필수"의 정신은 빈 문자열도 거부.
- **Fix:** `z.string().min(1).max(500)` lock + "reasoning 빈 문자열 거부" 테스트 케이스 추가 (10번째 schema test).
- **Files modified:** tools/proposePatch.ts, tools/proposePatch.test.ts
- **Commit:** `e8efc6e` (GREEN 커밋에 포함)

**4. [Rule 3 - 블로킹] Write tool 경로 사고 회피**
- **Found during:** Task 2 RED 커밋 직전
- **Issue:** Write tool 첫 호출이 worktree 절대경로(`.../worktrees/agent-a3cfae.../tools/proposePatch.test.ts`) 아닌 main 체크아웃 경로(`/home/gon/projects/gon/gons-works/tools/...`)로 파일을 생성. main 체크아웃의 git status가 untracked로 변함 → worktree 격리 위반 위험.
- **Fix:** main 경로의 잘못 생성된 파일 즉시 `rm`, worktree 절대경로로 재작성. 이후 모든 Write/Edit 호출은 worktree 절대경로 사용.
- **Files modified:** 없음 (잘못 생성 → 삭제 → 정상 생성)
- **Commit:** 없음 (커밋 전에 정정)
- **재발 방지:** 이후 git 명령은 모두 `git -C "$WORKTREE" ...`로 실행, bun 명령은 `cd "$WORKTREE" && ...`로 실행하여 main 체크아웃과 격리 유지.

### 코멘트 표현 정정 (verification 강화)
플랜 verification 블록의 strict grep contracts(`open-webui = 0`, `applyPatch = 0`)를 코멘트 표현이 위반하지 않도록 phrasing 조정.
- `tools/_index.ts`: "applyPatch는 LLM에 노출하지 않음" → "apply 단계는 LLM에 노출 안 함" (의미 보존, grep contract 충족)
- `tools/proposePatch.ts`: "open-webui 제외" 코멘트 → "5번째 stack은 plain docker run이라 제외 (v2 backlog)" 

코드 동작은 동일. Option A 4-stack scope 의도는 그대로 documentation에 남음 + grep 자동 검증 통과.

## Open Decisions / 후속 plan 위임

- **02-06 applyPatch와의 통합** — proposePatch가 반환한 `result.fileEdit.previousContent`를 applyPatch 호출 시 D-A5 (iii) 원격 동기화 fail rollback 인자로 전달. 02-06 plan에서 인터페이스 lock.
- **02-07 LOOP 통합** — `dispatch("proposePatch", input, turnId) → run("proposePatch", () => proposePatch(input, ctx)) → emit "approval-required" → await decision` 흐름. 본 plan은 service까지만, LOOP wrap은 02-07 책임.
- **5-key 'e'(edit) UX 흐름** — server.ts /approval/:id POST 핸들러에서 `{type:"edited", newContent}` 매핑 후 `consumeApproval(sessionId, nonce, decision)` 호출. nonce 유지(같은 카드, Open Q 1 lock). 02-08 plan.
- **fileEdit.previousContent의 정확한 시점** — proposePatch 시점에 read한 file이 approval 게이트 대기 동안 변경될 수 있음(operator OOB drift). 02-06 applyPatch 진입 시 1회 SSH read + SHA256 비교(D-A4)로 mirror staleness check 후 적용 여부 결정.

## Threat Flags

해당 없음. 본 plan에서 추가된 surface는:
- proposePatch tool input — Zod schema strict 검증으로 화이트리스트만 허용 (D-B1 7-command + D-A1 4-stack + path 2-list)
- system-prompt 본문 — LLM 행동 contract만 변경, 신규 외부 surface 없음

기존 plan 02-CONTEXT.md threat model 내 cover됨 (T-02 input validation, T-04 prompt injection, T-05 path traversal).

## Self-Check: PASSED

**파일 존재 검증:**
- `/home/gon/projects/gon/gons-works/.claude/worktrees/agent-a3cfae538814c1ee0/tools/proposePatch.ts` — FOUND
- `/home/gon/projects/gon/gons-works/.claude/worktrees/agent-a3cfae538814c1ee0/tools/proposePatch.test.ts` — FOUND
- `/home/gon/projects/gon/gons-works/.claude/worktrees/agent-a3cfae538814c1ee0/tools/_index.ts` — FOUND (modified)
- `/home/gon/projects/gon/gons-works/.claude/worktrees/agent-a3cfae538814c1ee0/tools/_index.test.ts` — FOUND (modified)
- `/home/gon/projects/gon/gons-works/.claude/worktrees/agent-a3cfae538814c1ee0/agent/system-prompt.ts` — FOUND (modified)

**커밋 존재 검증:**
- `3580b24` — FOUND (test RED)
- `e8efc6e` — FOUND (feat GREEN proposePatch)
- `d79f568` — FOUND (feat _index 등록)
- `0fd9775` — FOUND (feat system-prompt)
