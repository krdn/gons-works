// src/server.ts — Phase 1 Hono entrypoint.
//
// Responsibilities:
//   - POST /chat: htmx 폼 수신 → SSE 연결을 트리거할 wrapper HTML 반환
//   - GET /chat-stream: streamSSE handler — 4 startup probe 후 KB-03 drift + RAG + iterate() pump
//   - GET /static/:file: 화이트리스트 정적 파일 (htmx + sse extension)
//   - GET /: public/index.html serve
//
// 4 startup probes (실행 시 module main):
//   1) loadEnv() — module 진입점. FRICTION #8 친절 에러 → exit(1)
//   2) ensureDockerContext() — BOOT-04. context inspect 실패 → exit(1)
//   3) ensureIndexed() — KB lazy hash. failure → exit(1)
//   4) staleCheck() — boot 시 1회. console.warn만, exit 안 함
//
// Pitfalls handled:
//   #4 AbortError — streamSSE catch + onError 양쪽에서 명시 분기
//   #16 0.0.0.0 bind — hostname: "127.0.0.1" lock (acceptance grep)
//
// LOOP-06 (60s SSE chunk timeout / D-15.3):
//   createChunkWatchdog(emit) → emit()마다 reset, final/error마다 cancel,
//   timeout 발화 시 watchdog이 envelope을 onTimeout으로 넘기고 AbortSignal abort,
//   iterate(opts.abortSignal)이 signal 받아 break.

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { existsSync, readFileSync } from "node:fs"
import { loadEnv } from "./env"
import { ensureDockerContext } from "./docker-context-check"
import { ensureIndexed, queryTopK } from "../kb/index"
import { staleCheck, type StalenessReport } from "../kb/stale-check"
import { iterate } from "../agent/loop"
import {
  toSSEFrame,
  createChunkWatchdog,
  type SseEvent,
} from "../agent/sse"
import { formatRagContext } from "../agent/system-prompt"

const env = loadEnv()
const app = new Hono()

// ===== Static file serving (htmx + sse extension 화이트리스트) =====
// PITFALL: path traversal 차단 — Map 화이트리스트 외 모든 요청 404.
const STATIC_FILES: Record<string, string> = {
  // STACK.md lock: htmx@2.0.10, htmx-ext-sse@2.2.4
  "htmx.min.js": "node_modules/htmx.org/dist/htmx.min.js",
  "sse.js": "node_modules/htmx-ext-sse/sse.js",
}

function serveStatic(path: string): Response | null {
  const fpath = STATIC_FILES[path]
  if (fpath === undefined) return null
  if (!existsSync(fpath)) return null
  const body = readFileSync(fpath)
  return new Response(body, {
    headers: { "Content-Type": "application/javascript" },
  })
}

app.get("/static/:file", (c) => {
  const file = c.req.param("file")
  const resp = serveStatic(file)
  if (resp === null) return c.text(`static not found: ${file}`, 404)
  return resp
})

// ===== root index.html (Plan 08 frontend가 작성) =====
app.get("/", (c) => {
  const indexPath = "public/index.html"
  if (!existsSync(indexPath)) {
    // Plan 08 frontend 미머지 상태 — 운영자에게 명시
    return c.html(
      "<!doctype html><meta charset=utf-8><title>gons-works</title>" +
        "<p>public/index.html 미준비 — Plan 01-08 (frontend) 머지 후 사용 가능.</p>",
    )
  }
  const html = readFileSync(indexPath, "utf-8")
  return c.html(html)
})

// ===== POST /chat — htmx 폼 submit endpoint =====
// 응답: GET /chat-stream을 자동 연결할 div fragment. 운영자 1명 + 단일 페이지 → race 무시 가능.
// (UI-SPEC: hx-ext + sse-connect를 응답 fragment에 두면 htmx가 swap 후 SSE 시작)
app.post("/chat", async (c) => {
  const body = await c.req.parseBody()
  const prompt = String(body.prompt ?? "").trim()
  if (prompt === "") return c.json({ error: "prompt 비어있음" }, 400)
  const url = `/chat-stream?prompt=${encodeURIComponent(prompt)}`
  return c.html(
    `<div hx-ext="sse" sse-connect="${url}" hx-swap="none"></div>`,
  )
})

// ===== GET /chat-stream — SSE handler =====
// READ-04 + READ-05 + UI-04 + LOOP-06 모두 이 핸들러에서 wire.
app.get("/chat-stream", (c) => {
  const prompt = c.req.query("prompt") ?? ""
  const sessionId = c.req.header("x-session-id") ?? "default"

  return streamSSE(
    c,
    async (stream) => {
      // LOOP-06 / D-15.3: 60s no-chunk watchdog.
      // - emit() 호출마다 reset
      // - final/error마다 cancel
      // - timeout 발화 시 watchdog 자체가 envelope을 emit (이중 emit 회피 위해 watchdogFired flag)
      let watchdogFired = false
      const watchdog = createChunkWatchdog((timeoutEvent) => {
        watchdogFired = true
        // stream이 이미 닫힌 경우 writeSSE가 reject할 수 있음 — 조용히 swallow.
        void stream
          .writeSSE(toSSEFrame(timeoutEvent))
          .catch(() => {
            /* stream already closed */
          })
      })

      const emit = async (ev: SseEvent): Promise<void> => {
        watchdog.reset() // LOOP-06: 매 chunk마다 timer 갱신
        await stream.writeSSE(toSSEFrame(ev))
        if (ev.type === "final" || ev.type === "error") {
          watchdog.cancel() // 정상 종료 — timer 영구 중단
        }
      }

      try {
        // UI-04 / D-13.4: per-query staleness check (kb/stale-check.ts 30s TTL cache)
        const report: StalenessReport = await staleCheck(env)
        if (report.unknown.length > 0 || report.stale.length > 0) {
          await emit({
            type: "drift",
            message: `⚠ services.yaml 불일치: docker-only ${report.unknown.length}개, yaml-only ${report.stale.length}개 발견`,
            unknown: report.unknown,
            stale: report.stale,
          })
        }

        // KB-02: top-k=5 RAG retrieval
        const hits = await queryTopK(prompt, 5)
        const ragContext = formatRagContext(hits)

        // agent/loop.ts iterate — thin pump (HTTP-agnostic).
        // LOOP-06: watchdog.signal을 iterate()에 전달 → 60s chunk timeout 시 loop break.
        await iterate(prompt, {
          sessionId,
          ragContext,
          emit: (ev) => {
            void emit(ev)
          },
          abortSignal: watchdog.signal,
        })
      } catch (err) {
        // PITFALL #4: AbortError는 stream close에 의한 정상 cancel — 무시
        // watchdogFired인 경우 envelope 중복 emit 회피
        const errName = (err as Error).name
        if (errName !== "AbortError" && !watchdogFired) {
          await emit({
            type: "error",
            problem: "서버 처리 실패",
            cause: ((err as Error).message ?? String(err)).slice(0, 200),
            fix: "서버 로그 확인 후 재시도",
            retryable: true,
          })
        }
      } finally {
        // 모든 경로에서 timer 누수 방지
        watchdog.cancel()
      }
    },
    async (err, stream) => {
      // streamSSE 외부 onError handler — PITFALL #4 AbortError 무시
      if ((err as Error).name === "AbortError") return
      try {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            problem: "stream 처리 실패",
            cause: ((err as Error).message ?? String(err)).slice(0, 200),
            fix: "재연결 후 재시도",
            retryable: true,
          }),
        })
      } catch {
        /* stream already closed */
      }
    },
  )
})

// ===== Startup probes =====
async function startup(): Promise<void> {
  // probe 1: env (loadEnv 이미 모듈 진입에서 호출 — 실패 시 exit)
  // probe 2: docker context
  const dockerCheck = await ensureDockerContext(env.DOCKER_CONTEXT)
  if (!dockerCheck.ok) {
    console.error(`[BOOT-04] ${dockerCheck.problem.problem}`)
    console.error(`원인: ${dockerCheck.problem.cause}`)
    console.error(`해결: ${dockerCheck.problem.fix}`)
    process.exit(1)
  }
  // probe 3: kb 인덱싱 (D-13.3 lazy hash — yaml unchanged면 voyage skip)
  try {
    const result = await ensureIndexed()
    console.log(`[KB] indexed=${result.indexed}, chunkCount=${result.chunkCount}`)
  } catch (err) {
    console.error(`[KB] 인덱싱 실패: ${(err as Error).message}`)
    process.exit(1)
  }
  // probe 4: boot 시 staleCheck — drift event는 per-query에서 emit하므로 여기선 console.warn만
  try {
    const report = await staleCheck(env)
    if (report.unknown.length > 0 || report.stale.length > 0) {
      console.warn(
        `[KB-03] services.yaml drift 감지: unknown=${report.unknown.length}, stale=${report.stale.length}`,
      )
    }
  } catch (err) {
    console.warn(`[KB-03] staleCheck 실패 (서버 시작 계속): ${(err as Error).message}`)
  }
}

// 모듈이 직접 실행될 때만 startup + serve (test에서 import만 하면 server 시작 안 함)
if (import.meta.main) {
  await startup()
  const port = Number(process.env.PORT ?? 3000)
  console.log(`[server] ready — http://127.0.0.1:${port}`)
}

// PITFALL #16: 127.0.0.1 bind only — 0.0.0.0/외부 노출 절대 금지.
// Bun.serve는 export default { hostname, port, fetch } 시그니처 사용.
export default {
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
}

export { app }
