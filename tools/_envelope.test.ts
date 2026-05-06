import { describe, expect, test } from "bun:test"
import { isToolError, run, type ToolError } from "./_envelope"

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
