---
phase: 01-read-only-knowledge-layer
plan: 07
subsystem: server
tags: [hono, sse, http, watchdog, friction, agent-stub, abort-controller, kb-rag]

# Dependency graph
requires:
  - phase: 01-read-only-knowledge-layer
    provides:
      - "kb/index.ts ensureIndexed + queryTopK (Plan 01-05)"
      - "kb/stale-check.ts staleCheck (Plan 01-05)"
      - "src/env.ts loadEnv + EnvProblem shape (Phase 0)"
      - "src/docker-context-check.ts ensureDockerContext (Phase 0)"
provides:
  - "src/server.ts Hono app + /chat-stream SSE handler + 4 startup probes"
  - "src/server.ts createChunkWatchdog wire (LOOP-06 / D-15.3 60s no-chunk timeout)"
  - "src/env.ts FRICTION #8 친절한 에러 envelope (운영자 디버깅 비용 ~10분 단축)"
  - "agent/sse.ts (stub-but-functional): SseEvent 6 union + toSSEFrame + createChunkWatchdog 본격 구현"
  - "agent/loop.ts (stub-only): iterate(prompt, opts) 시그니처 lock — Plan 01-06이 본격 구현 후 대체"
  - "agent/system-prompt.ts (stub-only): SYSTEM_PROMPT + formatRagContext 시그니처 lock"
affects: [01-08-frontend, 01-09-verification, plan-06-agent-loop-merge]

# Tech tracking
tech-stack:
  added: []  # 신규 패키지 없음 — hono/htmx-ext-sse는 Phase 0에서 lock
  patterns:
    - "Hono streamSSE wrapper pattern + onError 분기"
    - "createChunkWatchdog: emit reset, final/error cancel, finally cancel, signal→iterate"
    - "Module-level loadEnv() + import.meta.main 분기로 test에서 server bind 회피"
    - "Static file 화이트리스트 Map (path traversal 차단 패턴)"
    - "Agent module stub strategy — 시그니처 lock, 머지 시 대체"

key-files:
  created:
    - "src/server.ts (208 LoC) — Phase 1 Hono entrypoint"
    - "src/server.test.ts (8 tests) — route sanity"
    - "agent/sse.ts (stub-but-functional, 95 LoC) — UI-02 + LOOP-06"
    - "agent/sse.test.ts (9 tests) — toSSEFrame + watchdog 4 시나리오"
    - "agent/loop.ts (stub) — iterate 시그니처 lock"
    - "agent/system-prompt.ts (stub) — SYSTEM_PROMPT + formatRagContext lock"
  modified:
    - "src/env.ts — FRICTION #8 분기 추가 (loadEnv 진입점 빈 ANTHROPIC_API_KEY 가로채기)"
    - "src/env.test.ts — subprocess 검증 2개 추가"

key-decisions:
  - "agent/* 3개 파일을 stub으로 미리 생성 — 01-06 병렬 진행, 시그니처 lock으로 머지 충돌 최소화"
  - "agent/sse.ts는 throw stub 불가 — server.ts가 createChunkWatchdog을 직접 호출하므로 실 동작 포함"
  - "agent/loop.ts iterate stub은 운영자 가시성 위해 명시적 'STUB — 01-06 미머지' error envelope emit"
  - "server.test.ts에서 Bun.env 할당을 top-level (await import 전)에 둠 — beforeAll은 import 이후라 too late"
  - "KB_DB_PATH=:memory:로 테스트 격리 — 실제 ./data/copilot.db 변경 방지"

patterns-established:
  - "FRICTION #8 가드: loadEnv() 진입점에서 Bun.env.X === '' 명시 분기 → 셸 export vs .env 충돌 디버그"
  - "PITFALL #4 양면 catch: streamSSE 내부 try-catch + 외부 onError 모두 AbortError 분기"
  - "PITFALL #16 grep lock: hostname \"127.0.0.1\" 명시 + acceptance에서 0.0.0.0 부재 검증"
  - "LOOP-06 watchdog wiring: emit→reset, final/error→cancel, finally→cancel (timer 누수 0 보장)"
  - "Stub-with-real-logic: 외부에서 호출하는 함수가 동작에 의존하면 throw stub 불가 — 본격 로직 inline"

requirements-completed: [READ-04, READ-05, UI-04, LOOP-06]

# Metrics
duration: 약 30분
completed: 2026-05-07
---

# Phase 1 Plan 07: server.ts Hono /chat-stream + LOOP-06 60s SSE Watchdog Summary

**Hono streamSSE 진입점 + 4 startup probe + 60s no-chunk watchdog + FRICTION #8 친절 에러 — Phase 1 server entry가 라우트/안전장치/계측 모두 wire 완료.**

## Performance

- **Duration:** 약 30분 (실 작업 — worktree 초기 환경 셋업 포함)
- **Started:** 2026-05-07 (UTC)
- **Completed:** 2026-05-07 (UTC)
- **Tasks:** 2 / 2 (Plan 정의 그대로)
- **Files created:** 6 (src/server.ts, src/server.test.ts, agent/sse.ts, agent/sse.test.ts, agent/loop.ts, agent/system-prompt.ts)
- **Files modified:** 2 (src/env.ts, src/env.test.ts)
- **Tests:** 28 pass / 0 fail (env 11 + server 8 + sse 9)

## Accomplishments

- **READ-04 / READ-05 wire 완료**: POST /chat → GET /chat-stream SSE → staleCheck → queryTopK RAG → iterate() pump
- **UI-04 drift event wire**: per-query staleCheck 결과로 SSE drift event emit
- **LOOP-06 / D-15.3 60s 타임아웃**: createChunkWatchdog 4 곳에서 정확히 wire (emit reset, final/error cancel, finally cancel, signal→iterate)
- **FRICTION #8 친절 에러**: 운영자가 빈 셸 ANTHROPIC_API_KEY 함정을 즉시 인지 (디버깅 비용 ~10분 → 0초)
- **PITFALL #4 + #16 처리**: AbortError 양면 catch + 127.0.0.1 lock + 0.0.0.0 부재 grep 검증
- **agent/* 시그니처 lock**: 01-06 병렬 머지 시 충돌 영역 최소화 (stub 3개)

## Task Commits

| # | 설명 | 커밋 | 타입 |
| - | ---- | ---- | ---- |
| 1 | src/env.ts FRICTION #8 친절한 에러 + subprocess 검증 (2 신규 테스트) | `8b61179` | feat |
| 2 | src/server.ts Hono /chat-stream SSE + LOOP-06 60s watchdog + agent/* stubs (3개) | `faa6c76` | feat |

(Plan-level metadata commit은 STATE.md/ROADMAP.md 비변경 정책에 따라 SUMMARY 단독 commit으로 대체.)

## Files Created/Modified

### Created

| 경로 | 역할 | LoC |
| ---- | ---- | --- |
| `src/server.ts` | Hono app + /chat-stream SSE + 4 startup probes + 127.0.0.1 bind | 208 |
| `src/server.test.ts` | route sanity tests (app fetch + path traversal + POST /chat behavior) | 95 |
| `agent/sse.ts` | **stub-but-functional**: UI-02 6 SseEvent + toSSEFrame + createChunkWatchdog 본격 구현 | 95 |
| `agent/sse.test.ts` | toSSEFrame + watchdog (timeout/reset/cancel/cancel-after-cancel) | 105 |
| `agent/loop.ts` | **stub-only**: iterate 시그니처 lock + 운영자 가시성 에러 emit | 50 |
| `agent/system-prompt.ts` | **stub-only**: SYSTEM_PROMPT + formatRagContext 시그니처 lock | 30 |

### Modified

| 경로 | 변경 내용 |
| ---- | --------- |
| `src/env.ts` | loadEnv() 진입점에 FRICTION #8 분기 추가 (Bun.env.ANTHROPIC_API_KEY === "" 가로채기) |
| `src/env.test.ts` | subprocess 검증 2개 추가 (FRICTION #8 분기 vs 일반 schema 실패) |

## 라우트 표

| Method | Path | 동작 | 응답 |
| ------ | ---- | ---- | ---- |
| GET | `/` | public/index.html serve | 200 + text/html (없으면 stub 안내) |
| GET | `/static/:file` | 화이트리스트(htmx.min.js / sse.js)만 serve | 200 + application/javascript 또는 404 |
| POST | `/chat` | htmx 폼 → sse-connect URL fragment 응답 | 200 + HTML fragment 또는 400 (empty prompt) |
| GET | `/chat-stream?prompt=...` | streamSSE handler — drift + RAG + iterate pump | 200 + text/event-stream |

## 4 Startup Probe 순서 + 실패 케이스

| 순서 | Probe | 실패 시 |
| ---- | ----- | ------ |
| 1 | `loadEnv()` (module-level) | exit(1) — `[BOOT-05]` envelope (FRICTION #8 분기 포함) |
| 2 | `ensureDockerContext(env.DOCKER_CONTEXT)` | exit(1) — `[BOOT-04]` envelope |
| 3 | `ensureIndexed()` (KB lazy hash) | exit(1) — `[KB] 인덱싱 실패` |
| 4 | `staleCheck(env)` (boot 1회) | warn-only — `[KB-03] staleCheck 실패 (서버 시작 계속)` |

(probe 1은 module 진입점에서 즉시 실행 — `if (import.meta.main)`은 probe 2-4와 server bind만 가드.)

## 6 SSE Event Emit 매핑 (server.ts에서)

| Event | server.ts emit 위치 | 트리거 조건 |
| ----- | ------------------ | ---------- |
| `drift` | /chat-stream 진입 직후 | staleCheck 결과의 unknown/stale > 0 |
| `text-delta` | iterate emit 위임 | Plan 01-06 agent/loop.ts가 Anthropic 응답에서 emit |
| `tool-start` | 동일 | 동일 |
| `tool-result` | 동일 | 동일 |
| `final` | iterate 종료 시 위임 + watchdog cancel | iterate 정상 종료 |
| `error` | (1) try-catch (서버 처리 실패), (2) onError (stream 처리 실패), (3) watchdog timeout | 60s no-chunk + Anthropic 실패 + 외부 stream error |

(LOOP-06 watchdog의 envelope shape은 `agent/sse.ts createChunkWatchdog` 내부에서 D-15.3 lock된 문자열로 정의 — frontend 매핑 안정성.)

## LOOP-06 60s Watchdog Wiring (4 곳)

```
1. createChunkWatchdog((envelope) => stream.writeSSE(toSSEFrame(envelope)))
   ↓
2. emit() 함수 정의 → watchdog.reset() (매 chunk마다)
   ↓
3. final/error event 처리 시 → watchdog.cancel()
   ↓
4. iterate(prompt, { ..., abortSignal: watchdog.signal })
   ↓
5. finally 블록 → watchdog.cancel() (timer 누수 방지)
```

**iterate 측면**: abortSignal.aborted 시 추가 messages.create 호출 안 함 (Plan 01-06 머지 시 본격 enforce — 현 stub은 단순 통지만).

## FRICTION #8 라이브 검증 결과

```
$ ANTHROPIC_API_KEY="" bun -e "import('./src/env').then(({loadEnv})=>loadEnv())"
[BOOT-05] ANTHROPIC_API_KEY가 빈 문자열 (FRICTION #8)
원인: 셸에 ANTHROPIC_API_KEY=가 빈 값으로 export되어 .env 자동 로드를 덮어씀
해결: 현재 셸에서 'unset ANTHROPIC_API_KEY' 실행 후 서버를 재시작하세요
$ echo $?
1
```

`src/env.test.ts`의 subprocess 테스트 2개가 이 동작 + 일반 schema 실패와의 분기를 자동 검증한다.

## Decisions Made

1. **agent/* 3개를 미리 stub으로 생성** — Plan 01-06이 병렬 진행 중. server.ts compile + test 통과를 위해 시그니처를 lock된 형태로 미리 작성. 머지 시 01-06 버전이 그대로 대체 (시그니처 동일).
2. **agent/sse.ts는 본격 구현 (throw stub 불가)** — server.ts가 `createChunkWatchdog`을 직접 호출하므로 stub이 throw하면 server.test.ts가 실패. LOOP-06 검증 단위 테스트 9개로 watchdog 동작 자체를 lock.
3. **agent/loop.ts iterate stub은 명시적 에러 emit** — 머지 누락 상태에서 운영자가 즉시 인지하도록 'STUB — 01-06 미머지' envelope emit + final.
4. **server.test.ts top-level Bun.env 할당** — module-level `loadEnv()`가 import 시 실행되므로 `beforeAll`은 too late. 동적 import 전에 env set.
5. **KB_DB_PATH=:memory:로 테스트 격리** — 실 서버 SQLite 파일에 테스트가 영향을 주지 않게 함.

## 마찰 (FRICTION carry-over)

### F-01-07-01 (LOW): worktree 초기 상태 = 빈 commit
**증상**: parent main으로부터 git worktree 생성 시 "Initial commit"만 있고 main의 50개 commit이 안 들어옴.
**워크어라운드**: `git merge main --no-edit`으로 dependency 모두 가져옴.
**제안**: `gsd-execute-phase`가 worktree 생성 직후 자동으로 main rebase/merge하는 step 추가.

### F-01-07-02 (LOW): node_modules 미설치 worktree
**증상**: worktree 진입 시 node_modules 없어 `bun test`/`bunx tsc`가 즉시 실패.
**워크어라운드**: `bun install` (78ms로 매우 빠름).
**제안**: worktree setup script에 `bun install` 자동 포함 권장.

### F-01-07-03 (LOW): htmx.org 패키지 미설치
**증상**: `package.json`에 `htmx-ext-sse`만 있고 `htmx.org`는 없음. server.ts의 `/static/htmx.min.js`는 file existence check로 404 반환.
**워크어라운드**: Plan 01-08 (frontend)이 `bun add htmx.org@2.0.10` 추가 또는 CDN 사용 결정 위임.
**제안**: Plan 01-08 첫 task에서 htmx.org 의존성 결정 명시.

### F-01-07-04 (RESOLVED): 셸 ANTHROPIC_API_KEY="" 빈 export
이번 plan의 핵심 fix 대상. server.ts test에서도 트리거되어 top-level Bun.env 할당으로 우회. **운영 환경 자체는 이번 plan으로 운영자가 즉시 인지하는 환경 완성.**

## Deviations from Plan

**None — plan executed exactly as written, with the stub-strategy explicitly requested by the orchestrator prompt (\"01-06 in parallel — stub cleanly\").**

Plan 동작상 추가 결정 사항(예: GET / index.html 미존재 시 stub HTML, server.test.ts에서 KB_DB_PATH=:memory: 격리)은 plan에 명시되지 않은 implementation detail이며 acceptance criteria에 영향이 없음.

## Issues Encountered

1. **server.test.ts beforeAll가 module-level loadEnv() 후 실행** — `await import("./server")` 라인이 실행되는 시점에 이미 loadEnv()가 호출됨. 해결: env 할당을 top-level로 이동 (await import 라인 위).
2. **shell ANTHROPIC_API_KEY=""** — FRICTION #8 자체가 즉시 트리거됨. plan이 의도한 대로 동작 → 우회 방법으로 테스트 격리.

## User Setup Required

None — Plan 01-08 (frontend)에서 public/index.html 작성 시 htmx.org 의존성 결정만 보류.

## Next Phase / Plan Readiness

### Ready (Plan 01-08 / 01-09)
- Server entrypoint 완성 — Plan 01-08이 public/index.html을 `<script src="/static/htmx.min.js">` + `<script src="/static/sse.js">`로 작성하면 즉시 GET / 통합
- `/chat-stream` SSE handler가 6 event 모두 정확한 type 보장 — frontend의 `htmx:sseMessage` switch가 deterministic
- Plan 01-09 verification에서 라이브 smoke (`unset ANTHROPIC_API_KEY && bun run dev`) 시 4 probe 모두 통과 또는 명시적 envelope exit 보장

### Blockers / Concerns
- **Plan 01-06 머지 필요**: agent/* stubs는 머지 후에만 실제 Claude 호출 가능. server.test.ts는 stub 동작에 의존하지 않으므로 머지 순서와 무관.
- **htmx.org 의존성 결정**: Plan 01-08에서 npm vs CDN vs 손수 download 결정 필요.
- **라이브 SSE smoke 미수행**: 본 plan은 unit-level 검증만. `curl -N "http://127.0.0.1:3000/chat-stream?prompt=test"`는 Plan 01-09 verification 단계 책임.

## Self-Check: PASSED

### 파일 존재 확인
- `[FOUND] src/server.ts`
- `[FOUND] src/server.test.ts`
- `[FOUND] src/env.ts (modified)`
- `[FOUND] src/env.test.ts (modified)`
- `[FOUND] agent/sse.ts`
- `[FOUND] agent/sse.test.ts`
- `[FOUND] agent/loop.ts`
- `[FOUND] agent/system-prompt.ts`

### 커밋 확인
- `[FOUND] 8b61179` (Task 1: env.ts FRICTION #8)
- `[FOUND] faa6c76` (Task 2: server.ts + agent/* stubs)

### Acceptance Criteria 확인
- `unset ANTHROPIC_API_KEY` in src/env.ts: 2 occurrences (>=1 OK)
- `FRICTION #8` in src/env.ts: 2 occurrences (>=1 OK)
- `streamSSE` in src/server.ts: 5 occurrences (>=1 OK)
- `hostname: "127.0.0.1"` in src/server.ts: 2 occurrences (>=1 OK)
- `hostname: "0.0.0.0"` in src/server.ts: 0 occurrences (==0 OK)
- `staleCheck` / `queryTopK` / `iterate(` / `ensureIndexed` / `ensureDockerContext` / `AbortError` / `createChunkWatchdog` / `watchdog.reset()` / `watchdog.cancel()` / `abortSignal: watchdog.signal`: 모두 >=1 OK
- `bun test src/env.test.ts src/server.test.ts agent/sse.test.ts`: 28 pass / 0 fail
- `bunx tsc --noEmit`: 0 errors

---
*Phase: 01-read-only-knowledge-layer*
*Plan: 07*
*Completed: 2026-05-07*
