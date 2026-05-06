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
