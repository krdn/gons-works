// kb/index.ts — voyage-4-lite 임베딩 + bun:sqlite 영속화 + D-13.3 hash lazy indexing + KB-02 top-k retrieval.
//
// Public API:
//   ensureIndexed(force?)     — services.yaml SHA-256 hash 비교 → 다르면 voyage embed + DB 재기록
//   queryTopK(query, k=5)     — query 임베딩 후 cosine similarity로 top-k Chunk 반환
//   cosineSimilarity(a, b)    — Spike 2 검증된 함수 (외부 export — 테스트 + 미래 사용)
//   _resetForTest()           — singleton DB 폐기 (테스트 isolation 전용)
//   _setEmbedderForTest(impl) — VoyageAIClient를 mock으로 swap (live API 호출 차단, advisor #2)
//
// 핵심 결정:
//   D-13.3 hash lazy indexing — boot 시 yaml unchanged면 voyage 호출 skip (cost + latency 절약)
//   PITFALL #10 strict + safeIntegers — 묵음 NULL binding 차단
//   PITFALL #15 — chunker.ts가 필드 단위로 청킹 (이 모듈은 단순히 받은 chunks 임베딩만 책임)
//   advisor #1 — KB_DB_PATH env override로 테스트 격리 (audit/log.ts와 별도 파일 가능)
//   advisor #4 — binding key는 prefix 없이 ({ key: ... }) — Plan 03 audit/log.ts 컨벤션 준수
//
// Spike 2 baseline: top-1 sim=0.6308 (state/SPIKE-2-RESULT.md). queryTopK가 이 baseline 보존.

import { Database } from "bun:sqlite"
import { VoyageAIClient } from "voyageai"
import { createHash } from "node:crypto"
import { mkdirSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import { load } from "js-yaml"
import { ServicesYamlSchema } from "./schema"
import { chunkServicesYaml, type Chunk } from "./chunker"
import { loadEnv } from "../src/env"

// DB 경로 — env override 가능 (테스트는 :memory: 또는 별도 파일 사용).
// _resetForTest(path)로 매 테스트 격리된 경로 주입 가능.
function defaultDbPath(): string {
  return process.env.KB_DB_PATH || "./data/copilot.db"
}

// DESIGN.md correction #1 + STACK.md lock: voyage-4-lite (1024 dim).
const VOYAGE_MODEL = "voyage-4-lite"

let _db: Database | null = null
let _dbPath: string | null = null

/**
 * bun:sqlite Database singleton.
 *
 * 첫 호출:
 *   1. 부모 디렉토리 mkdir (KB_DB_PATH가 :memory: 아닐 때만)
 *   2. Database open with { strict: true, safeIntegers: true, create: true } (PITFALL #10)
 *   3. PRAGMA journal_mode = WAL + synchronous = NORMAL
 *   4. kb_meta + kb_chunks 테이블 CREATE IF NOT EXISTS
 */
function getDb(): Database {
  if (_db) return _db
  const path = _dbPath ?? defaultDbPath()
  if (path !== ":memory:") {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  // PITFALL #10: strict + safeIntegers
  _db = new Database(path, { strict: true, safeIntegers: true, create: true })
  _db.run("PRAGMA journal_mode = WAL")
  _db.run("PRAGMA synchronous = NORMAL")
  // kb_meta: D-13.3 hash 저장 (key='yaml_hash')
  _db.run(`CREATE TABLE IF NOT EXISTS kb_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`)
  // kb_chunks: 1024 dim float 벡터 — JSON-encoded TEXT (binary BLOB은 디버깅 어려움, 24 chunk 규모는 부담 없음)
  _db.run(`CREATE TABLE IF NOT EXISTS kb_chunks (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    stack TEXT NOT NULL,
    field TEXT NOT NULL,
    embedding TEXT NOT NULL
  )`)
  return _db
}

/**
 * Cosine similarity — spikes/02-voyage-embed.smoke.ts 검증된 함수.
 * 외부 export: queryTopK 외부에서 직접 검색하고 싶을 때 (테스트 + 미래 NN debug).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
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

// Embedder DI — live VoyageAIClient를 wrapper 함수에 격리.
// 테스트는 _setEmbedderForTest로 stub 주입 (advisor #2 권고).
export interface Embedder {
  embedDocuments: (texts: string[]) => Promise<number[][]>
  embedQuery: (query: string) => Promise<number[]>
}

function defaultEmbedder(): Embedder {
  const env = loadEnv()
  const client = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY })
  return {
    async embedDocuments(texts: string[]): Promise<number[][]> {
      const resp = await client.embed({
        input: texts,
        model: VOYAGE_MODEL,
        inputType: "document",
      })
      return (resp.data ?? []).map((d) => d.embedding ?? [])
    },
    async embedQuery(query: string): Promise<number[]> {
      const resp = await client.embed({
        input: [query],
        model: VOYAGE_MODEL,
        inputType: "query",
      })
      return resp.data?.[0]?.embedding ?? []
    },
  }
}

let _embedder: Embedder | null = null

function getEmbedder(): Embedder {
  if (!_embedder) _embedder = defaultEmbedder()
  return _embedder
}

/**
 * 테스트 helper — 가짜 embedder 주입.
 * Production code 호출 금지. mock 끝나면 null로 다시 호출하여 default로 복원.
 */
export function _setEmbedderForTest(impl: Embedder | null): void {
  _embedder = impl
}

/**
 * D-13.3 hash 기반 lazy indexing.
 *
 * services.yaml SHA-256 hash가 kb_meta.yaml_hash와 같으면 fast path (skip embedding).
 * 다르면 voyage embed → kb_chunks 비우고 재기록 + meta hash 갱신.
 *
 * @param force  true면 hash 비교 skip하고 무조건 재인덱싱 (scripts/reindex-kb.ts 등에서)
 * @returns indexed: true면 재인덱싱 발생, false면 skip. chunkCount는 현재 인덱스의 chunk 개수.
 */
export async function ensureIndexed(force = false): Promise<{ indexed: boolean; chunkCount: number }> {
  const db = getDb()
  const yaml = await Bun.file("state/services.yaml").text()
  const hash = createHash("sha256").update(yaml).digest("hex")

  if (!force) {
    // strict 모드 + safeIntegers: bigint 반환 가능. value는 TEXT이므로 string.
    const stored = db
      .query("SELECT value FROM kb_meta WHERE key = $key")
      .get({ key: "yaml_hash" }) as { value: string } | null
    if (stored?.value === hash) {
      const row = db
        .query("SELECT COUNT(*) AS c FROM kb_chunks")
        .get() as { c: bigint }
      return { indexed: false, chunkCount: Number(row.c) }
    }
  }

  // 재인덱싱 path — yaml parse → chunk → embed → DB 재기록.
  const parsed = ServicesYamlSchema.parse(load(yaml))
  const chunks = chunkServicesYaml(parsed)
  const embedder = getEmbedder()
  const vectors = await embedder.embedDocuments(chunks.map((c) => c.text))

  if (vectors.length !== chunks.length) {
    throw new Error(`임베딩 개수 불일치: chunks=${chunks.length}, vectors=${vectors.length}`)
  }

  // transaction으로 atomicity 보장 (대량 INSERT 시 빠르고 partial state 차단).
  db.run("DELETE FROM kb_chunks")
  const insert = db.prepare(
    "INSERT INTO kb_chunks (id, text, stack, field, embedding) VALUES ($id, $text, $stack, $field, $emb)",
  )
  const tx = db.transaction((items: Array<{ chunk: Chunk; vec: number[] }>) => {
    for (const it of items) {
      insert.run({
        id: it.chunk.id,
        text: it.chunk.text,
        stack: it.chunk.metadata.stack,
        field: it.chunk.metadata.field,
        emb: JSON.stringify(it.vec),
      })
    }
  })
  tx(chunks.map((c, i) => ({ chunk: c, vec: vectors[i] ?? [] })))

  db.prepare("INSERT OR REPLACE INTO kb_meta (key, value) VALUES ($key, $value)").run({
    key: "yaml_hash",
    value: hash,
  })

  return { indexed: true, chunkCount: chunks.length }
}

export interface KbHit {
  id: string
  text: string
  stack: string
  field: string
  similarity: number
}

/**
 * KB-02: query 임베딩 → 모든 kb_chunks와 cosine similarity → top-k 반환.
 *
 * 24-25 chunk 규모에서는 in-memory linear scan으로 충분 (HNSW/ANN 불필요).
 *
 * @param query  사용자 자연어 query (예: "redis 어디 쓰여?")
 * @param k      반환 개수 (default 5 — KB-02 lock)
 * @returns similarity 내림차순 정렬된 KbHit[]
 */
export async function queryTopK(query: string, k = 5): Promise<KbHit[]> {
  const db = getDb()
  const embedder = getEmbedder()
  const qVec = await embedder.embedQuery(query)
  if (qVec.length === 0) return []

  const rows = db
    .query("SELECT id, text, stack, field, embedding FROM kb_chunks")
    .all() as Array<{ id: string; text: string; stack: string; field: string; embedding: string }>

  const scored: KbHit[] = rows.map((r) => ({
    id: r.id,
    text: r.text,
    stack: r.stack,
    field: r.field,
    similarity: cosineSimilarity(qVec, JSON.parse(r.embedding) as number[]),
  }))
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, k)
}

/**
 * 테스트 helper — singleton 폐기 + 다음 getDb()에서 재초기화.
 * Production code 호출 금지.
 *
 * @param newPath  optional — 다음 getDb() 호출 시 사용할 경로. null이면 default 복원.
 */
export function _resetForTest(newPath?: string | null): void {
  if (_db) {
    _db.close()
    _db = null
  }
  _embedder = null
  if (newPath !== undefined) {
    _dbPath = newPath
  }
}
