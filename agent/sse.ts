// agent/sse.ts — UI-02 5 named SSE event(+drift = 6) taxonomy + LOOP-06 60s chunk watchdog.
//
// Public API:
//   SseEvent             — 6 event type union (text-delta / tool-start / tool-result / final / error / drift)
//   SseFrame             — { event, data } shape (Hono streamSSE 인자)
//   toSSEFrame(ev)       — SseEvent → SseFrame 변환 (event 이름 = ev.type)
//   SSE_CHUNK_TIMEOUT_MS — D-15.3 60s lock (60_000)
//   ChunkWatchdog        — { reset, cancel, signal } 인터페이스
//   createChunkWatchdog(onTimeout, timeoutMs?) — 60s no-chunk watchdog 생성
//
// 핵심 결정:
//   UI-02         — 6 named SSE event lock (UI-SPEC.md "SSE 이벤트 → DOM 매핑" 표 매칭).
//   D-13.4 + KB-03 — drift 이벤트는 별도 sse-name (text-delta에 믹스 안 함).
//   LOOP-06       — server.ts가 createChunkWatchdog로 60s no-chunk 시 stream close.
//   D-15.3        — 60s chunk timeout = envelope shape (problem/cause/fix/retryable).
//                   tool 30s timeout(_envelope.ts)과 별도지만 동일 envelope 패턴.

// Phase 1 SSE event taxonomy — UI-02 lock + UI-SPEC.md DOM 매핑.
//
// 6 event types:
//   text-delta   — LLM text chunk (#output에 beforeend swap)
//   tool-start   — tool 호출 시작 (.tool-event 카드 생성)
//   tool-result  — tool 호출 종료 (.tool-event 카드 업데이트)
//   final        — turn 종료 (#status-bar에 "✓ 완료")
//   error        — D-15.4 envelope (#error-banner 빨간 배너)
//   drift        — KB-03 / D-13.4 staleness (#drift-banner amber 배너)
export type SseEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-start"; name: string; args: unknown }
  | { type: "tool-result"; name: string; ok: boolean; summary: string }
  | { type: "final" }
  | { type: "error"; problem: string; cause: string; fix: string; retryable: boolean }
  | { type: "drift"; message: string; unknown: string[]; stale: string[] }

// Hono streamSSE는 { event, data } 객체를 받는다 (event는 SSE name, data는 string payload).
export interface SseFrame {
  event: string
  data: string
}

/**
 * SseEvent → SseFrame 변환.
 *
 * SSE event name = ev.type (UI-SPEC 표 매핑과 일치 — sse-swap 속성에 그대로 사용 가능).
 * data는 이벤트 객체 전체를 JSON.stringify (브라우저에서 JSON.parse 후 detail.type 분기).
 */
export function toSSEFrame(ev: SseEvent): SseFrame {
  return { event: ev.type, data: JSON.stringify(ev) }
}

// LOOP-06 / D-15.3: 60s no-chunk stream timeout — SSE leak 방지.
// 30s tool timeout(tools/_envelope.ts)과 별개. 두 timeout 모두 동일 envelope shape으로 error event emit.
export const SSE_CHUNK_TIMEOUT_MS = 60_000

export interface ChunkWatchdog {
  /** 매 event emit마다 호출 — timer 갱신 (chunk 도착 = 정상). */
  reset(): void
  /** final/error 도달 시 호출 — timer 영구 중단 + signal 미발화. */
  cancel(): void
  /** 60s 미달 시 abort 발화 — loop.ts iterate()가 ac.signal과 OR 연결. */
  signal: AbortSignal
}

/**
 * 60s no-chunk watchdog 생성.
 *
 * 동작:
 *   1. 생성 직후 60s 타이머 arm
 *   2. reset() 호출 시 기존 타이머 clear + 새로 arm
 *   3. cancel() 호출 시 영구 중단 (final/error 후 호출 — onTimeout 미발화)
 *   4. 60s 무응답 시 onTimeout(envelope) 1회 호출 + AbortSignal 발화
 *
 * Caller wires (server.ts Plan 07):
 *   1) 매 emit() 직후 → watchdog.reset()
 *   2) final/error event → watchdog.cancel()
 *   3) loop.ts iterate(opts.abortSignal = watchdog.signal)
 *
 * D-15.3: timeout envelope shape이 _envelope.ts의 30s tool timeout과 동일 패턴.
 *
 * @param onTimeout  60s 도달 시 emit할 envelope-shaped error event
 * @param timeoutMs  default 60_000 (LOOP-06 lock). 테스트는 작은 값 주입 가능.
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
      // D-15.3 envelope shape — server.ts가 toSSEFrame()으로 SSE error event emit.
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
      if (timer) clearTimeout(timer)
      arm()
    },
    cancel(): void {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
    signal: ac.signal,
  }
}
