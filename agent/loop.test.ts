// agent/loop.test.ts — LOOP-01..07 단위 검증.
//
// 실 Anthropic SDK 호출 없음 — _setClientFactoryForTest()로 mock client 주입.
// kb/index.ts의 _setEmbedderForTest()와 동일 DI 컨벤션 (advisor 권고).
//
// 테스트 환경:
//   - loadEnv()가 ANTHROPIC_API_KEY/VOYAGE_API_KEY 비어 있으면 process.exit(1) → beforeAll에서 dummy 주입.
//   - audit/log.ts beginTurn/endTurn은 실 SQLite (data/copilot.db)에 쓴다 — KB_DB_PATH/AUDIT 동일 패턴은
//     audit이 아직 path override를 노출하지 않으므로 tests data/copilot.db 사용 허용 (다른 plan 테스트와 공유).

import { describe, expect, test, beforeAll, beforeEach, afterEach } from "bun:test"
import type Anthropic from "@anthropic-ai/sdk"
import type { SseEvent } from "./sse"
import {
  iterate,
  estimateTokens,
  compactHistory,
  MAX_TOOL_ITERATIONS,
  MAX_API_CALLS_PER_SESSION,
  REMOTE_COMPOSE_PATH,
  _resetForTest,
  _setClientFactoryForTest,
  _setSessionCallsForTest,
  _setKeepAliveIntervalForTest,
  _setProposePatchForTest,
  _setApplyPatchForTest,
} from "./loop"
import { _resetForTest as _resetApprovalStore } from "../approval/store"
import type { ProposePatchArgs, ProposePatchResult } from "../tools/proposePatch"
import type {
  ApplyPatchArgs,
  ApplyPatchResult,
  ApplyPatchOutcome,
} from "../tools/applyPatch"
import type { ApprovalDecision } from "../approval/store"

beforeAll(() => {
  // loadEnv() 통과를 위한 최소 dummy. 실 API 호출 안 함 (mock client 주입).
  if (!Bun.env.ANTHROPIC_API_KEY) Bun.env.ANTHROPIC_API_KEY = "test-key"
  if (!Bun.env.VOYAGE_API_KEY) Bun.env.VOYAGE_API_KEY = "test-key"
  if (!Bun.env.DOCKER_CONTEXT) Bun.env.DOCKER_CONTEXT = "home-server"
})

beforeEach(() => {
  _resetForTest()
  _resetApprovalStore() // Plan 02-07 — pending Map 초기화 (single-pending policy)
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

// === Plan 02-07 — dispatch('proposePatch') interrupt+resume + keep-alive 검증 ===
//
// 검증 대상:
//   1. proposePatch → approved → applied
//   2. proposePatch → approved → rolled-back (docker fail outcome)
//   3. proposePatch → edited → applied (newContent override가 applyPatch에 forward)
//   4. proposePatch → rejected → ToolError envelope
//   5. proposePatch → expired → ToolError envelope
//   6. abort 외부 trigger → expirePending → expired
//   7. keep-alive interval — 30s 미만에는 emit 없음, 가속 후 1+ emit
//   8. LOOP-04 PITFALL #1 — 모든 분기에서 dispatch return value truthy + tool_result push
//
// Bun no fake timers — _setKeepAliveIntervalForTest(50)으로 가속.

function makeToolUseProposePatchMessage(): Anthropic.Message {
  return {
    id: "msg_propose",
    container: null,
    content: [
      { type: "text", text: "재시작을 제안합니다.", citations: null },
      {
        type: "tool_use",
        id: "tu_propose_1",
        name: "proposePatch",
        input: {
          stack: "news",
          command: "compose restart",
          service: "news-prod-app",
          reasoning: "테스트 시나리오",
        },
      },
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
}

// helper — proposePatch mock 결과 빌더 (decision Promise는 caller가 별도 control)
function makeProposeResult(overrides?: Partial<ProposePatchResult>): ProposePatchResult {
  return {
    nonce: "n-test-uuid",
    stack: "news",
    command: "compose restart",
    service: "news-prod-app",
    diff: "(no file change — command only: compose restart news-prod-app)",
    reasoning: "테스트 시나리오",
    expiresAt: Date.now() + 120_000,
    ...overrides,
  }
}

function makeAppliedOutcome(overrides?: Partial<Extract<ApplyPatchOutcome, { type: "applied" }>>): ApplyPatchOutcome {
  return {
    type: "applied",
    sha_after: "abc1234",
    duration_ms: 1234,
    nonce: "n-test-uuid",
    stack: "news",
    command: "compose restart",
    service: "news-prod-app",
    ...overrides,
  }
}

function makeRolledBackOutcome(overrides?: Partial<Extract<ApplyPatchOutcome, { type: "rolled-back" }>>): ApplyPatchOutcome {
  return {
    type: "rolled-back",
    reason: "docker exit 1: container restart failed",
    rollback_command: "compose restart",
    rollback_ok: true,
    nonce: "n-test-uuid",
    stack: "news",
    ...overrides,
  }
}

describe("Plan 02-07 dispatch('proposePatch') — 6 분기 + keep-alive + LOOP-04 invariant", () => {
  afterEach(() => {
    // DI seam 복구
    _setProposePatchForTest(null)
    _setApplyPatchForTest(null)
  })

  // 1) proposePatch → approved → applied
  test("approved → applied: emit 시퀀스 + applyPatch 호출 + tool_result return ok=true", async () => {
    let applyCalledWith: ApplyPatchArgs | null = null

    _setProposePatchForTest(async (_args, _ctx) => {
      const result = makeProposeResult()
      const decision: Promise<ApprovalDecision> = Promise.resolve({ type: "approved" })
      return { result, decision }
    })
    _setApplyPatchForTest(async (args, _ctx) => {
      applyCalledWith = args
      return { outcome: makeAppliedOutcome() } satisfies ApplyPatchResult
    })

    _setClientFactoryForTest(() =>
      makeMockClient([makeToolUseProposePatchMessage(), endTurnMessage("done")]),
    )
    const events: SseEvent[] = []
    await iterate("news 재시작 해줘", { sessionId: "s-approved-applied", emit: (ev) => events.push(ev) })

    const types = events.map((e) => e.type)
    expect(types).toContain("approval-required")
    expect(types).toContain("applied")
    expect(types[types.length - 1]).toBe("final")
    // applyPatch가 정상 호출되었는지 + remoteComposePath가 매핑됐는지
    expect(applyCalledWith).not.toBeNull()
    expect(applyCalledWith!.remoteComposePath).toBe(REMOTE_COMPOSE_PATH["news"])
    // tool-result가 ok=true (LOOP-04 PITFALL #1 — orphan 방지)
    const toolResult = events.find((e) => e.type === "tool-result" && e.name === "proposePatch")
    expect(toolResult).toBeDefined()
    expect(toolResult?.type === "tool-result" && toolResult.ok).toBe(true)
  })

  // 2) proposePatch → approved → rolled-back (docker fail)
  test("approved → rolled-back (docker fail): emit rolled-back + tool_result ok=false", async () => {
    _setProposePatchForTest(async () => ({
      result: makeProposeResult(),
      decision: Promise.resolve({ type: "approved" }),
    }))
    _setApplyPatchForTest(async () => ({
      outcome: makeRolledBackOutcome({
        reason: "docker exit 1: no such service",
        rollback_command: "compose restart",
        rollback_ok: false,
      }),
    }))

    _setClientFactoryForTest(() =>
      makeMockClient([makeToolUseProposePatchMessage(), endTurnMessage("done")]),
    )
    const events: SseEvent[] = []
    await iterate("재시작", { sessionId: "s-approved-rolled-back", emit: (ev) => events.push(ev) })

    const types = events.map((e) => e.type)
    expect(types).toContain("approval-required")
    expect(types).toContain("rolled-back")
    expect(types).not.toContain("applied")
    const rb = events.find((e) => e.type === "rolled-back")
    expect(rb?.type === "rolled-back" && rb.reason).toContain("no such service")
    expect(rb?.type === "rolled-back" && rb.rollback_command).toBe("compose restart")
    expect(rb?.type === "rolled-back" && rb.rollback_ok).toBe(false)
    const toolResult = events.find((e) => e.type === "tool-result" && e.name === "proposePatch")
    expect(toolResult?.type === "tool-result" && toolResult.ok).toBe(false)
  })

  // 3) edited → applied (newContent override)
  test("edited → applied: decision.newContent가 applyPatch에 forward됨", async () => {
    let receivedDecision: ApprovalDecision | null = null

    _setProposePatchForTest(async () => ({
      result: makeProposeResult({
        fileEdit: {
          path: "state/compose/news.yml",
          newContent: "version: '3.8'\nservices:\n  app: {image: orig}\n",
          previousContent: "version: '3.8'\nservices:\n  app: {image: prev}\n",
        },
      }),
      decision: Promise.resolve({
        type: "edited",
        newContent: "version: '3.8'\nservices:\n  app: {image: edited}\n",
      } satisfies ApprovalDecision),
    }))
    _setApplyPatchForTest(async (args) => {
      receivedDecision = args.decision
      return { outcome: makeAppliedOutcome() }
    })

    _setClientFactoryForTest(() =>
      makeMockClient([makeToolUseProposePatchMessage(), endTurnMessage("done")]),
    )
    const events: SseEvent[] = []
    await iterate("edit", { sessionId: "s-edited-applied", emit: (ev) => events.push(ev) })

    expect(receivedDecision).not.toBeNull()
    expect(receivedDecision!.type).toBe("edited")
    expect(
      receivedDecision!.type === "edited" && receivedDecision!.newContent,
    ).toContain("image: edited")
    expect(events.find((e) => e.type === "applied")).toBeDefined()
  })

  // 4) rejected → ToolError envelope (emit applied/rolled-back 없음)
  test("rejected: applyPatch 미호출 + tool-result ok=false + applied/rolled-back emit 없음", async () => {
    let applyCalled = false
    _setProposePatchForTest(async () => ({
      result: makeProposeResult(),
      decision: Promise.resolve({ type: "rejected" }),
    }))
    _setApplyPatchForTest(async () => {
      applyCalled = true
      return { outcome: makeAppliedOutcome() }
    })

    _setClientFactoryForTest(() =>
      makeMockClient([makeToolUseProposePatchMessage(), endTurnMessage("done")]),
    )
    const events: SseEvent[] = []
    await iterate("재시작", { sessionId: "s-rejected", emit: (ev) => events.push(ev) })

    expect(applyCalled).toBe(false)
    const types = events.map((e) => e.type)
    expect(types).toContain("approval-required")
    expect(types).not.toContain("applied")
    expect(types).not.toContain("rolled-back")
    const toolResult = events.find((e) => e.type === "tool-result" && e.name === "proposePatch")
    expect(toolResult?.type === "tool-result" && toolResult.ok).toBe(false)
    expect(toolResult?.type === "tool-result" && toolResult.summary).toContain("rejected")
  })

  // 5) expired → ToolError envelope retryable=true
  test("expired: tool-result ok=false + summary 'approval expired'", async () => {
    _setProposePatchForTest(async () => ({
      result: makeProposeResult(),
      decision: Promise.resolve({ type: "expired" }),
    }))
    _setApplyPatchForTest(async () => ({ outcome: makeAppliedOutcome() }))

    _setClientFactoryForTest(() =>
      makeMockClient([makeToolUseProposePatchMessage(), endTurnMessage("done")]),
    )
    const events: SseEvent[] = []
    await iterate("재시작", { sessionId: "s-expired", emit: (ev) => events.push(ev) })

    const toolResult = events.find((e) => e.type === "tool-result" && e.name === "proposePatch")
    expect(toolResult?.type === "tool-result" && toolResult.ok).toBe(false)
    expect(toolResult?.type === "tool-result" && toolResult.summary).toContain("expired")
  })

  // 6) abort 외부 trigger → expirePending → expired
  test("abort wire: ac.abort() 시 expirePending 호출 → decision Promise resolve(expired)", async () => {
    // proposePatch는 실제 store.setPending을 사용 (real wire 검증).
    // applyPatch는 호출되면 안 됨 (expired 분기).
    let applyCalled = false

    // 동적 import로 실 store 사용
    const { setPending } = await import("../approval/store")

    _setProposePatchForTest(async (_args, ctx) => {
      const result = makeProposeResult({ nonce: "n-abort-test" })
      // 실 store에 setPending — abort handler가 expirePending 호출 시 'expired' resolve.
      const decision = setPending(ctx.sessionId, {
        nonce: result.nonce,
        diff: result.diff,
        stack: "news",
        command: "compose restart",
        service: result.service,
        reasoning: result.reasoning,
        user_prompt: ctx.userPrompt,
        expiresAt: Date.now() + 120_000,
      })
      return { result, decision }
    })
    _setApplyPatchForTest(async () => {
      applyCalled = true
      return { outcome: makeAppliedOutcome() }
    })

    // mock client는 inFlight AbortController에 access 못 하므로 externalSignal로 abort 트리거.
    const externalAc = new AbortController()
    _setClientFactoryForTest(() =>
      makeMockClient([makeToolUseProposePatchMessage(), endTurnMessage("done")]),
    )

    // 50ms 후 abort 발화 — proposePatch가 await decision 중일 때.
    setTimeout(() => externalAc.abort(), 50)

    const events: SseEvent[] = []
    await iterate("abort test", {
      sessionId: "s-abort",
      emit: (ev) => events.push(ev),
      abortSignal: externalAc.signal,
    })

    expect(applyCalled).toBe(false)
    // approval-required는 발신, applied/rolled-back은 발신 안 함.
    expect(events.find((e) => e.type === "approval-required")).toBeDefined()
    expect(events.find((e) => e.type === "applied")).toBeUndefined()
    // tool-result는 expired envelope summary
    const toolResult = events.find((e) => e.type === "tool-result" && e.name === "proposePatch")
    expect(toolResult?.type === "tool-result" && toolResult.ok).toBe(false)
    expect(toolResult?.type === "tool-result" && toolResult.summary).toContain("expired")
  })

  // 7) keep-alive interval — 가속 후 30s 미만에 1+ text-delta(empty) emit
  test("keep-alive interval: 가속 50ms 후 approval 대기 동안 1+ empty text-delta emit", async () => {
    _setKeepAliveIntervalForTest(50) // 50ms 가속

    // decision을 200ms 지연 — keep-alive interval(50ms)이 최소 2회 fire할 시간.
    _setProposePatchForTest(async () => ({
      result: makeProposeResult({ nonce: "n-keepalive" }),
      decision: new Promise<ApprovalDecision>((resolve) =>
        setTimeout(() => resolve({ type: "approved" }), 200),
      ),
    }))
    _setApplyPatchForTest(async () => ({ outcome: makeAppliedOutcome() }))

    _setClientFactoryForTest(() =>
      makeMockClient([makeToolUseProposePatchMessage(), endTurnMessage("done")]),
    )

    const events: SseEvent[] = []
    await iterate("keep-alive test", {
      sessionId: "s-keepalive",
      emit: (ev) => events.push(ev),
    })

    // approval-required emit 후 applied emit 사이에 빈 text-delta가 1+ 있어야 함.
    const approvalIdx = events.findIndex((e) => e.type === "approval-required")
    const appliedIdx = events.findIndex((e) => e.type === "applied")
    expect(approvalIdx).toBeGreaterThanOrEqual(0)
    expect(appliedIdx).toBeGreaterThan(approvalIdx)

    const between = events.slice(approvalIdx + 1, appliedIdx)
    const emptyTextDeltas = between.filter(
      (e) => e.type === "text-delta" && e.delta === "",
    )
    expect(emptyTextDeltas.length).toBeGreaterThanOrEqual(1)
  })

  // 8) LOOP-04 PITFALL #1 — 모든 분기에서 tool_result push (orphan tool_use 방지)
  test("LOOP-04 invariant: 모든 분기 (applied/rolled-back/rejected/aborted/expired)에서 tool-result emit", async () => {
    const decisions: ApprovalDecision[] = [
      { type: "approved" },
      { type: "rejected" },
      { type: "aborted" },
      { type: "expired" },
    ]

    for (const decision of decisions) {
      _resetForTest()
      _resetApprovalStore()
      _setProposePatchForTest(async () => ({
        result: makeProposeResult({ nonce: `n-${decision.type}` }),
        decision: Promise.resolve(decision),
      }))
      _setApplyPatchForTest(async () => ({ outcome: makeAppliedOutcome() }))

      _setClientFactoryForTest(() =>
        makeMockClient([makeToolUseProposePatchMessage(), endTurnMessage("done")]),
      )

      const events: SseEvent[] = []
      await iterate(`branch-${decision.type}`, {
        sessionId: `s-branch-${decision.type}`,
        emit: (ev) => events.push(ev),
      })

      const toolResult = events.find(
        (e) => e.type === "tool-result" && e.name === "proposePatch",
      )
      expect(toolResult, `${decision.type} 분기에서 tool-result emit 누락`).toBeDefined()
      // final emit 도달 — orphan tool_use 없으면 LLM이 정상적으로 end_turn
      expect(events[events.length - 1]?.type).toBe("final")
    }
  })

  // bonus: REMOTE_COMPOSE_PATH 4-stack lock 검증 (open-webui 제외)
  test("REMOTE_COMPOSE_PATH: 4-stack scope lock (news/ais/n8n/krdn-fx, open-webui 제외)", () => {
    expect(Object.keys(REMOTE_COMPOSE_PATH).sort()).toEqual(
      ["ais", "krdn-fx", "n8n", "news"],
    )
    expect(REMOTE_COMPOSE_PATH["news"]).toContain("/news-sentiment-prod/")
    expect(REMOTE_COMPOSE_PATH["ais"]).toContain("/ai-signalcraft/")
    expect(REMOTE_COMPOSE_PATH["n8n"]).toContain("/docker-n8n/")
    expect(REMOTE_COMPOSE_PATH["krdn-fx"]).toContain("/krdn-fx/")
    expect(REMOTE_COMPOSE_PATH["open-webui"]).toBeUndefined()
  })
})
