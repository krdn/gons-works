// approval/store.test.ts — PITFALL #3 prevention 검증 (nonce + 2분 expiresAt + consumed flag).
//
// 테스트 패턴: Phase 1 agent/loop.test.ts의 `_resetForTest()` beforeEach + Bun test runner.
// 9 분기 cover (CONTEXT.md `<behavior>` 1~9):
//   1. 정상 흐름 (approved)
//   2. nonce mismatch reject
//   3. double-press (consumed) reject
//   4. expired (자동 setTimeout)
//   5. expirePending external (loop abort)
//   6. edited decision payload 전달
//   7. rejected decision + 같은 sessionId 재등록 가능
//   8. session conflict (이미 pending이면 throw)
//   9. set-before-resolve invariant (consumed flag set이 resolve 호출 BEFORE)

import { describe, test, expect, beforeEach } from "bun:test"
import {
  setPending,
  consumeApproval,
  expirePending,
  _resetForTest,
} from "./store"
import type { ApprovalDecision, PendingApproval } from "./store"

// 헬퍼: 표준 PendingApproval 페이로드 (consumed 제외 — setPending이 보강).
function makePayload(
  overrides: Partial<Omit<PendingApproval, "consumed">> = {},
): Omit<PendingApproval, "consumed"> {
  return {
    nonce: overrides.nonce ?? "n1",
    diff: overrides.diff ?? "(no file change — command only: compose restart)",
    stack: overrides.stack ?? "news",
    command: overrides.command ?? "compose restart",
    service: overrides.service ?? "news-prod-app",
    fileEdit: overrides.fileEdit,
    reasoning: overrides.reasoning ?? "test reasoning",
    user_prompt: overrides.user_prompt ?? "restart news",
    expiresAt: overrides.expiresAt ?? Date.now() + 120_000,
  }
}

describe("approval/store", () => {
  beforeEach(() => {
    _resetForTest()
  })

  test("1. 정상 흐름: setPending → consumeApproval(approved) → Promise resolve", async () => {
    // Arrange
    const promise = setPending("s1", makePayload({ nonce: "n1" }))

    // Act
    consumeApproval("s1", "n1", { type: "approved" })

    // Assert
    await expect(promise).resolves.toEqual({ type: "approved" })
  })

  test("2. nonce mismatch: throw 'Stale approval — nonce mismatch'", async () => {
    // Arrange
    const promise = setPending("s1", makePayload({ nonce: "A" }))
    // 미해결 promise를 leak하지 않도록 끝에 expirePending으로 정리.

    // Act + Assert
    expect(() => consumeApproval("s1", "B", { type: "approved" })).toThrow(
      /Stale approval/,
    )

    // cleanup: 외부 expire로 promise resolve
    expirePending("s1")
    await expect(promise).resolves.toEqual({ type: "expired" })
  })

  test("3. double-press: 두 번째 consumeApproval은 'Already consumed' throw", async () => {
    // Arrange
    const promise = setPending("s1", makePayload({ nonce: "n1" }))

    // Act: 첫 호출 정상
    consumeApproval("s1", "n1", { type: "approved" })
    await expect(promise).resolves.toEqual({ type: "approved" })

    // Assert: 두 번째 호출 — 이미 delete됐으므로 "No pending approval"
    // 단 만약 delete 전에 호출되면 "Already consumed". 어느 쪽이든 throw.
    expect(() => consumeApproval("s1", "n1", { type: "approved" })).toThrow()
  })

  test("4. expired (자동): expiresAt이 과거면 setTimeout 즉시 발화 → resolve(expired)", async () => {
    // Arrange: expiresAt이 이미 과거 (음수 ms — Bun이 0ms로 즉시 큐에 등록)
    const promise = setPending(
      "s1",
      makePayload({ nonce: "n1", expiresAt: Date.now() - 1000 }),
    )

    // Act: 자동 expire 발화 대기
    await new Promise((r) => setTimeout(r, 20))

    // Assert: promise는 expired로 resolve
    await expect(promise).resolves.toEqual({ type: "expired" })

    // 후속 consumeApproval은 "No pending approval" — 이미 delete됨.
    expect(() => consumeApproval("s1", "n1", { type: "approved" })).toThrow(
      /No pending approval/,
    )
  })

  test("5. expirePending external (loop abort): Promise resolve(expired)", async () => {
    // Arrange
    const promise = setPending("s1", makePayload({ nonce: "n1" }))

    // Act
    expirePending("s1")

    // Assert
    await expect(promise).resolves.toEqual({ type: "expired" })

    // 후속 expirePending은 silent no-op (race로 두 번 호출 가능)
    expect(() => expirePending("s1")).not.toThrow()
  })

  test("6. edited decision: newContent 포함 payload 그대로 전달", async () => {
    // Arrange
    const promise = setPending("s1", makePayload({ nonce: "n1" }))
    const decision: ApprovalDecision = {
      type: "edited",
      newContent: "version: '3'\nservices: { test: { image: alpine:3 } }",
    }

    // Act
    consumeApproval("s1", "n1", decision)

    // Assert
    await expect(promise).resolves.toEqual(decision)
  })

  test("7. rejected: resolve(rejected) + 같은 sessionId 재등록 가능", async () => {
    // Arrange
    const p1 = setPending("s1", makePayload({ nonce: "n1" }))

    // Act: reject
    consumeApproval("s1", "n1", { type: "rejected" })
    await expect(p1).resolves.toEqual({ type: "rejected" })

    // Assert: 같은 sessionId에 재 setPending 가능 (delete 됐으므로)
    const p2 = setPending("s1", makePayload({ nonce: "n2" }))
    consumeApproval("s1", "n2", { type: "approved" })
    await expect(p2).resolves.toEqual({ type: "approved" })
  })

  test("8. session conflict: 이미 pending인 sessionId에 setPending 시 throw", async () => {
    // Arrange
    const p1 = setPending("s1", makePayload({ nonce: "n1" }))

    // Act + Assert: 같은 sessionId 두 번째 setPending throw
    expect(() => setPending("s1", makePayload({ nonce: "n2" }))).toThrow(
      /Pending approval already exists/,
    )

    // cleanup
    consumeApproval("s1", "n1", { type: "approved" })
    await expect(p1).resolves.toEqual({ type: "approved" })
  })

  test("9. set-before-resolve invariant: consumed=true가 resolve 호출 BEFORE 설정됨 (double-press 차단으로 검증)", async () => {
    // 이 invariant는 PITFALL #3 prevention의 핵심:
    //   consumed = true   ← BEFORE
    //   resolve(decision) ← AFTER
    //
    // 직접 noop spy는 internal 접근이라 어렵지만, 동기적으로 같은 tick에서 두 번째 호출이
    // throw하는지로 검증 (consumed flag가 set 상태이거나 entry 자체가 delete된 상태).

    // Arrange
    const promise = setPending("s1", makePayload({ nonce: "n1" }))

    // Act: 동기적으로 consumeApproval 호출 직후 같은 nonce로 재호출 시도
    consumeApproval("s1", "n1", { type: "approved" })

    // Assert: 두 번째 호출은 throw — consumed=true로 마크됐거나 이미 delete됨
    expect(() => consumeApproval("s1", "n1", { type: "approved" })).toThrow()
    await expect(promise).resolves.toEqual({ type: "approved" })
  })

  test("10. expired consumeApproval (race): expired 상태에서 consumeApproval 호출 시 expired throw + delete", async () => {
    // Arrange: 자동 setTimeout이 발화하기 전 동기적으로 consumeApproval 호출.
    // 단, expiresAt이 과거지만 setTimeout이 비동기라 동기적으로 consume 가능.
    // 이 케이스는 PITFALLS.md "Date.now() > a.expiresAt" 분기 직접 검증.
    const promise = setPending(
      "s1",
      makePayload({ nonce: "n1", expiresAt: Date.now() - 1000 }),
    )

    // Act + Assert: setTimeout 발화 전 동기적 consume — expired 분기 진입
    expect(() => consumeApproval("s1", "n1", { type: "approved" })).toThrow(
      /expired/,
    )

    // promise는 expired로 resolve
    await expect(promise).resolves.toEqual({ type: "expired" })
  })

  test("11. aborted decision: payload 그대로 전달", async () => {
    // Arrange
    const promise = setPending("s1", makePayload({ nonce: "n1" }))

    // Act
    consumeApproval("s1", "n1", { type: "aborted" })

    // Assert
    await expect(promise).resolves.toEqual({ type: "aborted" })
  })

  test("12. multi-session 격리: 다른 sessionId는 서로 영향 없음", async () => {
    // Arrange
    const p1 = setPending("s1", makePayload({ nonce: "nA" }))
    const p2 = setPending("s2", makePayload({ nonce: "nB" }))

    // Act: 각각 consume
    consumeApproval("s1", "nA", { type: "approved" })
    consumeApproval("s2", "nB", { type: "rejected" })

    // Assert
    await expect(p1).resolves.toEqual({ type: "approved" })
    await expect(p2).resolves.toEqual({ type: "rejected" })
  })

  test("13. expirePending (no pending): silent no-op", () => {
    // Act + Assert: pending 없는 sessionId expire는 throw 없음
    expect(() => expirePending("nonexistent")).not.toThrow()
  })

  test("14. consumeApproval (no pending): throw 'No pending approval'", () => {
    // Act + Assert
    expect(() =>
      consumeApproval("nonexistent", "any", { type: "approved" }),
    ).toThrow(/No pending approval/)
  })
})
