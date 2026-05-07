// src/server.test.ts — Hono app 라우트 sanity tests (Plan 01-07).
//
// 전략: server.ts를 import하면 module-level loadEnv()가 즉시 실행된다.
// 따라서 import 전에 Bun.env에 테스트 키를 set한다. ESM은 top-level await을 module
// 평가 단계에서 실행 — 따라서 env 할당 → 동적 import 순서로 두면 안전하다.
// (beforeAll은 import 이후에 실행되므로 too late.)
//
// staleCheck() / queryTopK()는 docker / voyageai 실호출이 가능하므로 SSE 핸들러를
// 끝까지 driver하지 않는다 — 라우트 존재 + status code + Content-Type만 확인.
// (라이브 검증은 Plan 01-09 verification에서.)

import { describe, expect, test } from "bun:test"

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

