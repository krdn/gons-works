---
plan_id: "00-06"
phase: 0
title: "Spike 5 — Zod v4 z.toJSONSchema → Claude input_schema 호환"
status: complete
completed: 2026-05-06
duration_minutes: 8
requirements: ["BOOT-01"]
spike: 5
spike_status: green
---

# 00-06 SUMMARY

## What was built

Zod v4 내장 `z.toJSONSchema()` 함수가 Anthropic Claude tool-use API의 `input_schema`로 그대로 사용 가능한 형태를 반환하는지 검증.

### key-files.created
- `spikes/05-zod-schema.test.ts` (9 tests)

### Spike 5 통과 기준 (BOOT-01)
- ✓ `z.toJSONSchema`가 함수로 정의됨 (Zod v4 확인)
- ✓ `listContainers` 대표 schema 변환 시 `{ type: "object", properties: {...} }` 반환
- ✓ `properties`에 filter, limit 두 키 모두 존재
- ✓ number min/max 제약이 `minimum`/`maximum`으로 표현
- ✓ enum 값 (running/stopped/all) 모두 schema에 표현
- ✓ required 배열이 noun으로 표현됨
- ✓ DESIGN.md correction #3 회귀 방지: schema가 빈 `{}` 아님

## Verification

- `bun test spikes/05-zod-schema.test.ts` → **9 pass, 0 fail, 20 expect() calls**
- `bunx tsc --noEmit` → 종료 코드 0
- 외부 API 호출 없음 (autonomous: true)

## Deviations / Friction

1. **TypeScript 타입 매칭 mismatch**: Zod v4의 `z.toJSONSchema()` 반환 타입이 `ZodStandardJSONSchemaPayload<...>`인데, plan에 명시된 `as { properties: ... }` 강제 변환이 TS2352 에러 발생. `as unknown as ...` 이중 캐스트 패턴으로 해결. → Phase 1 LOOP-01 tool schema 변환 시 동일 패턴 필요.

## Self-Check: PASSED

| Acceptance | Status |
|---|---|
| spikes/05-zod-schema.test.ts 존재 | ✓ |
| z.toJSONSchema 호출 grep | ✓ |
| listContainers schema grep | ✓ |
| z.enum(["running", "stopped", "all"]) grep | ✓ |
| 9 pass | ✓ |
| `bunx tsc --noEmit` exit 0 | ✓ |

## Spike status board (cumulative)

| Spike | Status |
|---|---|
| 1 (Bun.$ docker --context) | pending — Wave 2 (00-03) |
| 2 (Voyage AI embed) | pending — Wave 2 (00-04) |
| 3 (Hono SSE → htmx) | pending — Wave 2 (00-05) |
| 4 (Bun.$ git commit) | ✓ green |
| 5 (Zod v4 toJSONSchema) | ✓ green |
| 6 (Anthropic SDK + cli-proxy) | pending — Wave 2 (00-09) |
