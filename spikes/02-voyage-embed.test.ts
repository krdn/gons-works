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
