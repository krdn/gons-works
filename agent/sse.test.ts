// agent/sse.test.ts — UI-02 6 event taxonomy + LOOP-06 60s chunk watchdog 검증.
//
// 실 timer는 timeoutMs를 작은 값(100ms)으로 줄여 테스트. 60_000ms 절댓값은 SSE_CHUNK_TIMEOUT_MS 상수로만 검증.
// 마진은 50ms 단위로 — Bun setTimeout jitter 흡수 (advisor 권고).

import { describe, expect, test } from "bun:test"
import { type SseEvent, toSSEFrame, SSE_CHUNK_TIMEOUT_MS, createChunkWatchdog } from "./sse"

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe("toSSEFrame — event 이름 = ev.type, data = JSON.stringify(ev)", () => {
  test("text-delta", () => {
    const frame = toSSEFrame({ type: "text-delta", delta: "hi" })
    expect(frame.event).toBe("text-delta")
    expect(JSON.parse(frame.data)).toEqual({ type: "text-delta", delta: "hi" })
  })

  test("final", () => {
    const frame = toSSEFrame({ type: "final" })
    expect(frame.event).toBe("final")
    expect(JSON.parse(frame.data)).toEqual({ type: "final" })
  })

  test("tool-start", () => {
    const frame = toSSEFrame({ type: "tool-start", name: "listContainers", args: { limit: 5 } })
    expect(frame.event).toBe("tool-start")
    const parsed = JSON.parse(frame.data) as { type: string; name: string; args: { limit: number } }
    expect(parsed.name).toBe("listContainers")
    expect(parsed.args.limit).toBe(5)
  })

  test("tool-result", () => {
    const frame = toSSEFrame({
      type: "tool-result",
      name: "readLogs",
      ok: true,
      summary: "200 lines",
    })
    expect(frame.event).toBe("tool-result")
    const parsed = JSON.parse(frame.data) as { ok: boolean; summary: string }
    expect(parsed.ok).toBe(true)
    expect(parsed.summary).toBe("200 lines")
  })

  test("error — 5 fields preserved (problem/cause/fix/retryable + type)", () => {
    const frame = toSSEFrame({
      type: "error",
      problem: "x",
      cause: "y",
      fix: "z",
      retryable: true,
    })
    expect(frame.event).toBe("error")
    const parsed = JSON.parse(frame.data) as Record<string, unknown>
    expect(parsed.type).toBe("error")
    expect(parsed.problem).toBe("x")
    expect(parsed.cause).toBe("y")
    expect(parsed.fix).toBe("z")
    expect(parsed.retryable).toBe(true)
  })

  test("drift — KB-03 / D-13.4 (message + unknown[] + stale[])", () => {
    const frame = toSSEFrame({
      type: "drift",
      message: "⚠ services.yaml 불일치",
      unknown: ["vscode"],
      stale: [],
    })
    expect(frame.event).toBe("drift")
    const parsed = JSON.parse(frame.data) as { unknown: string[]; stale: string[] }
    expect(parsed.unknown).toEqual(["vscode"])
    expect(parsed.stale).toEqual([])
  })

  test("type union completeness — exhaustive switch compile-time check", () => {
    function exhaust(ev: SseEvent): string {
      switch (ev.type) {
        case "text-delta":
          return "td"
        case "tool-start":
          return "ts"
        case "tool-result":
          return "tr"
        case "final":
          return "f"
        case "error":
          return "e"
        case "drift":
          return "d"
        // TS strict 모드에서 case 빠지면 컴파일 에러 — 6개 모두 있어야 함.
      }
    }
    expect(exhaust({ type: "final" })).toBe("f")
  })
})

describe("LOOP-06 / D-15.3 — createChunkWatchdog 60s no-chunk timeout", () => {
  test("constant SSE_CHUNK_TIMEOUT_MS = 60_000 (D-15.3 lock)", () => {
    expect(SSE_CHUNK_TIMEOUT_MS).toBe(60_000)
  })

  test("timeout 발화: reset 없이 timeoutMs 초과 → onTimeout 1회 + signal.aborted=true", async () => {
    const events: Array<Extract<SseEvent, { type: "error" }>> = []
    const wd = createChunkWatchdog((ev) => events.push(ev), 50)

    expect(wd.signal.aborted).toBe(false)
    await sleep(120) // 50ms timeout + 70ms 마진 — jitter 흡수

    expect(events.length).toBe(1)
    expect(events[0]?.type).toBe("error")
    expect(events[0]?.problem).toBe("stream chunk timeout 60s")
    expect(events[0]?.cause).toContain("응답 스트림 중단")
    expect(events[0]?.fix).toContain("cli-proxy-api")
    expect(events[0]?.retryable).toBe(true)
    expect(wd.signal.aborted).toBe(true)
  })

  test("reset 동작: 중간에 reset() → 누적 시간이 timeoutMs 초과해도 onTimeout 미발화", async () => {
    const events: Array<Extract<SseEvent, { type: "error" }>> = []
    const wd = createChunkWatchdog((ev) => events.push(ev), 100)

    await sleep(60) // 60ms 경과 — 100ms 미만
    wd.reset() // 타이머 재시작
    await sleep(60) // 추가 60ms — reset 후 100ms 미만, 누적은 120ms

    // reset이 동작하면 100ms 미달이므로 미발화. cleanup.
    expect(events.length).toBe(0)
    expect(wd.signal.aborted).toBe(false)
    wd.cancel()
  })

  test("cancel 동작: 호출 후 timeoutMs 초과해도 onTimeout 미발화 + signal 미abort", async () => {
    const events: Array<Extract<SseEvent, { type: "error" }>> = []
    const wd = createChunkWatchdog((ev) => events.push(ev), 50)

    await sleep(20)
    wd.cancel()
    await sleep(80) // 누적 100ms — cancel 안 했으면 발화했을 시간

    expect(events.length).toBe(0)
    expect(wd.signal.aborted).toBe(false)
  })
})
