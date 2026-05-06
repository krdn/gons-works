# Phase 1: Read-Only Knowledge Layer — Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 16 (new or modified)
**Analogs found:** 13 / 16 (3 have no direct analog; use ARCHITECTURE.md excerpts)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server.ts` | route/middleware | request-response + streaming | `spikes/03-sse-roundtrip/server.ts` | role-match |
| `agent/loop.ts` | service | event-driven (tool-use loop) | `spikes/06-proxy-fallback.smoke.ts` + `spikes/06-proxy-fallback.test.ts` | partial-match (composite) |
| `agent/sse.ts` | utility | streaming | `spikes/03-sse-roundtrip/server.ts` | partial-match |
| `tools/_envelope.ts` | middleware | request-response | `src/env.ts` (EnvProblem shape) | partial-match (shape only) |
| `tools/_index.ts` | config/barrel | transform | `spikes/05-zod-schema.test.ts` | role-match |
| `tools/listContainers.ts` | service | file-I/O (subprocess) | `scripts/draft-services-yaml.ts` | exact |
| `tools/readLogs.ts` | service | file-I/O (subprocess + sanitize) | `scripts/draft-services-yaml.ts` | role-match |
| `tools/readCompose.ts` | service | file-I/O (SSH subprocess) | `spikes/04-git-commit.test.ts` (Bun.$ pattern) | partial-match |
| `kb/schema.ts` | model | transform | `src/env.ts` (Zod schema pattern) | role-match |
| `kb/chunker.ts` | utility | transform | `spikes/02-voyage-embed.smoke.ts` (chunk shape) | partial-match |
| `kb/index.ts` | service | batch + CRUD (SQLite) | `spikes/02-voyage-embed.smoke.ts` | role-match |
| `kb/stale-check.ts` | service | batch (semantic diff) | `spikes/01-docker-context.smoke.ts` + `scripts/draft-services-yaml.ts` | partial-match |
| `audit/schema.sql` | migration | CRUD | no analog | none |
| `audit/log.ts` | service | CRUD (SQLite) | no analog (STACK.md + PITFALLS.md patterns) | none |
| `public/index.html` | component | streaming (SSE) | `spikes/03-sse-roundtrip/index.html` | role-match (expand events) |
| `scripts/draft-services-yaml.ts` | script/utility | batch | existing file — narrow modification only | existing |

---

## Pattern Assignments

---

### `server.ts` (route, request-response + streaming)

**Analog:** `spikes/03-sse-roundtrip/server.ts`

**Imports pattern** (analog lines 1-5):
```typescript
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { loadEnv } from "./src/env"
import { ensureDockerContext } from "./src/docker-context-check"
```

**Core SSE route pattern** (analog lines 19-40):
```typescript
// Phase 1 server.ts /chat route — thin pump pattern.
// agent/loop.ts가 모든 Claude 로직 소유. route는 pump만.
app.post("/chat", (c) => {
  return streamSSE(c, async (stream) => {
    const { prompt } = await c.req.parseBody()
    // stale check → drift SSE 먼저
    // RAG retrieval → context
    // iterate(prompt, context, (ev) => stream.writeSSE(...))
  }, async (err, stream) => {
    // PITFALL #4: AbortError는 조용히 무시, 나머지는 SSE error event
    if ((err as Error).name !== "AbortError") {
      await stream.writeSSE({ event: "error", data: JSON.stringify({ problem: String(err) }) })
    }
  })
})
```

**Startup probe pattern** (`src/docker-context-check.ts` lines 1-22):
```typescript
// server.ts 시작 시 두 번째 probe (src/docker-context-check.ts 재사용)
const ctx = env.DOCKER_CONTEXT   // from loadEnv() — NEVER process.env directly
const dockerCheck = await ensureDockerContext(ctx)
if (!dockerCheck.ok) {
  console.error("[BOOT-04]", dockerCheck.problem)
  process.exit(1)
}
```

**Static file serve + bind 127.0.0.1 (PITFALL #16)**:
```typescript
// static 파일 서빙: node_modules에서 htmx/sse.js 복사 또는 직접 CDN
app.get("/static/:file", ...)

export default {
  hostname: "127.0.0.1",  // PITFALL #16: 절대 "0.0.0.0" 불가
  port: Number(Bun.env.PORT ?? 3000),
  fetch: app.fetch,
}
```

**Differences from analog:** Phase 1 server는 POST /chat (not GET), startup probes 2개 (loadEnv + ensureDockerContext), SSE error handler (analog에는 없음), 127.0.0.1 bind.

**Pitfalls to watch:** #4 (AbortError → server crash), #16 (0.0.0.0 bind).

---

### `agent/loop.ts` (service, event-driven tool-use loop)

**Analog:** `spikes/06-proxy-fallback.smoke.ts` (lines 37-117) + `spikes/06-proxy-fallback.test.ts` (lines 23-37)

**SDK client construction pattern** (`spikes/06-proxy-fallback.smoke.ts` lines 37-41):
```typescript
import Anthropic from "@anthropic-ai/sdk"
import { loadEnv } from "../src/env"

const env = loadEnv()
const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  baseURL: env.ANTHROPIC_BASE_URL,   // D-09: cli-proxy-api 기본
})
```

**D-11 fallback retry pattern** (`spikes/06-proxy-fallback.test.ts` lines 23-37):
```typescript
// callWithFallback — primary 실패 시 fallback 호출
async function callWithFallback(cfg: FallbackConfig): Promise<CallResult> {
  try {
    return await cfg.primary()
  } catch (primaryErr) {
    if (!cfg.fallback) throw primaryErr
    try {
      return await cfg.fallback()
    } catch (fallbackErr) {
      throw new Error(
        `primary 실패 + fallback 실패. primary: ${(primaryErr as Error).message} / fallback: ${(fallbackErr as Error).message}`
      )
    }
  }
}
```

**messages.stream async iterable pattern** (`spikes/06-proxy-fallback.smoke.ts` lines 96-113):
```typescript
const stream = client.messages.stream({
  model: env.COPILOT_MODEL_READONLY,
  max_tokens: 50,
  messages: [{ role: "user", content: "..." }],
})
let deltaCount = 0
for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    deltaCount++
    // emit text-delta SSE
  }
}
const finalMsg = await stream.finalMessage()
// finalMsg.stop_reason === "end_turn" → break loop
```

**Core tool-use loop** (ARCHITECTURE.md Pattern 3, lines 194-217 — no codebase analog yet):
```typescript
// agent/loop.ts 골격 (ARCHITECTURE.md Pattern 3 직접 적용)
export async function iterate(
  prompt: string,
  context: string,      // RAG 검색 결과
  emit: (ev: SseEvent) => void
): Promise<void> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }]
  let toolIterations = 0
  while (true) {
    // PITFALL #5: MAX_TOOL_ITERATIONS hard cap
    if (toolIterations > MAX_TOOL_ITERATIONS) {
      emit({ type: "error", problem: "도구 호출 한도 초과", cause: "", fix: "" })
      break
    }
    const response = await callWithFallback({
      primary: () => primaryClient.messages.create({ messages, tools: toolSchemas, ... }),
      fallback: hasFallback(env) ? () => fallbackClient.messages.create(...) : undefined,
    })
    for (const block of response.content) {
      if (block.type === "text") emit({ type: "text-delta", delta: block.text })
      if (block.type === "tool_use") {
        emit({ type: "tool-start", name: block.name, args: block.input })
        // PITFALL #1: try-catch 항상 tool_result push (never throw without result)
        let result: unknown
        try {
          result = await dispatch(block.name, block.input)
        } catch (err) {
          result = { problem: String(err), cause: "dispatch failed", fix: "retry", retryable: true }
        }
        const ok = !isToolError(result)
        emit({ type: "tool-result", name: block.name, ok, summary: summarize(result) })
        messages.push({ role: "assistant", content: response.content })
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) }] })
        toolIterations++
      }
    }
    // PITFALL #5: history compaction
    messages = compactHistory(messages)
    if (response.stop_reason === "end_turn") break
  }
  emit({ type: "final" })
}
```

**Differences from analog:** loop.ts는 spike 2개를 합성. callWithFallback + messages.stream 패턴에 tool-use loop 골격을 추가. history compaction + hard caps는 신규.

**Pitfalls to watch:** #1 (orphan tool_use — 항상 tool_result push), #4 (SSE 재연결 dedup — sessionId+queryHash 키), #5 (token runaway — MAX_TOOL_ITERATIONS=8, MAX_HISTORY_TOKENS=50K, SESSION_CALL_LIMIT=30).

---

### `agent/sse.ts` (utility, streaming)

**Analog:** `spikes/03-sse-roundtrip/server.ts` (lines 19-40) — event naming convention

**SseEvent type union** (ARCHITECTURE.md Pattern 1, lines 138-149 — no codebase analog):
```typescript
// agent/sse.ts — Phase 1 event taxonomy (6 event types)
export type SseEvent =
  | { type: "text-delta";   delta: string }
  | { type: "tool-start";   name: string; args: unknown }
  | { type: "tool-result";  name: string; ok: boolean; summary: string }
  | { type: "final" }
  | { type: "error";        problem: string; cause: string; fix: string }
  | { type: "drift";        message: string }   // KB-03 staleness

export function toSSEFrame(ev: SseEvent): { event: string; data: string } {
  return { event: ev.type, data: JSON.stringify(ev) }
}
```

**streamSSE write pattern** (analog lines 28-34):
```typescript
// spikes/03-sse-roundtrip/server.ts에서 직접 가져옴
await stream.writeSSE({
  event: "text-delta",
  data: JSON.stringify({ text: chunk }),
})
```

**60s chunk timeout + finally-close** (PITFALL #4 — ARCHITECTURE.md Scaling section):
```typescript
// agent/sse.ts에서 관리하거나 server.ts loop wrapper에서 관리
const CHUNK_TIMEOUT_MS = 60_000
// streamSSE handler에 타임아웃 래퍼 — 60s 무응답 시 error event emit + stream close
```

**Differences from analog:** spike는 2 이벤트(text-delta, final)만. Phase 1은 6 이벤트(위 union 참조). `drift` 이벤트 추가 (D-13.4).

**Pitfalls to watch:** #4 (재연결 시 중복 Claude API call), #12 (SSH/long-tool keepalive).

---

### `tools/_envelope.ts` (middleware, request-response)

**Analog:** `src/env.ts` lines 32-36 (EnvProblem shape — 가장 유사한 error shape)

**EnvProblem shape** (`src/env.ts` lines 32-36):
```typescript
export interface EnvProblem {
  problem: string
  cause: string
  fix: string
}
```

**ToolError shape — EnvProblem + retryable** (ARCHITECTURE.md Pattern 2, lines 162-168):
```typescript
// src/env.ts의 EnvProblem에 retryable: boolean 추가
export interface ToolError {
  problem: string    // 무엇이 실패했는지
  cause: string      // 왜 (stack-safe excerpt)
  fix: string        // "retry" | "SSH 점검" | shell 명령 verbatim
  retryable: boolean
}

export function isToolError(x: unknown): x is ToolError {
  return typeof x === "object" && x !== null && "problem" in x && "retryable" in x
}
```

**AbortController wrapper** (ARCHITECTURE.md Pattern 2, lines 169-183):
```typescript
export async function run<T>(
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 30_000
): Promise<T | ToolError> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fn(ac.signal)
  } catch (err) {
    clearTimeout(timer)
    // PITFALL #1: 절대 throw — 항상 ToolError 반환
    if ((err as Error).name === "AbortError") {
      return {
        problem: `tool ${name} timeout ${timeoutMs / 1000}s`,
        cause: "서버 도달·응답 지연",
        fix: "재시도 또는 SSH/docker context 상태 점검",
        retryable: true,
      }
    }
    return {
      problem: `tool ${name} 실패`,
      cause: (err as Error).message.slice(0, 200),
      fix: "로그 확인 후 재시도",
      retryable: true,
    }
  } finally {
    clearTimeout(timer)
  }
}
```

**AUDIT hook** (D-14.4 — audit/log.ts 연동):
```typescript
// _envelope.ts의 run()이 audit logTool 호출 책임
// run() 내부에서 beginTime → await fn() → logTool(parentId, name, input, result, ok, duration)
```

**Differences from analog:** `src/env.ts`는 startup-only, one-shot. `_envelope.ts`는 per-call wrapper, generic `<T>`, AbortController, audit 연동.

**Pitfalls to watch:** #1 (orphan tool_use — catch path 반드시 ToolError 반환, never throw), #12 (timeout AbortError → envelope).

---

### `tools/_index.ts` (config/barrel, transform)

**Analog:** `spikes/05-zod-schema.test.ts` lines 8-17 (listContainers schema) + lines 63-69 (Anthropic 호환 검증)

**Zod v4 schema → Anthropic tool pattern** (`spikes/05-zod-schema.test.ts` lines 8-17, 63-69):
```typescript
import { z } from "zod"
import type Anthropic from "@anthropic-ai/sdk"

// Phase 1의 3 read tool input schema 정의
const ListContainersInput = z.object({
  filter: z.object({
    state: z.enum(["running", "stopped", "all"]).default("running"),
    namePattern: z.string().optional(),
  }).optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

const ReadLogsInput = z.object({
  containerName: z.string().min(1),
  lines: z.number().int().min(1).max(1000).default(200),
  since: z.string().optional(),   // ISO datetime
  until: z.string().optional(),
})

const ReadComposeInput = z.object({
  composePath: z.string().min(1),  // remote path on 192.168.0.5
})

// z.toJSONSchema() — Zod v4 내장 (패키지 추가 금지 — STACK.md + DESIGN.md correction #3)
export const TOOL_SCHEMAS: Anthropic.Tool[] = [
  {
    name: "listContainers",
    description: "...",
    input_schema: z.toJSONSchema(ListContainersInput) as Anthropic.Tool["input_schema"],
  },
  // readLogs, readCompose 동일 패턴
]

// 각 tool의 입력 타입 (handler에서 사용)
export type ListContainersArgs = z.infer<typeof ListContainersInput>
export type ReadLogsArgs = z.infer<typeof ReadLogsInput>
export type ReadComposeArgs = z.infer<typeof ReadComposeInput>
```

**Differences from analog:** spike는 단일 스키마 테스트. `_index.ts`는 3개 스키마 + TOOL_SCHEMAS 배열 export.

**Pitfalls to watch:** 없음 (schema 정의만). `z.toJSONSchema` (대문자 JSON) 사용 — `z.toJsonSchema` (소문자) 아님.

---

### `tools/listContainers.ts` (service, file-I/O subprocess)

**Analog:** `scripts/draft-services-yaml.ts` lines 39-52 (docker ps 호출 패턴)

**docker --context 호출 패턴** (`scripts/draft-services-yaml.ts` lines 39-52):
```typescript
import { $ } from "bun"
import { loadEnv } from "../src/env"

const env = loadEnv()
const ctx = env.DOCKER_CONTEXT   // PITFALL #8: loadEnv()에서 읽기, process.env 직접 아님

// Bun.$ template literal로 --context 명시적 전달
const raw = await $`docker --context ${ctx} ps -a --format json`.text()

// NDJSON 파싱 (docker ps --format json은 줄 단위)
const rows = raw
  .trim()
  .split("\n")
  .filter((l) => l.length > 0)
  .map((l) => JSON.parse(l))
```

**_envelope.ts wrapper 적용 패턴**:
```typescript
import { run } from "./_envelope"
import type { ListContainersArgs } from "./_index"

export async function listContainers(
  args: ListContainersArgs,
  _signal: AbortSignal
): Promise<DockerContainer[]> {
  // 실제 구현: Bun.$ docker --context ${ctx} ps
  // _envelope.ts의 run()이 이 함수를 래핑하고 timeout + audit 처리
}

// agent/loop.ts dispatch()에서 호출:
// const result = await run("listContainers", (signal) => listContainers(args, signal))
```

**Differences from analog:** `draft-services-yaml.ts`는 standalone script. `listContainers.ts`는 `_envelope.ts`의 `run()`에 의해 래핑되고 audit log 자동 적용.

**Pitfalls to watch:** #8 (DOCKER_CONTEXT 항상 `env.DOCKER_CONTEXT`로, process.env 직접 아님).

---

### `tools/readLogs.ts` (service, file-I/O + sanitize)

**Analog:** `scripts/draft-services-yaml.ts` lines 45-50 (Bun.$ docker 호출) + PITFALLS.md #6 prevention block

**docker logs 호출 패턴** (draft-services-yaml.ts 방식 확장):
```typescript
// --since/--until으로 시간 범위 필터
const raw = await $`docker --context ${ctx} logs --tail ${lines} ${containerName}`.text()
```

**Log sanitization pattern** (PITFALLS.md #6 prevention block, lines 278-309):
```typescript
const SENSITIVE_PATTERNS = [
  /\b(API_KEY|SECRET|PASSWORD|TOKEN|BEARER|AUTH)\s*[:=]\s*\S+/gi,
  /sk-[a-zA-Z0-9]{20,}/g,   // OpenAI-style API keys
  /eyJ[a-zA-Z0-9_-]{20,}/g, // JWT tokens
]

// 주입 시도 라인은 통째로 DROP
const INJECTION_MARKERS = [
  /SYSTEM\s+(OVERRIDE|PROMPT|MESSAGE)\s*:/i,
  /ignore\s+prior\s+context/i,
  /<\|im_start\|>/i,
  /\[INST\]/i,
]

export function sanitizeLogs(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !INJECTION_MARKERS.some((p) => p.test(line)))
    .map((line) => SENSITIVE_PATTERNS.reduce((l, p) => l.replace(p, "[REDACTED]"), line))
    .join("\n")
}
```

**Differences from analog:** draft-services-yaml.ts는 sanitize 없음. readLogs.ts는 _envelope.ts 래핑 + sanitize 필수.

**Pitfalls to watch:** #6 (log injection + secret leakage), #8 (DOCKER_CONTEXT 명시적 전달).

---

### `tools/readCompose.ts` (service, file-I/O via SSH)

**Analog:** `spikes/04-git-commit.test.ts` lines 14-25 (Bun.$ cwd/shell option 패턴) + PITFALLS.md #12 prevention block

**Bun.$ SSH 호출 + timeout 패턴** (PITFALLS.md #12 prevention block, lines 545-568):
```typescript
import { $ } from "bun"

const SSH_TIMEOUT_MS = 15_000

async function sshReadFile(remotePath: string, signal: AbortSignal): Promise<string> {
  const proc = Bun.spawn(
    [
      "ssh",
      "-o", "ConnectTimeout=10",
      "-o", "ServerAliveInterval=5",
      "-o", "ServerAliveCountMax=2",
      "-o", "BatchMode=yes",
      "gon@192.168.0.5",
      "cat",
      remotePath,
    ],
    { stdout: "pipe", stderr: "pipe" }
  )
  // _envelope.ts의 AbortController가 30s로 proc.kill 담당
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text()
    throw new Error(`SSH 실패 (exit ${exitCode}): ${errText.slice(0, 200)}`)
  }
  return new Response(proc.stdout).text()
}
```

**Differences from analog:** spike 4는 git shell-out (동일 호스트). readCompose는 SSH + explicit SSH flags.

**Pitfalls to watch:** #12 (SSH 타임아웃 — ConnectTimeout=10, ServerAliveInterval=5, _envelope.ts 30s AbortController와 협력).

---

### `kb/schema.ts` (model, transform)

**Analog:** `src/env.ts` lines 1-30 (Zod schema + infer + safeParse 패턴)

**Zod schema + infer pattern** (`src/env.ts` lines 8-30):
```typescript
import { z } from "zod"

// src/env.ts에서 직접 학습: z.object + .default() + .optional() + safeParse
export const StackSchema = z.object({
  purpose: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
  volumes: z.array(z.string()).default([]),
  normal_log_pattern: z.string().default(""),
  key_log_locations: z.array(z.string()).default([]),
  containers: z.array(z.object({
    name: z.string(),
    image: z.string(),
    state: z.string(),
    status: z.string(),
  })).default([]),
})

export const ServicesYamlSchema = z.object({
  generated_at: z.string(),
  generated_from: z.string(),
  stacks: z.record(z.string(), StackSchema),   // D-12.4: stacks만 RAG 인덱싱
  unmatched_containers: z.array(z.object({
    name: z.string(),
    image: z.string(),
    state: z.string(),
  })).optional(),
})

export type ServicesYaml = z.infer<typeof ServicesYamlSchema>
export type Stack = z.infer<typeof StackSchema>
```

**Differences from analog:** `src/env.ts`는 process env용 스키마. `kb/schema.ts`는 YAML 파일 파싱용. 동일 Zod 패턴, 대상 다름.

**Pitfalls to watch:** D-12.4 — `stacks` 만 RAG 인덱싱, `unmatched_containers`는 future v2.

---

### `kb/chunker.ts` (utility, transform)

**Analog:** `spikes/02-voyage-embed.smoke.ts` lines 36-40 (chunk text format)

**자연어 chunk format** (`spikes/02-voyage-embed.smoke.ts` lines 36-40):
```typescript
// Spike 2가 검증한 자연어 chunk 형식 — 한국어 문장 + stack 식별자 prefix
const docs = [
  "ais-prod redis는 ais-prod-web과 ais-prod-worker가 사용하는 caching layer다.",
  "news-prod는 RSS 수집기 + 요약 worker로 구성되며 5433 포트의 news-postgres에 저장한다.",
]
// top-1 sim=0.6308 (SPIKE-2-RESULT.md baseline)
```

**D-13.1/D-13.2 chunker 구현**:
```typescript
import type { Stack } from "./schema"

export interface Chunk {
  id: string
  text: string    // 자연어 한 문장 + stack 식별자 prefix (D-13.2)
  metadata: {
    stack: string
    field: "purpose" | "depends_on" | "volumes" | "normal_log_pattern" | "key_log_locations"
  }
}

const FIELD_TEMPLATES: Record<string, (stack: string, val: unknown) => string> = {
  depends_on: (s, v) => `${s} stack은 ${(v as string[]).join(", ")}에 의존한다.`,
  volumes: (s, v) => `${s} stack의 볼륨: ${(v as string[]).join(", ")}.`,
  normal_log_pattern: (s, v) => `${s} stack의 normal_log_pattern: "${v}". 이 패턴이 안 보이면 이상.`,
  key_log_locations: (s, v) => `${s} 디버깅 시 확인할 컨테이너: ${(v as string[]).join(", ")}.`,
  purpose: (s, v) => `${s} stack: ${v}.`,
}

export function chunkStack(stackName: string, stack: Stack): Chunk[] {
  // D-13.1: 필드 단위 청크 (~5 chunks per stack, ~25 total)
  return Object.entries(FIELD_TEMPLATES).map(([field, template]) => ({
    id: `${stackName}:${field}`,
    text: template(stackName, stack[field as keyof Stack]),
    metadata: { stack: stackName, field: field as Chunk["metadata"]["field"] },
  }))
}
```

**Differences from analog:** spike는 3개 고정 docs. chunker.ts는 5 스택 × 5 필드 = ~25 청크를 동적 생성.

**Pitfalls to watch:** #15 (RAG recall 저하 — 반드시 필드 단위 청크, stack 단위 big chunk 금지).

---

### `kb/index.ts` (service, batch + CRUD)

**Analog:** `spikes/02-voyage-embed.smoke.ts` lines 28-103 (VoyageAIClient + cosine similarity)

**VoyageAI 임베딩 호출 패턴** (`spikes/02-voyage-embed.smoke.ts` lines 43-65):
```typescript
import { VoyageAIClient } from "voyageai"

const client = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY })

// document 임베딩
const docResp = await client.embed({
  input: chunks,       // string[]
  model: "voyage-4-lite",
  inputType: "document",
})
const docVectors = (docResp.data ?? []).map((d) => d.embedding ?? [])

// query 임베딩
const queryResp = await client.embed({
  input: [query],
  model: "voyage-4-lite",
  inputType: "query",   // document vs query — 다름 (중요)
})
const queryVector = queryResp.data?.[0]?.embedding ?? []
```

**cosineSimilarity** (`spikes/02-voyage-embed.smoke.ts` lines 12-26):
```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("벡터 차원 불일치")
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
```

**bun:sqlite 초기화 패턴** (STACK.md lines 165-178 + PITFALLS.md #10 prevention block lines 464-475):
```typescript
import { Database } from "bun:sqlite"

// PITFALL #10: strict:true + safeIntegers:true 필수
const db = new Database("./data/copilot.db", {
  strict: true,        // 오타 바인딩 → throw (NULL 묵음 아님)
  safeIntegers: true,  // INTEGER 컬럼 → bigint (정밀도 손실 방지)
  create: true,
})
db.run("PRAGMA journal_mode = WAL")
db.run("PRAGMA synchronous = NORMAL")

// kb_meta: 마지막 hash 저장 (D-13.3 lazy indexing)
db.run(`CREATE TABLE IF NOT EXISTS kb_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
// kb_chunks: embedding 벡터 저장 (1024 dim, blob)
db.run(`CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  stack TEXT NOT NULL,
  field TEXT NOT NULL,
  embedding BLOB NOT NULL    -- 1024 float32 값, JSON array로 저장
)`)
```

**D-13.3 hash-based lazy indexing**:
```typescript
// boot 시 SHA-256 hash 비교 → 다르면 재인덱싱
import { createHash } from "node:crypto"

export async function ensureIndexed(): Promise<void> {
  const yaml = await Bun.file("state/services.yaml").text()
  const hash = createHash("sha256").update(yaml).digest("hex")
  const stored = db.prepare("SELECT value FROM kb_meta WHERE key = 'yaml_hash'").get({}) as { value: string } | null
  if (stored?.value === hash) return  // fast path
  // 재인덱싱: voyageai embed → kb_chunks UPSERT
  ...
  db.prepare("INSERT OR REPLACE INTO kb_meta VALUES ('yaml_hash', $hash)").run({ $hash: hash })
}
```

**Differences from analog:** spike는 in-memory 계산. `kb/index.ts`는 SQLite 영속화 + hash lazy indexing + top-k query 함수 추가.

**Pitfalls to watch:** #10 (bun:sqlite strict mode 필수), #15 (per-field chunking — `kb/chunker.ts` 사용).

---

### `kb/stale-check.ts` (service, batch semantic diff)

**Analog:** `scripts/draft-services-yaml.ts` lines 63-70 (docker ps 파싱 + 5 stack 분류)

**Docker ps 파싱 + Set difference 패턴** (`scripts/draft-services-yaml.ts` lines 63-70):
```typescript
// draft-services-yaml.ts에서 학습: docker ps NDJSON 파싱 + 분류
const grouped = new Map<string, DockerPsRow[]>()
const unmatched: DockerPsRow[] = []
for (const r of rows) {
  const key = classifyStack(r.Names)   // 정규식으로 stack 식별
  if (key) grouped.get(key)!.push(r)
  else unmatched.push(r)
}
```

**StalenessReport 구현** (ARCHITECTURE.md lines 396-408 알고리즘):
```typescript
export interface StalenessReport {
  unknown: string[]   // docker-only (yaml에 없음)
  stale: string[]     // yaml-only (docker에 없음)
  drifted: string[]   // 양쪽 있지만 image/ports 다름
}

export async function staleCheck(
  env: Env,
  cache: Map<string, { report: StalenessReport; ts: number }>
): Promise<StalenessReport> {
  const CACHE_TTL = 30_000
  const cached = cache.get("stale")
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.report

  // docker ps
  const raw = await $`docker --context ${env.DOCKER_CONTEXT} ps -a --format json`.text()
  const containers = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))

  // services.yaml 파싱
  const yaml = ServicesYamlSchema.parse(load(await Bun.file("state/services.yaml").text()))

  const dockerNames = new Set(containers.map((c: { Names: string }) => c.Names))
  const yamlKeys = new Set(Object.keys(yaml.stacks))

  // 주의: state/services.yaml의 stacks 키(news/ais/n8n 등)와 docker container 이름(news-prod-*)은
  // 1:1 매핑이 아님. classifyStack(containerName) 로 stack key 도출 후 비교.
  const unknown = containers
    .filter((c: { Names: string }) => !classifyStack(c.Names))
    .map((c: { Names: string }) => c.Names)

  const staleKeys = [...yamlKeys].filter((k) => !containers.some((c: { Names: string }) => classifyStack(c.Names) === k))

  const report = { unknown, stale: staleKeys, drifted: [] }
  cache.set("stale", { report, ts: Date.now() })
  return report
}
```

**Note on `state/services.yaml` path:** ARCHITECTURE.md의 `kb/services.yaml` 표기는 연구 문서의 notation lag. 실제 파일은 `state/services.yaml` (Phase 0 산출물). `kb/` 디렉토리는 처리 코드(schema/chunker/index/stale-check)만 담고 YAML 파일 자체는 없음.

**Differences from analog:** `draft-services-yaml.ts`는 단순 분류만. `stale-check.ts`는 Set difference + 30s TTL cache + StalenessReport 반환.

**Pitfalls to watch:** #11 (semantic diff — mtime/hash 기반 아님), D-13.4 (boot + per-query 양쪽 실행).

---

### `audit/schema.sql` (migration, CRUD)

**Analog:** 없음 — STACK.md + PITFALLS.md #10 패턴 직접 적용

**bun:sqlite CREATE TABLE 패턴** (STACK.md lines 165-178):
```sql
-- audit/schema.sql (D-14.1 hybrid schema)
-- PITFALL #10: strict:true + safeIntegers:true로 열어야 묵음 NULL 방지

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,         -- ISO 8601
  -- Turn row (parent_id NULL)
  model       TEXT,
  prompt      TEXT,                     -- ≤2000자 trim (D-14.3)
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  total_tool_calls INTEGER,
  duration_ms INTEGER,
  error_envelope TEXT,                  -- JSON string 또는 NULL
  -- Tool row (parent_id NOT NULL)
  parent_id   INTEGER REFERENCES events(id),
  tool_name   TEXT,
  input       TEXT,                     -- JSON string
  result_summary TEXT,                  -- ≤500자 trim (D-14.3)
  ok          INTEGER                   -- 0/1 BOOL
);

CREATE INDEX IF NOT EXISTS idx_events_parent_id ON events(parent_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
```

**Differences from analog:** 코드베이스에 SQLite 사용 예시 없음. STACK.md 패턴 + D-14.1 hybrid schema 직접 구현.

**Pitfalls to watch:** #10 (Database 초기화 시 `strict: true, safeIntegers: true` 필수).

---

### `audit/log.ts` (service, CRUD)

**Analog:** 없음 — D-14 decisions + PITFALLS.md #10 패턴 직접 적용

**audit/log.ts 인터페이스 패턴**:
```typescript
import { Database } from "bun:sqlite"

// PITFALL #10: strict:true 필수
const db = new Database("./data/copilot.db", { strict: true, safeIntegers: true, create: true })
db.run("PRAGMA journal_mode = WAL")
db.run("PRAGMA synchronous = NORMAL")
// audit/schema.sql의 CREATE TABLE 실행

export function beginTurn(prompt: string, model: string): bigint {
  const trimmedPrompt = prompt.slice(0, 2000)  // D-14.3: ≤2000자
  const stmt = db.prepare(
    "INSERT INTO events (ts, model, prompt) VALUES ($ts, $model, $prompt)"
  )
  stmt.run({ $ts: new Date().toISOString(), $model: model, $prompt: trimmedPrompt })
  return db.query("SELECT last_insert_rowid() as id").get({})!.id as bigint
}

export function logTool(
  parentId: bigint, name: string, input: unknown,
  resultSummary: string, ok: boolean, durationMs: number
): void {
  const stmt = db.prepare(
    "INSERT INTO events (ts, parent_id, tool_name, input, result_summary, ok, duration_ms) VALUES ($ts, $pid, $name, $input, $summary, $ok, $dur)"
  )
  stmt.run({
    $ts: new Date().toISOString(),
    $pid: parentId,
    $name: name,
    $input: JSON.stringify(input).slice(0, 2000),
    $summary: resultSummary.slice(0, 500),  // D-14.3: ≤500자
    $ok: ok ? 1 : 0,
    $dur: durationMs,
  })
}

export function endTurn(
  id: bigint, outputTokens: number, cacheReadTokens: number,
  totalToolCalls: number, durationMs: number, errorEnvelope?: unknown
): void {
  // UPDATE turn row with final stats
}
```

**Differences from analog:** 코드베이스에 SQLite 사용 없음. D-14.1 hybrid schema + bun:sqlite strict 패턴 직접 구현.

**Pitfalls to watch:** #10 (strict:true + safeIntegers:true 필수 — 묵음 NULL 방지).

---

### `public/index.html` (component, streaming SSE)

**Analog:** `spikes/03-sse-roundtrip/index.html` lines 1-73

**htmx + sse extension CDN load** (analog lines 7-9):
```html
<!-- STACK.md 버전 lock: htmx@2.0.10, htmx-ext-sse@2.2.4 -->
<!-- Phase 1은 로컬 정적 파일 서빙 (server.ts /static/ route) -->
<script src="/static/htmx.min.js"></script>
<script src="/static/sse.js"></script>  <!-- htmx-ext-sse 별도 로드 필수 — DESIGN.md correction #4 -->
```

**SSE 이벤트 dispatch 패턴** (analog lines 47-70 — 2 → 6 이벤트로 확장):
```javascript
// analog: htmx:sseMessage 이벤트 분기
window.addEventListener("htmx:sseMessage", function (evt) {
  var detail = evt.detail
  if (!detail || typeof detail.data !== "string") return
  try {
    var parsed = JSON.parse(detail.data)
    // Phase 1: 6 이벤트 분기 (analog의 2개에서 확장)
    switch (detail.type) {
      case "text-delta":
        // analog에서 학습: textContent 누적 (innerHTML 절대 금지 — XSS)
        outputEl.appendChild(document.createTextNode(parsed.delta))
        break
      case "tool-start":
        // .tool-event 카드 생성 (createElement + textContent)
        break
      case "tool-result":
        // 해당 tool-start 카드 업데이트
        break
      case "final":
        // analog에서 학습: createElement("div").textContent 설정
        break
      case "error":
        // D-15.2: #error-banner div에 표시
        errorBanner.style.display = "block"
        // fix 필드 verbatim — textContent로만 (D-15.1)
        break
      case "drift":
        // D-13.4: #drift-banner 표시
        driftBanner.style.display = "block"
        break
    }
  } catch (e) { /* JSON parse 실패 무시 */ }
})
```

**CSS custom properties** (01-UI-SPEC.md lines 269-292):
```css
:root {
  --color-bg:       #0f1117;
  --color-surface:  #1a1d27;
  --color-accent:   #4ade80;
  --color-error:    #ef4444;
  --color-text:     #e2e8f0;
  --color-muted:    #64748b;
  --color-mono:     #86efac;
  --color-border:   #2d3244;
  --space-xs: 4px; --space-sm: 8px; --space-md: 16px;
  --space-lg: 24px; --space-xl: 32px;
  --font-size-label: 13px; --font-size-body: 15px;
  --font-size-mono: 13px; --font-size-heading: 17px;
  --font-family-sans: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --font-family-mono: 'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace;
}
```

**DOM 구조** (01-UI-SPEC.md lines 139-147):
```html
<body>
  <div id="drift-banner" style="display:none" hx-ext="sse" sse-swap="drift" hx-swap="innerHTML"></div>
  <div id="error-banner" style="display:none" hx-ext="sse" sse-swap="error" hx-swap="innerHTML"></div>
  <div id="output" hx-ext="sse" sse-connect="/chat-stream" sse-swap="text-delta" hx-swap="beforeend"></div>
  <div id="status-bar" hx-ext="sse" sse-swap="final" hx-swap="innerHTML"></div>
  <form hx-post="/chat" hx-target="#output" hx-swap="none">
    <input id="prompt" name="prompt" type="text" autofocus autocomplete="off"
           placeholder="질문하세요. 예: ais-prod redis 어디 쓰여?" />
    <button type="submit">전송</button>
  </form>
</body>
```

**Differences from analog:** spike는 2 이벤트(text-delta, final), 라이트 테마, Start 버튼 수동 연결. Phase 1은 6 이벤트, 다크 터미널 테마, 자동 SSE 연결, tool 카드 표시.

**Pitfalls to watch:** #4 (htmx-ext-sse 자동 재연결 — 서버 측 LOOP-07 idempotency로 대응), D-15.1 (fix 필드 verbatim — innerHTML 절대 금지).

---

### `scripts/draft-services-yaml.ts` (script, batch — 수정 사항 minimal)

**기존 파일:** `/home/gon/projects/gon/gons-works/scripts/draft-services-yaml.ts` — 이미 완전 구현됨

**Phase 1 수정 사항만:**
```typescript
// 기존 main() 마지막에 추가 (D-12.4: 스키마 검증 후 diff 출력)
import { ServicesYamlSchema } from "../kb/schema"
import { createPatch } from "diff"
import { load } from "js-yaml"  // or yaml package

// draft 작성 후 Zod 스키마 검증 (strict 모드)
const parsed = ServicesYamlSchema.safeParse(load(output))
if (!parsed.success) {
  console.warn("[draft-services] ⚠ 스키마 검증 경고:", parsed.error.issues)
}

// D-12.3: 현재 서비스 yaml과 unified diff 출력
try {
  const current = await Bun.file("state/services.yaml").text()
  const patch = createPatch("services.yaml", current, output, "current", "draft")
  console.log("\n=== Unified Diff (current → draft) ===")
  console.log(patch)
} catch {
  console.log("[draft-services] 현재 services.yaml 없음 — diff 생략")
}
console.log("Review then: mv state/services.yaml.draft state/services.yaml")
```

**Differences from analog:** 기존 파일 유지 + 마지막 단계에 `kb/schema.ts` Zod 검증 + jsdiff `createPatch` 추가만.

**Pitfalls to watch:** 없음 (기존 코드 변경 최소화). `kb/schema.ts`가 `scripts/draft-services-yaml.ts` 보다 먼저 완성되어야 함 (build order 참고).

---

## Shared Patterns

### 공통 환경변수 가드

**Source:** `src/env.ts` lines 44-61
**Apply to:** `server.ts`, `scripts/draft-services-yaml.ts` (already uses), `agent/loop.ts`

```typescript
// 모든 entrypoint 첫 줄
import { loadEnv } from "./src/env"
const env = loadEnv()  // 실패 시 process.exit(1) — 친절한 envelope 에러 출력
```

### Docker context 명시적 전달

**Source:** `scripts/draft-services-yaml.ts` lines 47-48
**Apply to:** `tools/listContainers.ts`, `tools/readLogs.ts`, `kb/stale-check.ts`

```typescript
// PITFALL #8: env.DOCKER_CONTEXT를 Bun.$ template에 명시 전달
const ctx = env.DOCKER_CONTEXT  // loadEnv()에서 — process.env 직접 금지
const raw = await $`docker --context ${ctx} ps -a --format json`.text()
```

**주의:** `src/env.ts:27`의 default는 `"dserver"`. 실제 운영 서버 컨텍스트 이름은 `"home-server"` (FRICTION #10 / CLAUDE.md 인프라 표). `.env` 파일에 `DOCKER_CONTEXT=home-server` 명시 필수.

### bun:sqlite strict 초기화

**Source:** PITFALLS.md #10 prevention block (lines 464-475)
**Apply to:** `kb/index.ts`, `audit/log.ts`

```typescript
import { Database } from "bun:sqlite"

// PITFALL #10: 이 3 옵션 항상 함께
const db = new Database("./data/copilot.db", {
  strict: true,        // 오타 바인딩 → throw
  safeIntegers: true,  // INTEGER → bigint
  create: true,
})
db.run("PRAGMA journal_mode = WAL")
db.run("PRAGMA synchronous = NORMAL")
```

### z.toJSONSchema (Zod v4 내장)

**Source:** `spikes/05-zod-schema.test.ts` lines 25-26
**Apply to:** `tools/_index.ts`

```typescript
// DESIGN.md correction #3: z.toJSONSchema (대문자 JSON) — Zod v4 내장
// zod-to-json-schema 패키지 절대 사용 금지 (Zod v4에서 빈 {} 반환)
import { z } from "zod"
const schema = z.toJSONSchema(myZodSchema) as Anthropic.Tool["input_schema"]
```

### EnvProblem → ToolError 확장 shape

**Source:** `src/env.ts` lines 32-36
**Apply to:** `tools/_envelope.ts` (ToolError 정의), `agent/loop.ts` (isToolError 체크)

```typescript
// src/env.ts EnvProblem에서 확장
interface ToolError extends EnvProblem {
  retryable: boolean  // 이 필드만 추가
}
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `audit/schema.sql` | migration | CRUD | bun:sqlite 사용 예시가 코드베이스에 없음 — STACK.md + PITFALLS.md #10 패턴 직접 적용 |
| `audit/log.ts` | service | CRUD | 동일 — bun:sqlite 신규 도입. D-14 decisions + PITFALLS.md #10 패턴 직접 적용 |
| `agent/loop.ts` (full) | service | event-driven | spike 2개(06-smoke + 06-test)의 부분 패턴 합성. tool-use loop + history compaction은 ARCHITECTURE.md Pattern 3 직접 구현 |

---

## Critical Notes for Planner

1. **`state/services.yaml` vs `kb/services.yaml`:** 파일은 `state/services.yaml`에 있다 (Phase 0 산출물). `kb/` 디렉토리는 처리 코드만 담음 — YAML 자체 없음.

2. **DOCKER_CONTEXT default mismatch:** `src/env.ts:27` default=`"dserver"`, 실제 홈랩 컨텍스트=`"home-server"`. `.env` 파일에 `DOCKER_CONTEXT=home-server` 명시 필수 (FRICTION #10).

3. **Build order dependency:** `kb/schema.ts` → `scripts/draft-services-yaml.ts` 수정 순서 준수 (Phase 1 build order step 1이 `tools/_index.ts`이지만 `kb/schema.ts`는 `scripts/` 수정 전에 있어야 함).

4. **_envelope.ts 의 PITFALL #1 보장:** catch 경로에서 절대 throw 금지. 항상 `ToolError` 반환. `agent/loop.ts`도 dispatch()의 catch에서 반드시 tool_result를 push한 후에만 loop 재진입.

5. **scripts/draft-services-yaml.ts는 rewrite 아님:** 기존 파일 유지, Phase 1 수정은 마지막에 Zod 검증 + jsdiff diff 출력 추가만.

---

## Metadata

**Analog search scope:** `/home/gon/projects/gon/gons-works/spikes/`, `/home/gon/projects/gon/gons-works/src/`, `/home/gon/projects/gon/gons-works/scripts/`, `/home/gon/projects/gon/gons-works/state/`
**Files scanned:** 13 source files (6 spike files + 3 src files + 1 script + 1 existing html + 1 state yaml + 1 state result)
**Pattern extraction date:** 2026-05-06
