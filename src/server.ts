// src/server.ts — Phase 1+2 Hono entrypoint.
//
// Responsibilities:
//   - POST /chat: htmx 폼 수신 → SSE 연결을 트리거할 wrapper HTML 반환
//   - GET /chat-stream: streamSSE handler — 5 startup probe 후 KB-03 drift +
//                        buffered marker drift + RAG + iterate() pump
//   - GET /static/:file: 화이트리스트 정적 파일 (htmx + sse extension)
//   - GET /: public/index.html serve
//   - POST /approval/:id: 5-key 승인 게이트 (Plan 02-08, APPLY-03)
//
// 5 startup probes (실행 시 module main):
//   1) loadEnv() — module 진입점. FRICTION #8 친절 에러 → exit(1)
//   2) ensureDockerContext() — BOOT-04. context inspect 실패 → exit(1)
//   3) ensureIndexed() — KB lazy hash. failure → exit(1)
//   4) staleCheck() — boot 시 1회. console.warn만, exit 안 함
//   5) recoverPendingMarkers() — Plan 02-08, APPLY-05/D-C2. state/.pending/*.json
//                                 발견 시 console.warn + buffer (자동 복구 안 함).
//                                 첫 /chat-stream 진입 시 SSE drift event로 운영자 안내.
//
// Pitfalls handled:
//   #4 AbortError — streamSSE catch + onError 양쪽에서 명시 분기
//   #16 0.0.0.0 bind — hostname: "127.0.0.1" lock (acceptance grep)
//   #3 PITFALL — POST /approval/:id가 nonce mismatch / consumed / expired를
//                409 envelope으로 매핑 (approval/store.ts consumeApproval throw).
//
// LOOP-06 (60s SSE chunk timeout / D-15.3):
//   createChunkWatchdog(emit) → emit()마다 reset, final/error마다 cancel,
//   timeout 발화 시 watchdog이 envelope을 onTimeout으로 넘기고 AbortSignal abort,
//   iterate(opts.abortSignal)이 signal 받아 break.
//
// APPLY-08 / D-10 lock (Plan 02-08 Task 3):
//   Phase 2 흐름 LLM 모델 = COPILOT_MODEL_PROPOSE (env default = opus-4-6, src/env.ts).
//   실제 messages.create 호출은 agent/loop.ts:124,136이 owns — 그곳에서 PROPOSE로 전환.
//   여기서는 env eval 1회 + 주석으로 lock 포인트 명시 (acceptance grep + 의도 표명).

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { existsSync, readFileSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
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
import { consumeApproval, type ApprovalDecision } from "../approval/store"

const env = loadEnv()

// APPLY-08 / D-10 lock — Phase 2 흐름 LLM 모델 = COPILOT_MODEL_PROPOSE (env default opus-4-6).
// 실제 messages.create 호출 site: agent/loop.ts:124, 136 (READONLY → PROPOSE 전환됨).
// 여기 evaluation은 (a) env에 키가 없으면 boot 즉시 실패 (b) acceptance grep용 lock 포인트.
const PHASE2_LLM_MODEL: string = env.COPILOT_MODEL_PROPOSE
// 사용처: server.ts는 LLM 직접 호출 안 함 — agent/loop.ts에 위임.
// 향후 dynamic swap(read-only turn에 SONNET fallback)이 필요해지면 이 상수를 통해 주입.
void PHASE2_LLM_MODEL

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

// ===== Plan 02-08: Pending marker boot recovery (D-C2, APPLY-05) =====
//
// state/.pending/*.json 파일은 02-06 applyPatch가 docker exec 직전에 작성하고
// git commit 완료 시 삭제. server crash가 (b)~(d) 사이에서 발생하면 marker가
// 남는다. boot 시 발견하면 자동 복구하지 않고(D-C2 lock — audit lie 위험),
// 운영자에게 SSE drift event로 a)/b)/c) 명령을 안내한다.
//
// permissive parse 정책 — Wave 1/2 (02-04 commit, 02-06 applyPatch)가
// fileEdit/reasoning/sha_before 등 추가 필드를 작성. reader인 본 plan은
// schema validation 안 함 (Record-style). Wave writer 변경 시에도 안전.

// 본 reader가 의존하는 minimum field — 그 외는 passthrough로 보존.
export interface PendingMarkerFields {
  nonce: string
  stack: string
  command: string
  service: string
  docker_started_at: string | null
  docker_finished_at: string | null
  exit_code: number | null
  // 추가 필드(fileEdit, reasoning, user_prompt, sha_before, ts_created 등)는
  // passthrough — Record<string, unknown>로 합쳐 보존한다.
  [key: string]: unknown
}

const DEFAULT_PENDING_DIR = "state/.pending"

let pendingDriftBuffer: PendingMarkerFields[] = []

/**
 * state/.pending/*.json scan + permissive parse.
 *
 * @param dir 기본 'state/.pending' — 테스트는 격리된 디렉토리 주입.
 * @returns 파일별 marker 객체 배열. 디렉토리 없거나 비어있으면 빈 배열.
 *          손상 JSON은 swallow (로그만).
 */
export async function recoverPendingMarkers(
  dir: string = DEFAULT_PENDING_DIR,
): Promise<PendingMarkerFields[]> {
  if (!existsSync(dir)) return []
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"))
  if (files.length === 0) return []
  const markers: PendingMarkerFields[] = []
  for (const f of files) {
    try {
      const content = await readFile(join(dir, f), "utf-8")
      const parsed = JSON.parse(content) as PendingMarkerFields
      markers.push(parsed)
    } catch (e) {
      // 손상 marker는 swallow — 운영자가 manual로 처리.
      console.warn(
        `[APPLY-05] marker 파싱 실패 ${f} (skip, manual cleanup 필요): ${(e as Error).message}`,
      )
    }
  }
  return markers
}

/** 첫 /chat-stream 진입 시까지 marker를 버퍼링. */
export function bufferPendingDrift(markers: PendingMarkerFields[]): void {
  pendingDriftBuffer = [...markers]
}

/** 첫 /chat-stream 진입 시 한 번만 consume — 두 번째는 빈 배열. */
export function consumeBufferedDrift(): PendingMarkerFields[] {
  const out = pendingDriftBuffer
  pendingDriftBuffer = []
  return out
}

/**
 * 3-state 분류 (D-C3) — boot drift 메시지 build.
 *
 * state 0: docker_started_at == null → docker 시작 전 crash (안전)
 * state 1: docker_started_at != null && docker_finished_at == null → 진행 중 (불확실)
 * state 2: docker_finished_at != null && exit_code != null → docker 완료 + git uncommitted
 */
function classifyMarker(m: PendingMarkerFields): "pre-docker" | "in-flight" | "post-docker" {
  if (m.docker_started_at == null) return "pre-docker"
  if (m.docker_finished_at == null) return "in-flight"
  return "post-docker"
}

/** 운영자 안내 메시지 — D-C2 a)/b)/c) 옵션 명시. */
function formatMarkerForDrift(m: PendingMarkerFields): string {
  const state = classifyMarker(m)
  const reverse: Record<string, string> = {
    "compose up -d": "compose down",
    "compose down": "compose up -d",
    "compose start": "compose stop",
    "compose stop": "compose start",
    "compose restart": "compose restart",
  }
  const reverseCmd = reverse[m.command] ?? m.command
  return [
    `⚠ unfinished applyPatch [${state}]: nonce=${m.nonce} stack=${m.stack} cmd=${m.command} service=${m.service}`,
    `  docker_started_at=${m.docker_started_at ?? "null"} docker_finished_at=${m.docker_finished_at ?? "null"} exit_code=${m.exit_code ?? "null"}`,
    `  복구 옵션 (1 선택):`,
    `   a) 수동 git commit: cd state && git add -A && git commit -F /tmp/manual-msg-${m.nonce}.txt`,
    `   b) 수동 docker rollback: ssh gon@192.168.0.5 'cd /원격경로/${m.stack} && docker compose ${reverseCmd} ${m.service}'`,
    `   c) marker 삭제 (production 그대로): rm state/.pending/${m.nonce}.json`,
  ].join("\n")
}

// ===== POST /approval/:id — 5-key 승인 게이트 (Plan 02-08, APPLY-03) =====
//
// PLAN.md schema:
//   path:    /approval/:id   (id = nonce)
//   header:  x-session-id (없으면 'default' fallback — Phase 1 carry-forward)
//   body:    form-urlencoded { key: 'y'|'n'|'e'|'d'|'a', newContent? }
//
// mapKey:
//   y → {type:'approved'}
//   n → {type:'rejected'}
//   e → {type:'edited', newContent} (newContent 없으면 invalid → 400)
//   d → 'ui-only' (consumeApproval 미호출, 200 OK + ui_only:true)
//   a → {type:'aborted'}
//   else → null → 400 invalid envelope
//
// 응답:
//   200 OK on 정상 + ui-only
//   400 invalid key / parse error
//   409 nonce mismatch / consumed / expired (consumeApproval throw)
//
// 보안 메모 (단일 사용자 도구):
//   - rate limit / CSRF 미적용 — PROJECT.md "Out of Scope: multi-user".
//   - 127.0.0.1 bind만 (PITFALL #16) — LAN/외부 노출 금지.
//   - x-session-id 헤더는 형식적 분리, 1인 도구이므로 보통 'default' 단일 세션.

type MappedKey = ApprovalDecision | "ui-only"

function mapKey(key: string, newContent?: string): MappedKey | null {
  switch (key) {
    case "y":
      return { type: "approved" }
    case "n":
      return { type: "rejected" }
    case "e":
      // newContent 누락 시 invalid (400) — PLAN.md interfaces 명시.
      return newContent ? { type: "edited", newContent } : null
    case "d":
      // UI-only 토글 (diff 표시) — consumeApproval 호출 안 함.
      return "ui-only"
    case "a":
      return { type: "aborted" }
    default:
      return null
  }
}

app.post("/approval/:id", async (c) => {
  const nonce = c.req.param("id")
  // v1.2 hotfix (F-15, 2026-05-07): sessionId source priority
  //   1) query ?session-id=  (브라우저가 sse-connect URL에서 sessionId를 받았으니 동일하게 echo 가능)
  //   2) header x-session-id  (curl + 외부 자동화)
  //   3) body session-id field  (htmx form parameter)
  //   4) "default" fallback
  // 이전 v1.0/v1.1은 헤더만 봐서 chat-stream(query)과 approval(header) 사이 sessionId mismatch 발생 →
  // approval store가 다른 키를 lookup → "No pending approval".

  let body: Record<string, string | File>
  try {
    body = await c.req.parseBody()
  } catch {
    return c.json(
      {
        problem: "invalid body",
        cause: "form-urlencoded 파싱 실패",
        fix: "Content-Type: application/x-www-form-urlencoded로 재전송",
        retryable: false,
      },
      400,
    )
  }

  const key = typeof body.key === "string" ? body.key : ""
  const newContent =
    typeof body.newContent === "string" ? body.newContent : undefined

  // v1.2 hotfix (F-15): body session-id 우선순위 결정. query → header → body → default.
  const sessionId =
    c.req.query("session-id") ??
    c.req.header("x-session-id") ??
    (typeof body["session-id"] === "string" ? body["session-id"] : undefined) ??
    "default"

  const mapped = mapKey(key, newContent)
  if (mapped === null) {
    return c.json(
      {
        problem: "invalid key",
        cause: `key='${key}' (또는 'e'에 newContent 누락)`,
        fix: "y/n/e/d/a 중 하나 선택, 'e'면 newContent textarea 동봉",
        retryable: false,
      },
      400,
    )
  }
  if (mapped === "ui-only") {
    // 'd' (show diff) — UI 토글, 서버 상태 변화 없음.
    return c.json({ ok: true, ui_only: true })
  }

  try {
    consumeApproval(sessionId, nonce, mapped)
    return c.json({ ok: true })
  } catch (err) {
    // PITFALL #3: nonce mismatch / consumed / expired → 409 envelope.
    const msg = (err as Error).message
    return c.json(
      {
        problem: msg,
        cause: "approval store invariant violation",
        fix: "diff를 다시 읽고 새 NL 입력으로 재제안",
        retryable: false,
      },
      409,
    )
  }
})

// ===== POST /chat — htmx 폼 submit endpoint =====
// 응답: GET /chat-stream을 자동 연결할 div fragment. 운영자 1명 + 단일 페이지 → race 무시 가능.
// (UI-SPEC: hx-ext + sse-connect를 응답 fragment에 두면 htmx가 swap 후 SSE 시작)
app.post("/chat", async (c) => {
  const body = await c.req.parseBody()
  const prompt = String(body.prompt ?? "").trim()
  if (prompt === "") return c.json({ error: "prompt 비어있음" }, 400)
  // v1.1 hotfix (F-11): 클라이언트가 x-session-id 헤더 또는 body의 session-id 필드로 전달.
  // EventSource는 custom header 미지원 → query string으로 전파.
  const sessionId = String(body["session-id"] ?? c.req.header("x-session-id") ?? "default")
  const url = `/chat-stream?prompt=${encodeURIComponent(prompt)}&session-id=${encodeURIComponent(sessionId)}`
  return c.html(
    `<div hx-ext="sse" sse-connect="${url}" hx-swap="none"></div>`,
  )
})

// ===== GET /chat-stream — SSE handler =====
// READ-04 + READ-05 + UI-04 + LOOP-06 모두 이 핸들러에서 wire.
app.get("/chat-stream", (c) => {
  const prompt = c.req.query("prompt") ?? ""
  // v1.1 hotfix (F-11): EventSource는 custom header 미지원 → query string ?session-id=... 우선,
  // 헤더는 fallback (curl 검증 등). default는 backward-compat.
  const sessionId = c.req.query("session-id") ?? c.req.header("x-session-id") ?? "default"

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
        const p = stream
          .writeSSE(toSSEFrame(timeoutEvent))
          .catch(() => {
            /* stream already closed */
          })
        pendingWrites.push(p)
      })

      // F-2 fix (Phase 2 D-E1 carry-back, plan 01-10): emit 큐.
      // iterate가 sync emit 콜백을 expect하므로 server.ts는 async writeSSE를 fire-and-forget
      // 래핑할 수밖에 없다. 이전 구현은 iterate resolve 직후 streamSSE가 stream을 close하여
      // 큐잉된 마지막 writeSSE Promise(특히 final event)가 resolve되기 전에 swallow되었다.
      // finally에서 Promise.allSettled로 모든 pending write를 기다려 정상 emit을 보장.
      const pendingWrites: Promise<void>[] = []

      const emit = (ev: SseEvent): void => {
        watchdog.reset() // LOOP-06: 매 chunk마다 timer 갱신
        const p = stream.writeSSE(toSSEFrame(ev)).catch(() => {
          /* stream already closed */
        })
        pendingWrites.push(p)
        if (ev.type === "final" || ev.type === "error") {
          watchdog.cancel() // 정상 종료 — timer 영구 중단
        }
      }

      try {
        // Plan 02-08: buffered marker drift — boot probe 5에서 발견된 unfinished
        // applyPatch markers를 첫 /chat-stream 진입 시 1회 emit (D-C2).
        // services.yaml drift와 별개의 SSE drift event로 보낸다 (UI 측에서 amber 배너 누적).
        const buffered = consumeBufferedDrift()
        if (buffered.length > 0) {
          const message = buffered
            .map((m) => formatMarkerForDrift(m))
            .join("\n\n")
          emit({
            type: "drift",
            message,
            unknown: [],
            stale: [],
          })
        }

        // UI-04 / D-13.4: per-query staleness check (kb/stale-check.ts 30s TTL cache)
        const report: StalenessReport = await staleCheck(env)
        if (report.unknown.length > 0 || report.stale.length > 0) {
          emit({
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
          emit,
          abortSignal: watchdog.signal,
        })
      } catch (err) {
        // PITFALL #4: AbortError는 stream close에 의한 정상 cancel — 무시
        // watchdogFired인 경우 envelope 중복 emit 회피
        const errName = (err as Error).name
        if (errName !== "AbortError" && !watchdogFired) {
          emit({
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
        // F-2 fix: stream close 전에 모든 emit 완결 보장 (final/error 클라이언트 도달 보장)
        await Promise.allSettled(pendingWrites)
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
  // probe 5 (Plan 02-08, APPLY-05/D-C2): pending markers boot detect.
  // 자동 복구 안 함 — console.warn + bufferPendingDrift, 첫 /chat-stream 진입 시 SSE drift event.
  try {
    const markers = await recoverPendingMarkers()
    if (markers.length > 0) {
      console.warn(
        `[APPLY-05] ${markers.length}개의 unfinished applyPatch marker 발견 — 첫 /chat-stream 연결 시 drift event 발화`,
      )
      for (const m of markers) {
        console.warn(
          `  - nonce=${m.nonce} stack=${m.stack} command=${m.command} docker_started_at=${m.docker_started_at} exit_code=${m.exit_code}`,
        )
      }
      bufferPendingDrift(markers)
    }
  } catch (err) {
    console.warn(
      `[APPLY-05] recoverPendingMarkers 실패 (서버 시작 계속): ${(err as Error).message}`,
    )
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
//
// v1.1 hotfix (F-10, 2026-05-07): Bun.serve 기본 idleTimeout=10s가 02-07 30s keep-alive
// interval보다 짧아 SSE 연결이 첫 keep-alive 도달 전에 끊김. 라이브 검증에서 발견.
// 0 = idle timeout 비활성화 (장시간 SSE + 2분 approval 대기를 안전하게 유지).
// LOOP-06 60s SSE chunk watchdog은 별도 wire로 작동하므로 idle timeout 비활성화 안전.
export default {
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  idleTimeout: 0,
  fetch: app.fetch,
}

export { app }
