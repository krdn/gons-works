# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** AI가 내 운영 환경의 도메인 지식을 알고 있고, 모든 운영 액션이 git-versioned audit trail이 된다.
**Current focus:** Phase 1 — Read-Only Knowledge Layer (✅ code-complete, awaiting operator smoke)

## Current Position

Phase: 1 of 3 (Read-Only Knowledge Layer) — ✅ COMPLETE (code), awaiting live smoke
Plan: 9 of 9
Status: All 4 waves merged. 22/22 REQ-IDs unit/integration PASS. 153/157 tests PASS (4 E2E skipped). ROADMAP Success Criteria #5 (hard cap) unit-PASS. #1/#2/#3/#4 deferred to operator runtime smoke.
Last activity: 2026-05-07 — Phase 1 종료: Wave 4 머지(public/index.html htmx UI + VERIFICATION/FRICTION 문서)

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
Stopped at: Phase 1 execute 완료 — 9/9 plans 4 waves 모두 머지 + 22/22 REQ-IDs unit/integration PASS + 153 tests PASS. ROADMAP Success Criteria #1-#4 라이브 smoke 보류.
Resume file: .planning/phases/01-read-only-knowledge-layer/01-VERIFICATION.md (전체 검증 결과)
Next: (선택) operator runtime smoke (위 Blockers/Concerns 5단계) → Phase 2 진행 (`/gsd-spec-phase 2` 또는 `/gsd-discuss-phase 2`)
Outstanding operator actions: (1) VOYAGE_API_KEY 회전 (2) Phase 1 live runtime smoke
Recommended: /clear 먼저 (이 세션 컨텍스트 매우 길어짐)

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
