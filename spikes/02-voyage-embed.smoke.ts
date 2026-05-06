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
