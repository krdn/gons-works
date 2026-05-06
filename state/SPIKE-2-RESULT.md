# Spike 2 결과 — Voyage AI voyage-4-lite embedding

**Date:** 2026-05-06
**Status:** PASS
Status: PASS
**Vector dimension:** 1024
**Top-1 idx:** 0 (expected — ais redis doc)
**Top-1 cosine similarity:** 0.6308

## 출력 발췌

```
[Spike 2] voyage-4-lite embedding roundtrip 시작
[Spike 2] ✓ 벡터 4개 반환 (차원=1024)

Top-k by cosine similarity:
  [0] sim=0.6308 — ais-prod redis는 ais-prod-web과 ais-prod-worker가 사용하...
  [1] sim=0.3073 — news-prod는 RSS 수집기 + 요약 worker로 구성되며 5433 포트의 news...
  [2] sim=0.1733 — krdn-fx는 외환 시계열 데이터를 timescaledb에 저장하고 dashboard로 ...

[Spike 2 PASS] ✓ voyage-4-lite roundtrip + cosine 검색 OK (top-1 sim=0.6308)
```

## 의미 분리 분석

| Rank | Doc 주제 | Similarity | 의미 |
|------|---------|-----------|------|
| 1 | ais-prod redis | 0.6308 | 정답 doc — top-1 |
| 2 | news-prod RSS 수집 | 0.3073 | "redis"는 없지만 "메모리/캐싱" 어휘 부분 일치 |
| 3 | krdn-fx FX timescaledb | 0.1733 | 의미 무관 |

→ **분리도 충분 (0.63 - 0.31 = 0.32 gap)**. Phase 1 RAG에서 top-3 retrieval로 구성 시 noise 적음.

## 비용

3 docs + 1 query × 약 30 tokens × $0.02/MTok ≈ **$0.0000018** (rounding error 수준).
Phase 1 services.yaml 100 chunk × 200 tokens 가정 시 1회 인덱싱 ≈ $0.0004. 무시 가능.

## DESIGN.md correction #1 검증

- ✓ Anthropic embedding API 비-존재 → Voyage AI `voyage-4-lite`로 우회.
- ✓ `voyageai@0.2.1` SDK가 `embed()` API + `inputType: "document"|"query"` 분리 지원.
- ✓ Phase 1 RAG path 확정 가능.

## D-02 (No partial pass) 영향

Spike 2는 priority 2, 실패 시 fallback은 Ollama `nomic-embed`. **PASS이므로 Phase 1 RAG = Voyage 확정**.

## DOG-02 friction 후보

특별한 마찰 없음. plan대로 정상 동작.
다만 1차 시도에서 셸 환경 빈 `ANTHROPIC_API_KEY=` 영향으로 loadEnv 실패 가능했으나, Spike 6 시점에서 이미 `unset` 패턴으로 해결됨.
