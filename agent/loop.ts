// agent/loop.ts — Phase 1+2 brain. HTTP-agnostic Anthropic tool-use loop + Plan 02-07 proposePatch dispatch.
//
// Public API:
//   iterate(prompt, opts)         — 메인 진입점. server.ts /chat이 wire.
//   estimateTokens(messages)      — 4 char per token approx (LOOP-05)
//   compactHistory(messages, t?)  — 50K threshold 시 system + 마지막 6 exchanges 보존 (LOOP-05)
//   MAX_TOOL_ITERATIONS = 8       — LOOP-03 hard cap
//   MAX_API_CALLS_PER_SESSION = 30— LOOP-03 hard cap
//   REMOTE_COMPOSE_PATH           — 4-stack 매핑 (02-04 SUMMARY lock된 정확 경로)
//   _resetForTest()               — inFlight + sessionApiCalls + keepAlive 복구
//   _setClientFactoryForTest(impl)— mock Anthropic client 주입 (테스트 격리)
//   _setSessionCallsForTest(s,n)  — sessionApiCalls 강제 setup (한도 초과 테스트)
//   _setKeepAliveIntervalForTest(ms)— Plan 02-07 keep-alive 가속 (Bun no fake timers)
//   _setProposePatchForTest(fn)   — proposePatch tool mock 주입
//   _setApplyPatchForTest(fn)     — applyPatch tool mock 주입
//
// 핵심 결정:
//   LOOP-01  iterate() HTTP-agnostic — server.ts에서 emit 콜백으로 wire
//   LOOP-02  tools/_envelope.run() 활용 — D-15.4 envelope shape 통일
//   LOOP-03  MAX_TOOL_ITERATIONS=8 + MAX_API_CALLS_PER_SESSION=30 hard cap
//   LOOP-04  PITFALL #1 prevention — 모든 tool_use 블록은 dispatch try-catch로 감싸 항상
//            tool_result push (orphan tool_use 차단)
//   LOOP-05  estimateTokens > 50K 시 compactHistory(system + 마지막 6 exchanges)
//   LOOP-06  abortSignal opt — server.ts의 createChunkWatchdog().signal 전달 받아 break.
//            Plan 02-07: approval 대기 동안 30s keep-alive 'text-delta delta=""' emit으로
//            60s chunk watchdog reset 유도 (advisor lock).
//   LOOP-07  inFlight Map<sessionId+queryHash, AbortController> dedup (PITFALL #4)
//   D-09     cli-proxy-api primary (env.ANTHROPIC_BASE_URL)
//   D-10     COPILOT_MODEL_READONLY (claude-sonnet-4-6)
//   D-11     hasFallback(env) → callWithFallback로 console.anthropic.com 재시도
//   D-15.4   tool_result content = JSON.stringify(envelope) (success도 동일 shape)
//
//   Plan 02-07 추가:
//   APPLY-02 dispatch('proposePatch') — interrupt+resume + decision Promise await 후 즉시 applyPatch
//            internal call → 단일 tool_result로 LLM에 push (Open Q 2 lock — 새 dispatch round 안 만듦)
//   UI-02+3  approval-required / applied / rolled-back 3 SSE event emit
//   AbortCtl ac.signal abort 시 expirePending(sessionId) 호출 (LOOP-04 PITFALL #1 보호 carry-forward)
//   UserPrompt raw `prompt`만 forward (ragContext 제외 — D-D1 git commit body source는 운영자 의도만 담아야 함)
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
import {
  proposePatch as defaultProposePatch,
  type ProposePatchArgs,
  type ProposePatchResult,
} from "../tools/proposePatch"
import {
  applyPatch as defaultApplyPatch,
  type ApplyPatchArgs,
  type ApplyPatchResult,
} from "../tools/applyPatch"
import { expirePending, type ApprovalDecision } from "../approval/store"
import { beginTurn, endTurn } from "../audit/log"
import { SYSTEM_PROMPT } from "./system-prompt"
import type { SseEvent } from "./sse"

// LOOP-03 hard caps (PITFALL #5)
export const MAX_TOOL_ITERATIONS = 8
export const MAX_API_CALLS_PER_SESSION = 30
// LOOP-05 history compaction threshold
const HISTORY_TOKEN_THRESHOLD = 50_000

// Plan 02-07 keep-alive interval — 60s SSE chunk watchdog 충돌 회피용 (advisor lock).
// approval 대기 2분 동안 30s마다 'text-delta delta=""' emit으로 watchdog reset.
// const 대신 let — 테스트는 _setKeepAliveIntervalForTest로 가속 (Bun no fake timers).
const DEFAULT_KEEP_ALIVE_INTERVAL_MS = 30_000
let _keepAliveIntervalMs = DEFAULT_KEEP_ALIVE_INTERVAL_MS

// Plan 02-07 — 4-stack remoteComposePath 매핑 (02-04 SUMMARY lock된 정확 경로).
// Option A 4-stack scope (2026-05-07 hotfix): open-webui 제외 (192.168.0.5에서
// plain docker run, no compose, v2 backlog). 02-04 executor가 `docker inspect
// com.docker.compose.project.config_files` label + ssh `test -f`로 검증 완료.
export const REMOTE_COMPOSE_PATH: Record<string, string> = {
  "news":    "/home/gon/deploy/news-sentiment-prod/docker-compose.yml",
  "ais":     "/home/gon/actions-runner/_work/ai-signalcraft/ai-signalcraft/docker/docker-compose.prod.yml",
  "n8n":     "/home/gon/docker-n8n/docker-compose.yml",
  "krdn-fx": "/home/gon/projects/krdn-fx/docker-compose.yml",
}

// LOOP-07 in-memory dedup (PITFALL #4)
const inFlight = new Map<string, AbortController>()
// LOOP-03 session 카운터
const sessionApiCalls = new Map<string, number>()

// === Test DI (advisor 권고 — kb/index.ts _setEmbedderForTest 컨벤션) ===

export type ClientFactory = (env: Env, useFallback: boolean) => Anthropic

let _clientFactory: ClientFactory | null = null

// Plan 02-07 — proposePatch / applyPatch DI seam (테스트 mock 주입용).
// production은 default* 모듈 함수 그대로 사용. _resetForTest()에서 default 복구.
type ProposePatchFn = (
  args: ProposePatchArgs,
  ctx: { sessionId: string; userPrompt: string },
) => Promise<{ result: ProposePatchResult; decision: Promise<ApprovalDecision> }>
type ApplyPatchFn = (
  args: ApplyPatchArgs,
  ctx: { signal?: AbortSignal },
) => Promise<ApplyPatchResult>

let _proposePatchImpl: ProposePatchFn = defaultProposePatch
let _applyPatchImpl: ApplyPatchFn = defaultApplyPatch

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
 * 테스트 helper — keep-alive interval 가속 (Bun no fake timers).
 *
 * 50ms 등 작은 값으로 줄여 100-150ms 후 emit 1+ 검증 가능.
 * _resetForTest()에서 30_000ms로 복구.
 */
export function _setKeepAliveIntervalForTest(ms: number): void {
  _keepAliveIntervalMs = ms
}

/**
 * 테스트 helper — proposePatch tool mock 주입.
 * Plan 02-07 dispatch('proposePatch') 분기 검증용.
 */
export function _setProposePatchForTest(impl: ProposePatchFn | null): void {
  _proposePatchImpl = impl ?? defaultProposePatch
}

/**
 * 테스트 helper — applyPatch tool mock 주입.
 * Plan 02-07 dispatch('proposePatch') 분기 검증용.
 */
export function _setApplyPatchForTest(impl: ApplyPatchFn | null): void {
  _applyPatchImpl = impl ?? defaultApplyPatch
}

/**
 * 테스트 helper — inFlight + sessionApiCalls + clientFactory + Plan 02-07 DI 복구.
 */
export function _resetForTest(): void {
  inFlight.clear()
  sessionApiCalls.clear()
  _clientFactory = null
  _keepAliveIntervalMs = DEFAULT_KEEP_ALIVE_INTERVAL_MS
  _proposePatchImpl = defaultProposePatch
  _applyPatchImpl = defaultApplyPatch
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
 * Plan 02-07: dispatch 시그니처 확장 — proposePatch case는 sessionId + userPrompt + emit + ac 필요.
 * 기존 3 read tool case는 sessionId/userPrompt/emit/ac 무시하고 정상 동작 (carry-forward).
 *
 * @param name        Anthropic tool_use block의 name
 * @param input       Anthropic tool_use block의 input (validated by Zod when actually used)
 * @param turnId      audit/log.ts beginTurn() 결과 — _envelope.run의 auditParentId
 * @param sessionId   Plan 02-07 — approval store key
 * @param userPrompt  Plan 02-07 — D-D1 git commit body source (raw prompt only, no ragContext)
 * @param emit        Plan 02-07 — SSE event emit 콜백 (approval-required / applied / rolled-back / keep-alive)
 * @param ac          Plan 02-07 — AbortController (chunk timeout 등으로 abort 발화 시 expirePending)
 * @returns           tool 결과 또는 ToolError envelope (예외 전파 안 함 — 항상 값 반환)
 */
async function dispatch(
  name: string,
  input: unknown,
  turnId: bigint,
  sessionId: string,
  userPrompt: string,
  emit: (ev: SseEvent) => void,
  ac: AbortController,
): Promise<unknown> {
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
    case "proposePatch":
      return await dispatchProposePatch(
        input as ProposePatchArgs,
        turnId,
        sessionId,
        userPrompt,
        emit,
        ac,
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

/**
 * Plan 02-07 — proposePatch dispatch 분기 (interrupt + resume + applyPatch internal call).
 *
 * 흐름:
 *   1. _envelope.run(30s)으로 proposePatch 호출 → { result, decision Promise }
 *   2. emit "approval-required" SSE event (UI-02 +3)
 *   3. setInterval(_keepAliveIntervalMs) 30s keep-alive — 'text-delta delta=""' emit으로
 *      60s SSE chunk watchdog reset 유도 (advisor lock — approval 대기 2분 동안 wire 끊김 방지)
 *   4. ac.signal abort handler 등록 — chunk timeout 등으로 abort 시 expirePending(sessionId)
 *      → decision Promise가 'expired' resolve (LOOP-04 PITFALL #1 보호 carry-forward)
 *   5. await decision → 5-key 분기:
 *      - approved | edited → applyPatch(60s timeout) internal call → emit applied/rolled-back +
 *                            tool_result content으로 outcome JSON.stringify push (Open Q 2 lock)
 *      - rejected           → ToolError envelope (cause: 사용자 'n')
 *      - aborted            → ToolError envelope (cause: 사용자 'a')
 *      - expired            → ToolError envelope (cause: 운영자 미응답 또는 chunk timeout)
 *   6. finally — keep-alive interval clear + abort handler remove
 *
 * @returns success outcome 또는 ToolError envelope. 모든 분기에서 truthy return (LOOP-04 invariant).
 */
async function dispatchProposePatch(
  input: ProposePatchArgs,
  turnId: bigint,
  sessionId: string,
  userPrompt: string,
  emit: (ev: SseEvent) => void,
  ac: AbortController,
): Promise<unknown> {
  // Step 1 — proposePatch 호출 (30s timeout으로 wrap).
  // 주의: run()의 반환값은 proposePatch가 동기 반환한 { result, decision Promise } 객체 그 자체.
  //       decision Promise는 run()의 30s timeout 영향 받지 않음 (이미 resolved 객체 안에 들어있는 Promise).
  const wrapped = await run(
    "proposePatch",
    async (_s) => _proposePatchImpl(input, { sessionId, userPrompt }),
    30_000,
    turnId,
    input,
  )
  if (isToolError(wrapped)) return wrapped // setPending throw / Zod 검증 실패 등

  const { result, decision } = wrapped as {
    result: ProposePatchResult
    decision: Promise<ApprovalDecision>
  }

  // Step 2 — emit approval-required SSE event.
  emit({
    type: "approval-required",
    nonce: result.nonce,
    stack: result.stack,
    command: result.command,
    service: result.service,
    diff: result.diff,
    reasoning: result.reasoning,
    expiresAt: result.expiresAt,
  })

  // Step 3 — keep-alive interval (advisor lock — 60s chunk watchdog reset).
  const keepAliveInterval = setInterval(() => {
    emit({ type: "text-delta", delta: "" })
  }, _keepAliveIntervalMs)

  // Step 4 — abort wire (chunk timeout 등으로 ac.abort() 시 decision Promise resolve(expired)).
  const abortHandler = (): void => {
    expirePending(sessionId)
  }
  ac.signal.addEventListener("abort", abortHandler, { once: true })

  // Step 5 — await decision.
  let resolved: ApprovalDecision
  try {
    resolved = await decision
  } finally {
    clearInterval(keepAliveInterval)
    ac.signal.removeEventListener("abort", abortHandler)
  }

  // Step 6 — 5-key 분기.
  if (resolved.type === "approved" || resolved.type === "edited") {
    // applyPatch internal call (60s timeout — compose up -d 시 image pull 가능성, 재시도 가능).
    const remoteComposePath = REMOTE_COMPOSE_PATH[result.stack]
    if (!remoteComposePath) {
      // 4-stack scope 외 (open-webui 등) — 정상 흐름에서 ProposePatchInput Zod가 차단해야 함.
      const reason = `unsupported stack '${result.stack}' (4-stack scope: ${Object.keys(
        REMOTE_COMPOSE_PATH,
      ).join("/")})`
      emit({
        type: "rolled-back",
        nonce: result.nonce,
        stack: result.stack,
        reason,
      })
      return {
        problem: `applyPatch unsupported stack: ${result.stack}`,
        cause: reason,
        fix: "tools/proposePatch.ts ProposePatchInput stack enum 확인",
        retryable: false,
      } satisfies ToolError
    }

    const applyArgs: ApplyPatchArgs = {
      proposal: result,
      decision: resolved,
      userPrompt,
      remoteComposePath,
    }

    const applyResult = await run(
      "applyPatch",
      async (signal) => _applyPatchImpl(applyArgs, { signal }),
      60_000,
      turnId,
      { proposal: result, decision: resolved, remoteComposePath },
    )
    if (isToolError(applyResult)) {
      // _envelope.run에서 throw 잡힘 (e.g. mirror staleness drift, 503 marker exists).
      emit({
        type: "rolled-back",
        nonce: result.nonce,
        stack: result.stack,
        reason: applyResult.problem,
      })
      return applyResult
    }

    const outcome = (applyResult as ApplyPatchResult).outcome
    if (outcome.type === "applied") {
      emit({
        type: "applied",
        nonce: outcome.nonce,
        stack: outcome.stack,
        command: outcome.command,
        service: outcome.service,
        sha_after: outcome.sha_after,
        duration_ms: outcome.duration_ms,
      })
      return {
        ok: true,
        type: "applied",
        nonce: outcome.nonce,
        stack: outcome.stack,
        command: outcome.command,
        service: outcome.service,
        sha_after: outcome.sha_after,
        duration_ms: outcome.duration_ms,
      }
    }
    // outcome.type === "rolled-back"
    emit({
      type: "rolled-back",
      nonce: outcome.nonce,
      stack: outcome.stack,
      reason: outcome.reason,
      rollback_command: outcome.rollback_command,
      rollback_ok: outcome.rollback_ok,
    })
    return {
      problem: `applyPatch rolled-back: ${outcome.reason}`.slice(0, 200),
      cause: outcome.rollback_command
        ? `역 docker '${outcome.rollback_command}' ok=${outcome.rollback_ok ?? false}`
        : "docker 또는 git 명령 실패",
      fix: "수동 점검 후 재시도 (rollback_command 결과 확인)",
      retryable: false,
    } satisfies ToolError
  }

  // rejected / aborted / expired — applyPatch 호출 안 함, ToolError envelope 반환.
  // emit 추가 없음 (approval-required는 이미 발신됨, UI는 X 닫기 또는 expired indicator로 처리).
  if (resolved.type === "rejected") {
    return {
      problem: "approval rejected",
      cause: "사용자가 'n' 키로 거부",
      fix: "다른 접근(read tool로 상태 재확인 등)을 시도",
      retryable: false,
    } satisfies ToolError
  }
  if (resolved.type === "aborted") {
    return {
      problem: "approval aborted",
      cause: "사용자가 'a' 키로 중단",
      fix: "문맥 재구성 후 다시 제안",
      retryable: false,
    } satisfies ToolError
  }
  // resolved.type === "expired"
  return {
    problem: "approval expired (2 min)",
    cause: "운영자 미응답 또는 stream chunk timeout으로 외부 abort",
    fix: "다시 proposePatch 호출 (필요 시)",
    retryable: true,
  } satisfies ToolError
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
          // Plan 02-07: dispatch 시그니처 확장 — sessionId/userPrompt/emit/ac 추가.
          //   userPrompt는 raw `prompt`만 (ragContext 제외 — D-D1 git commit body source는
          //   운영자 의도만 담아야 함, advisor lock).
          const toolReturn = await dispatch(
            block.name,
            block.input,
            turnId,
            sessionId,
            prompt,
            emit,
            ac,
          )
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
