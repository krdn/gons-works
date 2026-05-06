import { describe, expect, test, beforeEach, afterAll } from "bun:test"
import { existsSync, unlinkSync } from "node:fs"
import { isToolError, run, type ToolError } from "./_envelope"
import { beginTurn, getDb, _resetForTest } from "../audit/log"

const DB_PATH = "./data/copilot.db"

// audit DB isolation helper — Plan 03 audit/log.test.ts 패턴 그대로 (WAL/SHM sidecar 정리).
function cleanDb(): void {
  _resetForTest()
  for (const ext of ["", "-wal", "-shm"]) {
    const path = `${DB_PATH}${ext}`
    if (existsSync(path)) unlinkSync(path)
  }
}

// LOOP-02: 모든 tool wrapper가 공통 ToolError envelope { problem, cause, fix, retryable } 반환.
// LOOP-04: catch 경로에서 절대 throw 안 함 — orphan tool_use 방지.
// LOOP-06: 30s AbortController timeout — timeout 도달 시 envelope retryable=true.

describe("tools/_envelope: ToolError shape + run() wrapper", () => {
  test("happy path: fn 결과를 그대로 반환한다", async () => {
    // Arrange + Act
    const result = await run("t", async () => "ok")

    // Assert
    expect(result).toBe("ok")
  })

  test("error path: fn이 throw하면 ToolError envelope 반환 (절대 throw 안 함)", async () => {
    // Arrange
    const failing = async () => {
      throw new Error("boom")
    }

    // Act
    const result = await run("listContainers", failing)

    // Assert: 5 필드 envelope shape
    expect(isToolError(result)).toBe(true)
    const err = result as ToolError
    expect(err.problem).toContain("tool listContainers 실패")
    expect(err.cause).toBe("boom")
    expect(err.fix).toBe("로그 확인 후 재시도")
    expect(err.retryable).toBe(true)
  })

  test("timeout path: timeoutMs 초과 시 AbortError → ToolError(retryable=true)", async () => {
    // Arrange: tool이 50ms 걸리지만 timeoutMs는 10ms
    const slow = async (signal: AbortSignal): Promise<string> => {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve("late"), 50)
        signal.addEventListener("abort", () => {
          clearTimeout(t)
          const ae = new Error("aborted")
          ae.name = "AbortError"
          reject(ae)
        })
      })
    }

    // Act
    const result = await run("readLogs", slow, 10)

    // Assert
    expect(isToolError(result)).toBe(true)
    const err = result as ToolError
    expect(err.problem).toContain("timeout")
    expect(err.problem).toContain("readLogs")
    expect(err.retryable).toBe(true)
    expect(err.fix).toContain("재시도")
  })

  test("isToolError: 정상 ToolError 객체에는 true", () => {
    const sample: ToolError = {
      problem: "x",
      cause: "y",
      fix: "z",
      retryable: true,
    }
    expect(isToolError(sample)).toBe(true)
  })

  test("isToolError: 문자열에는 false", () => {
    expect(isToolError("string")).toBe(false)
  })

  test("isToolError: retryable 필드 누락된 객체에는 false", () => {
    expect(isToolError({ problem: "x" })).toBe(false)
  })

  test("cause excerpt: 200자 초과 시 200자로 trim", async () => {
    // Arrange
    const longMessage = "a".repeat(300)
    const failing = async () => {
      throw new Error(longMessage)
    }

    // Act
    const result = await run("t", failing)

    // Assert
    expect(isToolError(result)).toBe(true)
    const err = result as ToolError
    expect(err.cause.length).toBe(200)
  })
})

// AUDIT-01 + D-14.4: auditParentId 통합 테스트.
// 신규 4번째/5번째 인자(auditParentId, auditInput)가 optional이고
// 미전달 시 기존 동작 유지, 전달 시 SQLite에 child row INSERT.
describe("tools/_envelope: audit hook 통합 (AUDIT-01 + D-14.4)", () => {
  beforeEach(() => {
    cleanDb()
  })

  afterAll(() => {
    cleanDb()
  })

  test("audit hook skip — auditParentId 미전달 시 audit DB row 생성 안 함", async () => {
    // Arrange
    const turnId = beginTurn("test prompt", "test-model")

    // Act — 3-arg 시그니처 (Plan 02 호환성)
    const result = await run("test-tool", async () => "ok")

    // Assert
    expect(result).toBe("ok")
    const db = getDb()
    const row = db
      .query("SELECT COUNT(*) AS n FROM events WHERE parent_id = $pid")
      .get({ pid: turnId }) as { n: bigint }
    expect(row.n).toBe(0n) // child row 0개
  })

  test("audit hook fire — auditParentId + auditInput 전달 시 SQLite child row INSERT (ok=1)", async () => {
    // Arrange
    const turnId = beginTurn("test prompt", "test-model")

    // Act — 5-arg 시그니처
    const result = await run(
      "listContainers",
      async () => "12 컨테이너 목록",
      30_000,
      turnId,
      { limit: 5 },
    )

    // Assert
    expect(result).toBe("12 컨테이너 목록")
    const db = getDb()
    const row = db
      .query(
        "SELECT tool_name, input, result_summary, ok FROM events WHERE parent_id = $pid",
      )
      .get({ pid: turnId }) as {
      tool_name: string
      input: string
      result_summary: string
      ok: bigint
    }
    expect(row.tool_name).toBe("listContainers")
    expect(row.input).toBe(JSON.stringify({ limit: 5 }))
    expect(row.result_summary).toBe("12 컨테이너 목록")
    expect(row.ok).toBe(1n)
  })

  test("audit hook on error — tool throw 시에도 logTool 호출 + ok=0 + envelope summary 기록", async () => {
    // Arrange
    const turnId = beginTurn("test prompt", "test-model")

    // Act — fn이 throw → ToolError envelope 반환 + audit row ok=0
    const result = await run(
      "readLogs",
      async () => {
        throw new Error("docker daemon down")
      },
      30_000,
      turnId,
      { containerName: "news-prod-api", lines: 200 },
    )

    // Assert: tool 결과는 envelope (PITFALL #1 — throw 안 함)
    expect(isToolError(result)).toBe(true)
    const err = result as ToolError
    expect(err.cause).toBe("docker daemon down")

    // Assert: audit row는 ok=0 + summary에 problem/cause 직렬화
    const db = getDb()
    const row = db
      .query(
        "SELECT tool_name, ok, result_summary FROM events WHERE parent_id = $pid",
      )
      .get({ pid: turnId }) as {
      tool_name: string
      ok: bigint
      result_summary: string
    }
    expect(row.tool_name).toBe("readLogs")
    expect(row.ok).toBe(0n)
    expect(row.result_summary).toContain("readLogs 실패")
    expect(row.result_summary).toContain("docker daemon down")
  })
})
