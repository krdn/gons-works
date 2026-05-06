#!/usr/bin/env bun
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Spike 3 — Hono streamSSE → htmx-ext-sse roundtrip.
// 더미 endpoint 1개 + 정적 HTML 1개. agent loop 연결 없음 (Phase 1).

const PORT = Number(Bun.env.SPIKE_PORT ?? 5173)
const app = new Hono()

const indexHtmlPath = join(import.meta.dir, "index.html")
const indexHtml = readFileSync(indexHtmlPath, "utf8")

app.get("/", (c) => c.html(indexHtml))

// SSE endpoint. Phase 1과 동일한 named event 패턴.
app.get("/sse-test", (c) => {
  return streamSSE(c, async (stream) => {
    const chunks = [
      "안녕, ",
      "이건 ",
      "Spike 3 ",
      "스트림 ",
      "테스트입니다.",
    ]
    for (const chunk of chunks) {
      await stream.writeSSE({
        event: "text-delta",
        data: JSON.stringify({ text: chunk }),
      })
      await stream.sleep(400) // 5개 청크 × 400ms
    }
    await stream.writeSSE({
      event: "final",
      data: JSON.stringify({ message: "Spike 3 PASS" }),
    })
  })
})

console.log(`[Spike 3] Hono server listening on http://localhost:${PORT}`)
console.log(`[Spike 3] 브라우저로 위 URL을 열고 "Start" 버튼을 누르세요.`)
console.log(`[Spike 3] 5개 chunk가 순차 표시되면 PASS, "final" 후 자동 종료.`)

export default {
  port: PORT,
  fetch: app.fetch,
}
