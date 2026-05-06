---
plan_id: "00-09"
phase: 0
title: "Spike 6 — Anthropic SDK + cli-proxy-api roundtrip + fallback 검증"
status: complete
completed: 2026-05-06
duration_minutes: 22
requirements: ["BOOT-01"]
covers_decisions: ["D-09", "D-10", "D-11"]
spike: 6
spike_status: green
---

# 00-09 SUMMARY

## What was built

D-09 (cli-proxy-api), D-10 (claude-opus-4-6), D-11 (fallback) 라이브 검증 완료. SDK 레이어에서 4가지 호환성(chat/tool-use/streaming/model-echo) 모두 PASS.

### key-files.created
- `spikes/06-proxy-fallback.test.ts` (5 tests, fallback retry policy 단위 테스트)
- `spikes/06-proxy-fallback.smoke.ts` (라이브 SDK + cli-proxy-api roundtrip)
- `state/SPIKE-6-RESULT.md` (D-09/D-10/D-11 lock-in 결정 문서)

### Spike 6 통과 기준 (BOOT-01)
- ✓ SDK chat: `claude-sonnet-4-6` model echo + text 응답
- ✓ SDK tool-use: stop_reason=tool_use, tool=list_containers 정확히 페어링
- ✓ SDK streaming: `messages.stream()` async iterable + content_block_delta 이벤트 정상
- ✓ `claude-opus-4-6` (D-10) model echo + text 응답
- ✓ fallback retry policy 5/5 단위 테스트 PASS (D-11)

## Verification

- `bun test spikes/06-proxy-fallback.test.ts` → **5 pass, 0 fail, 10 expect() calls**
- `bun run spikes/06-proxy-fallback.smoke.ts` (with `unset ANTHROPIC_API_KEY` 선결) → **4/4 통과 + Spike 6 PASS** + exit 0
- `bunx tsc --noEmit` → 종료 코드 0

## Deviations / Friction

1. **셸 환경 변수 우선순위 함정 (CRITICAL DOG-02)**:
   - 셸에 `ANTHROPIC_API_KEY=` (빈 값) export되어 있어서 Bun의 `.env` 자동 로드를 silently 덮어씀.
   - `loadEnv()`가 BOOT-05 검증 실패로 종료. 사용자가 `.env`를 채워뒀음에도.
   - 해결: 실행 전 `unset ANTHROPIC_API_KEY` 필요.
   - 시스템적 해결책: Phase 1에서 startup script가 빈 환경 변수 감지하고 명시적 `dotenv` 로드 우선 옵션 처리. 또는 `bun --env-file=.env` 강제.
   - **FRICTION.md (00-08)에 기록 필요**.

2. **`bun run -e` vs `bun -e`**: `bun run -e ...`는 usage 출력. `bun -e ...`만 동작. dogfood 마찰.

## Self-Check: PASSED

| Acceptance | Status |
|---|---|
| spikes/06-proxy-fallback.test.ts 존재 + 5 시나리오 | ✓ |
| `bun test ...test.ts` 5 pass | ✓ |
| spikes/06-proxy-fallback.smoke.ts 존재 + Anthropic import + baseURL override | ✓ |
| `bun run ...smoke.ts` 4/4 PASS | ✓ |
| state/SPIKE-6-RESULT.md 존재 + Status: PASS | ✓ |
| `bunx tsc --noEmit` exit 0 | ✓ |

## Spike status board (cumulative)

| Spike | Status |
|---|---|
| 1 (Bun.$ docker --context) | pending — Wave 2 (00-03) |
| 2 (Voyage AI embed) | pending — Wave 2 (00-04) |
| 3 (Hono SSE → htmx) | pending — Wave 2 (00-05) |
| 4 (Bun.$ git commit) | ✓ green |
| 5 (Zod v4 toJSONSchema) | ✓ green |
| 6 (Anthropic SDK + cli-proxy) | ✓ green |

3/6 spike GREEN. Wave 2 남은 3 spike: 00-03 (docker), 00-04 (Voyage), 00-05 (SSE) — 모두 autonomous:false.
