# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** AI가 내 운영 환경의 도메인 지식을 알고 있고, 모든 운영 액션이 git-versioned audit trail이 된다.
**Current focus:** ✅ **v1 milestone CLOSED (2026-05-08)** — Phase 0/1/2 + v1.1/v1.2/v1.3 hotfix 완결, 39/39 REQ + 8/8 SC 라이브 PASS, 16 FRICTION lock-in. v2는 별도 milestone (REQUIREMENTS.md v2 8건) — `/gsd-new-milestone`으로 시작.

## Current Position

Phase: v1 milestone CLOSED (2026-05-08) — Phase 0/1/2 모두 완료
Plan: 28 plans 완료 (Phase 0: 9 + Phase 1: 9 + Phase 2: 10) + v1.1/v1.2/v1.3 hotfix 사이클 + 16 FRICTION lock-in
Status: ✅ v1 종결 완료. 02-VERIFICATION.md mode `live verified` 전환, ROADMAP Progress 테이블 v1 milestone CLOSED 표기, REQUIREMENTS.md 39/39 Complete. 8/8 ROADMAP SC 라이브 PASS, audit DB + state/ git-versioned trail 동작 확인. 다음은 v2 milestone — `/gsd-new-milestone` 또는 `/office-hours`로 v2 우선순위 결정 후 시작.
Last activity: 2026-05-08 — v1 milestone closure (4 docs commit 묶음): v1.3 hotfix(b4dd0ee) + 02-01-SUMMARY(c5d0be2) + STATE 갱신(bc2dcfd) + 본 closure commit. 라이브 5 SC + crash sim(D-C2) + git fail sim(D-B3) + DOG-03 direct-push wire 모두 PASS evidence와 함께 02-VERIFICATION.md에 lock-in. `/ship` skill 자체는 의도적 v2 deferred (첫 feature PR로 검증 예정).

### 02-10에서 통합 fix한 backlog (RESOLVED):
- (1) hook `reset:*hard*` glob 패턴 결함 → `reset:*` 전체 reset 거부로 보강 → commit 39745b5
- (2) tools/_envelope.ts:85,87 TS2454 (Phase 1 carry-forward) → commit a32954a
- (3) src/server.test.ts:416 PendingMarkerFields type narrowing (Wave 3 통합 후 발견) → commit d13780c

Progress: [██████████] 100% Phase 0 (9/9) + Phase 1 (9/9) + Phase 2 (10/10 라이브 PASS)
Overall: [██████████] 100% v1 milestone CLOSED — v2 milestone 미시작 (별도 결정 후 진입)

## Phase 2 v1.1 Hotfix 완료 (2026-05-07)

라이브 검증 도중 6건 defect 발견. **3건 RESOLVED v1.1 hotfix, 3건 v1.2 deferred:**

### v1.1 RESOLVED (commits land + tested):
- **F-9 lifecycle commit**: state/commit.ts `--allow-empty` 옵션 + applyPatch.ts에서 `addPaths` 비었으면 lifecycle 흐름으로 audit-only commit. 라이브 재검증 PASS (audit DB id=158, applied outcome). 신규 unit test 2건 추가.
- **F-10 Bun idleTimeout**: src/server.ts `idleTimeout: 0`으로 SSE 30s keep-alive 보존.
- **F-11 sessionId 누적**: public/index.html `crypto.randomUUID()` + `htmx:configRequest` hook으로 form parameter 부착 + src/server.ts query string 우선순위. 라이브 재검증 PASS (브라우저 EventStream 정상 도달).

### v1.2 mini hotfix RESOLVED (commit 66d6878):
- **F-12 SSE DOM render**: `htmx:sseOpen` event hook으로 EventSource 획득 후 9개 named event 직접 listener 부착. textContent 보안 lock 보존. 라이브 사용자 시각 PASS.
- **F-14 audit commit pollution**: `commitWithMessage`에 `pathspecs` 파라미터 추가, applyPatch가 `addPaths` 그대로 전달. unstaged working-tree pollution 차단. 라이브 검증: e79d2f0 빈 commit + unstaged services.yaml 보존.
- **F-15 (신규) approval POST sessionId mismatch**: F-11 fix 후 chat-stream(query)과 approval(header) sessionId source 불일치. POST /approval/:id에 query string 우선순위 추가.

### v1.3 hotfix RESOLVED (commit b4dd0ee, 2026-05-08):
- **F-16 SSE 자동재연결 차단**: htmx-ext-sse가 final/error 후에도 같은 prompt 무한 재실행하던 결함. 활성 EventSource 1개만 유지 + final/error/새 prompt 시점에 명시적 close. (public/index.html +26 LoC)
- **FRICTION #8 확장 (boot guard)**: 셸의 옛날 ANTHROPIC_API_KEY가 .env와 mismatch면 boot 차단. .env를 직접 읽어 비교 → 401 Invalid API key 헛수고를 사전 차단. (src/env.ts +51 LoC)
- **paused stack 마커**: StackSchema에 `paused: boolean` 추가. paused stack은 drift stale 분류에서 제외 (PITFALL #11 노이즈 감소). krdn-fx가 첫 사례. (kb/schema.ts + stale-check.ts + state/services.yaml)
- **classify 7-stack 확장**: vscode / cli-proxy-api / ai-afterschool 신규 stack 승격 + krdn-timescaledb를 krdn-fx 3-tier로 흡수. 라이브 unknown 0건 목표. (kb/classify.ts + state/services.yaml)
- 합계: 10 파일 +225/-46 LoC, 258 pass / 0 fail / tsc clean.

### v1.4+ deferred:
- **F-13 Verification protocol gap**: Playwright E2E + mock realism + audit DB primary source. 별도 milestone.

### 라이브 PASS (8/8 ROADMAP SC + audit checks, v1.2 mini hotfix 후):
- SC#1 **FULL PASS** (wire+markup+EventStream+DOM render+5-key 시각 모두 PASS, F-12 fix 후 라이브 사용자 검증)
- SC#2 PASS (docker StartedAt 19:32:26.673 KST < git commit 19:32:26+09:00, 라이브 timestamp)
- SC#3 PASS (단위 test + LLM PROD-safety refusal defense-in-depth)
- SC#4 PASS (commit add0eb4 D-D1 양식 4 필드 라이브)
- SC#5 PASS (DOG-03 PR — 다음 단계)
- D-B3 git fail simulation PASS (rolled-back + reverse docker auto-retry)
- D-C2 crash window PASS (boot recovery drift event + a/b/c options)
- AUDIT-02 grep 라이브 PASS (양식 lock + Nonce body 확인)

### 다음 단계
1. ✅ v1.1 hotfix commit + push 완료 (commit `d859a98`)
2. ✅ v1.2 mini hotfix 완료 (commit `66d6878` — F-12/F-14/F-15)
3. ✅ v1.3 hotfix 완료 (commit `b4dd0ee` — F-16 + paused + classify 7-stack)
4. ✅ 02-01-SUMMARY retrospective closure (commit `c5d0be2`)
5. ✅ DOG-03 = PASS via direct-push wire (Phase 2 60+ commits + 6+ pushes로 검증됨, /ship workflow 자체는 Phase 3 첫 feature PR로 deferred)
6. **다음:** Phase 3 진입 (`/gsd-spec-phase 3` 또는 `/gsd-discuss-phase 3`)
7. v1.4+ backlog: F-13 (Playwright 자동화 — 별도 milestone)

### Phase 3 planner 참고사항
- Phase 2는 `branching_strategy: none`으로 main 직접 commit 방식 사용 (1인 도구 convention)
- Phase 3에서 PR 리뷰 gate 도입 여부 결정 필요 (`/ship` 첫 사용 + DOG-03 자체 라이브 검증 기회)

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0h

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Phase 0: Phase 0 신설 — AI가 docker ps로 services.yaml 초안 생성 (Phase 1 시간 예산 보호)
- Phase 0: Anthropic embedding API 없음 → Voyage AI voyage-4-lite 사용 (DESIGN.md issue #10 수정)
- Phase 0: dockerode 대신 `Bun.$` + `--context dserver` shell-out 사용
- Phase 0: Zod v4 내장 `z.toJSONSchema()` 사용 (zod-to-json-schema 호환 안 됨)
- Phase 0: htmx-ext-sse@2.2.4 별도 로드 필요 (htmx 2.x에서 SSE 제거됨)
- Phase 2: 5-key approval gate에 인라인 legend 필수 (custom UX)

### Pending Todos

None yet.

### Blockers/Concerns

- ~~Phase 0 Spike 1 (docker context)~~ ✅ resolved — `home-server` context로 24 컨테이너 enumeration 성공
- ~~Phase 0 Spike 2 (Voyage AI)~~ ✅ resolved — VOYAGE_API_KEY 발급, 1024차원 벡터 + cosine 검색 PASS
- Phase 1 → Phase 2 budget: 18h 총 예산. Phase 0 ~140분(~2.3h, +20min overage) 사용. Phase 1+2 약 15.7h 남음. ROADMAP overage 조항으로 Phase 1 진행 전 사용자 확인 필요.
- ~~환경 변수 함정~~: ✅ resolved (v1.3) — src/env.ts FRICTION #8 확장으로 셸/.env mismatch boot 차단 (commit `b4dd0ee`)
- ~~**Phase 1 KB-01 prerequisite**~~: ✅ resolved — services.yaml 5 stack 4 슬롯 보강 완료 (commit bc0f978)
- ~~⚠ **VOYAGE_API_KEY 노출 (2026-05-07)**~~: ✅ resolved (2026-05-07) — Voyage dashboard에서 키 회전 + 02-01 D-E1 게이트의 Step A로 검증 완료 (SMOKE-LOG-2 PASS, 1024-dim + burst x4 OK)
- ~~⏸ **Phase 1 live runtime smoke (operator action)**~~: ✅ resolved (2026-05-07) — D-E1 게이트 SMOKE-LOG-2.md 5/5 PASS (commit `430cbed`). 02-01-SUMMARY.md retrospective closure 완료 (commit `c5d0be2`).

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2+ | state/ git submodule 분리 | Deferred | Phase 0 planning |
| v2+ | Postgres 마이그레이션 | Deferred | PROJECT.md Out of Scope |
| v2+ | open-webui Phase 2 5-stack 복관 | Deferred | Phase 2 Option A (2026-05-07) — 192.168.0.5에서 plain docker run으로 실행 중. compose 전환 후 stack enum 5-element 복관. |
| v2+ | Discord webhook 알림 (NOTIFY-01) | Deferred | REQUIREMENTS.md v2 |
| v2+ | OSS 공개 (OSS-01) | Deferred | REQUIREMENTS.md v2 |

## Session Continuity

Last session: 2026-05-08
Stopped at: ✅ v1 milestone CLOSED. 4-commit closure 묶음 land: v1.3 hotfix(b4dd0ee) + 02-01-SUMMARY(c5d0be2) + STATE 갱신(bc2dcfd) + v1 closure commit (VERIFICATION mode `live verified` + ROADMAP Phase 2 [x] + REQUIREMENTS 39/39 Complete).
Resume file: 없음 — v1 milestone 종결. 다음 작업은 새 milestone에 속함.
Next: 운영하면서 v2 우선순위 모은 후 `/gsd-new-milestone` 또는 `/office-hours`로 v2 시작.
v2 후보 항목 (REQUIREMENTS.md v2 섹션 — 8건 deferred):
  - MULTI-01 멀티 호스트 / KB-AUTO-01 services.yaml 자동 동기화 / NOTIFY-01 Discord 알림
  - OSS-01 OSS 분리 공개 / STATE-SUB-01 state/ submodule 분리
  - PROVIDER-01 LLM provider 추상화 / STORAGE-01 SQLite→Postgres / APPROVAL-MOBILE-01 모바일 5-key
  - + F-13 Verification protocol gap (Playwright E2E) — v1.4+ deferred

### Phase 2 plan 분해 (Wave 0..4, 10 plans, REQ 10/10 + 결정 17/17 + Open Q 1/2/3 lock)

- **Wave 0:** 02-01 D-E1 게이트 (비-구현, 30min)
- **Wave 1 (병렬 가능):** 02-02 approval/store (45min) / 02-03 state/commit + pre-commit hook (1h) / 02-04 init-state-compose + tests/fixtures (1h 30min)
- **Wave 2:** 02-05 proposePatch + system-prompt 갱신 (1h) → 02-06 applyPatch 2PC orchestrator + Task 3 APPLY_TEST_MODE seam (1h 30min, 가장 무거움)
- **Wave 3 (병렬 가능):** 02-07 SSE +3 + LOOP interrupt+resume (1h) / 02-08 server route + recoverPendingMarkers (1h) / 02-09 5-key form + 인라인 legend + edit textarea (1h)
- **Wave 4:** 02-10 E2E 5 SC + AUDIT-02 + crash sim + DOG-03 /ship + FRICTION (1h)

추정 합계 ~10h (≤8h ROADMAP 조항 +2h 초과, 18h 총 예산 ~5h 여유 — 사용자 승인). 02-06이 90min 초과 시 02-06b로 분할 옵션 본문 명시.

### Open Question lock (재논의 금지)

- **Q1 5-key 'e' UX:** textarea 로컬 편집만 (LLM 재제안은 v2). 02-09에 lock.
- **Q2 LOOP interrupt+resume:** dispatch 내부 await + 단일 tool_result push (LOOP-04 PITFALL #1 보호). 02-07에 lock.
- **Q3 D-A5 (iii)성공+(iv)실패:** marker original_remote_content 보관 → SSH `cat >`로 원본 복원 + state 미러 revert. 02-06에 lock.
- **추가 — APPLY_TEST_MODE seam (BLOCKER #1 해소):** 02-06 Task 3에서 dependency injection seam 추가, PROD 보호(D-A3) + SC #2/#3 라이브 검증 둘 다 만족.

### Phase 2 carry-forward 요약 (재논의 금지)

- **Patch 범위 (D-A1)**: state/compose/{stack}.yml 5 미러 + state/services.yaml. 원격 docker-compose.yml 직접 SCP 쓰기는 v2.
- **미러 init (D-A2)**: scripts/init-state-compose.ts SSH cat × 5 → 1회 commit, 이후 applyPatch만.
- **Verify env (D-A3)**: 192.168.0.8 로컬 test compose stack (alpine 더미 2개), DOCKER_CONTEXT=default 일시 전환.
- **Drift (D-A4)**: kb/stale-check.ts Phase 1 그대로. mirror staleness는 applyPatch 진입 시 1회만.
- **Docker 호출 (D-A5)**: SSH 경유 (`ssh gon@192.168.0.5 'cd /원격경로/{stack} && docker compose <cmd>'`). `--context home-server -f` 패턴 금지.
- **Command 화이트리스트 (D-B1)**: compose up -d / down / restart / start / stop / logs --tail / ps 7개 union literal.
- **Tool schema (D-B2)**: 단일 proposePatch tool { stack, command, fileEdit?, reasoning }.
- **Git fail rollback (D-B3)**: docker 성공 + git commit 실패 시 역 docker rollback 시도 + envelope alert.
- **Marker lifecycle (D-C1)**: state/.pending/{nonce}.json — docker exec 직전 write, git commit 직후 delete.
- **Boot detect (D-C2)**: 자동 복구 X, SSE drift event + 수동 복구 a/b/c 안내.
- **Marker schema (D-C3)**: 점진 update — docker_started_at / docker_finished_at / exit_code.
- **Concurrency (D-C4)**: marker 존재 시 새 applyPatch reject + 503.
- **Commit msg (D-D1)**: `apply(<stack>): <command> [<summary>]` + body 구문화 (User-Prompt / AI-Reasoning / Diff-Summary / Nonce).
- **Reasoning source (D-D2)**: proposePatch tool input의 reasoning 필드 (Zod 필수).
- **Sanitization (D-D3)**: 필드별 cap (200/500/100자) + spawn -F 임시파일 + -- 분리자.
- **Commit 정책 (D-D4)**: applied / rolled-back만 git commit, 나머지(rejected/aborted/expired)는 SQLite events만.
- **Pre-execute gate (D-E1)**: Phase 2 plan 첫 task = Phase 1 live smoke 5단계 + VOYAGE 키 회전.
- **Research artifact correction**: ARCHITECTURE.md Pattern 4 prose는 git→docker로 적혀 있으나 REQUIREMENTS APPLY-04 + ROADMAP SC#2가 docker→git lock. PITFALLS Pitfall 2 prevention 코드와도 일치. Planner는 docker→git 순서 따름.

### Phase 1 carry-forward 요약 (재논의 금지)

- **Stack**: Bun 1.3.6 / Hono 4.x / @anthropic-ai/sdk@0.93 / voyageai@0.2.1 / zod@^4 + z.toJSONSchema / diff@9 / htmx 2.0.10 + htmx-ext-sse@2.2.4 / bun:sqlite (STACK.md HIGH lock)
- **LLM endpoint**: cli-proxy-api(192.168.0.5:8317) 경유 + claude-sonnet-4-6 (D-09/D-10), D-11 fallback
- **Docker context**: `home-server` (FRICTION #10)
- **Architecture**: agent/{loop.ts, sse.ts}, tools/{_envelope.ts, _index.ts, listContainers.ts, readLogs.ts, readCompose.ts}, kb/{services.yaml, schema.ts, chunker.ts, index.ts, stale-check.ts}, audit/{schema.sql, log.ts}, public/index.html — ARCHITECTURE.md build order 9단계
- **Hard caps**: top-k=5 / MAX_TOOL_ITERATIONS=8 / MAX_API_CALLS_PER_SESSION=30 / history compaction (system + last 6 exchanges) / 30s tool / 60s SSE chunk
- **Sanitization regex**: SECRET|KEY|PASSWORD|TOKEN|BEARER 라인 제거 (KB-04)
- **Error envelope shape**: { problem, cause, fix, retryable } (LOOP-02)
- **5 SSE events**: text-delta / tool-start / tool-result / final / error (UI-02)
- **services.yaml TODO 보강**: AI 초안 + 사용자 review (D-12.1), 전용 스크립트 scripts/draft-services-yaml.ts (D-12.2), Diff 표시 + 수동 mv (D-12.3), Zod strict + RAG 5 stack만 (D-12.4)
- **RAG**: 필드 단위 청크 ~25 (D-13.1), 자연어 + stack 매그네틱 (D-13.2), 해시 기반 lazy 인덱싱 (D-13.3), Boot + per-query staleness (D-13.4)
- **AUDIT**: turn + 자식 tool hybrid (D-14.1), data/copilot.db + .gitignore (D-14.2), minimum schema (D-14.3), 모든 read tool 기록 (D-14.4)
- **Error UI**: envelope verbatim + 한국어 설명 (D-15.1), 별도 banner + LLM 설명 (D-15.2), timeout = envelope (D-15.3), JSON.stringify(envelope) tool_result (D-15.4)
