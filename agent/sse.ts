// agent/sse.ts — UI-02 SSE event taxonomy + LOOP-06 60s chunk watchdog.
//
// **STUB STATUS (Plan 01-07 / Wave 3):** 이 파일은 Plan 01-06 (병렬 진행 중)이
// 본격 구현한다. Plan 01-07 server.ts가 import를 필요로 하므로 시그니처 + 동작이
// 모두 LOCK된 형태로 미리 작성한다.
//
// 머지 순서:
//   1) 01-07 (이 파일)이 main으로 머지됨 → server.ts가 빌드/테스트 통과
//   2) 01-06이 main으로 머지될 때 이 파일이 01-06 버전으로 대체됨
//      (시그니처 동일하므로 server.ts 수정 불요)
//
// 시그니처 lock 근거: .planning/phases/01-read-only-knowledge-layer/01-06-PLAN.md Task 2
// (UI-02 lock + UI-SPEC.md DOM 매핑 + D-15.3 envelope shape)

// Phase 1 SSE event taxonomy — 6 event types (UI-02)
export type SseEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-start"; name: string; args: unknown }
  | { type: "tool-result"; name: string; ok: boolean; summary: string }
  | { type: "final" }
  | { type: "error"; problem: string; cause: string; fix: string; retryable: boolean }
  | { type: "drift"; message: string; unknown: string[]; stale: string[] } // KB-03 / D-13.4

export interface SseFrame {
  event: string
  data: string
}

export function toSSEFrame(ev: SseEvent): SseFrame {
  // Hono streamSSE는 { event, data } 객체를 받음 (data: string).
  return { event: ev.type, data: JSON.stringify(ev) }
}

// LOOP-06 / D-15.3: 60s no-chunk SSE stream timeout — leak 방지.
// 30s tool timeout(_envelope.ts)과 별개. 두 timeout 모두 동일 envelope shape으로 emit.
export const SSE_CHUNK_TIMEOUT_MS = 60_000

export interface ChunkWatchdog {
  reset(): void          // 매 event emit마다 — timer 갱신
  cancel(): void         // final/error 도달 시 — timer 영구 중단
  signal: AbortSignal    // loop.ts iterate()가 받아서 abort 시 break
}

/**
 * 60s no-chunk watchdog 생성. 60s간 reset()이 호출되지 않으면 발화:
 *   1) D-15.3 envelope shape의 error event를 onTimeout 콜백으로 전달
 *   2) AbortSignal을 abort → iterate가 추가 messages.create 호출 안 함
 *
 * Caller wire (server.ts /chat-stream):
 *   - emit() 호출마다 → watchdog.reset()
 *   - final/error event 처리 시 → watchdog.cancel()
 *   - loop iterate({ abortSignal: watchdog.signal })로 전달
 *   - finally에서 watchdog.cancel() (timer 누수 방지)
 */
export function createChunkWatchdog(
  onTimeout: (ev: Extract<SseEvent, { type: "error" }>) => void,
  timeoutMs: number = SSE_CHUNK_TIMEOUT_MS,
): ChunkWatchdog {
  const ac = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

  const arm = (): void => {
    if (cancelled) return
    timer = setTimeout(() => {
      if (cancelled) return
      // D-15.3 envelope: SSE chunk timeout 60s = 동일 shape error event.
      onTimeout({
        type: "error",
        problem: "stream chunk timeout 60s",
        cause: "응답 스트림 중단 — 모델/네트워크 지연",
        fix: "재시도 또는 cli-proxy-api(192.168.0.5:8317) 상태 점검",
        retryable: true,
      })
      ac.abort()
    }, timeoutMs)
  }

  arm()

  return {
    reset(): void {
      if (cancelled) return
      if (timer !== null) clearTimeout(timer)
      arm()
    },
    cancel(): void {
      cancelled = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
    signal: ac.signal,
  }
}
