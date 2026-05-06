// tools/_envelope.ts
// 모든 read tool이 공유할 공통 wrapper. 두 가지 책임:
//   1. ToolError shape (LOOP-02) — { problem, cause, fix, retryable } envelope.
//   2. run() generic wrapper (LOOP-04 + LOOP-06) — catch 경로에서 예외를 절대 전파하지 않고
//      AbortController로 30초 timeout을 강제한다.
//
// PITFALL #1 (orphan tool_use): catch 경로가 예외를 다시 던지면 agent loop가 tool_result를 push하지 못해
// conversation poison이 발생한다. run()은 항상 ToolError를 반환한다.
//
// AUDIT-01/D-14.4: Plan 03의 audit/log.ts logTool() 호출은 Plan 04 read tool wrapping 단계에서 추가.
// _envelope.ts 자체는 audit-agnostic 유지 (test simplicity).

export interface ToolError {
  problem: string // 무엇이 실패했는지 (e.g. "tool listContainers 실패")
  cause: string // 왜 (stack-safe excerpt, max 200 chars)
  fix: string // 사용자 권장 액션 ("재시도" / "SSH 점검" / shell 명령)
  retryable: boolean // agent가 retry 시도할지 결정하는 힌트
}

// 런타임에서 ToolError 여부 판별 (handler가 raw value vs envelope 구분 시 사용).
export function isToolError(x: unknown): x is ToolError {
  return (
    typeof x === "object" &&
    x !== null &&
    "problem" in x &&
    "retryable" in x &&
    typeof (x as ToolError).problem === "string" &&
    typeof (x as ToolError).retryable === "boolean"
  )
}

// 모든 read tool이 거치는 wrapper.
// happy path: fn(signal)의 resolved 값을 그대로 반환.
// error path: 어떤 예외든 ToolError envelope으로 변환 (PITFALL #1 방지).
// timeout path: AbortController가 fn에 abort 신호 전달, AbortError catch 후 envelope.
export async function run<T>(
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 30_000,
): Promise<T | ToolError> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fn(ac.signal)
  } catch (err) {
    // PITFALL #1: 절대 던지지 않는다 — 항상 ToolError 반환.
    if ((err as Error).name === "AbortError") {
      return {
        problem: `tool ${name} timeout ${timeoutMs / 1000}s`,
        cause: "서버 도달·응답 지연",
        fix: "재시도 또는 SSH/docker context 상태 점검",
        retryable: true,
      }
    }
    const rawCause = (err as Error).message ?? String(err)
    return {
      problem: `tool ${name} 실패`,
      cause: rawCause.slice(0, 200),
      fix: "로그 확인 후 재시도",
      retryable: true,
    }
  } finally {
    clearTimeout(timer)
  }
}
