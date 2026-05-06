# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** AI가 내 운영 환경의 도메인 지식을 알고 있고, 모든 운영 액션이 git-versioned audit trail이 된다.
**Current focus:** Phase 0 — Bootstrap & Spikes

## Current Position

Phase: 0 of 3 (Bootstrap & Spikes) — ✅ COMPLETE
Plan: 9 of 9 complete (all 4 waves done)
Status: Phase 0 PASS — 6/6 spike GREEN, 34 unit tests pass. Ready for Phase 1.
Last activity: 2026-05-06 — Phase 0 verification + FRICTION.md (00-08); 9/9 plans done

Progress: [██████████] 100% (Phase 0)
Overall: [███░░░░░░░] 33% (1/3 phases)

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
Stopped at: Phase 0 COMPLETE — 9/9 plans, 6/6 spike GREEN, 34 unit tests pass, BOOT-01..BOOT-05 + DOG-01/DOG-02 만족
Resume file: state/PHASE-0-VERIFICATION.md
Next: /gsd-discuss-phase 1  (Phase 1: Read-Only Knowledge Layer)
Recommended: /clear 먼저 (이 세션 컨텍스트 길어짐)
