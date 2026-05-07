// agent/loop.ts — Phase 1 brain. HTTP-agnostic Anthropic tool-use loop.
//
// Public API:
//   iterate(prompt, opts)         — 메인 진입점. server.ts /chat이 wire.
//   estimateTokens(messages)      — 4 char per token approx (LOOP-05)
//   compactHistory(messages, t?)  — 50K threshold 시 system + 마지막 6 exchanges 보존 (LOOP-05)
//   MAX_TOOL_ITERATIONS = 8       — LOOP-03 hard cap
//   MAX_API_CALLS_PER_SESSION = 30— LOOP-03 hard cap
//   _resetForTest()               — inFlight + sessionApiCalls 초기화
//   _setClientFactoryForTest(impl)— mock Anthropic client 주입 (테스트 격리)
//   _setSessionCallsForTest(s,n)  — sessionApiCalls 강제 setup (한도 초과 테스트)
//
// 핵심 결정:
//   LOOP-01  iterate() HTTP-agnostic — server.ts에서 emit 콜백으로 wire
//   LOOP-02  tools/_envelope.run() 활용 — D-15.4 envelope shape 통일
//   LOOP-03  MAX_TOOL_ITERATIONS=8 + MAX_API_CALLS_PER_SESSION=30 hard cap
//   LOOP-04  PITFALL #1 prevention — 모든 tool_use 블록은 dispatch try-catch로 감싸 항상
//            tool_result push (orphan tool_use 차단)
//   LOOP-05  estimateTokens > 50K 시 compactHistory(system + 마지막 6 exchanges)
//   LOOP-06  abortSignal opt — server.ts의 createChunkWatchdog().signal 전달 받아 break
//   LOOP-07  inFlight Map<sessionId+queryHash, AbortController> dedup (PITFALL #4)
//   D-09     cli-proxy-api primary (env.ANTHROPIC_BASE_URL)
//   D-10     COPILOT_MODEL_READONLY (claude-sonnet-4-6)
//   D-11     hasFallback(env) → callWithFallback로 console.anthropic.com 재시도
//   D-15.4   tool_result content = JSON.stringify(envelope) (success도 동일 shape)
//
// PITFALL #1 보장: callWithFallback의 두 곳 외 추가 예외 발생 없음 (orphan tool_use 차단).

import Anthropic from "@anthropic-ai/sdk"
import { createHash } from "node:crypto"
import { loadEnv, type Env, hasFallback } from "../src/env"
import {
  TOOL_SCHEMAS,
  type ListContainersArgs,
  type ReadLogsArgs,
  type ReadComposeArgs,
} from "../tools/_index"
import { run, isToolError, type ToolError } from "../tools/_envelope"
import { listContainers } from "../tools/listContainers"
import { readLogs } from "../tools/readLogs"
import { readCompose } from "../tools/readCompose"
import { beginTurn, endTurn } from "../audit/log"
import { SYSTEM_PROMPT } from "./system-prompt"
import type { SseEvent } from "./sse"

// LOOP-03 hard caps (PITFALL #5)
export const MAX_TOOL_ITERATIONS = 8
export const MAX_API_CALLS_PER_SESSION = 30
// LOOP-05 history compaction threshold
const HISTORY_TOKEN_THRESHOLD = 50_000

// LOOP-07 in-memory dedup (PITFALL #4)
const inFlight = new Map<string, AbortController>()
// LOOP-03 session 카운터
const sessionApiCalls = new Map<string, number>()

// === Test DI (advisor 권고 — kb/index.ts _setEmbedderForTest 컨벤션) ===

export type ClientFactory = (env: Env, useFallback: boolean) => Anthropic

let _clientFactory: ClientFactory | null = null

/**
 * 테스트 helper — Anthropic client 생성 함수 swap.
 *
 * Production code 호출 금지. null로 호출하면 default 복원.
 */
export function _setClientFactoryForTest(impl: ClientFactory | null): void {
  _clientFactory = impl
}

/**
 * 테스트 helper — sessionApiCalls 강제 setup (한도 초과 시나리오 검증).
 */
export function _setSessionCallsForTest(sessionId: string, count: number): void {
  sessionApiCalls.set(sessionId, count)
}

/**
 * 테스트 helper — inFlight + sessionApiCalls + clientFactory 초기화.
 */
export function _resetForTest(): void {
  inFlight.clear()
  sessionApiCalls.clear()
  _clientFactory = null
}

// === Anthropic client construction ===

function buildClient(env: Env, useFallback: boolean): Anthropic {
  if (_clientFactory) return _clientFactory(env, useFallback)
  if (useFallback && hasFallback(env)) {
    return new Anthropic({
      apiKey: env.ANTHROPIC_FALLBACK_API_KEY!,
      baseURL: env.ANTHROPIC_FALLBACK_BASE_URL!,
    })
  }
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL,
  })
}

interface CreateArgs {
  env: Env
  messages: Anthropic.MessageParam[]
  systemPrompt: string
}

/**
 * D-11 fallback retry — Spike 6 검증된 패턴.
 *
 * primary 성공 → 결과 반환, fallback 미호출.
 * primary 실패 + fallback 미설정 → primary 에러 재발생 (envelope 변환은 caller).
 * primary 실패 + fallback 설정 → fallback 호출. 둘 다 실패 시 결합 에러 재발생.
 *
 * 본 함수는 PITFALL #1 cap을 정확히 소진한다 — iterate/dispatch 어디서도 추가 예외 발생 금지.
 */
async function callWithFallback(args: CreateArgs): Promise<Anthropic.Message> {
  const primary = buildClient(args.env, false)
  try {
    return await primary.messages.create({
      model: args.env.COPILOT_MODEL_READONLY,
      max_tokens: 4096,
      system: args.systemPrompt,
      messages: args.messages,
      tools: TOOL_SCHEMAS,
    })
  } catch (primaryErr) {
    if (!hasFallback(args.env)) throw primaryErr
    const fallback = buildClient(args.env, true)
    try {
      return await fallback.messages.create({
        model: args.env.COPILOT_MODEL_READONLY,
        max_tokens: 4096,
        system: args.systemPrompt,
        messages: args.messages,
        tools: TOOL_SCHEMAS,
      })
    } catch (fallbackErr) {
      throw new Error(
        `primary 실패 + fallback 실패. primary: ${(primaryErr as Error).message} / fallback: ${(fallbackErr as Error).message}`,
      )
    }
  }
}

// === LOOP-05 history compaction ===

/**
 * 4 char per token approximation (LOOP-05 — Claude's Discretion).
 *
 * Anthropic tokenizer 정확도 대신 cheap 근사치. 50K threshold 결정에 충분.
 */
export function estimateTokens(messages: Anthropic.MessageParam[]): number {
  if (messages.length === 0) return 0
  const text = messages
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join(" ")
  // 4 char per token, 빈 문자열 → 0
  return Math.floor(text.length / 4)
}

/**
 * threshold 초과 시 첫 message(보통 user system context) + 마지막 6 messages만 유지.
 *
 * 7 이하 messages면 token 초과해도 그대로 (정보 손실 막음).
 *
 * F-1 fix (Phase 2 D-E1 carry-back, plan 01-10): 항상 새 array를 반환한다.
 * caller가 `messages.length=0; messages.push(...compacted)` 패턴으로 in-place reset할 때,
 * 이전 구현은 early-return 분기에서 입력과 동일 ref를 반환하여 array aliasing으로 인해
 * messages가 빈 배열이 되었다 (다음 callWithFallback에서 400 invalid_request_error).
 */
export function compactHistory(
  messages: Anthropic.MessageParam[],
  threshold = HISTORY_TOKEN_THRESHOLD,
): Anthropic.MessageParam[] {
  if (estimateTokens(messages) < threshold) return [...messages]
  if (messages.length <= 7) return [...messages]
  return [messages[0]!, ...messages.slice(-6)]
}

// === Tool dispatch (PITFALL #1: catch는 항상 envelope 반환, 예외 전파 금지) ===

/**
 * tool 이름 → 실 tool 함수 라우팅.
 *
 * 모든 tool은 _envelope.run()으로 래핑되어 audit log + 30s timeout + ToolError envelope을 자동 적용.
 * unknown tool name도 ToolError envelope 반환 (LOOP-04 orphan 방지 + retryable=false).
 *
 * @param name        Anthropic tool_use block의 name
 * @param input       Anthropic tool_use block의 input (validated by Zod when actually used)
 * @param turnId      audit/log.ts beginTurn() 결과 — _envelope.run의 auditParentId
 * @returns           tool 결과 또는 ToolError envelope (예외 전파 안 함 — 항상 값 반환)
 */
async function dispatch(name: string, input: unknown, turnId: bigint): Promise<unknown> {
  switch (name) {
    case "listContainers":
      return await run(
        "listContainers",
        async (_s) => listContainers(input as ListContainersArgs),
        30_000,
        turnId,
        input,
      )
    case "readLogs":
      return await run(
        "readLogs",
        async (_s) => readLogs(input as ReadLogsArgs),
        30_000,
        turnId,
        input,
      )
    case "readCompose":
      return await run(
        "readCompose",
        async (_s) => readCompose(input as ReadComposeArgs),
        30_000,
        turnId,
        input,
      )
    default:
      // unknown tool name — LLM이 hallucinate한 도구. retryable=false (재시도 무의미).
      return {
        problem: `unknown tool: ${name}`,
        cause: "TOOL_SCHEMAS 외 호출",
        fix: "tools/_index.ts 등록 확인",
        retryable: false,
      } satisfies ToolError
  }
}

function summarizeResult(name: string, result: unknown): string {
  if (isToolError(result)) {
    return `${result.problem}: ${result.cause}`.slice(0, 200)
  }
  if (Array.isArray(result)) return `${name} — ${result.length} items`
  if (typeof result === "string") return `${name} — ${result.length} chars`
  return `${name} — done`
}

// === Public iterate() ===

export interface IterateOpts {
  /** 세션 식별자 — LOOP-07 inFlight key 일부 + LOOP-03 sessionApiCalls 누적 키 */
  sessionId: string
  /** RAG retrieval 결과 (formatRagContext 출력) — user message에 prepend됨 */
  ragContext?: string
  /** SSE event emit 콜백 — server.ts가 toSSEFrame()으로 wrap */
  emit: (ev: SseEvent) => void
  /**
   * LOOP-06 / D-15.3: server.ts가 createChunkWatchdog(60s)의 signal을 전달.
   * 60s no-chunk 시 server가 abort → iterate가 break (추가 messages.create 호출 안 함).
   * undefined면 iterate 자체 hard caps만 사용.
   */
  abortSignal?: AbortSignal
}

/**
 * Phase 1 메인 tool-use loop.
 *
 * 흐름:
 *   1. inFlight dedup 체크 (LOOP-07) — 같은 sessionId+queryHash 진행 중이면 즉시 return
 *   2. beginTurn(prompt, model) → audit row id
 *   3. while loop:
 *      - hard cap 체크 (LOOP-03)
 *      - abortSignal 체크 (LOOP-06)
 *      - callWithFallback (D-09 + D-11)
 *      - response.content 순회: text → text-delta emit, tool_use → dispatch + tool-result emit
 *      - assistant + tool_result block messages.push
 *      - compactHistory (LOOP-05)
 *      - stop_reason==="end_turn" || tool_use 없음 → break
 *   4. emit final
 *   5. finally: inFlight.delete + endTurn(...)
 *
 * @param prompt  사용자 질의 (한국어 예상)
 * @param opts    IterateOpts
 */
export async function iterate(prompt: string, opts: IterateOpts): Promise<void> {
  const env = loadEnv()
  const { sessionId, ragContext = "", emit, abortSignal: externalSignal } = opts
  const queryHash = createHash("sha256").update(`${sessionId}:${prompt}`).digest("hex").slice(0, 16)
  const inFlightKey = `${sessionId}:${queryHash}`

  // LOOP-07: SSE 재연결 dedup
  if (inFlight.has(inFlightKey)) {
    emit({ type: "text-delta", delta: "(재연결 감지 — 기존 응답 유지)" })
    return
  }

  const ac = new AbortController()
  inFlight.set(inFlightKey, ac)
  // LOOP-06: external watchdog signal과 internal AbortController 연결
  if (externalSignal) {
    if (externalSignal.aborted) ac.abort()
    else externalSignal.addEventListener("abort", () => ac.abort(), { once: true })
  }

  const turnId = beginTurn(prompt, env.COPILOT_MODEL_READONLY)
  const startedAt = Date.now()
  let toolIterations = 0
  let totalToolCalls = 0
  let totalOutputTokens = 0
  let totalCacheReadTokens = 0
  let errorEnvelope: unknown = undefined

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: ragContext + prompt },
  ]

  try {
    while (true) {
      // LOOP-06: external chunk-timeout watchdog 발화 시 즉시 break.
      // server.ts가 이미 D-15.3 envelope을 emit한 상태 — 중복 emit 회피.
      if (ac.signal.aborted) break

      // LOOP-03 hard caps
      const sessionCalls = (sessionApiCalls.get(sessionId) ?? 0) + 1
      sessionApiCalls.set(sessionId, sessionCalls)
      if (sessionCalls > MAX_API_CALLS_PER_SESSION) {
        errorEnvelope = {
          problem: "세션 API 호출 한도 초과 (30회)",
          cause: `sessionId=${sessionId}`,
          fix: "새 세션을 시작하세요",
          retryable: false,
        }
        emit({
          type: "error",
          ...(errorEnvelope as {
            problem: string
            cause: string
            fix: string
            retryable: boolean
          }),
        })
        break
      }
      if (toolIterations > MAX_TOOL_ITERATIONS) {
        errorEnvelope = {
          problem: "도구 호출 한도 초과 (8회)",
          cause: "단일 turn에서 tool iteration > 8",
          fix: "부분 결과를 반환하고 새 질의로 분할하세요",
          retryable: false,
        }
        emit({
          type: "error",
          ...(errorEnvelope as {
            problem: string
            cause: string
            fix: string
            retryable: boolean
          }),
        })
        break
      }

      const response = await callWithFallback({
        env,
        messages,
        systemPrompt: SYSTEM_PROMPT,
      })
      totalOutputTokens += response.usage?.output_tokens ?? 0
      totalCacheReadTokens += response.usage?.cache_read_input_tokens ?? 0

      let assistantHasToolUse = false
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type === "text") {
          emit({ type: "text-delta", delta: block.text })
        } else if (block.type === "tool_use") {
          assistantHasToolUse = true
          totalToolCalls++
          toolIterations++
          emit({ type: "tool-start", name: block.name, args: block.input })
          // PITFALL #1: dispatch는 예외 전파 안 함 — 항상 envelope/값 반환 보장.
          const toolReturn = await dispatch(block.name, block.input, turnId)
          const ok = !isToolError(toolReturn)
          emit({
            type: "tool-result",
            name: block.name,
            ok,
            summary: summarizeResult(block.name, toolReturn),
          })
          // D-15.4: tool_result content = JSON.stringify(envelope) — success/error 동일 shape.
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(toolReturn),
          })
        }
      }

      // assistant + tool_result messages 추가
      messages.push({ role: "assistant", content: response.content })
      if (toolResultBlocks.length > 0) {
        messages.push({ role: "user", content: toolResultBlocks })
      }

      // LOOP-05 history compaction (in-place 갱신)
      // F-1 (plan 01-10): compactHistory가 항상 새 array를 반환하도록 변경되어 aliasing 안전.
      // defense-in-depth: 빈 배열로 reset되는 경우(향후 회귀) 즉시 throw하여 silent 400 회피.
      const compacted = compactHistory(messages)
      messages.length = 0
      messages.push(...compacted)
      if (messages.length === 0) {
        throw new Error("internal: messages reset to empty after compactHistory (F-1 회귀 의심)")
      }

      if (response.stop_reason === "end_turn" || !assistantHasToolUse) break
    }

    emit({ type: "final" })
  } catch (err) {
    // callWithFallback의 두 throw가 여기로 떨어진다 (DI에 의한 mock client 에러도 포함).
    const ee = {
      problem: "loop 실행 실패",
      cause: ((err as Error).message ?? String(err)).slice(0, 200),
      fix: "재시도 또는 서버 로그 확인",
      retryable: true,
    }
    errorEnvelope = ee
    emit({ type: "error", ...ee })
  } finally {
    inFlight.delete(inFlightKey)
    endTurn(
      turnId,
      totalOutputTokens,
      totalCacheReadTokens,
      totalToolCalls,
      Date.now() - startedAt,
      errorEnvelope,
    )
  }
}
