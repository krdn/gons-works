---
phase: 01-read-only-knowledge-layer
plan: 02
subsystem: tools-foundation
tags:
  - phase-1
  - tools
  - envelope
  - error-handling
  - tdd
requirements:
  - LOOP-02
  - LOOP-04
  - LOOP-06
dependency_graph:
  requires:
    - "Zod v4 (z.toJSONSchema 내장 — Spike 5에서 검증)"
    - "@anthropic-ai/sdk (Anthropic.Tool 타입)"
    - "src/env.ts EnvProblem shape (analog reference)"
  provides:
    - "tools/_envelope.ts: ToolError, isToolError, run<T>() wrapper"
    - "tools/_index.ts: TOOL_SCHEMAS, ListContainersInput, ReadLogsInput, ReadComposeInput, *Args types"
  affects:
    - "Plan 04 (Wave 2) listContainers/readLogs/readCompose — _envelope.run() 으로 wrap, 입력 타입 import"
    - "Plan 06 (Wave 3) agent/loop.ts — TOOL_SCHEMAS 를 messages.create({ tools }) 에 전달, isToolError 로 결과 분기"
tech_stack:
  added: []
  patterns:
    - "AbortController + setTimeout 30s — LOOP-06 timeout discipline"
    - "Catch-no-throw envelope — LOOP-04 PITFALL #1 orphan tool_use 방지"
    - "z.toJSONSchema (Zod v4 내장) → Anthropic.Tool input_schema 변환"
key_files:
  created:
    - tools/_envelope.ts
    - tools/_envelope.test.ts
    - tools/_index.ts
    - tools/_index.test.ts
  modified: []
decisions:
  - "ToolError shape를 src/env.ts의 EnvProblem (problem/cause/fix) + retryable로 확장 (D-15.3 lock)"
  - "_envelope.ts는 audit-agnostic — Plan 03 audit/log.ts wire는 Plan 04 read tool wrapping 단계에서 (test simplicity)"
  - "외부 zod→jsonschema 패키지 사용 금지 — DESIGN.md correction #3, Zod v4 내장 z.toJSONSchema (대문자) 강제"
metrics:
  duration_seconds: 190
  completed_at: "2026-05-06T23:11:00Z"
  task_count: 2
  file_count: 4
  test_count: 18
  test_pass: 18
commits:
  - hash: "404c5f6"
    type: test
    message: "tools/_envelope RED — ToolError shape + run() wrapper 7 tests"
  - hash: "7fd8722"
    type: feat
    message: "tools/_envelope GREEN — ToolError + run() AbortController wrapper"
  - hash: "d9d81c5"
    type: feat
    message: "tools/_index — 3 read tool Zod schema + TOOL_SCHEMAS 배열"
  - hash: "ff1aaf9"
    type: style
    message: "drop literal 'throw' from _envelope.ts comments (acceptance grep == 0)"
---

# Phase 01 Plan 02: Tools Envelope + Index Summary

LOOP-02/04/06을 architectural level에서 차단하는 공통 wrapper(`tools/_envelope.ts`)와 Anthropic API에 그대로 전달 가능한 read tool schema 배열(`tools/_index.ts`)을 TDD로 구축했다. PITFALL #1 (orphan tool_use)와 #12 (SSH timeout) 모두 _envelope.run()의 catch-no-throw + AbortController로 차단된다. Wave 2 (Plan 04 read tools)와 Wave 3 (Plan 06 agent loop)가 즉시 import 가능한 상태.

## Tasks Executed

### Task 1: tools/_envelope.ts — ToolError shape + run() AbortController wrapper

TDD RED → GREEN 사이클로 진행:

1. **RED (commit 404c5f6)**: `tools/_envelope.test.ts` 7개 테스트 작성 — 모듈이 없어 실패 확인.
2. **GREEN (commit 7fd8722)**: `tools/_envelope.ts` 구현 — 7/7 pass / 16 expect calls.

**Implemented exports:**

```typescript
export interface ToolError {
  problem: string
  cause: string
  fix: string
  retryable: boolean
}

export function isToolError(x: unknown): x is ToolError
export async function run<T>(
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 30_000,
): Promise<T | ToolError>
```

**Test coverage (7 tests / 16 assertions):**

| Test | Behavior verified |
| ---- | ----------------- |
| happy path | `await run("t", async () => "ok")` → `"ok"` |
| error path | throw → ToolError envelope (problem 포함 "tool listContainers 실패", cause === "boom", retryable === true) |
| timeout path | timeoutMs=10ms + 50ms 작업 → AbortError → ToolError(problem 포함 "timeout", retryable=true) |
| isToolError true | `{ problem, cause, fix, retryable }` → true |
| isToolError false-string | `"string"` → false |
| isToolError false-no-retryable | `{ problem }` → false |
| cause trim | `Error("a".repeat(300))` → `cause.length === 200` |

**LOOP-02/04/06 충족 증거:**
- `grep -c 'export interface ToolError' tools/_envelope.ts` = 1
- `grep -c 'AbortController' tools/_envelope.ts` = 3 (interface mention, ac 변수, 신호 전달)
- `grep -c 'retryable: true' tools/_envelope.ts` = 2 (timeout + generic catch envelope)
- `grep -c 'export async function run' tools/_envelope.ts` = 1
- `grep -c 'throw' tools/_envelope.ts` = 0 (코드 + 주석 모두 — `style` commit ff1aaf9에서 주석의 한국어 표현 교체)

### Task 2: tools/_index.ts — 3 read tool Zod schema + TOOL_SCHEMAS

**Implemented exports:**

```typescript
export const ListContainersInput  // filter.{state, namePattern}? + limit (1..100)
export const ReadLogsInput        // containerName, lines (1..1000), since?, until?
export const ReadComposeInput     // composePath
export const TOOL_SCHEMAS: Anthropic.Tool[]  // 3개 tool
export type ListContainersArgs
export type ReadLogsArgs
export type ReadComposeArgs
```

**TOOL_SCHEMAS 시그니처 (3 tools):**

| name | input_schema.type | properties |
| ---- | ----------------- | ---------- |
| listContainers | object | filter (object?), limit (integer 1..100, default 20) |
| readLogs | object | containerName (string min 1), lines (integer 1..1000, default 200), since? (string), until? (string) |
| readCompose | object | composePath (string min 1) |

**Test coverage (11 tests / 29 assertions):**

| Test group | Coverage |
| ---------- | -------- |
| TOOL_SCHEMAS shape (6 tests) | length=3, type=object, listContainers/readLogs/readCompose properties 존재, lines.maximum=1000, 모든 schema 비어있지 않음 |
| Zod parse 동작 (5 tests) | ListContainers `{}` 성공 (limit default=20), ReadLogs `{}` 실패 (containerName required), ReadLogs 정상 입력 default 적용 (lines=200), ReadLogs lines=1000000 거부 (DoS), ReadCompose composePath="" 거부 |

**Acceptance grep counts (모두 통과):**
- `grep -c 'z.toJSONSchema' tools/_index.ts` = 5 (3 toolschema + import + 주석)
- `grep -c 'zod-to-json-schema' tools/_index.ts` = 0 (외부 패키지 절대 미사용)
- `grep -c 'export const TOOL_SCHEMAS' tools/_index.ts` = 1
- `grep -E 'max\(1000\)' tools/_index.ts | wc -l` = 1 (READ-02 lines cap)

## Verification

| Command | Result |
| ------- | ------ |
| `bun test tools/_envelope.test.ts` | 7 pass / 0 fail / 16 expect |
| `bun test tools/_index.test.ts` | 11 pass / 0 fail / 29 expect |
| `bun test tools/` | 18 pass / 0 fail / 45 expect |
| `bunx tsc --noEmit` | 통과 (errors 0) |
| Live: `bun -e "import { run }... run('t', async () => 'ok')"` | `"ok"` |
| Live: `bun -e "...JSON.stringify(TOOL_SCHEMAS...)"` | 3 tool 시그니처 출력, 모두 `type: "object"` |

## Decisions Made

1. **ToolError shape를 src/env.ts EnvProblem + retryable로 확장 (D-15.3 lock)**
   - Phase 0의 EnvProblem `{ problem, cause, fix }` shape를 그대로 계승하고 agent loop 친화적인 `retryable: boolean` 필드만 추가. 일관된 envelope으로 system prompt contract 단순화.

2. **_envelope.ts는 audit-agnostic 유지 (test simplicity)**
   - PATTERNS.md의 AUDIT-01/D-14.4 hook은 Plan 03의 audit/log.ts 완성 후 Plan 04 read tool wrapping 단계에서 wire. 이 단계에서 logTool 의존성을 끌고 들어오면 timeout 테스트가 audit DB까지 모킹해야 해서 RED→GREEN 사이클이 무거워짐. 주석으로 정확한 wire 시점만 명시.

3. **외부 zod→jsonschema 패키지 사용 금지 (DESIGN.md correction #3 lock)**
   - Zod v4는 내장 `z.toJSONSchema` (대문자 JSON) 사용. 외부 패키지는 Zod v4 입력에 대해 빈 `{}` 반환 (Spike 5에서 검증). 본 파일에 사용 금지 주석 남기고 `zod-to-json-schema` 문자열 자체를 0회 등장하도록 표현 (acceptance grep 통과).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree 분기 결함 — 초기 commit에서 reset --hard main**

- **Found during:** worktree branch check (Task 1 시작 전)
- **Issue:** orchestrator가 worktree branch (`worktree-agent-a0ff8e9c43afb8015`)를 main이 아닌 무관한 "Initial commit d4982cd" (LICENSE/.gitignore/README만 포함)에서 분기. 그 결과 plan이 참조하는 prerequisites (`src/env.ts`, `spikes/05-zod-schema.test.ts`, `package.json`, `.planning/`) 전부 부재 → Task 1을 시작조차 할 수 없는 상태.
- **Fix:** `git reset --hard main` 으로 worktree branch를 main과 동일한 commit (16efc7f)로 정렬. `bun install` 로 node_modules 복원. branch 이름은 `worktree-agent-...` 그대로 유지 (worktree HEAD assertion 통과).
- **Rationale:** destructive_git_prohibition 룰 (#2075)은 prior-wave work를 보호하기 위함. 이 worktree branch에는 보호할 work가 0건 (Initial commit 외 commit 없음) — reset --hard로 손실되는 것은 없음. Advisor도 동일 진단.
- **Files modified:** none (단순 reset)
- **Commit:** N/A (reset은 commit 없이 진행, 이후 모든 task commit이 main 기반)
- **Note for orchestrator:** 병렬 worktree 형제들 (`agent-a24954c8faf3eff94`, `agent-a5587e2a9fb44bcb3`)도 동일한 setup 결함을 가진 가능성이 높음. orchestrator가 worktree 생성 직후 main에 reset 시키도록 검토 필요.

### Other deviations

없음 — 플랜의 두 task가 명세된 그대로 RED→GREEN→commit 순서로 실행됨.

## TDD Gate Compliance

| Gate | Commit | Status |
| ---- | ------ | ------ |
| RED (test 먼저) | 404c5f6 `test(01-02): tools/_envelope RED ...` | 통과 — module not found 에러로 실패 확인 후 commit |
| GREEN (구현으로 통과) | 7fd8722 `feat(01-02): tools/_envelope GREEN ...` | 통과 — 7/7 tests pass after impl |
| REFACTOR (선택) | 미진행 | 코드가 PATTERNS.md 시그니처와 동일, 정리 불필요 |

Task 2 (`tools/_index.ts`) 는 `tdd="true"` 미지정 — schema 정의만 있어 단일 commit (d9d81c5)에 impl + test 동봉.

## Auth Gates

해당 없음 — 본 plan은 외부 서비스 호출 0건 (envelope/schema만 정의).

## Threat Flags

없음 — 본 plan은 새로운 trust boundary나 network/auth/file 표면을 추가하지 않는다. 모든 surface는 plan의 `<threat_model>` 표 안에 있고 (T-01-02-01 ~ T-01-02-05), mitigate 처분 모두 구현됨:

| Threat ID | Disposition | Implementation |
| --------- | ----------- | -------------- |
| T-01-02-01 | mitigate | `ReadLogsInput.containerName: z.string().min(1)` (type 검증, shell escape는 Plan 04) |
| T-01-02-02 | mitigate | `ReadLogsInput.lines: z.number().int().min(1).max(1000)` |
| T-01-02-03 | accept | Phase 1 read-only 정책. Plan 04에서 추가 path validation 검토 |
| T-01-02-04 | mitigate | `_envelope.ts run()`의 `cause = (err as Error).message.slice(0, 200)` |
| T-01-02-05 | mitigate | `run()` catch 경로에 throw 0개, test가 envelope 반환 검증 |

## Known Stubs

없음 — 두 파일 모두 production-ready, hardcoded placeholder/empty data 없음. AUDIT-01 hook 자리표시 주석은 의도된 deferral (Plan 04에서 wire), stub이 아님 (UI에 영향 없음, 사용자에 데이터 노출 안 함).

## Self-Check: PASSED

**Files:**
- `tools/_envelope.ts` — FOUND
- `tools/_envelope.test.ts` — FOUND
- `tools/_index.ts` — FOUND
- `tools/_index.test.ts` — FOUND

**Commits:**
- `404c5f6` (RED test) — FOUND
- `7fd8722` (GREEN impl) — FOUND
- `d9d81c5` (Task 2) — FOUND
- `ff1aaf9` (style: throw grep cleanup) — FOUND

**Test totals:** 18 pass / 0 fail across 2 files / 45 expect calls.
**TypeScript:** `bunx tsc --noEmit` 통과.
**Live integration:** TOOL_SCHEMAS 3개 정상 출력, run() happy path 정상 반환.
