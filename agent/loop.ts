// agent/loop.ts — iterate() tool-use loop (Anthropic SDK + cli-proxy-api + fallback).
//
// **STUB STATUS (Plan 01-07 / Wave 3):** 본격 구현은 Plan 01-06 (병렬 진행).
// 시그니처만 lock — server.ts /chat-stream이 import + 호출만 검증.
//
// 머지 순서:
//   1) 01-07이 main으로 머지 → server.ts compile + route 테스트 통과
//   2) 01-06이 main으로 머지 → 이 파일이 7 LOOP 요구사항 충족 버전으로 대체
//
// 시그니처 lock 근거: .planning/phases/01-read-only-knowledge-layer/01-06-PLAN.md Task 3
//   export async function iterate(prompt, opts): Promise<void>
//   IterateOpts: { sessionId, ragContext?, emit, abortSignal? }

import type { SseEvent } from "./sse"

// LOOP-03 hard cap 시그니처 lock (01-06이 실제 enforce)
export const MAX_TOOL_ITERATIONS = 8
export const MAX_API_CALLS_PER_SESSION = 30

export interface IterateOpts {
  sessionId: string
  ragContext?: string
  emit: (ev: SseEvent) => void
  /** LOOP-06: server.ts createChunkWatchdog(60s).signal 주입. abort 시 추가 messages.create 안 함. */
  abortSignal?: AbortSignal
}

/**
 * Phase 1 brain — Claude tool-use loop.
 *
 * **STUB:** 현재는 단순 통지만. Plan 01-06 머지 시 실제 loop:
 *   - beginTurn → callWithFallback → tool-use dispatch → endTurn
 *   - LOOP-03 hard caps + LOOP-04 orphan tool_result 보장 + LOOP-05 history compaction
 *   - LOOP-06 abortSignal 존중 + LOOP-07 inFlight Map dedup
 *
 * 현 stub은 server.ts compile + route 테스트만 통과시키며,
 * 호출 시 명시적 stub 메시지를 emit해 "01-06 미머지 상태"를 운영자가 즉시 인지하게 한다.
 */
export async function iterate(prompt: string, opts: IterateOpts): Promise<void> {
  const { emit } = opts
  emit({
    type: "error",
    problem: "agent/loop.ts STUB — 01-06 미머지 상태",
    cause: `prompt 처리 불가 (length=${prompt.length}, sessionId=${opts.sessionId})`,
    fix: "Plan 01-06 (agent loop) main 머지 후 재시도",
    retryable: false,
  })
  emit({ type: "final" })
}
