// agent/loop.test.ts — LOOP-01..07 단위 검증.
//
// 실 Anthropic SDK 호출 없음 — _setClientFactoryForTest()로 mock client 주입.
// kb/index.ts의 _setEmbedderForTest()와 동일 DI 컨벤션 (advisor 권고).
//
// 테스트 환경:
//   - loadEnv()가 ANTHROPIC_API_KEY/VOYAGE_API_KEY 비어 있으면 process.exit(1) → beforeAll에서 dummy 주입.
//   - audit/log.ts beginTurn/endTurn은 실 SQLite (data/copilot.db)에 쓴다 — KB_DB_PATH/AUDIT 동일 패턴은
//     audit이 아직 path override를 노출하지 않으므로 tests data/copilot.db 사용 허용 (다른 plan 테스트와 공유).

import { describe, expect, test, beforeAll, beforeEach } from "bun:test"
import type Anthropic from "@anthropic-ai/sdk"
import type { SseEvent } from "./sse"
import {
  iterate,
  estimateTokens,
  compactHistory,
  MAX_TOOL_ITERATIONS,
  MAX_API_CALLS_PER_SESSION,
  _resetForTest,
  _setClientFactoryForTest,
  _setSessionCallsForTest,
} from "./loop"

beforeAll(() => {
  // loadEnv() 통과를 위한 최소 dummy. 실 API 호출 안 함 (mock client 주입).
  if (!Bun.env.ANTHROPIC_API_KEY) Bun.env.ANTHROPIC_API_KEY = "test-key"
  if (!Bun.env.VOYAGE_API_KEY) Bun.env.VOYAGE_API_KEY = "test-key"
  if (!Bun.env.DOCKER_CONTEXT) Bun.env.DOCKER_CONTEXT = "home-server"
})

beforeEach(() => {
  _resetForTest()
})

// 헬퍼: deferred Promise — in-flight 동시성 테스트용
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// 헬퍼: 정해진 응답을 순서대로 반환하는 mock client
function makeMockClient(responses: Anthropic.Message[]): Anthropic {
  let i = 0
  return {
    messages: {
      create: async (): Promise<Anthropic.Message> => {
        const r = responses[i++]
        if (!r) throw new Error(`mock client exhausted (${responses.length} responses 소진)`)
        return r
      },
    },
  } as unknown as Anthropic
}

function endTurnMessage(text = "ok"): Anthropic.Message {
  return {
    id: "msg_test",
    container: null,
    content: [{ type: "text", text, citations: null }],
    model: "claude-sonnet-4-6",
    role: "assistant",
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    type: "message",
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      service_tier: null,
      server_tool_use: null,
    },
  } as unknown as Anthropic.Message
}

describe("LOOP-03 hard cap 상수", () => {
  test("MAX_TOOL_ITERATIONS = 8", () => {
    expect(MAX_TOOL_ITERATIONS).toBe(8)
  })
  test("MAX_API_CALLS_PER_SESSION = 30", () => {
    expect(MAX_API_CALLS_PER_SESSION).toBe(30)
  })
})

describe("LOOP-05 estimateTokens / compactHistory", () => {
  test("estimateTokens: 빈 배열 → 0", () => {
    expect(estimateTokens([])).toBe(0)
  })

  test("estimateTokens: 'abcdefgh' (8 chars) → 2 tokens (4 char per token)", () => {
    expect(estimateTokens([{ role: "user", content: "abcdefgh" }])).toBe(2)
  })

  test("compactHistory: 5 messages, low tokens → unchanged", () => {
    const msgs: Anthropic.MessageParam[] = Array.from({ length: 5 }, (_, i) => ({
      role: "user" as const,
      content: `m${i}`,
    }))
    expect(compactHistory(msgs).length).toBe(5)
  })

  test("compactHistory: 10 messages with low tokens → unchanged (threshold 미달)", () => {
    const msgs: Anthropic.MessageParam[] = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `m${i}`,
    }))
    expect(compactHistory(msgs).length).toBe(10)
  })

  test("compactHistory: 10 messages with token > 50K → 7 (system + 마지막 6)", () => {
    const big = "x".repeat(60_000) // ~15K tokens per message
    const msgs: Anthropic.MessageParam[] = Array.from({ length: 10 }, () => ({
      role: "user" as const,
      content: big,
    }))
    const out = compactHistory(msgs)
    expect(out.length).toBe(7)
    // 첫 번째는 원본 messages[0], 나머지는 마지막 6개
    expect(out[0]).toBe(msgs[0])
    expect(out[1]).toBe(msgs[4])
    expect(out[6]).toBe(msgs[9])
  })

  test("compactHistory: messages.length <= 7이면 token 초과해도 그대로", () => {
    const big = "x".repeat(60_000)
    const msgs: Anthropic.MessageParam[] = Array.from({ length: 7 }, () => ({
      role: "user" as const,
      content: big,
    }))
    expect(compactHistory(msgs).length).toBe(7)
  })
})

describe("LOOP-01 iterate — happy path (text-delta + final)", () => {
  test("end_turn 응답 하나 → text-delta + final emit", async () => {
    _setClientFactoryForTest(() => makeMockClient([endTurnMessage("hello")]))
    const events: SseEvent[] = []
    await iterate("hi", { sessionId: "s1", emit: (ev) => events.push(ev) })

    const types = events.map((e) => e.type)
    expect(types).toContain("text-delta")
    expect(types[types.length - 1]).toBe("final")
    const td = events.find((e) => e.type === "text-delta")
    expect(td?.type === "text-delta" && td.delta).toBe("hello")
  })
})

describe("LOOP-04 orphan tool_use 방지 — unknown tool name 도 tool_result push", () => {
  test("unknown tool name → tool-result emit ok=false + retryable=false envelope (이후 end_turn으로 종료)", async () => {
    const toolUseMsg: Anthropic.Message = {
      id: "msg1",
      container: null,
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "nonexistentTool",
          input: { x: 1 },
        },
      ],
      model: "claude-sonnet-4-6",
      role: "assistant",
      stop_reason: "tool_use",
      stop_details: null,
      stop_sequence: null,
      type: "message",
      usage: {
        input_tokens: 5,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        service_tier: null,
        server_tool_use: null,
      },
    } as unknown as Anthropic.Message

    _setClientFactoryForTest(() => makeMockClient([toolUseMsg, endTurnMessage("done")]))
    const events: SseEvent[] = []
    await iterate("trigger unknown tool", {
      sessionId: "s2",
      emit: (ev) => events.push(ev),
    })

    const toolResult = events.find((e) => e.type === "tool-result")
    expect(toolResult).toBeDefined()
    expect(toolResult?.type === "tool-result" && toolResult.ok).toBe(false)
    expect(events[events.length - 1]?.type).toBe("final")
  })
})

describe("LOOP-07 inFlight dedup — 같은 sessionId+queryHash 중 두 번째는 즉시 return", () => {
  test("두 iterate 동시 호출 → 두 번째는 '재연결' 텍스트 + 즉시 종료", async () => {
    const def = deferred<Anthropic.Message>()
    _setClientFactoryForTest(
      () =>
        ({
          messages: {
            create: () => def.promise,
          },
        }) as unknown as Anthropic,
    )

    const eventsA: SseEvent[] = []
    const eventsB: SseEvent[] = []

    const promiseA = iterate("same-prompt", { sessionId: "s3", emit: (ev) => eventsA.push(ev) })
    // tiny delay — A가 inFlight.set 했음을 보장
    await sleep(5)
    const promiseB = iterate("same-prompt", { sessionId: "s3", emit: (ev) => eventsB.push(ev) })

    // B는 즉시 끝나야 한다 (A의 응답 대기 안 함)
    await promiseB
    expect(eventsB.length).toBeGreaterThanOrEqual(1)
    const reconnectText = eventsB.find(
      (e) => e.type === "text-delta" && e.delta.includes("재연결"),
    )
    expect(reconnectText).toBeDefined()

    // A 정리
    def.resolve(endTurnMessage("a-done"))
    await promiseA
  })
})

describe("LOOP-03 session 한도 — 초과 시 첫 iteration에서 error emit + break", () => {
  test("sessionApiCalls > 30 setup 후 iterate → error event emit", async () => {
    _setClientFactoryForTest(() => makeMockClient([endTurnMessage("never reached")]))
    _setSessionCallsForTest("s4", MAX_API_CALLS_PER_SESSION + 1)

    const events: SseEvent[] = []
    await iterate("any", { sessionId: "s4", emit: (ev) => events.push(ev) })

    const err = events.find((e) => e.type === "error")
    expect(err).toBeDefined()
    expect(err?.type === "error" && err.problem).toContain("세션 API 호출 한도")
  })
})

// === F-1 회귀 방지 (Phase 2 D-E1 carry-back, plan 01-10 Task 4 T1) ===
//
// 2 iteration loop에서 첫 응답이 tool_use를 포함할 때, 두 번째 callWithFallback에 전달되는
// messages가 비어있지 않은지 검증. 이전 버그: compactHistory가 length<=7 분기에서 같은 ref
// 반환 → caller의 `messages.length=0; messages.push(...compacted)` 패턴이 in-place로 messages를
// 비움 → 두 번째 호출에서 400 invalid_request_error.
describe("LOOP-05 F-1 회귀 — 2 iteration tool-use turn에서 두 번째 호출 messages 보존", () => {
  test("compactHistory는 항상 새 array 반환 (early-return 분기에서도)", () => {
    const small: Anthropic.MessageParam[] = [{ role: "user", content: "hi" }]
    const out1 = compactHistory(small)
    expect(out1).not.toBe(small) // 같은 ref 아님
    expect(out1.length).toBe(1)

    // length <= 7 + token 초과
    const big = "x".repeat(60_000)
    const seven: Anthropic.MessageParam[] = Array.from({ length: 7 }, () => ({
      role: "user" as const,
      content: big,
    }))
    const out2 = compactHistory(seven)
    expect(out2).not.toBe(seven)
    expect(out2.length).toBe(7)
  })

  test("array aliasing 안전: compactHistory 결과를 caller가 in-place reset해도 messages 손실 없음", () => {
    // F-1 root cause 회귀 검증: const a=[1,2,3]; const b=a; a.length=0; a.push(...b) → 0 (BUG)
    // fix 후 compactHistory는 새 array 반환하므로 aliasing 없음.
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ]
    const compacted = compactHistory(messages)
    messages.length = 0
    messages.push(...compacted)
    expect(messages.length).toBe(3) // 이전 버그면 0
  })

  test("iterate: 2-iteration tool_use turn에서 두 번째 messages.create 호출 시 messages.length > 0", async () => {
    // 첫 응답: tool_use (listContainers). 두 번째 응답: end_turn.
    // mock client가 두 번째 호출의 messages를 캡처하여 검증.
    const toolUseMsg: Anthropic.Message = {
      id: "msg1",
      container: null,
      content: [
        { type: "text", text: "확인하겠습니다.", citations: null },
        { type: "tool_use", id: "tu_1", name: "listContainers", input: { limit: 5 } },
      ],
      model: "claude-sonnet-4-6",
      role: "assistant",
      stop_reason: "tool_use",
      stop_details: null,
      stop_sequence: null,
      type: "message",
      usage: {
        input_tokens: 10,
        output_tokens: 30,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        service_tier: null,
        server_tool_use: null,
      },
    } as unknown as Anthropic.Message

    const capturedCalls: Anthropic.MessageParam[][] = []
    let i = 0
    const responses = [toolUseMsg, endTurnMessage("answer")]
    _setClientFactoryForTest(() => ({
      messages: {
        create: async (args: { messages: Anthropic.MessageParam[] }): Promise<Anthropic.Message> => {
          capturedCalls.push([...args.messages])
          const r = responses[i++]
          if (!r) throw new Error("mock exhausted")
          return r
        },
      },
    } as unknown as Anthropic))

    const events: SseEvent[] = []
    await iterate("ais-prod redis 어디 쓰여?", {
      sessionId: "s-f1-regression",
      emit: (ev) => events.push(ev),
    })

    // 두 번 호출되어야 함
    expect(capturedCalls.length).toBe(2)
    // 두 번째 호출의 messages가 비어있지 않아야 함 (F-1 핵심 보장)
    expect(capturedCalls[1]!.length).toBeGreaterThan(0)
    // assistant + user(tool_result) append 후 두 번째 호출에는 messages.length === 3 기대
    expect(capturedCalls[1]!.length).toBe(3)
    // final emit 도달
    expect(events[events.length - 1]?.type).toBe("final")
  })
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
