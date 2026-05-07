# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** AI가 내 운영 환경의 도메인 지식을 알고 있고, 모든 운영 액션이 git-versioned audit trail이 된다.
**Current focus:** Phase 2 — Propose/Apply with Approval Gate (CONTEXT 작성 완료, ready for plan-phase)

## Current Position

Phase: 2 of 3 (Propose/Apply with Approval Gate) — D-E1 게이트 OPEN, 02-02 진입 unblocked
Plan: 1 of 10 PASS (D-E1) / 9 plans pending (02-02..02-10)
Status: D-E1 재검증 5/5 PASS. F-1/F-2 fix가 라이브에서 결정적 검증 (Criteria #2 readLogs synthesis text-delta + final 도달, audit DB error_envelope=null 재발 0건). Phase 2 plan 02-02 ~ 02-10 진행 가능.
Last activity: 2026-05-07 — D-E1 재실행: Criteria #1 (RAG grounded) PASS, #2 (readLogs+synthesis) PASS, #3 (drift wire) PASS, #4 (audit) PASS. SMOKE-LOG-2.md commit. 이전 SMOKE-LOG-1.md는 보존 (FAIL→PASS 전환 증거 추적).

Progress: [██████████] 100% (Phase 1 — 9/9 plans executed)
Overall: [██████░░░░] 66% (2/3 phases — Phase 0+1 complete)

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
- 환경 변수 함정: 셸의 빈 `ANTHROPIC_API_KEY=`가 Bun .env 자동 로드를 덮어씀 → 라이브 실행 시 `unset ANTHROPIC_API_KEY` 필요. Phase 1 startup script에 친절한 에러 메시지 추가 권장 (FRICTION.md #8)
- ~~**Phase 1 KB-01 prerequisite**~~: ✅ resolved — services.yaml 5 stack 4 슬롯 보강 완료 (commit bc0f978)
- ⚠ **VOYAGE_API_KEY 노출 (2026-05-07)**: Plan 01-05 executor가 라이브 E2E 검증 위해 부모 .env를 worktree로 복사 → 키가 sub-agent conversation transcript에 평문 노출. worktree .env는 삭제 완료. **권장 조치**: Voyage dashboard에서 즉시 키 회전 후 부모 .env 교체.
- ⏸ **Phase 1 live runtime smoke (operator action)**: ROADMAP Success Criteria #1/#2/#3/#4가 unit/integration 외 라이브 검증 필요. 명령:
  1. `unset ANTHROPIC_API_KEY && bun run src/server.ts` (서버 띄우기)
  2. 브라우저 http://127.0.0.1:PORT 접속, "ais-prod redis 어디 쓰여?" 질의 → SSE stream + RAG + tool call 확인 (Criteria #1)
  3. "지난밤 새벽 1-3시 voice 에러 패턴" 질의 → readLogs 호출 + 답변 (Criteria #2)
  4. services.yaml에서 컨테이너 1개 임시 삭제 후 페이지 reload → drift banner 확인 (Criteria #3)
  5. `sqlite3 data/audit.db "SELECT name, ok, duration_ms FROM events"` → tool call rows 확인 (Criteria #4)

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2+ | state/ git submodule 분리 | Deferred | Phase 0 planning |
| v2+ | Postgres 마이그레이션 | Deferred | PROJECT.md Out of Scope |
| v2+ | Discord webhook 알림 (NOTIFY-01) | Deferred | REQUIREMENTS.md v2 |
| v2+ | OSS 공개 (OSS-01) | Deferred | REQUIREMENTS.md v2 |

## Session Continuity

Last session: 2026-05-07
Stopped at: Phase 2 plan-phase 완료 — PATTERNS.md(13 신설 모듈 매핑) + 10 PLAN.md (Wave 0..4) + ROADMAP plans 섹션 갱신. plan-checker revision 1 통과(BLOCKER #1 = 02-06 Task 3 APPLY_TEST_MODE seam 추가, WARNING #1 = 02-08 line 272 D-A5 정정).
Resume file: .planning/phases/02-propose-apply-approval-gate/02-01-PLAN.md (Wave 0 D-E1 게이트)
Next: `/gsd-execute-phase 2` (또는 단일: `/gsd-execute-phase 2 --plan 01`부터 — 02-01은 운영자 manual 5단계 + VOYAGE 키 회전)
Outstanding operator actions (Wave 0 / 02-01 = pre-execute gate D-E1, 비-구현): (1) VOYAGE_API_KEY 회전 (2) Phase 1 live runtime smoke 5단계 (`unset ANTHROPIC_API_KEY && bun run src/server.ts` → 2 NL 쿼리 + drift mutation + sqlite3 audit). 5/5 PASS 후 02-02부터 구현 진입.
Recommended: /clear 후 `/gsd-execute-phase 2 --plan 01`

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
