// audit/log.test.ts — D-14.3 + PITFALL #10 verification
//
// 테스트 isolation: beforeEach 마다 _resetForTest() + DB 파일 삭제 + getDb() 재초기화.
// 모든 테스트가 격리된 새 DB로 실행됨.

import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { existsSync, unlinkSync, rmSync } from "node:fs"
import { beginTurn, logTool, endTurn, getDb, _resetForTest } from "./log"

const DB_PATH = "./data/copilot.db"

function cleanDb(): void {
  _resetForTest()
  // 메인 DB 파일 + WAL/SHM sidecar 모두 정리
  for (const ext of ["", "-wal", "-shm"]) {
    const path = `${DB_PATH}${ext}`
    if (existsSync(path)) unlinkSync(path)
  }
}

beforeEach(() => {
  cleanDb()
})

afterAll(() => {
  cleanDb()
})

describe("audit/log.ts — D-14.3 hybrid schema + PITFALL #10", () => {
  test("getDb() 첫 호출은 data/ 디렉토리 + Database 인스턴스 생성", () => {
    const db = getDb()
    expect(db).toBeDefined()
    expect(existsSync(DB_PATH)).toBe(true)
    // singleton — 두 번째 호출은 동일 인스턴스
    expect(getDb()).toBe(db)
  })

  test("beginTurn — bigint id 반환 + parent_id NULL인 turn row INSERT", () => {
    const id = beginTurn("사용자 질문", "claude-sonnet-4-6")
    expect(typeof id).toBe("bigint")
    expect(id > 0n).toBe(true)

    const db = getDb()
    const row = db.query("SELECT id, parent_id, prompt, model FROM events WHERE id = $id")
      .get({ id }) as { id: bigint; parent_id: bigint | null; prompt: string; model: string }
    expect(row).not.toBeNull()
    expect(row.parent_id).toBeNull()
    expect(row.prompt).toBe("사용자 질문")
    expect(row.model).toBe("claude-sonnet-4-6")
  })

  test("beginTurn 2000자 trim — D-14.3", () => {
    const longPrompt = "a".repeat(3000)
    const id = beginTurn(longPrompt, "model-x")
    const db = getDb()
    const row = db.query("SELECT prompt FROM events WHERE id = $id")
      .get({ id }) as { prompt: string }
    expect(row.prompt.length).toBe(2000)
  })

  test("logTool — child row INSERT (parent_id 자기참조 + tool_name + ok)", () => {
    const turnId = beginTurn("test", "model-x")
    logTool(turnId, "listContainers", { limit: 5 }, "12 컨테이너", true, 250)

    const db = getDb()
    const row = db.query(
      "SELECT parent_id, tool_name, input, result_summary, ok, duration_ms FROM events WHERE parent_id = $pid"
    ).get({ pid: turnId }) as {
      parent_id: bigint
      tool_name: string
      input: string
      result_summary: string
      ok: bigint
      duration_ms: bigint
    }
    expect(row.parent_id).toBe(turnId)
    expect(row.tool_name).toBe("listContainers")
    expect(row.input).toBe(JSON.stringify({ limit: 5 }))
    expect(row.result_summary).toBe("12 컨테이너")
    expect(row.ok).toBe(1n) // safeIntegers → bigint
    expect(row.duration_ms).toBe(250n)
  })

  test("logTool 500자 trim — D-14.3", () => {
    const turnId = beginTurn("t", "m")
    const longSummary = "x".repeat(800)
    logTool(turnId, "tool", { a: 1 }, longSummary, true, 50)

    const db = getDb()
    const row = db.query(
      "SELECT result_summary FROM events WHERE parent_id = $pid"
    ).get({ pid: turnId }) as { result_summary: string }
    expect(row.result_summary.length).toBe(500)
  })

  test("endTurn — UPDATE turn row with output_tokens / cache_read_tokens / total_tool_calls / duration_ms", () => {
    const turnId = beginTurn("test", "m")
    endTurn(turnId, 100, 50, 3, 1500)

    const db = getDb()
    const row = db.query(
      "SELECT output_tokens, cache_read_tokens, total_tool_calls, duration_ms, error_envelope FROM events WHERE id = $id"
    ).get({ id: turnId }) as {
      output_tokens: bigint
      cache_read_tokens: bigint
      total_tool_calls: bigint
      duration_ms: bigint
      error_envelope: string | null
    }
    expect(row.output_tokens).toBe(100n)
    expect(row.cache_read_tokens).toBe(50n)
    expect(row.total_tool_calls).toBe(3n)
    expect(row.duration_ms).toBe(1500n)
    expect(row.error_envelope).toBeNull()
  })

  test("endTurn — error_envelope JSON 직렬화", () => {
    const turnId = beginTurn("test", "m")
    const envelope = { problem: "X", cause: "Y", fix: "Z", retryable: false }
    endTurn(turnId, 0, 0, 0, 100, envelope)

    const db = getDb()
    const row = db.query(
      "SELECT error_envelope FROM events WHERE id = $id"
    ).get({ id: turnId }) as { error_envelope: string }
    expect(row.error_envelope).toBe(JSON.stringify(envelope))
  })

  test("PITFALL #10 — strict 모드 활성: 잘못된 binding 키는 throw", () => {
    const db = getDb()
    const stmt = db.prepare("SELECT * FROM events WHERE id = $x")
    // strict: true이므로 binding 키 오타 → throw
    expect(() => stmt.get({ wrong_key: 1 })).toThrow()
  })
})
