---
plan_id: "00-04"
phase: 0
title: "Spike 2 — Voyage AI voyage-4-lite embedding roundtrip"
status: complete
completed: 2026-05-06
duration_minutes: 12
requirements: ["BOOT-01"]
spike: 2
spike_status: green
---

# 00-04 SUMMARY

## What was built

Phase 1 RAG의 핵심 의존성 (Voyage AI `voyage-4-lite`) 라이브 검증.

### key-files.created
- `spikes/02-voyage-embed.smoke.ts` (라이브 API roundtrip)
- `spikes/02-voyage-embed.test.ts` (6 cosineSimilarity unit tests)
- `state/SPIKE-2-RESULT.md` (PASS 기록 + 비용 분석)

### Spike 2 통과 기준 (BOOT-01, ROADMAP.md priority 2)
- ✓ Voyage API key + 네트워크 도달 가능
- ✓ `voyage-4-lite` 모델 1024차원 임베딩 벡터 반환
- ✓ document/query inputType 분리 동작
- ✓ cosine similarity로 top-1 정답 doc 식별 (idx=0, sim=0.6308)
- ✓ 의미 분리도 충분 (top1 - top2 = 0.32)

## Verification

- `bun test spikes/02-voyage-embed.test.ts` → **6 pass, 0 fail, 7 expect() calls**
- `bun run spikes/02-voyage-embed.smoke.ts` (라이브) → exit 0, "Spike 2 PASS"
- `bunx tsc --noEmit` → 종료 코드 0

## Cost analysis

- 1회 spike 비용 ≈ $0.0000018 (반올림 오차)
- Phase 1 services.yaml 100 청크 × 200 토큰 인덱싱 ≈ $0.0004
- 운영 시점 query 호출당 ≈ $0.0000004
→ **무시 가능한 비용**.

## Deviations / Friction

특별한 마찰 없음. Plan대로 정상 동작.
- `unset ANTHROPIC_API_KEY` 패턴은 Spike 6에서 이미 도입되어 영향 없음.

## Self-Check: PASSED

| Acceptance | Status |
|---|---|
| spikes/02-voyage-embed.smoke.ts 존재 + 정확한 모델명 + inputType 두 가지 | ✓ |
| 6 단위 테스트 PASS | ✓ |
| state/SPIKE-2-RESULT.md PASS 기록 | ✓ |
| 라이브 라이브 spike PASS + top-1 idx=0 | ✓ |
| `bunx tsc --noEmit` exit 0 | ✓ |

## Spike status board (cumulative)

| Spike | Status |
|---|---|
| 1 (Bun.$ docker --context) | ✓ green |
| 2 (Voyage AI embed) | ✓ green |
| 3 (Hono SSE → htmx) | pending — Wave 2 (00-05) |
| 4 (Bun.$ git commit) | ✓ green |
| 5 (Zod v4 toJSONSchema) | ✓ green |
| 6 (Anthropic SDK + cli-proxy) | ✓ green |

5/6 spike GREEN. Wave 2 마지막 1 spike: 00-05 (Hono SSE).
