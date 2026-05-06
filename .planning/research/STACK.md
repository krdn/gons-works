# Stack Research

**Domain:** Single-host Docker Compose AI operator copilot (Bun + Hono + Claude tool-use)
**Researched:** 2026-05-06
**Confidence:** HIGH (verified via official docs + npm; 3 items MEDIUM where tradeoffs exist)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Bun | 1.2+ | Runtime, package manager, test runner | Ships native SQLite, native shell (`Bun.$`), zero-config TS execution. No toolchain overhead vs Node. 16h budget: one runtime to install, done. |
| Hono | 4.x (latest ~4.x on npm) | HTTP server + SSE streaming | Web-standards native, runs identically on Bun without adapter boilerplate. `streamSSE` from `hono/streaming` is the standard SSE API — verified in official docs. Sub-ms cold start on Bun. |
| `@anthropic-ai/sdk` | 0.93.0 (latest, May 2026) | Claude API client, tool-use, streaming | Official SDK. `anthropic.messages.stream()` returns an async-iterable `MessageStream` with `.finalMessage()`. For tool-use loops use the `for await (const event of stream)` pattern accumulating `input_json_delta` events per tool block. SDK handles SSE reconnect and typed events. |
| `bun:sqlite` | built-in (Bun 1.2+) | Event log + embedding vector storage | Zero dependency, native to Bun, 3-6x faster than better-sqlite3 on JS-layer object construction (verified). Single file DB — ideal for 1-user audit log + small embedding index. |
| htmx | 2.0.10 | Browser UI — input form + SSE stream rendering | No build step, no JS framework. One `<input>`, one SSE-connected `<div>`. For this 16h scope, htmx is the only choice that needs zero frontend tooling. |
| `htmx-ext-sse` | 2.2.4 | htmx SSE extension (separated from core in htmx 2.x) | **Important:** In htmx 2.x, SSE is NOT in core. It ships as `htmx-ext-sse` package. Load via CDN or npm. The `hx-ext="sse"` attribute activates it. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `voyageai` | 0.2.1 | Voyage AI embedding client (TypeScript SDK) | For `kb/index.ts` — embed 50-100 services.yaml fields and user queries for RAG retrieval. **Use `voyage-4-lite` model** ($0.02/MTok, 32K context, current-generation). For 100 chunks of avg 200 tokens, one-time index cost ≈ $0.0004 — rounding error. Bun-compatible (Bun 1.0+ per official SDK repo). |
| `zod` | ^4.0.0 | Runtime schema validation + JSON Schema generation for tool inputs | Define the 5 tool input schemas in Zod. Use `z.toJSONSchema(schema)` (Zod v4's native top-level function) to produce the `input_schema` object for Anthropic's API. This gives full TypeScript inference on tool handler parameters with zero extra packages. Do NOT use `zod-to-json-schema` package — it does not support Zod v4 and produces an empty `{}` schema (Vercel AI SDK issue #12020). |
| `diff` (jsdiff) | 9.0.0 | Unified diff generation and parsing | For `proposePatch` tool — generate human-readable unified diffs from old/new compose file strings. `createPatch()` for generation. Comes with TypeScript types since v8 (no `@types/diff` needed). Latest v9.0.0 released May 2026. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `bun test` | Unit + integration testing | Built-in, Jest-compatible API. No `vitest` or `jest` needed. `bun:test` mock API for SSH and Claude API mocking. |
| TypeScript (bundled in Bun) | Type checking | Bun executes `.ts` directly. For explicit type checks: `bunx tsc --noEmit`. No `ts-node` or `tsx` needed. |

---

## Installation

```bash
# Initialize project
bun init -y

# Core HTTP + Claude
bun add hono @anthropic-ai/sdk

# htmx SSE extension (serve from public/ or CDN)
bun add htmx-ext-sse

# Schema validation + tool definitions (Zod v4)
bun add zod

# Embedding client
bun add voyageai

# Diff generation
bun add diff

# @types/diff NOT needed — diff@9 ships its own TypeScript types

# Dev
bun add -d typescript
```

**CDN alternative for htmx + extension (no build step at all):**
```html
<!-- Verify integrity hashes at install time via cdn.jsdelivr.net — shown here as reference only -->
<script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.10/dist/htmx.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/htmx-ext-sse@2.2.4/dist/sse.js"></script>
```

---

## Decision Rationale (per question)

### 1. Hono SSE + Claude streaming tool-use loop

Use `streamSSE` from `hono/streaming`. The handler opens an SSE channel and runs the Claude tool-use loop inside it:

```typescript
import { streamSSE } from 'hono/streaming'
import Anthropic from '@anthropic-ai/sdk'

app.post('/chat', (c) => {
  return streamSSE(c, async (stream) => {
    const client = new Anthropic()
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userInput }]

    while (true) {
      const toolInputs: Record<number, string> = {}
      const anthropicStream = client.messages.stream({ model, tools, messages, max_tokens: 4096 })

      // Register abort handler to stop Claude stream on client disconnect
      stream.onAbort(() => anthropicStream.abort())

      for await (const event of anthropicStream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          await stream.writeSSE({ data: event.delta.text, event: 'text' })
        } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          toolInputs[event.index] = ''
        } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
          toolInputs[event.index] += event.delta.partial_json
        }
      }

      const final = await anthropicStream.finalMessage()
      if (final.stop_reason !== 'tool_use') break

      // Execute tools and append tool_result blocks, then loop
      messages.push({ role: 'assistant', content: final.content })
      const toolResults = await executeTools(final.content, toolInputs)
      messages.push({ role: 'user', content: toolResults })
    }
  }, (err, stream) => {
    stream.writeSSE({ data: JSON.stringify({ error: err.message }), event: 'error' })
  })
})
```

The `stream.onAbort()` callback handles client disconnect — pass it to `anthropicStream.abort()` to stop the Claude API call when the user navigates away.

**Confidence: HIGH** — verified against official Anthropic streaming docs and Hono streaming helper docs.

### 2. Claude tool-use SDK: `@anthropic-ai/sdk` + Zod v4 schemas

Use `@anthropic-ai/sdk` (official, v0.93.0). Do NOT use lower-level `fetch` — the SDK handles SSE reconnect, typed events, and `.finalMessage()` accumulation.

For tool definitions, use **Zod v4 + `z.toJSONSchema()`** (Zod v4's native top-level function, no third-party package):

```typescript
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'

const ListContainersInput = z.object({
  filter: z.string().optional().describe('Optional filter by name')
})

const tools: Anthropic.Tool[] = [
  {
    name: 'listContainers',
    description: 'List all Docker containers on the managed server via dserver context',
    // z.toJSONSchema is a top-level function in Zod v4 — NOT a method on the schema
    input_schema: z.toJSONSchema(ListContainersInput) as Anthropic.Tool['input_schema']
  }
]

// In handler — full type safety on tool arguments:
type ListContainersArgs = z.infer<typeof ListContainersInput>
async function handleListContainers(args: ListContainersArgs) { /* ... */ }
```

**Why Zod v4, not v3:**
- `bun add zod` installs v4 today (v4 released mid-2025)
- Zod v3 has no native JSON Schema export — it requires `zod-to-json-schema` package
- Zod v4 adds `z.toJSONSchema(schema)` as a built-in top-level function (capital `JSON`)
- This eliminates the `zod-to-json-schema` dependency and avoids the empty-schema bug

**Confidence: HIGH** — `z.toJSONSchema()` verified as Zod v4 native function via official Zod v4 release notes (zod.dev/v4).

### 3. SQLite: `bun:sqlite` (native, built-in)

Use `bun:sqlite`. It ships with Bun 1.2+, zero dependencies, and is 3-6x faster than better-sqlite3 for JS object construction (Bun's own benchmarks; independently confirmed in community discussion). For this project's scale (event log + ~100-row embedding table) the absolute numbers are irrelevant — use native because it eliminates one dependency.

```typescript
import { Database } from 'bun:sqlite'

const db = new Database('./data/copilot.db', { create: true })
db.run(`CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  prompt TEXT,
  tool_calls TEXT,  -- JSON
  result TEXT,
  commit_sha TEXT
)`)
```

Do NOT use `better-sqlite3` — it requires native compilation and only makes sense if you want the same codebase to run under Node.js. This project is Bun-only.

**Confidence: HIGH** — official Bun docs, verified shipped in 1.2.

### 4. Embedding model: `voyage-4-lite` via `voyageai` npm

**Design doc correction:** DESIGN.md issue #10 says "Claude Haiku embedding 사용". This is incorrect — Anthropic does not offer an embedding API (they acquired Voyage AI in 2024 and route through Voyage, not through Claude). Do not use Claude for embeddings.

**Recommendation: `voyage-4-lite`** (January 2026 release, $0.02/MTok, 32K context).

Cost for this project:
- 100 chunks × 200 tokens avg = 20,000 tokens one-time indexing ≈ **$0.0004** (sub-cent, negligible)
- Query embeddings: 1 per user turn × 50 tokens ≈ $0.000001 each

Voyage 4 family shares a single embedding space, so you can index cheaply with `voyage-4-lite` and later query with a larger model without re-indexing.

The `voyageai` npm package (v0.2.1) is the official TypeScript SDK, Bun-compatible:

```typescript
import { VoyageAIClient } from 'voyageai'

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! })

const { embeddings } = await voyage.embed({
  model: 'voyage-4-lite',
  input: chunks,
  inputType: 'document'
})
```

**Alternative:** OpenAI `text-embedding-3-small` ($0.02/MTok, same price) — perfectly fine at this scale. Choose `voyage-4-lite` because Anthropic officially integrates with Voyage, avoiding cross-vendor dependencies.

**Confidence: MEDIUM** — Voyage 4-lite pricing and model name verified via official Voyage docs and pricing page (May 2026). The "Anthropic has no embedding API" claim is HIGH confidence (verified by absence from official Anthropic API docs).

### 5. htmx + SSE — minimal pattern

**Critical:** In htmx 2.x, SSE is NOT built into core. Load `htmx-ext-sse@2.2.4` separately.

```html
<!-- public/index.html -->
<head>
  <script src="/static/htmx.min.js"></script>
  <script src="/static/sse.js"></script>  <!-- htmx-ext-sse -->
</head>

<body>
  <!-- SSE stream target -->
  <div id="output"
       hx-ext="sse"
       sse-connect="/chat-stream"
       sse-swap="text"
       hx-swap="beforeend">
  </div>

  <!-- Input form — posts to /chat, which triggers SSE -->
  <form hx-post="/chat" hx-target="#output" hx-swap="none">
    <input name="prompt" type="text" autofocus autocomplete="off" />
    <button type="submit">Send</button>
  </form>

  <!-- 5-key approval UI (shown only when patch is pending) -->
  <div id="approval" style="display:none">
    Approve? <kbd>y</kbd>es / <kbd>n</kbd>o / <kbd>e</kbd>dit / <kbd>d</kbd>iff / <kbd>a</kbd>bort
  </div>
  <script>
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('approval').style.display === 'none') return
      const key = e.key.toLowerCase()
      if (['y','n','e','d','a'].includes(key)) {
        fetch('/approve', { method: 'POST', body: JSON.stringify({ action: key }),
          headers: { 'Content-Type': 'application/json' } })
      }
    })
  </script>
</body>
```

The 5-key approval handler (`y/n/e/d/a`) is a plain JS `keydown` listener posting to `/approve` — no htmx extension needed for keyboard shortcuts.

**Confidence: HIGH** — htmx 2.x SSE extension name and CDN URLs verified against official htmx.org and npm registry.

### 6. Docker remote control: `Bun.$` shell-out with `--context dserver`

**Do NOT use `dockerode`** for this project. `dockerode` requires a direct socket URL or TLS certificate — it does not read Docker contexts. Wiring it to `dserver` (which is an SSH-based Docker context) would require manual SSH tunnel setup, defeating the purpose of having a context already configured.

**Recommendation: Shell-out via `Bun.$`** with explicit `--context dserver` flag:

```typescript
import { $ } from 'bun'

async function listContainers() {
  const result = await $`docker --context dserver ps --format json`.text()
  return JSON.parse('[' + result.trim().split('\n').join(',') + ']')
}

async function readLogs(name: string, tail = 200) {
  // Sanitize logs for prompt injection before returning
  const raw = await $`docker --context dserver logs --tail ${tail} ${name}`.text()
  return sanitizeLogs(raw)
}

// Startup check — fail loudly if dserver context is misconfigured
async function checkDockerContext() {
  const result = await $`docker context inspect dserver`.nothrow()
  if (result.exitCode !== 0) {
    throw new Error('Docker context "dserver" not found. Run: docker context create dserver --docker host=ssh://gon@192.168.0.5')
  }
}
```

`Bun.$` returns a `ShellOutput` with `.text()`, `.json()`, `.exitCode`. Use `.nothrow()` to prevent exceptions on non-zero exit codes, then check `.exitCode` manually. Use `docker context inspect dserver` (not `DOCKER_HOST`) for the startup connectivity check.

**Why not `dockerode` at all:** Dockerode can SSH, but it requires configuring `sshAgent` or explicit host/port, and has no concept of named Docker contexts. The existing `dserver` context in `~/.docker/contexts/` means `docker --context dserver` works out of the box with zero additional config.

**Confidence: HIGH** — architectural reasoning confirmed by Docker context docs and Bun shell docs; no source says dockerode supports named contexts.

### 7. Git audit trail: `Bun.$` shell-out (not simple-git, not isomorphic-git)

Use `Bun.$` git shell-outs directly. For this project's needs (fast-forward only commits, structured messages, read `git log`), simple-git adds ~zero value and isomorphic-git is for browser environments.

```typescript
import { $ } from 'bun'

async function commitStateChange(opts: {
  files: string[]
  promptSummary: string
  reasoning: string
  toolsCalled: string[]
}) {
  // Sanitize: strip newlines, limit length (DESIGN.md issue #9 — commit message injection)
  const safePrompt = opts.promptSummary.replace(/\n/g, ' ').slice(0, 72)
  const safeReasoning = opts.reasoning.replace(/\n/g, ' ').slice(0, 500)

  const msg = [
    `operator: ${safePrompt}`,
    '',
    `tools: ${opts.toolsCalled.join(', ')}`,
    `reasoning: ${safeReasoning}`,
  ].join('\n')

  await $`git -C ${STATE_DIR} add ${opts.files}`
  await $`git -C ${STATE_DIR} commit -m ${msg}`
}
```

Security note: `Bun.$` template literal interpolation handles argument escaping when values are in separate template slots (not string-concatenated). The `msg` variable is passed as a single argument slot, so newlines inside the message are safe — they become part of the commit message body, not additional shell tokens.

**Why not `simple-git`:** It wraps `git` binary anyway. For 4-5 operations (add, commit, log, status), the wrapper buys nothing. `isomorphic-git` is a pure-JS reimplementation for browsers — wrong tool, higher overhead.

**Confidence: HIGH** — settled question; training data and current docs agree.

### 8. Unified diff: `diff` package (jsdiff) v9.0.0

Use `diff` (jsdiff) for both generation and parsing. It ships TypeScript types since v8 (no `@types/diff` needed). v9.0.0 released May 2026.

```typescript
import { createPatch, parsePatch } from 'diff'

// Generate unified diff for proposePatch tool
function generatePatch(oldContent: string, newContent: string, filename: string): string {
  return createPatch(filename, oldContent, newContent, 'current', 'proposed')
}

// Parse a diff string back to structured hunks (for display or apply logic)
function parseDiff(patchStr: string) {
  return parsePatch(patchStr)
}
```

Do NOT use `parse-diff` — it's a separate package that only parses (no generation) and has fewer weekly downloads than `diff`. No reason to add a second package when `diff` covers both.

**Confidence: HIGH** — npm verified, TypeScript support confirmed since v8, v9.0.0 is current.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `bun:sqlite` | `better-sqlite3` | Only if you need Node.js portability (not this project) |
| `Bun.$` docker shell-out | `dockerode` | Only if you need programmatic Docker API access without an existing named context (e.g., dynamic remote targeting). Requires direct socket URL or TLS cert setup — incompatible with named Docker contexts. |
| `Bun.$` git shell-out | `simple-git` | Only if you need cross-platform git abstraction across Node + Bun + browser runtimes (not this project) |
| `voyage-4-lite` | `text-embedding-3-small` (OpenAI) | If you already have OpenAI API key and prefer one fewer API account. Same price ($0.02/MTok), similar quality at this scale. |
| `diff` (jsdiff) | `parse-diff` | Never — parse-diff is parse-only; jsdiff does both |
| `z.toJSONSchema()` (Zod v4 built-in) | `zod-to-json-schema` package | Never for Zod v4 — produces empty `input_schema` (confirmed bug). Only valid if you intentionally pin Zod v3. |
| htmx 2.x + `htmx-ext-sse` | WebSocket | If you need bidirectional push (not needed here — all interaction is request-driven from the input form) |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `dockerode` | Does not understand Docker named contexts. To use it with `dserver` you'd need to manually configure SSH agent or host/port — defeating the purpose of the pre-existing context. | `Bun.$\`docker --context dserver ...\`` |
| `simple-git` / `isomorphic-git` | simple-git is a thin wrapper with no benefit over shell-out for 4-5 operations; isomorphic-git is for browsers | `Bun.$\`git ...\`` |
| Claude API for embeddings | Anthropic does not offer an embedding endpoint. Design doc issue #10 is incorrect on this point. | `voyageai` with `voyage-4-lite` |
| `zod-to-json-schema` package | Does not support Zod v4 — produces empty `{}` as `input_schema` (confirmed Vercel AI SDK issue #12020) | `z.toJSONSchema(schema)` (Zod v4 built-in) |
| `zod@3.x` | Requires `zod-to-json-schema` for JSON Schema export. `bun add zod` installs v4 anyway. | `zod@^4.0.0` |
| React / Next.js / Vite | Zero need. htmx + 1 HTML file is the whole frontend. Any bundler introduces tooling overhead incompatible with the 16h budget. | Plain HTML + htmx |
| `vitest` / `jest` | Bun ships `bun test` (Jest-compatible API). Adding a test runner is redundant. | `bun test` |
| `nodemon` / `ts-node` / `tsx` | Bun executes `.ts` natively and has `bun --watch` for hot reload. | `bun --watch server.ts` |
| `express` / `fastify` | Hono is lighter, web-standards native, and runs on Bun without any adapter. Express on Bun works but is not idiomatic. | `hono` |

---

## Stack Patterns by Variant

**If you want to run copilot on 192.168.0.5 instead of 192.168.0.8:**
- Remove `--context dserver` from all docker commands (it becomes local)
- Add reverse proxy (Caddy or nginx) if you want browser access from outside the home network
- Otherwise no stack changes needed

**If embedding cost becomes a concern at larger scale (>10K chunks):**
- Switch from Voyage API to a locally-hosted model via Ollama (`nomic-embed-text` or `bge-m3`)
- Replace `voyageai` SDK with a simple `fetch` call to `localhost:11434/api/embeddings`
- No other stack changes needed — SQLite vector storage stays the same

**If you want to test proposePatch/applyPatch without touching 192.168.0.5:**
- Spin up a local docker-compose on 192.168.0.8 and create a `test-local` docker context pointing to it
- Set `DOCKER_CONTEXT=test-local` in the test environment
- No code changes — just context swap

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `hono@4.x` | `bun@1.2+` | No adapter needed for Bun. `streamSSE` is in `hono/streaming`. |
| `@anthropic-ai/sdk@0.93` | `bun@1.2+` | Uses native `fetch`. Works on Bun without polyfills. |
| `voyageai@0.2.1` | `bun@1.0+` | Official SDK repo documents Bun 1.0+ support. |
| `zod@^4.0.0` | `@anthropic-ai/sdk@0.93` | Use `z.toJSONSchema(schema)` (Zod v4 built-in top-level function, capital JSON). Do NOT use `zod-to-json-schema` package. |
| `htmx@2.0.10` | `htmx-ext-sse@2.2.4` | SSE extension must be same major version as htmx (both 2.x). |
| `diff@9.0.0` | Any | Ships its own TypeScript types. No `@types/diff` needed. |
| `bun:sqlite` | `bun@1.2+` | Built-in. API stable since 1.2. |

---

## Cost Estimate

| Item | Volume | Cost |
|------|--------|------|
| Voyage `voyage-4-lite` indexing (one-time) | 100 chunks × 200 tokens | ~$0.0004 |
| Voyage query embeddings | 1 per user turn × 50 tokens | ~$0.000001/turn |
| Claude Sonnet 4.6 (Phase 1 read queries) | ~1K tokens/turn | ~$0.003/turn |
| Claude Opus 4.7 (Phase 2 propose/apply) | ~3K tokens/turn | ~$0.045/turn |

At personal use scale (~20 turns/day), monthly LLM cost is well under $5. No rate-limit infrastructure needed.

---

## Sources

- [Anthropic fine-grained tool streaming docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming) — tool-use streaming event pattern, TypeScript example (HIGH confidence)
- [Hono streaming helper docs](https://hono.dev/docs/helpers/streaming) — `streamSSE` API, `onAbort`, Bun compatibility (HIGH confidence)
- [@anthropic-ai/sdk on npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — version 0.93.0 confirmed current (HIGH confidence)
- [Voyage AI embeddings docs](https://docs.voyageai.com/docs/embeddings) — model names, JS SDK (HIGH confidence)
- [Voyage AI pricing](https://docs.voyageai.com/docs/pricing) — voyage-4-lite at $0.02/MTok (MEDIUM confidence — pricing page; rates can change)
- [voyageai npm package](https://www.npmjs.com/package/voyageai) — v0.2.1, Bun 1.0+ support (HIGH confidence)
- [htmx SSE extension](https://htmx.org/extensions/sse/) — htmx-ext-sse v2.2.4 (HIGH confidence)
- [htmx 2.0.0 release notes](https://htmx.org/posts/2024-06-17-htmx-2-0-0-is-released/) — SSE moved to extension in 2.x (HIGH confidence)
- [bun:sqlite docs](https://bun.com/docs/runtime/sqlite) — native API, Bun 1.2+ (HIGH confidence)
- [diff package on npm](https://www.npmjs.com/package/diff) — v9.0.0 current, TypeScript types since v8 (HIGH confidence)
- [Zod v4 release notes](https://zod.dev/v4) — `z.toJSONSchema()` confirmed as built-in top-level function (HIGH confidence)
- Vercel AI SDK issue #12020 — `zod-to-json-schema` empty schema bug with Zod v4 (MEDIUM confidence — GitHub issue, but widely observed)
- Docker contexts docs — named contexts not readable by dockerode (HIGH confidence — architectural constraint)

---

*Stack research for: Single-host Docker Compose AI operator copilot*
*Researched: 2026-05-06*
