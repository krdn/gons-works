---
plan_id: "00-04"
phase: 0
title: "Spike 2 — Voyage AI voyage-4-lite embedding roundtrip"
wave: 2
depends_on: ["00-01"]
files_modified:
  - "spikes/02-voyage-embed.test.ts"
  - "spikes/02-voyage-embed.smoke.ts"
requirements: ["BOOT-01"]
autonomous: false
estimated_minutes: 25
---

# 00-04: Spike 2 — Voyage AI voyage-4-lite embedding roundtrip

<objective>
ROADMAP.md 우선순위 2 spike. **Anthropic은 embedding endpoint가 없다** (DESIGN.md correction #1). Phase 1 RAG 전체가 Voyage AI에 의존하므로, `voyageai@0.2.1` SDK + `voyage-4-lite` 모델이 정상 동작하는지 사전 검증.

통과 기준: 임베딩 벡터가 반환되고, cosine similarity 검색이 의미 있는 청크를 top-k에서 찾는다.

`autonomous: false` — Voyage API 호출에 실제 API key + 네트워크 필요. 비용은 무시할 만함 ($0.02/MTok, 100청크 × 200토큰 ≈ $0.0004).

**must_haves.truths:**
- DESIGN.md correction #1: Voyage AI `voyage-4-lite` 사용 (Anthropic embedding API 비-존재)
- D-02 (CONTEXT.md): No partial pass — Spike 2 실패 시 fallback은 Ollama `nomic-embed` 로컬 모델 + 재조사
- BOOT-01 Spike 2: 벡터 반환 + cosine 검색이 올바른 청크 반환
</objective>

<must_haves>
## Truths

- DESIGN.md correction #1: Voyage AI `voyage-4-lite`가 유일한 embedding path. Anthropic Haiku embedding은 존재하지 않음.
- STACK.md lock: `voyageai@0.2.1`. 다른 버전 사용 금지.
- D-01: Spike 코드는 `spikes/` 격리.
- Failure path (ROADMAP.md): 로컬 임베딩 모델 (Ollama `nomic-embed`)로 전환 + 재조사.

## Verification anchors

- `spikes/02-voyage-embed.smoke.ts` 존재 + `voyageai` import + `voyage-4-lite` 문자열 grep 가능
- `bun run spikes/02-voyage-embed.smoke.ts` 종료 코드 0
- 출력에 cosine similarity 점수 (3개 docs 중 query와 가장 가까운 doc index) 표시
- `state/SPIKE-2-RESULT.md` PASS/FAIL 기록
</must_haves>

<task id="00-04-t01" type="execute">
<title>spikes/02-voyage-embed.smoke.ts — 라이브 API roundtrip</title>
<read_first>
- `.planning/research/STACK.md` (Voyage AI 섹션 — 100청크 비용 추정)
- `.planning/research/PITFALLS.md` (RAG recall degradation 섹션, 있다면)
- `.planning/ROADMAP.md` Phase 0 Spike List 2번
- `.planning/research/SUMMARY.md` correction #1
</read_first>
<action>
`spikes/02-voyage-embed.smoke.ts` 생성:

```typescript
#!/usr/bin/env bun
import { VoyageAIClient } from "voyageai"
import { loadEnv } from "../src/env"

// Spike 2 — Voyage AI voyage-4-lite embedding roundtrip + cosine similarity 검색.
// autonomous: false. 실제 API 호출 비용 발생 (≈ $0.0001).
//
// 통과 기준 (ROADMAP.md):
//   1. 벡터 반환 (numeric array)
//   2. cosine similarity 검색이 query와 의미적으로 가까운 doc을 top-1으로 찾음

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("벡터 차원 불일치")
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!
    const bi = b[i]!
    dot += ai * bi
    normA += ai * ai
    normB += bi * bi
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function main(): Promise<void> {
  const env = loadEnv()

  console.log("[Spike 2] voyage-4-lite embedding roundtrip 시작")
  const client = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY })

  // services.yaml chunk를 흉내내는 3개 doc.
  const docs = [
    "ais-prod redis는 ais-prod-web과 ais-prod-worker가 사용하는 caching layer다. 메모리 사용량 모니터링 중요.",
    "news-prod는 RSS 수집기 + 요약 worker로 구성되며 5433 포트의 news-postgres에 저장한다.",
    "krdn-fx는 외환 시계열 데이터를 timescaledb에 저장하고 dashboard로 시각화한다.",
  ]
  const query = "ais redis 메모리 어디서 쓰여?"

  // 1. 임베딩 호출
  let docVectors: number[][]
  let queryVector: number[]
  try {
    const docResp = await client.embed({
      input: docs,
      model: "voyage-4-lite",
      inputType: "document",
    })
    docVectors = (docResp.data ?? []).map((d) => d.embedding ?? [])

    const queryResp = await client.embed({
      input: [query],
      model: "voyage-4-lite",
      inputType: "query",
    })
    queryVector = queryResp.data?.[0]?.embedding ?? []
  } catch (e) {
    console.error("[Spike 2 FAIL] Voyage API 호출 실패:", e)
    console.error("\nFallback path: Ollama nomic-embed 로컬 모델로 전환 + 재조사")
    console.error("  - VOYAGE_API_KEY가 .env에 정확히 설정되어 있는지 확인")
    console.error("  - 네트워크 도달 가능한지 확인 (curl https://api.voyageai.com)")
    process.exit(1)
  }

  // 2. 벡터 sanity check
  if (docVectors.length !== 3 || queryVector.length === 0) {
    console.error(`[Spike 2 FAIL] 벡터 개수 불일치: docs=${docVectors.length}, query=${queryVector.length}`)
    process.exit(1)
  }
  const dim = queryVector.length
  if (docVectors.some((v) => v.length !== dim)) {
    console.error(`[Spike 2 FAIL] 벡터 차원 불일치 (query=${dim})`)
    process.exit(1)
  }
  console.log(`[Spike 2] ✓ 벡터 4개 반환 (차원=${dim})`)

  // 3. cosine similarity 검색
  const sims = docVectors.map((v, i) => ({
    idx: i,
    sim: cosineSimilarity(queryVector, v),
    preview: docs[i]!.slice(0, 50),
  }))
  sims.sort((a, b) => b.sim - a.sim)

  console.log("\nTop-k by cosine similarity:")
  for (const s of sims) {
    console.log(`  [${s.idx}] sim=${s.sim.toFixed(4)} — ${s.preview}...`)
  }

  // 4. 통과 기준: top-1이 ais 관련 doc(idx=0)이어야 의미 있는 검색.
  const top = sims[0]!
  if (top.idx !== 0) {
    console.error(`[Spike 2 FAIL] cosine 검색 결과가 비합리적. top-1=${top.idx}, 기대=0 (ais redis 관련 doc)`)
    console.error("Voyage 모델이 동작하지만 임베딩 품질이 낮을 가능성. fallback 검토 필요.")
    process.exit(1)
  }
  if (top.sim < 0.3) {
    console.warn(`[Spike 2] ⚠ top-1 similarity가 낮음 (${top.sim.toFixed(4)}). RAG 품질 점검 필요.`)
  }

  console.log(`\n[Spike 2 PASS] ✓ voyage-4-lite roundtrip + cosine 검색 OK (top-1 sim=${top.sim.toFixed(4)})`)
}

main().catch((e) => {
  console.error("[Spike 2 FAIL] 예외:", e)
  process.exit(1)
})
```
</action>
<acceptance_criteria>
- `spikes/02-voyage-embed.smoke.ts` 존재
- 파일에 `import { VoyageAIClient } from "voyageai"` grep 가능
- 파일에 `model: "voyage-4-lite"` 정확한 문자열 grep 가능
- 파일에 `inputType: "document"` 와 `inputType: "query"` 둘 다 grep 가능
- 파일에 `cosineSimilarity` 함수 정의 grep 가능
- 파일에 `Spike 2 PASS` 메시지 grep 가능
- 파일에 fallback 안내 (`Ollama nomic-embed`) grep 가능
- 라이브 환경에서 (VOYAGE_API_KEY 채워진 상태): `bun run spikes/02-voyage-embed.smoke.ts` 종료 코드 0
- `bunx tsc --noEmit` 종료 코드 0
</acceptance_criteria>
</task>

<task id="00-04-t02" type="execute">
<title>spikes/02-voyage-embed.test.ts — cosineSimilarity 단위 테스트</title>
<read_first>
- 방금 만든 `spikes/02-voyage-embed.smoke.ts` (cosineSimilarity 함수 정의)
</read_first>
<action>
`spikes/02-voyage-embed.test.ts` 생성. cosineSimilarity 함수를 격리해서 단위 테스트:

```typescript
import { describe, expect, test } from "bun:test"

// smoke.ts의 cosineSimilarity 로직을 동일하게 복제 (단위 테스트 격리).
// 통합 테스트는 smoke.ts에서, 함수 동작은 여기서.
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("벡터 차원 불일치")
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!
    const bi = b[i]!
    dot += ai * bi
    normA += ai * ai
    normB += bi * bi
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

describe("Spike 2 cosineSimilarity 단위 테스트", () => {
  test("같은 벡터는 cosine similarity = 1", () => {
    const v = [1, 2, 3, 4]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6)
  })

  test("직교 벡터는 cosine similarity = 0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })

  test("반대 방향 벡터는 cosine similarity = -1", () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 6)
  })

  test("zero vector는 0 반환 (NaN 방지)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  })

  test("차원 불일치는 throw", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow("벡터 차원 불일치")
  })

  test("부동소수점 안정성 (정규화 안 된 벡터)", () => {
    const a = [3, 4]
    const b = [4, 3]
    // dot=24, |a|=5, |b|=5, sim=24/25=0.96
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.96, 4)
  })
})
```
</action>
<acceptance_criteria>
- `spikes/02-voyage-embed.test.ts` 존재
- `bun test spikes/02-voyage-embed.test.ts` 종료 코드 0
- 출력에 `6 pass` (또는 `6 passed`) grep 가능
- Voyage API 키 없이도 통과 (순수 함수 테스트)
</acceptance_criteria>
</task>

<task id="00-04-t03" type="execute">
<title>Spike 2 라이브 검증 + state/SPIKE-2-RESULT.md 기록</title>
<read_first>
- 방금 만든 `spikes/02-voyage-embed.smoke.ts`
- `.env` (실제 키 채워진 상태)
</read_first>
<action>
**사용자 승인 필요.** 다음 명령 실행:

```bash
# 0. .env에 실제 VOYAGE_API_KEY 채워졌는지 확인
grep -q "PLACEHOLDER" .env && echo "⚠ .env에 placeholder가 남아있다. 실제 값으로 변경 필요."

# 1. 라이브 spike 실행
bun run spikes/02-voyage-embed.smoke.ts
```

**예상 시나리오:**

A. **PASS**: 출력에 `[Spike 2 PASS]` + top-1 similarity 점수 표시 + idx=0 (ais redis doc)이 top-1.

B. **API key invalid**: `Voyage API 호출 실패` 출력 + fallback 안내. 사용자가 https://www.voyageai.com 에서 키 재발급.

C. **네트워크 도달 불가**: 동일 fallback 안내. 프록시/방화벽 점검.

D. **임베딩 품질 낮음 (top-1이 ais가 아님)**: 모델 자체 동작은 하지만 검색 품질 저하. fallback (Ollama) 평가 필요. ROADMAP.md fallback path 활성화.

각 결과를 `state/SPIKE-2-RESULT.md`에 기록:

```markdown
# Spike 2 결과 — Voyage AI voyage-4-lite embedding

**Date:** YYYY-MM-DD
**Status:** PASS | FAIL — <reason>
**Vector dimension:** N
**Top-1 idx:** 0 (expected) | other (FAIL)
**Top-1 cosine similarity:** N.NNNN

## 출력 발췌

(spike 실행 출력)

## 비용

3 docs + 1 query × ≈ 30 tokens × $0.02/MTok = $0.0000018 (rounding error)
```
</action>
<acceptance_criteria>
- `state/SPIKE-2-RESULT.md` 존재 + `Status: PASS` 또는 `Status: FAIL — <reason>` grep 가능
- PASS 시: `Top-1 idx: 0` grep 가능
- FAIL 시: fallback 결정 (Ollama 전환? 키 재발급?) 한 줄 기록
- DOG-02 마찰 메모 후보로 결과 발췌
</acceptance_criteria>
</task>

<verification>
## 검증 (Spike 2 통과)

```bash
test -f spikes/02-voyage-embed.smoke.ts
test -f spikes/02-voyage-embed.test.ts
grep -q 'voyage-4-lite' spikes/02-voyage-embed.smoke.ts
grep -q 'inputType: "document"' spikes/02-voyage-embed.smoke.ts
grep -q 'inputType: "query"' spikes/02-voyage-embed.smoke.ts
grep -q 'Spike 2 PASS' spikes/02-voyage-embed.smoke.ts
grep -q 'Ollama nomic-embed' spikes/02-voyage-embed.smoke.ts
bun test spikes/02-voyage-embed.test.ts
test -f state/SPIKE-2-RESULT.md
grep -E "Status: (PASS|FAIL)" state/SPIKE-2-RESULT.md
bunx tsc --noEmit
```

이 plan 통과 시: Spike 2 ✓ green (BOOT-01의 2/5 spike). DESIGN.md correction #1이 라이브로 검증됨.
</verification>
