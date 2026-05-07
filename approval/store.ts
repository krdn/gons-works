// approval/store.ts — APPLY-03 in-memory 승인 게이트 store.
//
// 역할: proposePatch tool이 등록한 PendingApproval을 LOOP가 await하는 단일 진실 공급원.
//        nonce + 2분 expiresAt + consumed flag의 3-layer race 차단 (PITFALL #3).
//
// 핵심 invariants (PITFALLS.md Pitfall 3 prevention 코드 lock):
//   1. consumed=true는 resolve() 호출 BEFORE에 set (race 0 — 동시 호출 시 두 번째는 throw).
//   2. nonce mismatch면 ApprovalDecision 반환 안 함 (server route가 409 응답으로 매핑).
//   3. expired는 자동 setTimeout 또는 외부 expirePending 호출 시 resolve({type:"expired"}).
//   4. "edited" 결정은 nonce 유지 — newContent만 LOOP에 전달, fileEdit은 proposePatch 본체가 갱신.
//
// 패턴 analog (Phase 1):
//   - module-level Map<string, ...>: agent/loop.ts:53 inFlight Map (LOOP-07 dedup)
//   - _resetForTest(): agent/loop.ts:82-86 (test isolation 컨벤션)
//
// 비-export waitForApproval: sessionId만으로는 Promise 재 attach 불가 — LOOP가 setPending이 반환한
// Promise를 직접 await. SSE 재연결 시 재시도는 v2 시나리오로 deferred (advisor Open Q 2 lock).

// === 타입 정의 ===

// D-B1 7-union literal — proposePatch tool input의 command 필드와 1:1 매칭.
export type ComposeCommand =
  | "compose up -d"
  | "compose down"
  | "compose restart"
  | "compose start"
  | "compose stop"
  | "compose logs --tail=200"
  | "compose ps"

// D-A1 5 stack lock.
export type Stack = "news" | "ais" | "n8n" | "open-webui" | "krdn-fx"

// PendingApproval — proposePatch가 setPending에 넘기고, store가 internal 보관용으로 consumed/timeoutHandle/resolve를 추가.
export interface PendingApproval {
  nonce: string // crypto.randomUUID() per proposePatch 호출
  diff: string // jsdiff createPatch 결과 또는 "(no file change ...)" 배너
  stack: Stack
  command: ComposeCommand
  service: string // <svc> 인자 (compose ps 시 빈 문자열 허용)
  fileEdit?: { path: string; newContent: string }
  reasoning: string // D-D2 source — sanitization은 state/commit.ts가 수행
  user_prompt: string // D-D1 body source — sanitization은 state/commit.ts가 수행
  expiresAt: number // Date.now() + 120_000 (PITFALL #3 prevention 코드)
  consumed: boolean // atomic set-before-resolve flag (PITFALL #3)
}

// 5-key 매핑 결과. server.ts /approval/:id POST 핸들러가 키→decision 매핑 후 consumeApproval 호출.
//   y → {type:"approved"}
//   n → {type:"rejected"}
//   e → {type:"edited", newContent:<textarea 결과>}  (Open Q 1 lock — 같은 카드, nonce 유지)
//   a → {type:"aborted"}
//   d → 정보 표시만, decision 미발생
//   expired → 자동 setTimeout 또는 expirePending 호출 시
export type ApprovalDecision =
  | { type: "approved" }
  | { type: "rejected" }
  | { type: "edited"; newContent: string }
  | { type: "aborted" }
  | { type: "expired" }

// === Internal state ===

// store-internal entry: PendingApproval(consumed 포함) + Promise resolve callback + setTimeout handle.
interface PendingEntry extends PendingApproval {
  resolve: (decision: ApprovalDecision) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

// module-level Map (analog: agent/loop.ts:53 inFlight Map). single-process bun에서 race-safe.
const pending = new Map<string, PendingEntry>()

// === Public API ===

/**
 * proposePatch tool이 호출 — sessionId 단위로 PendingApproval을 등록하고 ApprovalDecision Promise 반환.
 *
 * - 같은 sessionId에 이미 pending이 있으면 throw (D-C4 single-pending 정책 — multi-pending v2 deferred).
 * - 자동 expire 등록: expiresAt - Date.now() 후 setTimeout이 resolve({type:"expired"}) + delete.
 *   expiresAt이 이미 과거여도 setTimeout(0)으로 다음 tick에 발화.
 * - 반환된 Promise는 consumeApproval 또는 expirePending 호출 시 resolve된다.
 *
 * @param sessionId session 단위 키 (1인 도구이므로 보통 "default" 단일 세션)
 * @param payload PendingApproval에서 consumed 제외 (store가 false로 보강)
 * @returns ApprovalDecision Promise — 사용자 5-key 입력 또는 자동 expire까지 대기
 * @throws sessionId가 이미 pending인 경우
 */
export function setPending(
  sessionId: string,
  payload: Omit<PendingApproval, "consumed">,
): Promise<ApprovalDecision> {
  if (pending.has(sessionId)) {
    throw new Error(`Pending approval already exists for session: ${sessionId}`)
  }

  let resolveRef!: (decision: ApprovalDecision) => void
  const promise = new Promise<ApprovalDecision>((resolve) => {
    resolveRef = resolve
  })

  // 자동 expire 등록 — Date.now() > expiresAt이어도 음수 ms는 Bun이 0ms로 즉시 큐에 넣는다.
  const remainingMs = payload.expiresAt - Date.now()
  const timeoutHandle = setTimeout(
    () => {
      const entry = pending.get(sessionId)
      if (!entry) return // 이미 consume/abort된 경우 — silent no-op
      entry.resolve({ type: "expired" })
      pending.delete(sessionId)
    },
    Math.max(0, remainingMs),
  )

  const entry: PendingEntry = {
    ...payload,
    consumed: false,
    resolve: resolveRef,
    timeoutHandle,
  }
  pending.set(sessionId, entry)
  return promise
}

/**
 * server.ts /approval/:id POST 핸들러가 호출 — 5-key 결정을 store에 전달.
 *
 * PITFALLS.md Pitfall 3 prevention 코드 verbatim 적용:
 *   1. nonce mismatch → throw (server route는 409로 매핑)
 *   2. consumed=true → throw (double-press 차단)
 *   3. Date.now() > expiresAt → resolve(expired) + delete + throw (사용자에게 재제안 안내)
 *   4. 정상 → consumed=true (BEFORE) → resolve(decision) → delete
 *
 * @param sessionId session 단위 키
 * @param clientNonce 클라이언트가 form hidden field로 보낸 nonce
 * @param decision 5-key 매핑된 결과
 * @throws "No pending approval" / "Stale approval — nonce mismatch" / "Already consumed" / "Approval expired"
 */
export function consumeApproval(
  sessionId: string,
  clientNonce: string,
  decision: ApprovalDecision,
): void {
  const a = pending.get(sessionId)
  if (!a) {
    throw new Error("No pending approval")
  }
  if (a.nonce !== clientNonce) {
    throw new Error(
      "Stale approval — nonce mismatch. Re-read the diff before approving.",
    )
  }
  if (a.consumed) {
    throw new Error("Already consumed (double-press guard)")
  }
  if (Date.now() > a.expiresAt) {
    a.resolve({ type: "expired" })
    clearTimeout(a.timeoutHandle)
    pending.delete(sessionId)
    throw new Error("Approval expired (2 min). Re-propose.")
  }

  // PITFALL #3 prevention 핵심: consumed=true는 resolve() 호출 BEFORE.
  // 동시 진입 시 두 번째 호출은 위 `if (a.consumed)` 분기에서 throw.
  a.consumed = true
  a.resolve(decision)
  clearTimeout(a.timeoutHandle)
  pending.delete(sessionId)
}

/**
 * 외부 abort — agent/loop.ts AbortController가 chunk timeout 등으로 abort 시 호출.
 *
 * pending이 있으면 resolve({type:"expired"}) + clearTimeout + delete.
 * 없으면 silent no-op (race로 두 번 호출될 수 있음).
 *
 * @param sessionId session 단위 키
 */
export function expirePending(sessionId: string): void {
  const a = pending.get(sessionId)
  if (!a) return // silent no-op (race-safe)
  a.resolve({ type: "expired" })
  clearTimeout(a.timeoutHandle)
  pending.delete(sessionId)
}

/**
 * 테스트 helper — pending Map 초기화 + 모든 in-flight setTimeout 취소.
 *
 * Production code 호출 금지. Phase 1 agent/loop.ts:82-86 _resetForTest 컨벤션.
 */
export function _resetForTest(): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timeoutHandle)
  }
  pending.clear()
}
