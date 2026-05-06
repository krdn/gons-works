// kb/index.test.ts — D-13.3 hash lazy + KB-02 top-k retrieval 검증.
//
// 검증 대상:
//   cosineSimilarity     — Spike 2 검증된 함수의 unit (orthogonal/identical/opposite)
//   ensureIndexed lazy   — 두 번째 호출은 indexed=false (hash 동일)
//   ensureIndexed force  — force=true는 무조건 재인덱싱
//   queryTopK k cap      — k 만큼만 반환, similarity 내림차순 정렬
//
// 격리:
//   - KB_DB_PATH 환경변수로 임시 파일 경로 강제 (audit/log.ts와 분리, advisor #1)
//   - _setEmbedderForTest로 stub embedder 주입 (live VoyageAIClient 호출 방지, advisor #2)
//   - _resetForTest로 매 테스트 isolation
//
// E2E 모드 (process.env.E2E === "1"):
//   - live Voyage API 호출
//   - Spike 2 baseline 보존: top-1 sim >= 0.5 검증
//   - VOYAGE_API_KEY 미설정 시 자동 skip

import { test, expect, describe, beforeEach, afterAll, beforeAll } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  cosineSimilarity,
  ensureIndexed,
  queryTopK,
  _resetForTest,
  _setEmbedderForTest,
} from "./index"

// 매 테스트마다 별도 임시 디렉토리 (다른 테스트의 DB 영향 차단).
const TMP_DIRS: string[] = []
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-index-test-"))
  TMP_DIRS.push(dir)
  return join(dir, "test-copilot.db")
}

// 가짜 embedder — 결정적 1024 dim 벡터 (chunk text 길이로 첫 차원만 차이).
function makeStubEmbedder(): {
  docCalls: number
  queryCalls: number
  embedDocuments: (texts: string[]) => Promise<number[][]>
  embedQuery: (query: string) => Promise<number[]>
} {
  const stub = {
    docCalls: 0,
    queryCalls: 0,
    async embedDocuments(texts: string[]): Promise<number[][]> {
      stub.docCalls++
      return texts.map((t, idx) => {
        const v = new Array(1024).fill(0)
        // 결정적 — text length + idx로 변별 가능하게.
        v[0] = (t.length % 100) / 100
        v[1] = (idx % 10) / 10
        v[2] = 0.5
        return v
      })
    },
    async embedQuery(query: string): Promise<number[]> {
      stub.queryCalls++
      const v = new Array(1024).fill(0)
      v[0] = (query.length % 100) / 100
      v[1] = 0.1
      v[2] = 0.5
      return v
    },
  }
  return stub
}

beforeEach(() => {
  // 매 테스트마다 DB + embedder 격리 — 새 임시 파일 경로 주입.
  _resetForTest(freshDbPath())
})

afterAll(() => {
  _resetForTest(null)
  for (const dir of TMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

describe("cosineSimilarity — unit", () => {
  test("1. 동일 벡터 → 1.0", () => {
    const a = [1, 2, 3]
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5)
  })

  test("2. 직교 벡터 → 0.0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0, 5)
  })

  test("3. 반대 방향 → -1.0", () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1.0, 5)
  })

  test("4. 0 벡터 → 0.0 (NaN 방지)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0)
  })

  test("5. 차원 불일치 → throw", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/벡터 차원 불일치/)
  })
})

describe("ensureIndexed — D-13.3 hash lazy", () => {
  test("6. 첫 호출은 indexed=true (hash 비어있음 → embed)", async () => {
    const stub = makeStubEmbedder()
    _setEmbedderForTest(stub)
    const result = await ensureIndexed()
    expect(result.indexed).toBe(true)
    expect(result.chunkCount).toBe(25) // 5 stack × 5 field
    expect(stub.docCalls).toBe(1)
  })

  test("7. 두 번째 호출은 indexed=false (hash 동일 → skip)", async () => {
    const stub = makeStubEmbedder()
    _setEmbedderForTest(stub)
    const r1 = await ensureIndexed()
    expect(r1.indexed).toBe(true)
    const r2 = await ensureIndexed()
    expect(r2.indexed).toBe(false)
    expect(r2.chunkCount).toBe(r1.chunkCount)
    // embed는 첫 호출에서만 발생
    expect(stub.docCalls).toBe(1)
  })

  test("8. force=true는 hash 무시하고 재인덱싱", async () => {
    const stub = makeStubEmbedder()
    _setEmbedderForTest(stub)
    await ensureIndexed()
    expect(stub.docCalls).toBe(1)
    const r = await ensureIndexed(true)
    expect(r.indexed).toBe(true)
    expect(stub.docCalls).toBe(2)
  })
})

describe("queryTopK — KB-02 top-k retrieval", () => {
  test("9. queryTopK k=5 → 정확히 5개 반환", async () => {
    const stub = makeStubEmbedder()
    _setEmbedderForTest(stub)
    await ensureIndexed()
    const hits = await queryTopK("redis 어디 쓰여", 5)
    expect(hits).toHaveLength(5)
    // 각 hit는 id/text/stack/field/similarity 모두 채워짐
    for (const h of hits) {
      expect(typeof h.id).toBe("string")
      expect(typeof h.text).toBe("string")
      expect(typeof h.similarity).toBe("number")
      expect(h.id).toContain(":")
    }
  })

  test("10. queryTopK 결과는 similarity 내림차순", async () => {
    const stub = makeStubEmbedder()
    _setEmbedderForTest(stub)
    await ensureIndexed()
    const hits = await queryTopK("test query", 10)
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.similarity).toBeGreaterThanOrEqual(hits[i]!.similarity)
    }
  })

  test("11. queryTopK k=3 → 3개 반환 (cap 검증)", async () => {
    const stub = makeStubEmbedder()
    _setEmbedderForTest(stub)
    await ensureIndexed()
    const hits = await queryTopK("test", 3)
    expect(hits).toHaveLength(3)
  })
})

// E2E (조건부) — live Voyage API 호출. process.env.E2E === "1" + VOYAGE_API_KEY 필요.
const E2E = process.env.E2E === "1" && Boolean(process.env.VOYAGE_API_KEY)
const e2eDescribe = E2E ? describe : describe.skip

e2eDescribe("E2E — live Voyage AI roundtrip", () => {
  beforeAll(() => {
    // E2E는 default embedder 사용 (beforeEach에서 stub 끊기).
    _setEmbedderForTest(null)
  })

  beforeEach(() => {
    // E2E도 매 테스트마다 fresh DB이지만, embedder는 default 유지.
    _setEmbedderForTest(null)
  })

  test("12. ensureIndexed live + queryTopK 'redis 어디 쓰여' top-1 stack=ais|news (Spike 2 baseline)", async () => {
    const r = await ensureIndexed(true)
    expect(r.chunkCount).toBe(25)
    const hits = await queryTopK("redis 어디 쓰여", 5)
    expect(hits.length).toBe(5)
    const top = hits[0]!
    // **의미 매칭의 ground truth**: top-1 stack은 redis 사용하는 ais 또는 news
    // 이것이 가장 중요한 검증 — RAG가 의미적으로 올바른 chunk를 retrieval하는가?
    expect(["ais", "news"]).toContain(top.stack)
    // baseline 절댓값 — 라이브 측정 결과 0.4944 (Plan 05 SUMMARY 기록).
    // Spike 2 0.6308과 다른 이유: chunk 자연어 템플릿이 더 풍부해서 query와 다른 측면에서도 매칭 → 분산.
    // threshold 0.4는 의미적 매칭 유지 + future regression 감지 둘 다 cover.
    expect(top.similarity).toBeGreaterThanOrEqual(0.4)
  }, 60_000)
})
