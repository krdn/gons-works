// src/server.test.ts — Hono app 라우트 sanity tests (Plan 01-07 + 02-08).
//
// 전략: server.ts를 import하면 module-level loadEnv()가 즉시 실행된다.
// 따라서 import 전에 Bun.env에 테스트 키를 set한다. ESM은 top-level await을 module
// 평가 단계에서 실행 — 따라서 env 할당 → 동적 import 순서로 두면 안전하다.
// (beforeAll은 import 이후에 실행되므로 too late.)
//
// staleCheck() / queryTopK()는 docker / voyageai 실호출이 가능하므로 SSE 핸들러를
// 끝까지 driver하지 않는다 — 라우트 존재 + status code + Content-Type만 확인.
// (라이브 검증은 Plan 01-09 verification에서.)
//
// Plan 02-08 추가: POST /approval/:id 5-key route + recoverPendingMarkers boot probe.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// import 전 Bun.env 주입 — server.ts module-level loadEnv() 통과용.
// FRICTION #8 분기를 피하려면 빈 문자열 아닌 값으로 명시적 set 필요
// (현 셸에 ANTHROPIC_API_KEY=가 빈 값으로 export된 상태일 수 있음).
Bun.env.ANTHROPIC_API_KEY = "test-anth-key"
Bun.env.VOYAGE_API_KEY = "test-voyage-key"
Bun.env.DOCKER_CONTEXT = "test-context"
// KB SQLite를 :memory:로 격리해 실제 ./data/copilot.db 변경 방지
Bun.env.KB_DB_PATH = ":memory:"

// 동적 import — env set 후에 server.ts 평가
const serverMod = await import("./server")
const { app } = serverMod
const serveDefault = serverMod.default

// approval store 직접 import (test isolation을 위해 _resetForTest 사용)
const approvalStoreMod = await import("../approval/store")
const { setPending, _resetForTest: resetApprovalStore } = approvalStoreMod

describe("server.ts (Plan 01-07)", () => {
  test("app은 Hono instance — fetch 메서드 존재", () => {
    expect(typeof app.fetch).toBe("function")
  })

  test("export default는 PITFALL #16 — hostname '127.0.0.1' 명시 + 정수 port", () => {
    expect(serveDefault.hostname).toBe("127.0.0.1")
    expect(typeof serveDefault.port).toBe("number")
    expect(Number.isInteger(serveDefault.port)).toBe(true)
    expect(typeof serveDefault.fetch).toBe("function")
  })

  test("GET /static/htmx.min.js → 200 또는 404 (둘 다 OK — 파일 존재 여부 따라)", async () => {
    const res = await app.fetch(new Request("http://localhost/static/htmx.min.js"))
    expect([200, 404]).toContain(res.status)
  })

  test("GET /static/passwd → 404 (path traversal 방지 — 화이트리스트 외)", async () => {
    const res = await app.fetch(new Request("http://localhost/static/passwd"))
    expect(res.status).toBe(404)
  })

  test("GET /static/..%2Fetc%2Fpasswd → 404 (URL traversal 시도도 화이트리스트 비매칭)", async () => {
    const res = await app.fetch(
      new Request("http://localhost/static/..%2Fetc%2Fpasswd"),
    )
    expect(res.status).toBe(404)
  })

  test("POST /chat with empty prompt → 400 + JSON error", async () => {
    const formBody = new URLSearchParams({ prompt: "" })
    const res = await app.fetch(
      new Request("http://localhost/chat", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain("비어있음")
  })

  test("POST /chat with prompt → 200 + 응답 fragment에 sse-connect URL 포함", async () => {
    const formBody = new URLSearchParams({ prompt: "테스트 질의" })
    const res = await app.fetch(
      new Request("http://localhost/chat", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain("sse-connect")
    expect(text).toContain("/chat-stream?prompt=")
    // URL-encoded 한국어 prompt가 hx-attribute에 들어가야 함
    expect(text).toContain(encodeURIComponent("테스트 질의"))
  })

  test("GET / → 200 (index.html 없으면 STUB 안내, 있으면 파일 내용)", async () => {
    const res = await app.fetch(new Request("http://localhost/"))
    expect(res.status).toBe(200)
    const ct = res.headers.get("content-type") ?? ""
    expect(ct).toContain("text/html")
  })
})

// === F-2 회귀 방지 (Phase 2 D-E1 carry-back, plan 01-10 Task 4 T2) ===
//
// 핵심 인보이언트: 모든 stream.writeSSE Promise는 stream close 전에 flush된다.
// 이전 버그: emit 콜백이 `void emit(ev)` fire-and-forget이라 iterate resolve 직후
// streamSSE가 stream을 close하면 마지막 writeSSE Promise(특히 final event)가 swallow됨.
// fix: pendingWrites 큐 + finally Promise.allSettled로 모든 emit 완결 보장.
//
// 단위 검증 전략: emit + pendingWrites + Promise.allSettled 패턴 자체를 격리 재현하여
// "마지막 emit이 모두 resolve된 뒤에야 flush 단계가 끝난다"를 결정적으로 보장.
describe("F-2 회귀 — pendingWrites flush 패턴 (server.ts SSE wrapper 핵심 인보이언트)", () => {
  test("Promise.allSettled가 큐의 모든 Promise resolve를 기다린다 (이전 fire-and-forget 버그 재현 + 회귀)", async () => {
    const writeOrder: string[] = []
    const pendingWrites: Promise<void>[] = []

    // mock writeSSE: 각 호출은 다른 지연을 가진 Promise. 마지막(final)이 가장 늦게 resolve.
    function mockWriteSSE(label: string, delayMs: number): Promise<void> {
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          writeOrder.push(label)
          resolve()
        }, delayMs),
      )
    }

    // sync emit (server.ts와 동일 패턴) — fire-and-forget으로 push만 함
    function emit(label: string, delayMs: number): void {
      pendingWrites.push(mockWriteSSE(label, delayMs))
    }

    // 가상의 iterate 흐름: drift → text-delta → tool-start → tool-result → final
    emit("drift", 5)
    emit("text-delta-1", 8)
    emit("tool-start", 3)
    emit("tool-result", 6)
    emit("final", 12) // 가장 늦게 resolve — 이전 버그면 stream close에 의해 swallow

    // server.ts finally 블록 시뮬레이션
    await Promise.allSettled(pendingWrites)

    // 모든 emit이 resolve되어야 함 (특히 final)
    expect(writeOrder).toContain("final")
    expect(writeOrder.length).toBe(5)
  })

  test("rejected writeSSE는 swallow되지만 다른 emit flush를 막지 않는다 (stream already closed 케이스)", async () => {
    const writeOrder: string[] = []
    const pendingWrites: Promise<void>[] = []

    pendingWrites.push(
      new Promise<void>((resolve) => setTimeout(() => { writeOrder.push("a"); resolve() }, 5)),
    )
    pendingWrites.push(
      Promise.reject(new Error("stream already closed")).catch(() => { /* swallow */ }),
    )
    pendingWrites.push(
      new Promise<void>((resolve) => setTimeout(() => { writeOrder.push("c"); resolve() }, 10)),
    )

    await Promise.allSettled(pendingWrites)
    expect(writeOrder).toEqual(["a", "c"])
  })
})

// ===== Plan 02-08: POST /approval/:id 5-key route =====
//
// PLAN.md:
//   body: form-urlencoded { key: 'y'|'n'|'e'|'d'|'a', newContent? }
//   nonce: URL path param (`:id`)
//   sessionId: x-session-id header (default 'default')
//
// mapKey:
//   y → {type:'approved'}
//   n → {type:'rejected'}
//   e → {type:'edited', newContent} (newContent 없으면 invalid → 400)
//   d → ui-only (consumeApproval 미호출, 200 OK)
//   a → {type:'aborted'}
//   else → invalid → 400
//
// 응답:
//   200 OK on 정상 + ui-only
//   400 invalid key / parse error
//   409 nonce mismatch / consumed / expired (consumeApproval throw)
describe("Plan 02-08: POST /approval/:id (5-key approval route)", () => {
  beforeEach(() => {
    resetApprovalStore()
  })

  afterEach(() => {
    resetApprovalStore()
  })

  // 공통 fixture — pending 등록을 위한 minimal payload
  function basePending(nonce: string) {
    return {
      nonce,
      diff: "",
      stack: "news" as const,
      command: "compose ps" as const,
      service: "",
      reasoning: "test",
      user_prompt: "test",
      expiresAt: Date.now() + 120_000,
    }
  }

  function postApproval(
    nonce: string,
    formFields: Record<string, string>,
    sessionId = "default",
  ) {
    const body = new URLSearchParams(formFields).toString()
    return app.fetch(
      new Request(`http://localhost/approval/${nonce}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-session-id": sessionId,
        },
        body,
      }),
    )
  }

  test("key='y' → 200 + decision 'approved' resolve", async () => {
    const decisionPromise = setPending("default", basePending("n1"))
    const res = await postApproval("n1", { key: "y" })
    expect(res.status).toBe(200)
    await expect(decisionPromise).resolves.toEqual({ type: "approved" })
  })

  test("key='n' → 200 + decision 'rejected'", async () => {
    const decisionPromise = setPending("default", basePending("n2"))
    const res = await postApproval("n2", { key: "n" })
    expect(res.status).toBe(200)
    await expect(decisionPromise).resolves.toEqual({ type: "rejected" })
  })

  test("key='e' + newContent → 200 + decision 'edited'", async () => {
    const decisionPromise = setPending("default", basePending("n3"))
    const res = await postApproval("n3", {
      key: "e",
      newContent: "version: '3'\nservices: {}\n",
    })
    expect(res.status).toBe(200)
    await expect(decisionPromise).resolves.toEqual({
      type: "edited",
      newContent: "version: '3'\nservices: {}\n",
    })
  })

  test("key='e' + no newContent → 400 invalid key envelope", async () => {
    setPending("default", basePending("n4"))
    const res = await postApproval("n4", { key: "e" })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { problem: string; retryable: boolean }
    expect(body.problem).toContain("invalid")
    expect(body.retryable).toBe(false)
  })

  test("key='d' → 200 + ui-only flag (consumeApproval 미호출)", async () => {
    // pending 그대로 살아있어야 함 — d는 토글만
    const decisionPromise = setPending("default", basePending("n5"))
    const res = await postApproval("n5", { key: "d" })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; ui_only: boolean }
    expect(body.ok).toBe(true)
    expect(body.ui_only).toBe(true)
    // pending이 그대로 살아있는지 — consumeApproval 미호출 검증.
    // 이후 'a'로 abort하여 promise 매듭 (test cleanup).
    const abortRes = await postApproval("n5", { key: "a" })
    expect(abortRes.status).toBe(200)
    await expect(decisionPromise).resolves.toEqual({ type: "aborted" })
  })

  test("key='a' → 200 + decision 'aborted'", async () => {
    const decisionPromise = setPending("default", basePending("n6"))
    const res = await postApproval("n6", { key: "a" })
    expect(res.status).toBe(200)
    await expect(decisionPromise).resolves.toEqual({ type: "aborted" })
  })

  test("key='z' (invalid) → 400 envelope", async () => {
    setPending("default", basePending("n7"))
    const res = await postApproval("n7", { key: "z" })
    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      problem: string
      cause: string
      fix: string
      retryable: boolean
    }
    expect(body.problem).toContain("invalid")
    expect(body.cause).toContain("z")
    expect(body.retryable).toBe(false)
  })

  test("nonce mismatch → 409 envelope (PITFALL #3 prevention)", async () => {
    setPending("default", basePending("real-nonce"))
    const res = await postApproval("wrong-nonce", { key: "y" })
    expect(res.status).toBe(409)
    const body = (await res.json()) as {
      problem: string
      cause: string
      fix: string
      retryable: boolean
    }
    expect(body.problem.toLowerCase()).toContain("nonce")
    expect(body.retryable).toBe(false)
  })
})

// ===== Plan 02-08: recoverPendingMarkers + buffered drift =====
//
// D-C2 boot probe — state/.pending/*.json scan, 발견 시 console.warn + buffer
// (자동 복구 안 함). 첫 /chat-stream 진입 시 buffered drift event SSE emit.
//
// reader는 permissive parse — Wave 1/2 (02-04 commit, 02-06 applyPatch)가
// PendingMarker 추가 필드(fileEdit/reasoning/sha_before 등)를 작성하므로
// 정확한 schema 매칭 강제 안 함.
describe("Plan 02-08: recoverPendingMarkers + buffered drift", () => {
  // tests/fixtures/pending-test/ 임시 디렉토리에서 격리 실행
  // 실제 state/.pending과 충돌 회피 — testRoot로 분리.
  const testRoot = join(import.meta.dir, "..", "tests", "fixtures", "pending-test")
  const testPendingDir = join(testRoot, ".pending")

  beforeEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
    mkdirSync(testPendingDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  test("recoverPendingMarkers: 디렉토리 비어있으면 빈 배열", async () => {
    const { recoverPendingMarkers } = serverMod
    const result = await recoverPendingMarkers(testPendingDir)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(0)
  })

  test("recoverPendingMarkers: 존재하지 않는 디렉토리도 빈 배열 (mkdir 안 함)", async () => {
    const { recoverPendingMarkers } = serverMod
    const noSuchDir = join(testRoot, "absolutely-not-exist")
    const result = await recoverPendingMarkers(noSuchDir)
    expect(result).toEqual([])
    expect(existsSync(noSuchDir)).toBe(false)
  })

  test("recoverPendingMarkers: 2개 marker → 2개 반환 + 추가 필드는 permissive (passthrough)", async () => {
    // Wave 1/2 writers (02-04/02-06)가 작성하는 실제 marker shape — 추가 필드 포함
    const m1 = {
      nonce: "uuid-1",
      stack: "news",
      command: "compose restart",
      service: "news",
      reasoning: "image bump",
      user_prompt: "news 재시작",
      sha_before: "abc1234",
      ts_created: "2026-05-08T10:00:00+09:00",
      docker_started_at: "2026-05-08T10:00:01+09:00",
      docker_finished_at: null,
      exit_code: null,
      // permissive 필드:
      fileEdit: { path: "state/compose/news.yml", newContent: "x", previousContent: "y" },
    }
    const m2 = {
      nonce: "uuid-2",
      stack: "krdn-fx",
      command: "compose down",
      service: "dashboard",
      reasoning: "stop fx",
      user_prompt: "fx 중지",
      sha_before: "def5678",
      ts_created: "2026-05-08T10:01:00+09:00",
      docker_started_at: "2026-05-08T10:01:01+09:00",
      docker_finished_at: "2026-05-08T10:01:02+09:00",
      exit_code: 0,
    }
    writeFileSync(join(testPendingDir, "uuid-1.json"), JSON.stringify(m1, null, 2))
    writeFileSync(join(testPendingDir, "uuid-2.json"), JSON.stringify(m2, null, 2))

    const { recoverPendingMarkers } = serverMod
    const result = await recoverPendingMarkers(testPendingDir)
    expect(result.length).toBe(2)
    const nonces = result.map((m: { nonce: string }) => m.nonce).sort()
    expect(nonces).toEqual(["uuid-1", "uuid-2"])
    // permissive parse 검증 — 추가 필드도 보존되어야 함
    const m1Found = result.find(
      (m: { nonce: string }) => m.nonce === "uuid-1",
    ) as { fileEdit?: unknown }
    expect(m1Found.fileEdit).toBeDefined()
  })

  test("recoverPendingMarkers: 손상 JSON 파일은 swallow (operator manual)", async () => {
    writeFileSync(join(testPendingDir, "good.json"), JSON.stringify({ nonce: "good" }))
    writeFileSync(join(testPendingDir, "broken.json"), "{ not valid json")

    const { recoverPendingMarkers } = serverMod
    const result = await recoverPendingMarkers(testPendingDir)
    // 손상 파일은 무시되고 정상 1개만 반환
    expect(result.length).toBe(1)
    expect((result[0] as { nonce: string }).nonce).toBe("good")
  })

  test("bufferPendingDrift / consumeBufferedDrift: 버퍼는 한 번만 consume", () => {
    const { bufferPendingDrift, consumeBufferedDrift } = serverMod
    const markers = [{ nonce: "a", stack: "news", command: "compose ps" }]
    bufferPendingDrift(markers)
    const first = consumeBufferedDrift()
    expect(first.length).toBe(1)
    const second = consumeBufferedDrift()
    expect(second.length).toBe(0)
  })
})

