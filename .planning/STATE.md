# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** AI가 내 운영 환경의 도메인 지식을 알고 있고, 모든 운영 액션이 git-versioned audit trail이 된다.
**Current focus:** Phase 0 — Bootstrap & Spikes

## Current Position

Phase: 1 of 3 (Read-Only Knowledge Layer) — Context gathered, ready for plan
Plan: 0 of TBD
Status: Phase 1 discuss complete — 4 영역 × 4 결정 (D-12..D-15). 다음 단계: /gsd-plan-phase 1
Last activity: 2026-05-06 — Phase 1 CONTEXT.md + DISCUSSION-LOG.md 작성

Progress: [░░░░░░░░░░] 0% (Phase 1)
Overall: [███░░░░░░░] 33% (1/3 phases — Phase 0 complete)

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
- **Phase 1 KB-01 prerequisite**: `state/services.yaml`이 TODO 슬롯(depends_on/volumes/normal_log_pattern/key_log_locations) 비워진 채 commit됨. Phase 1 KB-01 첫 task로 `state/services.yaml.review-checklist.md`에 따라 보강 필요. 보강 안 하면 RAG retrieval 품질이 Spike 2가 보여준 0.32 gap에 미치지 못할 수 있음.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2+ | state/ git submodule 분리 | Deferred | Phase 0 planning |
| v2+ | Postgres 마이그레이션 | Deferred | PROJECT.md Out of Scope |
| v2+ | Discord webhook 알림 (NOTIFY-01) | Deferred | REQUIREMENTS.md v2 |
| v2+ | OSS 공개 (OSS-01) | Deferred | REQUIREMENTS.md v2 |

## Session Continuity

Last session: 2026-05-06
Stopped at: Phase 1 context gathered — 4 영역 × 4 결정 (D-12 services.yaml 보강, D-13 RAG chunking, D-14 AUDIT 입도, D-15 Tool error UI)
Resume file: .planning/phases/01-read-only-knowledge-layer/01-CONTEXT.md
Next: /gsd-plan-phase 1  (Phase 1: Read-Only Knowledge Layer)
Recommended: /clear 먼저 (이 세션 컨텍스트 길어짐)

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
