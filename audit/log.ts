// audit/log.ts — D-14 SQLite event log (turn + 자식 tool row hybrid)
//
// Public API:
//   getDb()       — singleton bun:sqlite Database (strict + safeIntegers + WAL)
//   beginTurn()   — turn row INSERT (parent_id NULL), bigint id 반환
//   logTool()     — tool row INSERT (parent_id NOT NULL)
//   endTurn()     — turn row UPDATE (output_tokens / cache_read_tokens / total_tool_calls / duration_ms / error_envelope)
//   _resetForTest()— 테스트 helper (production code 사용 금지)
//
// 핵심 결정:
//   D-14.1 hybrid schema (events 단일 테이블, parent_id 자기참조)
//   D-14.2 ./data/copilot.db (.gitignore /data/)
//   D-14.3 prompt ≤2000자 / result_summary ≤500자 trim — application layer
//   D-14.4 모든 read tool 호출 기록 (tools/_envelope.ts에서 logTool 호출)
//   PITFALL #10 strict + safeIntegers 필수 (묵음 NULL binding 차단)

import { Database } from "bun:sqlite"
import { mkdirSync, existsSync, readFileSync } from "node:fs"
import { dirname } from "node:path"

const DB_PATH = "./data/copilot.db"
const SCHEMA_PATH = "audit/schema.sql"

let _db: Database | null = null

/**
 * bun:sqlite Database singleton.
 *
 * 첫 호출:
 *   1. ./data/ 디렉토리 mkdir (D-14.2)
 *   2. Database open with { strict: true, safeIntegers: true, create: true } (PITFALL #10)
 *   3. PRAGMA journal_mode = WAL + synchronous = NORMAL (PITFALL #10)
 *   4. audit/schema.sql 실행 (idempotent — IF NOT EXISTS)
 * 이후 호출: 동일 instance 반환.
 */
export function getDb(): Database {
  if (_db) return _db
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // PITFALL #10: strict + safeIntegers 필수 (묵음 NULL binding 차단)
  _db = new Database(DB_PATH, { strict: true, safeIntegers: true, create: true })
  _db.run("PRAGMA journal_mode = WAL")
  _db.run("PRAGMA synchronous = NORMAL")
  // schema.sql 실행 (CREATE TABLE / CREATE INDEX 모두 IF NOT EXISTS)
  const sql = readFileSync(SCHEMA_PATH, "utf-8")
  _db.run(sql)
  return _db
}

/**
 * Turn row INSERT — parent_id NULL.
 *
 * @param prompt 사용자 prompt — 2000자 초과 시 trim (D-14.3)
 * @param model  모델 식별자 (예: "claude-sonnet-4-6")
 * @returns 새 turn row의 id (bigint, safeIntegers 모드)
 */
export function beginTurn(prompt: string, model: string): bigint {
  const db = getDb()
  const trimmed = prompt.slice(0, 2000) // D-14.3 prompt cap
  // PITFALL #10 + bun:sqlite strict 모드: binding key는 $ prefix 없이 사용
  // (SQL에서 $name으로 선언하지만 JS 객체에서는 { name: ... }로 전달)
  const stmt = db.prepare(
    "INSERT INTO events (ts, model, prompt) VALUES ($ts, $model, $prompt)"
  )
  stmt.run({
    ts: new Date().toISOString(),
    model: model,
    prompt: trimmed,
  })
  // safeIntegers: true → bigint 반환
  const row = db.query("SELECT last_insert_rowid() AS id").get() as { id: bigint }
  return row.id
}

/**
 * Tool call row INSERT — parent_id NOT NULL.
 *
 * @param parentId       turn row id (beginTurn 반환값)
 * @param name           tool 이름 (예: "listContainers")
 * @param input          tool input — JSON.stringify 후 2000자 trim
 * @param resultSummary  tool 결과 요약 — 500자 trim (D-14.3)
 * @param ok             성공 여부 (true → 1, false → 0)
 * @param durationMs     tool 실행 시간 (밀리초)
 */
export function logTool(
  parentId: bigint,
  name: string,
  input: unknown,
  resultSummary: string,
  ok: boolean,
  durationMs: number
): void {
  const db = getDb()
  const stmt = db.prepare(
    "INSERT INTO events (ts, parent_id, tool_name, input, result_summary, ok, duration_ms) " +
      "VALUES ($ts, $pid, $name, $input, $summary, $ok, $dur)"
  )
  stmt.run({
    ts: new Date().toISOString(),
    pid: parentId,
    name: name,
    input: JSON.stringify(input).slice(0, 2000),
    summary: resultSummary.slice(0, 500), // D-14.3 result_summary cap
    ok: ok ? 1 : 0,
    dur: durationMs,
  })
}

/**
 * Turn row UPDATE — agent loop 종료 시 cost 합계 + duration + error envelope 기록.
 *
 * @param id              turn row id
 * @param outputTokens    Anthropic SDK final.usage.output_tokens 합계
 * @param cacheReadTokens Anthropic SDK final.usage.cache_read_input_tokens 합계
 * @param totalToolCalls  이번 turn에서 실행된 tool 호출 횟수
 * @param durationMs      turn 시작-종료 elapsed 시간 (밀리초)
 * @param errorEnvelope   에러 envelope (D-15.4 shape) — undefined이면 NULL
 */
export function endTurn(
  id: bigint,
  outputTokens: number,
  cacheReadTokens: number,
  totalToolCalls: number,
  durationMs: number,
  errorEnvelope?: unknown
): void {
  const db = getDb()
  const stmt = db.prepare(
    "UPDATE events SET output_tokens = $out, cache_read_tokens = $cache, " +
      "total_tool_calls = $calls, duration_ms = $dur, error_envelope = $err " +
      "WHERE id = $id"
  )
  stmt.run({
    id: id,
    out: outputTokens,
    cache: cacheReadTokens,
    calls: totalToolCalls,
    dur: durationMs,
    err: errorEnvelope === undefined ? null : JSON.stringify(errorEnvelope),
  })
}

/**
 * 테스트 helper — singleton 폐기 + 다음 getDb() 호출 시 재초기화.
 *
 * Production code에서 호출 금지. audit/log.test.ts에서 isolation 보장에만 사용.
 */
export function _resetForTest(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
