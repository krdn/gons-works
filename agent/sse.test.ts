// agent/sse.test.ts — Plan 01-07이 stub으로 만든 sse.ts의 LOOP-06 watchdog 검증.
//
// **NOTE:** 이 파일은 Plan 01-06이 본격 작성한다. Plan 01-07은 watchdog 동작이
// 정확히 동작함을 보장하기 위해 minimal coverage만 둔다. 01-06 머지 시 확장.
//
// LOOP-06 / D-15.3 envelope shape lock — 머지 후에도 envelope 문자열은 변하면 안 됨.

import { describe, expect, test } from "bun:test"
import {
  toSSEFrame,
  createChunkWatchdog,
  SSE_CHUNK_TIMEOUT_MS,
  type SseEvent,
} from "./sse"

describe("toSSEFrame (UI-02)", () => {
  test("text-delta event → frame.event === 'text-delta'", () => {
    const frame = toSSEFrame({ type: "text-delta", delta: "hi" })
    expect(frame.event).toBe("text-delta")
    expect(JSON.parse(frame.data)).toEqual({ type: "text-delta", delta: "hi" })
  })

  test("final event → frame.event === 'final'", () => {
    const frame = toSSEFrame({ type: "final" })
    expect(frame.event).toBe("final")
  })

  test("drift event → frame.event === 'drift' (KB-03 / D-13.4)", () => {
    const frame = toSSEFrame({
      type: "drift",
      message: "⚠ drift",
      unknown: ["vscode"],
      stale: [],
    })
    expect(frame.event).toBe("drift")
    const parsed = JSON.parse(frame.data) as Extract<
      SseEvent,
      { type: "drift" }
    >
    expect(parsed.unknown).toEqual(["vscode"])
  })

  test("error event → 5 fields 보존", () => {
    const frame = toSSEFrame({
      type: "error",
      problem: "x",
      cause: "y",
      fix: "z",
      retryable: true,
    })
    const parsed = JSON.parse(frame.data) as Extract<
      SseEvent,
      { type: "error" }
    >
    expect(parsed.problem).toBe("x")
    expect(parsed.retryable).toBe(true)
  })
})

describe("createChunkWatchdog (LOOP-06 / D-15.3 envelope shape lock)", () => {
  test("60s default constant lock", () => {
    expect(SSE_CHUNK_TIMEOUT_MS).toBe(60_000)
  })

  test("timeout 발화: reset 없이 timeoutMs 초과 → onTimeout 1회 + signal.aborted true", async () => {
    let calls = 0
    let captured: Extract<SseEvent, { type: "error" }> | null = null
    const wd = createChunkWatchdog((ev) => {
      calls++
      captured = ev
    }, 50)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(calls).toBe(1)
    expect(wd.signal.aborted).toBe(true)
    // D-15.3 envelope shape lock — 문자열 그대로 (frontend가 검증할 수도 있음)
    expect(captured!.problem).toBe("stream chunk timeout 60s")
    expect(captured!.cause).toContain("응답 스트림 중단")
    expect(captured!.fix).toContain("cli-proxy-api")
    expect(captured!.retryable).toBe(true)
    wd.cancel()
  })

  test("reset 호출 시 timer 갱신 — 30+30 < 50+50 동안 미발화", async () => {
    let calls = 0
    const wd = createChunkWatchdog(() => {
      calls++
    }, 50)
    await new Promise((resolve) => setTimeout(resolve, 30))
    wd.reset()
    await new Promise((resolve) => setTimeout(resolve, 30))
    // 누적 60ms이지만 reset이 timer를 30ms 시점에서 재설정 → 추가 50ms 후 발화
    expect(calls).toBe(0)
    expect(wd.signal.aborted).toBe(false)
    wd.cancel()
  })

  test("cancel 호출 시 timer 영구 중단 — 시간 지나도 미발화", async () => {
    let calls = 0
    const wd = createChunkWatchdog(() => {
      calls++
    }, 50)
    await new Promise((resolve) => setTimeout(resolve, 20))
    wd.cancel()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(calls).toBe(0)
    expect(wd.signal.aborted).toBe(false)
  })

  test("cancel 후 reset은 no-op (timer 재가동 없음)", async () => {
    let calls = 0
    const wd = createChunkWatchdog(() => {
      calls++
    }, 30)
    wd.cancel()
    wd.reset() // cancelled 상태에선 무시
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls).toBe(0)
  })
})
