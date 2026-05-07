// tools/_envelope.ts
// 모든 read tool이 공유할 공통 wrapper. 세 가지 책임:
//   1. ToolError shape (LOOP-02) — { problem, cause, fix, retryable } envelope.
//   2. run() generic wrapper (LOOP-04 + LOOP-06) — catch 경로에서 예외를 절대 전파하지 않고
//      AbortController로 30초 timeout을 강제한다.
//   3. AUDIT-01 / D-14.4 — auditParentId가 전달되면 finally 블록에서 logTool() 호출.
//      audit 자체 실패는 swallow (tool 실행 결과에 영향 없음 — PITFALL #1 보호 유지).
//
// PITFALL #1 (orphan tool_use): catch 경로가 예외를 다시 던지면 agent loop가 tool_result를 push하지 못해
// conversation poison이 발생한다. run()은 항상 ToolError를 반환한다. logTool 실패도 마찬가지로 swallow.

import { logTool } from "../audit/log"

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
//
// auditParentId가 전달되면 finally에서 logTool() 호출 (AUDIT-01 + D-14.4).
// audit 자체가 실패해도 catch swallow — tool 결과에 영향 주지 않는다 (PITFALL #1 invariant 유지).
export async function run<T>(
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 30_000,
  auditParentId?: bigint,
  auditInput?: unknown,
): Promise<T | ToolError> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const startedAt = Date.now()
  // result는 try/catch 양 경로에서 모두 할당되므로 finally 도달 시 항상 정의됨.
  // 다만 TS는 정확히 추적하지 못해 TS2454 발생 → undefined 허용 + finally에서 ! narrow.
  let result: T | ToolError | undefined
  let ok = false
  try {
    const value = await fn(ac.signal)
    result = value
    ok = !isToolError(value)
    return value
  } catch (err) {
    // PITFALL #1: 절대 던지지 않는다 — 항상 ToolError 반환.
    if ((err as Error).name === "AbortError") {
      result = {
        problem: `tool ${name} timeout ${timeoutMs / 1000}s`,
        cause: "서버 도달·응답 지연",
        fix: "재시도 또는 SSH/docker context 상태 점검",
        retryable: true,
      }
    } else {
      const rawCause = (err as Error).message ?? String(err)
      result = {
        problem: `tool ${name} 실패`,
        cause: rawCause.slice(0, 200),
        fix: "로그 확인 후 재시도",
        retryable: true,
      }
    }
    ok = false
    return result
  } finally {
    clearTimeout(timer)
    // AUDIT-01 / D-14.4: parentId가 있을 때만 logTool 호출 (Plan 06 agent/loop.ts 진입점에서 전달).
    // 미전달 시 skip — Plan 02의 기존 시그니처 호환성 유지 + test simplicity.
    if (auditParentId !== undefined) {
      try {
        // finally 도달 시 result는 try (line 54) 또는 catch (line 60/68)에서 할당된 후이므로 항상 정의됨.
        const r = result!
        const summary = isToolError(r)
          ? `${r.problem}: ${r.cause}`
          : typeof r === "string"
            ? r.slice(0, 500)
            : JSON.stringify(r).slice(0, 500)
        logTool(auditParentId, name, auditInput ?? null, summary, ok, Date.now() - startedAt)
      } catch {
        // audit 실패는 절대 tool 결과에 영향 주지 않는다 — PITFALL #1 invariant 유지.
      }
    }
  }
}
