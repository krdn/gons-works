---
plan_id: "00-03"
phase: 0
title: "Spike 1 — Bun.$ docker --context dserver ps roundtrip"
status: complete
completed: 2026-05-06
duration_minutes: 18
requirements: ["BOOT-01"]
spike: 1
spike_status: green
---

# 00-03 SUMMARY

## What was built

Phase 0의 priority 1 spike. **`Bun.$` + named docker context로 원격 서버 컨테이너 enumeration이 정상 동작**함을 라이브 검증.

### key-files.created
- `spikes/01-docker-context.smoke.ts` (라이브 spike)
- `spikes/01-docker-context.test.ts` (3 단위 tests)
- `state/SPIKE-1-RESULT.md` (결과 + friction 기록)

### Spike 1 통과 기준 (BOOT-01, ROADMAP.md priority 1)
- ✓ `docker context inspect home-server` 성공
- ✓ `docker --context home-server ps --format json` NDJSON 24개 라인 반환
- ✓ JSON.parse 성공으로 컨테이너 배열 24개 파싱
- ✓ 5 핵심 stack 중 4/5 발견 (news/ais/n8n/open-webui — krdn-fx만 stopped)

## Verification

- `bun test spikes/01-docker-context.test.ts` → **3 pass, 0 fail, 8 expect() calls**
- `bun run spikes/01-docker-context.smoke.ts` (라이브) → exit 0, "Spike 1 PASS"
- `bunx tsc --noEmit` → 종료 코드 0

## Deviations / Friction

1. **Context 이름 mismatch (CRITICAL DOG-02 입력)**:
   - Plan-time 가정: `dserver`
   - Runtime 실제: `home-server`
   - `~/.claude/CLAUDE.md`의 "Alias dserver, dcserver"는 셸 alias이지 docker context 이름이 아니었음.
   - 해결: `.env` `DOCKER_CONTEXT=home-server`로 override.
   - 시스템적 교훈: Phase plan 작성 전 라이브 환경 사실 확인 단계가 `/gsd-discuss-phase`에 명시되어야 함.

2. **krdn-fx stopped (예상된 stale 상태)**:
   - CLAUDE.md ⏸ 마커와 정확히 일치.
   - services.yaml 초안에 `state: stopped` 명시 필요. 또는 Phase 1 RAG에서 `docker ps -a` 옵션 추가 검토.

## Self-Check: PASSED

| Acceptance | Status |
|---|---|
| spikes/01-docker-context.smoke.ts 존재 + Bun.$ + --context + --format json | ✓ |
| Spike 1 PASS / SSH/context fallback 메시지 grep | ✓ |
| spikes/01-docker-context.test.ts 3 pass | ✓ |
| state/SPIKE-1-RESULT.md Status: PASS | ✓ |
| 5 핵심 stack 중 ≥3 발견 | ✓ (4/5) |
| `bunx tsc --noEmit` exit 0 | ✓ |

## Spike status board (cumulative)

| Spike | Status |
|---|---|
| 1 (Bun.$ docker --context) | ✓ green |
| 2 (Voyage AI embed) | pending — Wave 2 (00-04) |
| 3 (Hono SSE → htmx) | pending — Wave 2 (00-05) |
| 4 (Bun.$ git commit) | ✓ green |
| 5 (Zod v4 toJSONSchema) | ✓ green |
| 6 (Anthropic SDK + cli-proxy) | ✓ green |

4/6 spike GREEN. Wave 2 남은 2 spike: 00-04 (Voyage), 00-05 (SSE).
