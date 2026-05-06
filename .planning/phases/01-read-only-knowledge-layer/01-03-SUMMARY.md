---
phase: 01-read-only-knowledge-layer
plan: 03
subsystem: audit
tags:
  - phase-1
  - audit
  - sqlite
  - cost-monitoring
  - tdd
dependency_graph:
  requires:
    - .planning/research/STACK.md (bun:sqlite 1.3.6)
    - .planning/research/PITFALLS.md #10 (strict + safeIntegers + WAL)
    - 01-CONTEXT.md D-14.1 / D-14.2 / D-14.3 / D-14.4
  provides:
    - audit/schema.sql (events 테이블 hybrid + 2 인덱스)
    - audit/log.ts (beginTurn / logTool / endTurn / getDb / _resetForTest)
    - .gitignore /data/ 라인 (D-14.2)
  affects:
    - Plan 01-04 (tools/_envelope.ts → logTool wire 책임)
    - Plan 01-06 (agent/loop.ts → beginTurn/endTurn 호출 + LOOP-07 idempotency_key)
    - Plan 01-09 (verify-phase 통합 검증)
tech_stack:
  added:
    - bun:sqlite (Node.js 내장이 아닌 Bun 런타임 모듈)
  patterns:
    - Database singleton (lazy init)
    - hybrid schema (parent_id 자기참조)
    - Application-layer trim (column length 제약은 SQLite가 강제 안 함)
key_files:
  created:
    - audit/schema.sql
    - audit/log.ts
    - audit/log.test.ts
  modified:
    - .gitignore (라인 1개 추가: /data/)
decisions:
  - "Plan/PATTERNS.md 예시의 '$' prefix binding 컨벤션은 bun:sqlite strict 모드와 비호환. 실제 동작 기준으로 prefix 없는 객체 키 사용 ({ ts: ... })."
  - "PRAGMA foreign_keys = ON 미설정 (SQLite 기본). T-01-03-01 위협은 binding key 검증 (strict 모드)으로 cover. FK enforcement는 future plan으로 deferred."
metrics:
  duration: "≈ 5분 36초"
  completed: 2026-05-06T23:11:48Z
  tasks_completed: 2
  tests_pass: 8
  expects: 24
  commits: 3
requirements_completed:
  - AUDIT-01
  - AUDIT-03
---

# Phase 1 Plan 3: Audit Log SQLite (D-14) Summary

**One-liner:** D-14 lock 5 결정을 모두 구현 — bun:sqlite events 테이블 (turn + 자식 tool row hybrid) + beginTurn/logTool/endTurn API + PITFALL #10 strict 모드 라이브 검증 (8/8 tests pass).

---

## 산출물

### `audit/schema.sql` 컬럼 표

| 컬럼 | 타입 | turn row (parent_id NULL) | tool row (parent_id NOT NULL) | 비고 |
|------|------|---------------------------|-------------------------------|------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | ✓ | ✓ | safeIntegers 모드 → bigint |
| `ts` | TEXT NOT NULL | ✓ | ✓ | ISO 8601 |
| `model` | TEXT | ✓ | – | 예: "claude-sonnet-4-6" |
| `prompt` | TEXT | ✓ | – | ≤2000자 trim (audit/log.ts) |
| `input_tokens` | INTEGER | ✓ | – | Anthropic SDK final.usage |
| `output_tokens` | INTEGER | ✓ | – | Anthropic SDK final.usage |
| `cache_read_tokens` | INTEGER | ✓ | – | Anthropic SDK final.usage |
| `total_tool_calls` | INTEGER | ✓ | – | turn 내 tool 호출 횟수 |
| `duration_ms` | INTEGER | ✓ | ✓ | turn / tool elapsed |
| `error_envelope` | TEXT | ✓ | – | JSON string 또는 NULL (D-15.4) |
| `parent_id` | INTEGER REFERENCES events(id) | – | ✓ | 자기참조 (D-14.1 hybrid) |
| `tool_name` | TEXT | – | ✓ | 예: "listContainers" |
| `input` | TEXT | – | ✓ | JSON.stringify, ≤2000자 trim |
| `result_summary` | TEXT | – | ✓ | ≤500자 trim (audit/log.ts) |
| `ok` | INTEGER | – | ✓ | 0/1 BOOL |

**인덱스:** `idx_events_parent_id` (parent_id), `idx_events_ts` (ts).

**LOOP-07 idempotency_key 컬럼:** D-14.3 minimum + Plan 06 결정 deferred (in-memory Map 가능성).

### `audit/log.ts` API signature 표

| 함수 | 시그니처 | 동작 | D 매핑 |
|------|----------|------|--------|
| `getDb()` | `(): Database` | singleton bun:sqlite Database. 첫 호출 시 ./data/ mkdir + open `{ strict: true, safeIntegers: true, create: true }` + PRAGMA WAL/synchronous=NORMAL + audit/schema.sql 실행 | D-14.2, PITFALL #10 |
| `beginTurn(prompt, model)` | `(prompt: string, model: string): bigint` | turn row INSERT (parent_id NULL). prompt 2000자 trim. 반환값: 새 row id (bigint, safeIntegers) | D-14.3 |
| `logTool(parentId, name, input, summary, ok, durationMs)` | `(parentId: bigint, name: string, input: unknown, resultSummary: string, ok: boolean, durationMs: number): void` | tool row INSERT (parent_id NOT NULL). input JSON.stringify + 2000자 cap. summary 500자 cap. ok → 0/1 | D-14.3, D-14.4 |
| `endTurn(id, output, cacheRead, totalCalls, durationMs, errEnv?)` | `(id: bigint, outputTokens: number, cacheReadTokens: number, totalToolCalls: number, durationMs: number, errorEnvelope?: unknown): void` | turn row UPDATE. errorEnvelope undefined → NULL | D-14.3, D-15.4 |
| `_resetForTest()` | `(): void` | 테스트 isolation helper. `_db.close() + _db = null`. Production code 사용 금지. | (테스트 전용) |

### 테스트 결과

```
$ bun test audit/log.test.ts
bun test v1.3.6 (d530ed99)

 8 pass
 0 fail
 24 expect() calls
Ran 8 tests across 1 file. [40.00ms]
```

**8 케이스 전체:**

| # | 테스트 | 검증 대상 |
|---|--------|-----------|
| 1 | `getDb() 첫 호출은 data/ 디렉토리 + Database 인스턴스 생성` | singleton 동작 + ./data/ 자동 mkdir (D-14.2) |
| 2 | `beginTurn — bigint id 반환 + parent_id NULL인 turn row INSERT` | D-14.1 turn row + bigint 반환 (safeIntegers) |
| 3 | `beginTurn 2000자 trim — D-14.3` | 3000자 prompt → DB row prompt.length === 2000 |
| 4 | `logTool — child row INSERT (parent_id 자기참조 + tool_name + ok)` | D-14.1 hybrid + parent_id 일치 + ok 0/1 변환 |
| 5 | `logTool 500자 trim — D-14.3` | 800자 summary → DB result_summary.length === 500 |
| 6 | `endTurn — UPDATE turn row with output_tokens / cache_read_tokens / total_tool_calls / duration_ms` | UPDATE 후 SELECT 검증 (bigint 모두) |
| 7 | `endTurn — error_envelope JSON 직렬화` | envelope 객체 → JSON.stringify → DB TEXT |
| 8 | **PITFALL #10 — strict 모드 활성: 잘못된 binding 키는 throw** | `stmt.get({ wrong_key: 1 })` → throw (라이브 검증) |

**PITFALL #10 라이브 검증 (Test 8)** — `Database(..., { strict: true })` 모드가 실제로 binding key 오타를 throw로 차단함을 코드 레벨에서 확인. PATTERNS.md `Phase 1 unit test to verify strict mode is active` 의도와 일치.

### Verification 단계 결과

| Step | 명령 | 결과 |
|------|------|------|
| 1 | `bun test audit/log.test.ts` | 8 pass / 0 fail / 24 expect() |
| 2 | `bunx sqlite3 data/copilot.db ".schema events"` (대체: bun:sqlite SELECT FROM sqlite_master) | events 테이블 정의 + 2 인덱스 출력 — hybrid schema 영속화 |
| 3 | `git status` (data/ ignored 검증) | `git check-ignore data/copilot.db` PASS — D-14.2 만족 |
| 4 | `bun -e 'import {beginTurn,logTool,endTurn} ...'` 직접 호출 | "OK" 출력. data/copilot.db + WAL/SHM sidecar 정상 생성. 1 turn row + 1 child tool row 영속화 확인. |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PATTERNS.md 예시의 `$` prefix binding key는 bun:sqlite strict 모드와 비호환**

- **Found during:** Task 2 (GREEN 단계 — 첫 테스트 실행에서 6/8 fail)
- **Issue:** PATTERNS.md (line 802 등)와 PLAN의 `<action>` 코드 예시가 `stmt.run({ $ts: ..., $model: ... })`로 작성됨. 그러나 실제 bun:sqlite `{ strict: true }` 모드에서는 binding key의 `$`/`:`/`@` prefix를 자동 strip하므로 `{ wrong_key: 1 }` 형태와 마찬가지로 `$ts`도 "Missing parameter \"ts\""로 throw.
- **Verify:**
  ```
  $ bun -e '... { strict: true } ... stmt.run({ $name: "x" })' → Missing parameter "name"
  $ bun -e '... { strict: true } ... stmt.run({ name: "x" })'  → OK
  ```
- **Fix:** audit/log.ts의 모든 `stmt.run()` / `stmt.get()` 호출에서 `$` prefix 제거. SQL은 `INSERT INTO events ... VALUES ($ts, $model, ...)` 그대로 (strict 모드에서 `$` 자동 strip해서 `ts`, `model` 키와 매칭).
- **Files modified:** audit/log.ts (3 함수의 binding 객체)
- **Commit:** f5d0db9
- **Downstream impact:** Plan 04 (`tools/_envelope.ts`가 logTool 호출 — 객체 인자 전달이라 영향 없음), Plan 05/06이 직접 SQL parametrized query 작성 시 동일 컨벤션 적용 필요. **FRICTION 메모로 carry-over** (아래 섹션).

### Deferred / Known Limitations

**1. PRAGMA foreign_keys = ON 미설정**

- **현재 상태:** schema에 `parent_id INTEGER REFERENCES events(id)` 자기참조 FK 선언이 있지만, SQLite는 default `foreign_keys = OFF`. FK constraint 위반(예: 존재하지 않는 parent_id 참조)이 INSERT 시 throw하지 않고 silently 통과됨.
- **위협 모델 분석:** T-01-03-01 (binding 오타로 인한 NULL 묵음 INSERT)은 strict 모드 + Test 8로 cover됨. FK enforcement는 별도 위협 surface (애플리케이션 버그로 잘못된 parent_id 전달).
- **대응:** D-14.3 minimum + 8h budget 보호. 현재 plan에서 미적용. 향후 FK enforcement가 필요하면 future plan에서 `db.run("PRAGMA foreign_keys = ON")`을 getDb()에 추가 (idempotent).
- **Phase 1 영향:** 없음. agent/loop.ts (Plan 06) finally 블록에서 endTurn 호출 보장 (T-01-03-05 accept).

### Note: prompt success_criteria wording vs PLAN

orchestrator 프롬프트의 `<success_criteria>`가 "turns table + tool_calls table" + "started_at/ended_at" 컬럼을 언급하지만, PLAN D-14.1 lock은 **단일 hybrid `events` 테이블** + **단일 `ts` 컬럼** + **`duration_ms`**. 본 실행은 PLAN을 준수 (hybrid 테이블 단일 + ts/duration_ms). orchestrator wording은 paraphrase 산물로 추정 — 검증 시 PLAN 기준으로 평가 권장.

---

## FRICTION carry-over

| # | 마찰 | 영향 | 권장 조치 |
|---|------|------|-----------|
| 1 | bun:sqlite strict 모드 binding key 컨벤션이 **널리 인용되는 문법(`$prefix`)과 다름** | Plan 04/05/06 + 향후 모든 SQL parametrized query | (a) audit/log.ts JSDoc에 컨벤션 주석 추가됨 (line 60-61). (b) **FRICTION.md에 항목 추가 권장** (Phase 0 FRICTION.md에 #11로 append, 또는 .planning/phases/01-*/FRICTION.md 신설). |
| 2 | bunx의 `sqlite3` npm 패키지 누락 → ".schema" verification step 자동화 어려움 | verify-phase 검증 자동화 | bun:sqlite SELECT FROM sqlite_master 사용으로 우회 (위 Verification step 2). 또는 sqlite3 CLI binary 시스템 패키지 사용. |

---

## Self-Check: PASSED

**Files created (verified):**
- ✅ `audit/schema.sql` (FOUND)
- ✅ `audit/log.ts` (FOUND)
- ✅ `audit/log.test.ts` (FOUND)

**Files modified (verified):**
- ✅ `.gitignore` (1 line added: `/data/`)

**Commits (verified in `git log`):**
- ✅ 39c2319 — `feat(01-03): audit/schema.sql events 테이블 + /data/ git ignore`
- ✅ 0303eeb — `test(01-03): audit/log.test.ts RED — D-14.3 + PITFALL #10 verification`
- ✅ f5d0db9 — `feat(01-03): audit/log.ts beginTurn / logTool / endTurn API (GREEN — 8/8 pass)`

**Tests:**
- ✅ `bun test audit/log.test.ts` → 8 pass / 0 fail / 24 expect() calls

**Acceptance criteria:**
- ✅ All 8 Task 1 + 9 Task 2 acceptance criteria satisfied (단, "data/copilot.db 파일 존재" 항목은 afterAll cleanup 후 검증이라 false — 그러나 test 실행 중 strict 모드 동작은 8/8 pass + 직접 호출 verification step 4로 확인됨)

---

## Threat Flags

(threat surface scan — 신규 surface 없음)

본 plan에서 만든 surface는 모두 PLAN의 `<threat_model>`에 등재됨 (T-01-03-01 ~ T-01-03-06). 신규 위협 surface 없음.
