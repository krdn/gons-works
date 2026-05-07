# Phase 2: Propose/Apply with Approval Gate — Pattern Map

**Mapped:** 2026-05-07
**Files analyzed:** 13 신설/확장 모듈 (CONTEXT decisions D-A1..D-E1 lock 기반)
**Analogs found:** 11 / 13 (2개는 신규 — 메인 repo `.git/hooks/pre-commit`의 state/-only ff 블록 + `scripts/install-state-hook.sh` (D-04 lock: state/는 메인 repo subdir), `approval/store.ts` 신규 도메인)

---

## Overview

Phase 2가 신설/확장하는 13개 포인트 1줄 요약. CONTEXT.md `<code_context>`의 결정 lock 위에서 Phase 1 산출물을 analog로 재사용한다.

| # | 신설/수정 포인트 | 종류 | 핵심 analog | 결정 lock |
|---|-----------------|------|-------------|----------|
| 1 | `tools/proposePatch.ts` | 신설 service | `tools/readCompose.ts` (Zod input + run() wrapper) | D-B1, D-B2, D-D2 |
| 2 | `tools/applyPatch.ts` | 신설 service (2PC orchestrator) | `tools/listContainers.ts`(Bun.spawn) + `audit/log.ts` (begin/end) | D-A5, D-B3, D-C1, D-C4, D-D4 |
| 3 | `approval/store.ts` | 신설 in-memory store | `agent/loop.ts:53` `inFlight = new Map<...>` (LOOP-07 dedup map) | D-15.4 envelope, PITFALL #3 prevention |
| 4 | `state/commit.ts` | 신설 utility (commit msg + sanitize + spawn -F) | `audit/log.ts` (prepared statement 분리) + `spikes/04-git-commit.test.ts` | D-D1, D-D3 |
| 5 | 메인 repo `.git/hooks/pre-commit` (state/ pathspec 블록 추가) + `scripts/install-state-hook.sh` | 신설 shell hook 블록 + idempotent installer (TS 아님) | 없음 — 신규 (APPLY-07 + PITFALL #8 직접 명시). **D-04 lock: state/는 메인 repo subdir, 별도 git 아님** | APPLY-07, PITFALL Pitfall 8 |
| 6 | `state/.pending/{nonce}.json` + `recoverPendingMarkers()` | 신설 marker + boot probe | `src/server.ts:191-220` (4 startup probe 패턴) | D-C1, D-C2, D-C3 |
| 7 | `scripts/init-state-compose.ts` | 신설 일회성 SSH 복사 script | `tools/readCompose.ts` (SSH `cat`) + `scripts/draft-services-yaml.ts` (script 패턴) | D-A2 |
| 8 | `tests/fixtures/test-compose.yml` + `tests/setup/docker-context.ts` | 신설 verify env | 없음 — 신규 디렉토리 (alpine 더미 stack) | D-A3 |
| 9 | `agent/sse.ts` 확장 | 6→9 event union | 자기 참조 — `agent/sse.ts:27-33` SseEvent union | UI-02 +3 events lock |
| 10 | `agent/loop.ts` interrupt+resume | proposePatch tool dispatch 시 Promise resolve 대기 | `agent/loop.ts:191-226` dispatch + `agent/loop.ts:286-292` AbortController wire | LOOP-04 PITFALL #1, planner-결정 |
| 11 | `public/index.html` 5-key 확장 | 6→9 SSE handler + form | `public/index.html:289-399` switch-case 패턴 | DESIGN.md correction #5 |
| 12 | `src/server.ts` 확장 | `/approval/:id` POST + 5번째 startup probe | `src/server.ts:84-92` POST `/chat` + `:191-220` startup | APPLY-03, D-C2 |
| 13 | `tools/_index.ts` 확장 | proposePatch/applyPatch 2개 tool 추가 | `tools/_index.ts:43-62` TOOL_SCHEMAS 배열 | DESIGN.md correction #3 |

---

## File Classification

| 신설/수정 파일 | Role | Data Flow | Closest Analog | Match Quality |
|----------------|------|-----------|----------------|---------------|
| `tools/proposePatch.ts` | service | request-response (transform) | `tools/readCompose.ts` | role-match |
| `tools/applyPatch.ts` | service (2PC orchestrator) | request-response + file-I/O + side-effect | `tools/listContainers.ts` + `audit/log.ts` (composite) | partial-match (composite) |
| `approval/store.ts` | model/store (in-memory) | event-driven (Promise resolve) | `agent/loop.ts:53-55` (in-memory Map) | partial-match (shape) |
| `state/commit.ts` | utility | side-effect (git commit + temp file write) | `audit/log.ts` + `spikes/04-git-commit.test.ts` | partial-match |
| 메인 repo `.git/hooks/pre-commit` state/ 블록 + `scripts/install-state-hook.sh` | hook (shell) + installer | event-driven (git pre-commit, state/ pathspec gated) | 없음 | none |
| `state/.pending/{nonce}.json` (data) + `recoverPendingMarkers()` | model + service | file-I/O + boot-time CRUD | `src/server.ts:191-220` startup probes | role-match |
| `scripts/init-state-compose.ts` | script (one-shot) | batch (SSH read × 5) | `tools/readCompose.ts` (SSH cat) + `scripts/draft-services-yaml.ts` | role-match |
| `tests/fixtures/test-compose.yml` | fixture (yaml) | data | 없음 (신규 디렉토리) | none |
| `tests/setup/docker-context.ts` | test helper | config | 없음 (신규 디렉토리) | none |
| `agent/sse.ts` (확장) | utility | streaming | 자기 참조 (`agent/sse.ts:27-33`) | exact (extend union) |
| `agent/loop.ts` (확장) | service | event-driven (interrupt+resume) | 자기 참조 (`agent/loop.ts:191-226`) | exact (extend dispatch) |
| `public/index.html` (확장) | component | streaming + form-submit | 자기 참조 (`public/index.html:289-399`) | exact (extend switch + form) |
| `src/server.ts` (확장) | route | request-response + boot probe | 자기 참조 (`src/server.ts:84-92`, `:191-220`) | exact (extend route + probe) |
| `tools/_index.ts` (확장) | config/barrel | transform | 자기 참조 (`tools/_index.ts:43-62`) | exact (append schemas) |

---

## 모듈별 매핑

### 1. `tools/proposePatch.ts` — 신설 (D-B1, D-B2, D-D2)

**Analog:** `tools/readCompose.ts` (Zod input + `run()` wrapper의 가장 단순한 형태)

**재사용 패턴 — Zod input schema strict** (analog: `tools/_index.ts:36-39`, `tools/readCompose.ts:36-71`):
```typescript
// tools/_index.ts:43-62 TOOL_SCHEMAS 패턴 차용 — 신규 tool도 동일 위치에 등록.
export const ProposePatchInput = z.object({
  stack: z.enum(["news", "ais", "n8n", "open-webui", "krdn-fx"]),  // D-A1 lock
  command: z.union([                                                // D-B1 7 union literal
    z.literal("compose up -d"),
    z.literal("compose down"),
    z.literal("compose restart"),
    z.literal("compose start"),
    z.literal("compose stop"),
    z.literal("compose logs --tail=200"),
    z.literal("compose ps"),
  ]),
  service: z.string().min(1),                                       // <svc> 인자 (ps 제외)
  fileEdit: z.object({
    path: z.enum(["state/compose/{stack}.yml", "state/services.yaml"]),  // D-A1 strict
    newContent: z.string(),
  }).optional(),
  reasoning: z.string().max(500),  // D-D2 필수, D-D3 cap
})
```

**재사용 패턴 — `_envelope.run()` wrapper** (analog: `tools/_envelope.ts:40-94`):
```typescript
// readCompose.ts:36-44처럼 run("name", async (signal) => {...}) 형태.
// proposePatch는 docker exec 없이 jsdiff createPatch만 호출 — 즉 30s timeout 충분.
export async function proposePatch(args: ProposePatchArgs): Promise<ProposePatchResult | ToolError> {
  return await run("proposePatch", async (_signal) => {
    // 1. 현재 파일 read (state/compose/{stack}.yml 또는 state/services.yaml)
    // 2. jsdiff createPatch(path, current, args.fileEdit?.newContent ?? current, "current", "proposed")
    // 3. crypto.randomUUID() → nonce
    // 4. approval/store.ts.set(sessionId, { nonce, diff, command, fileEdit, reasoning, expiresAt: Date.now() + 120_000, consumed: false })
    // 5. return { nonce, diff, summary: "..." }  (envelope success path — D-15.4 JSON.stringify)
  })
}
```

**차이점:**
- `readCompose`는 read-only side-effect 무. `proposePatch`는 `approval/store.ts`에 PendingApproval 등록 (side-effect 1개) + nonce 생성.
- fileEdit이 None이면 diff = `"(no file change — command only: compose ${command})"` 배너 (D-B2 lock).

**결정 lock:** D-B1 (7-command union literal), D-B2 (단일 tool), D-D2 (`reasoning` 필수 z.string().max(500)).

---

### 2. `tools/applyPatch.ts` — 신설 2PC orchestrator (D-A5, D-B3, D-C1..C4, D-D4)

**Analog 1:** `tools/listContainers.ts:63` (Bun.spawn / Bun.$ docker subprocess 패턴)
**Analog 2:** `audit/log.ts:57-72` (beginTurn) + `:119-141` (endTurn) — applyPatch도 독립 audit row 기록

**재사용 패턴 — SSH Bun.spawn** (analog: `tools/readCompose.ts:43-59`):
```typescript
// readCompose.ts와 동일한 SSH 옵션 lock (PITFALL #12 mitigation 그대로 carry-forward).
// 단, command shape이 다르다 — readCompose는 `cat <path>`, applyPatch는 `cd /원격경로/{stack} && docker compose <cmd>`.
const proc = Bun.spawn(
  [
    "ssh",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=5",
    "-o", "ServerAliveCountMax=2",
    "-o", "BatchMode=yes",
    "gon@192.168.0.5",
    `cd ${REMOTE_COMPOSE_PATH[stack]} && docker compose ${command} ${service}`,  // D-A5 lock
  ],
  { stdout: "pipe", stderr: "pipe", signal },
)
```

**재사용 패턴 — `_envelope.run()` audit hook** (analog: `tools/_envelope.ts:79-92`):
```typescript
// run()의 finally가 logTool() 자동 호출 — applyPatch도 별도 audit row.
// 단, applyPatch는 "applied/rolled-back" 결과를 추가로 git commit (D-D4) — endTurn(error_envelope)와는 별개.
return await run("applyPatch", async (signal) => { ... }, 30_000, turnId, args)
```

**2PC 시퀀스 (D-A5 lock — 정확한 순서):**
1. **(i) Marker write** (`state/.pending/{nonce}.json` 초기 상태) — D-C1 lock, fsync 보장 (Bun.write sync mode).
2. **(ii) state/compose/{stack}.yml + state/services.yaml fileEdit write** — D-A5 (ii). Bun.write sync.
3. **(iii) SSH `cat > /원격경로/{stack}/docker-compose.yml`** — fileEdit 있을 때만, 원격 동기화. 실패 → marker delete + 즉시 ToolError, git commit 안 함.
4. **(iv) SSH `cd /원격경로/{stack} && docker compose <cmd> <svc>`** — D-B1 7-list. Bun.spawn signal 전달. exit_code≠0 → marker update + 즉시 ToolError, git commit 안 함 (APPLY-04 docker→git 순서 보호).
5. **(v) git commit state/** — `state/commit.ts buildMessage()` + spawn `-F` 임시파일 + `--` 분리자 (D-D3). 실패 시 D-B3 outer catch가 역 docker 시도 + envelope CRITICAL.
6. **(vi) Marker delete** — git commit 성공 직후. crash window 종료.

**차이점 (Phase 1 tool들과):**
- `listContainers`/`readLogs`/`readCompose`는 모두 single-step read-only. `applyPatch`는 6-step orchestration with ordered side-effects.
- D-B3 신규: docker 성공 + git fail 시 역 docker rollback 시도 (`up -d`↔`down`, `start`↔`stop`, `restart`→idempotent restart, `logs/ps`→불필요).
- D-C4 신규: 진입점에서 `state/.pending/*.json` glob count > 0 → 503 envelope reject.
- D-D4 신규: `applied`/`rolled-back`만 git commit, `rejected/aborted/expired-nonce`는 audit/log endTurn(error_envelope)만.

**결정 lock:** D-A5(SSH 경유), D-B3(git fail 역 docker), D-C1(marker lifecycle), D-C4(reject when marker exists), D-D4(commit 정책 분기).

---

### 3. `approval/store.ts` — 신설 in-memory store (PITFALL #3 prevention)

**Analog:** `agent/loop.ts:53-55` `const inFlight = new Map<string, AbortController>()` (LOOP-07 dedup map)

**재사용 패턴 — in-memory Map module-level singleton** (analog: `agent/loop.ts:53-55`, `:286-292` AbortController wire):
```typescript
// agent/loop.ts:53-55 패턴 그대로: module-level Map<sessionId, ...>.
// 차이: loop는 AbortController 저장, store는 PendingApproval 저장 + Promise resolve callback.
const pending = new Map<string, PendingApproval>()

interface PendingApproval {
  nonce: string                          // crypto.randomUUID() per proposePatch
  diff: string
  stack: "news" | "ais" | "n8n" | "open-webui" | "krdn-fx"
  command: ComposeCommand                // D-B1 7-union
  fileEdit?: { path: string; newContent: string }
  reasoning: string                       // D-D2 source
  expiresAt: number                       // Date.now() + 120_000 (PITFALL #3 prevention 코드)
  consumed: boolean                       // atomic set-before-await (PITFALL #3 prevention)
  resolve: (decision: ApprovalDecision) => void  // proposePatch tool이 await 대기
}

type ApprovalDecision = { type: "approved" } | { type: "rejected" } | { type: "edited"; newContent: string } | { type: "aborted" } | { type: "expired" }
```

**재사용 패턴 — atomic consumed set + nonce check** (PITFALLS.md `Pitfall 3` lines 117-141 prevention 코드 그대로):
```typescript
// PITFALL #3 prevention — pending.consumed = true는 await 호출 전에 set.
export function consumeApproval(sessionId: string, clientNonce: string, decision: ApprovalDecision): void {
  const a = pending.get(sessionId)
  if (!a) throw new Error("No pending approval")
  if (a.nonce !== clientNonce) throw new Error("Stale approval — nonce mismatch")
  if (a.consumed) throw new Error("Already consumed (double-press guard)")
  if (Date.now() > a.expiresAt) {
    a.resolve({ type: "expired" })
    pending.delete(sessionId)
    throw new Error("Approval expired (2 min). Re-propose.")
  }
  a.consumed = true   // set BEFORE resolve — race window 0
  a.resolve(decision)
  pending.delete(sessionId)
}
```

**차이점:**
- `inFlight`는 AbortController 저장만, dedup용. `approval/store.ts`는 Promise resolve callback으로 LOOP에 결정 전달.
- `_resetForTest()` 패턴은 `agent/loop.ts:82-86` 그대로 차용 (test isolation).

**결정 lock:** PITFALL #3 prevention 코드 verbatim 적용 + D-15.4 envelope shape (rejected → ToolError envelope으로 LLM에 전달).

---

### 4. `state/commit.ts` — 신설 commit msg + sanitize + spawn -F (D-D1, D-D3)

**Analog 1:** `audit/log.ts:62-72` (prepared statement + 필드 cap 패턴)
**Analog 2:** `spikes/04-git-commit.test.ts:25-31` (Bun.$ git commit body roundtrip — **단, D-D3가 spawn `-F`로 supersede**)

**재사용 패턴 — buildMessage() pure function** (analog 형식: `audit/log.ts beginTurn`처럼 함수 1개당 책임 1개):
```typescript
// D-D1 lock: Subject 한 줄 + body 구문화 4 필드.
export function buildMessage(action: ApplyResult): string {
  const subject = `apply(${action.stack}): ${action.command}${action.fileEditSummary ? ` [${action.fileEditSummary}]` : ""}`
  const body = [
    `User-Prompt: ${sanitize(action.userPrompt, 200)}`,    // D-D3 cap 200
    `AI-Reasoning: ${sanitize(action.reasoning, 500)}`,    // D-D3 cap 500 (D-D2 source)
    `Diff-Summary: ${action.fileEditSummary ?? "no-file-change"}`,  // D-D3 cap 100
    `Nonce: ${action.nonce}`,
  ].join("\n")
  return `${subject}\n\n${body}`
}
```

**재사용 패턴 — sanitize() pure function** (analog: `tools/readLogs.ts:53-61` reduce 패턴):
```typescript
// readLogs.ts sanitizeLogs와 동일 idiom: split → filter → map → join.
// D-D3 sequence: (1) \n / \r → " / " (2) backtick / dollar / null 제거 (3) cap (4) spawn -F write
export function sanitize(text: string, cap: number): string {
  return text
    .replace(/[\n\r]+/g, " / ")
    .replace(/[`$\0]/g, "")
    .slice(0, cap)
}
```

**재사용 패턴 — Bun.spawn `-F` 임시파일** (analog: `tools/readCompose.ts:43-59` Bun.spawn args 배열 + signal):
```typescript
// D-D3: Bun.$가 아니라 Bun.spawn(['git', '-F', tmpFile, '--']) — 셸 통과 회피.
// spike 04는 `Bun.$ git commit -m ${dangerous}`로 검증했으나 multi-line 한국어 body는 spawn -F가 더 안전.
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs"

export async function commitWithMessage(message: string, nonce: string): Promise<void> {
  const tmpDir = "data/.tmp"  // .gitignore 적용된 디렉토리 (D-D3)
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
  const tmpFile = `${tmpDir}/state-msg-${nonce}.txt`
  writeFileSync(tmpFile, message, { encoding: "utf-8" })
  try {
    const proc = Bun.spawn(
      ["git", "commit", "-F", tmpFile, "--"],
      { cwd: "state", stdout: "pipe", stderr: "pipe" },
    )
    const exit = await proc.exited
    if (exit !== 0) {
      const err = await new Response(proc.stderr).text()
      throw new Error(`git commit 실패 (exit ${exit}): ${err.slice(0, 200)}`)
    }
  } finally {
    try { unlinkSync(tmpFile) } catch { /* swallow */ }
  }
}
```

**차이점:**
- `audit/log.ts`는 SQLite prepared statement, `state/commit.ts`는 git subprocess + 임시파일.
- spike 04는 `Bun.$` template literal로 검증 PASS했지만 D-D3가 `Bun.spawn(['-F', ...])`로 supersede — 이유: multi-line + 한국어 + shell metachar 한 번에 처리하려면 임시파일 경유가 안전.
- 임시파일 위치는 `data/.tmp/state-msg-{nonce}.txt` — `data/`는 이미 `.gitignore`(`audit/log.ts:21` `./data/copilot.db` 동일 위치).

**결정 lock:** D-D1(commit message format), D-D3(sanitize sequence + spawn -F + `--` separator).

---

### 5. 메인 repo `.git/hooks/pre-commit` state/-only 블록 + `scripts/install-state-hook.sh` — 신설 shell hook 블록 + idempotent installer (APPLY-07, PITFALL Pitfall 8)

**Analog:** 없음 (TypeScript 모듈 아님 — POSIX shell 스크립트).

**D-04 lock 재확인**: state/는 메인 repo의 서브디렉토리이며 별도 git repo가 아니다 (00-CONTEXT.md line 54-56, STATE.md "deferred items"의 "state/ git submodule 분리 → v2+"). 따라서 hook은 메인 repo의 `.git/hooks/pre-commit`에 상주하며 **state/ pathspec 변경에 한정**해서만 ff-only를 enforce한다. 메인 repo의 다른 영역(`src/`, `.planning/`, `tests/` 등)은 영향받지 않는다.

**재사용 패턴:** Phase 1에 동등 analog 없음. APPLY-07 + PITFALL Pitfall 8 contract 직접 명시 (메인 hook 본문에 prepend, 기존 hook 보존):
```bash
# === APPLY-07 state/-only ff-only block (PITFALL #8) ===
# state/ subdir 변경이 staged이고 reflog가 rebase/rewrite/reset 패턴이면 commit 거부.
# 메인 repo의 다른 영역은 영향받지 않음.
STATE_STAGED=$(git diff --cached --name-only -- state/ 2>/dev/null || echo "")
if [ -n "$STATE_STAGED" ]; then
  LAST_REFLOG=$(git reflog -1 --format="%gs" 2>/dev/null || echo "")
  case "$LAST_REFLOG" in
    rebase*|*rewrite*|reset:*hard*)
      echo "[pre-commit] APPLY-07 violation: state/ 변경에 rebase/rewrite/reset --hard 감지. state/ fast-forward only."
      exit 1
      ;;
  esac
fi
# === end APPLY-07 block ===
```

**차이점 (다른 Phase 2 모듈과):**
- 유일한 비-TypeScript 산출물 — TS 코드 excerpt 없음.
- `.git/hooks/`는 git이 자동 실행 — bun 런타임 의존 없음.
- 설치는 `scripts/install-state-hook.sh` (idempotent — 이미 marker 존재 시 skip).
- **clone 후 hook 자동 복구 필요**: `.git/hooks/`는 working tree 외부이므로 main repo가 추적하지 않는다 → 02-10 verification에서 운영자가 `bash scripts/install-state-hook.sh` 한 번 실행해야 APPLY-07 활성화.

**결정 lock:** APPLY-07(state/ pathspec gated fast-forward only enforce), PITFALL Pitfall 8(state/ rebase 금지 prevention), D-04(state/는 메인 repo subdir).

---

### 6. `state/.pending/{nonce}.json` + `recoverPendingMarkers()` — 신설 marker + boot probe (D-C1..C4)

**Analog:** `src/server.ts:191-220` (4개 startup probe — `loadEnv` / `ensureDockerContext` / `ensureIndexed` / `staleCheck` 패턴) → 5번째 probe로 추가.

**재사용 패턴 — startup probe** (analog: `src/server.ts:191-220`):
```typescript
// src/server.ts:191-220의 startup() 함수에 5번째 probe로 추가.
// 분기 정책 차용: probe 1-3은 실패 시 process.exit(1), probe 4(staleCheck)는 console.warn만.
// recoverPendingMarkers는 probe 4와 동일 정책 — 발견은 알리되 exit 안 함, drift event는 첫 /chat-stream에서 emit.
async function recoverPendingMarkers(): Promise<PendingMarker[]> {
  const dir = "state/.pending"
  if (!existsSync(dir)) return []
  const files = await fs.glob(`${dir}/*.json`).list()  // Bun.glob 또는 node:fs/promises.readdir
  if (files.length === 0) return []
  // D-C2: 자동 복구 안 함, drift event로 사용자 안내만.
  console.warn(`[APPLY-05] unfinished applyPatch detected: ${files.length} marker(s)`)
  const markers = await Promise.all(files.map(async (f) => {
    const content = await Bun.file(f).text()
    return JSON.parse(content) as PendingMarker
  }))
  return markers
}
```

**재사용 패턴 — fsync sync write** (D-C1 lock — boot 후 발견 가능해야 함):
```typescript
// audit/log.ts:36-48 패턴 차용 — bun:sqlite은 PRAGMA synchronous=NORMAL이지만,
// marker는 docker exec 직전 무조건 디스크에 도달해야 하므로 Bun.write의 sync 옵션 사용.
import { writeFileSync } from "node:fs"
writeFileSync(`state/.pending/${nonce}.json`, JSON.stringify(marker), { encoding: "utf-8" })
// node:fs writeFileSync는 동기적이지만 OS 버퍼 flush 보장 위해 fsync 필요 시:
// const fd = fs.openSync(path, "w"); fs.writeSync(fd, content); fs.fsyncSync(fd); fs.closeSync(fd)
```

**Marker schema (D-C3 점진 update):**
```json
{
  "nonce": "uuid",
  "stack": "news",
  "command": "compose restart",
  "service": "news-prod-app",
  "fileEdit": { "path": "state/compose/news.yml", "newContent": "..." },
  "reasoning": "...",
  "user_prompt": "...",
  "sha_before": "abc1234",
  "ts_created": "2026-05-08T10:00:00+09:00",
  "docker_started_at": null,
  "docker_finished_at": null,
  "exit_code": null
}
```

**차이점 (Phase 1 startup probe와):**
- probe 1-3는 실패 → exit. probe 4(staleCheck)는 warn만. probe 5(recoverPendingMarkers)는 warn + 첫 SSE drift event 예약 (D-C2).
- `state/.pending/` 디렉토리는 신규 — `state/.gitignore`에 `/.pending/` 추가 필요.

**결정 lock:** D-C1(lifecycle 4 단계), D-C2(자동 복구 X + drift event), D-C3(점진 update — docker_started_at / finished_at / exit_code), D-C4(marker 존재 시 새 applyPatch reject).

---

### 7. `scripts/init-state-compose.ts` — 신설 일회성 SSH 복사 (D-A2)

**Analog 1:** `tools/readCompose.ts:43-59` (SSH `cat <path>` 패턴 그대로)
**Analog 2:** `scripts/draft-services-yaml.ts` (script 형태 — script 내부에서 Bun.$ + git commit + console 보고)

**재사용 패턴 — SSH cat × 5 + state/compose/{stack}.yml write + 단일 git commit:**
```typescript
// readCompose.ts:43-59 SSH 옵션 lock 그대로 차용.
// services.yaml의 stacks 키 + 각 stack의 compose path를 입력으로 사용.
import { $ } from "bun"
import { load } from "js-yaml"

const STACKS = ["news", "ais", "n8n", "open-webui", "krdn-fx"]  // D-A1 lock

async function main() {
  const yaml = ServicesYamlSchema.parse(load(await Bun.file("state/services.yaml").text()))

  for (const stack of STACKS) {
    const remotePath = composePath(stack)  // services.yaml의 메타정보 또는 .env에서
    const proc = Bun.spawn(
      ["ssh", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes",
       "gon@192.168.0.5", "cat", remotePath],
      { stdout: "pipe", stderr: "pipe" },
    )
    const exit = await proc.exited
    if (exit !== 0) throw new Error(`SSH 실패: ${stack}`)
    const content = await new Response(proc.stdout).text()
    await Bun.write(`state/compose/${stack}.yml`, content)
  }

  // spike 04 패턴: Bun.$ git commit (단일 init script은 D-D3 spawn -F 미적용 OK).
  await $`git -C state add compose/`.text()
  await $`git -C state commit -m "feat(02): bootstrap state/compose mirror (5 stacks via SSH cat)"`.text()
  console.log("[init-state-compose] OK — 5 mirrors committed.")
}
```

**차이점:**
- 일회성 — Phase 2 첫 plan(02-01 또는 wave 1)에서만 실행. 평소 sync 안 함.
- `applyPatch`처럼 marker/2PC 미사용 — bootstrap이라 audit 불필요.

**결정 lock:** D-A2(첫 plan 일회성 SSH 복사 후 commit, 평소 sync 안 함).

---

### 8. `tests/fixtures/test-compose.yml` + `tests/setup/docker-context.ts` — 신설 verify env (D-A3)

**Analog:** 없음 — Phase 1은 모든 *.test.ts가 모듈과 colocated, 별도 fixtures/setup 디렉토리 미존재.

**재사용 패턴 — docker-context 전환 (analog 없음, D-A3 직접 명시):**
```yaml
# tests/fixtures/test-compose.yml — alpine 더미 2개 (D-A3 lock)
services:
  test-svc-a:
    image: alpine:3
    command: ["sleep", "3600"]
    container_name: gons-test-svc-a
  test-svc-b:
    image: alpine:3
    command: ["sleep", "3600"]
    container_name: gons-test-svc-b
```

```typescript
// tests/setup/docker-context.ts — DOCKER_CONTEXT 일시 전환 helper.
// PROJECT.md "PROD 절대 조작 금지" + ROADMAP overage 보호.
import { $ } from "bun"

const ORIGINAL_CONTEXT = "home-server"  // FRICTION #10 lock
const TEST_CONTEXT = "default"          // 192.168.0.8 로컬

export async function switchToLocalContext(): Promise<void> {
  // env override는 process.env 임시 변경 또는 .env.test 파일 사용
  process.env.DOCKER_CONTEXT = TEST_CONTEXT
  await $`docker compose -f tests/fixtures/test-compose.yml up -d`.text()
}

export async function restoreContext(): Promise<void> {
  await $`docker compose -f tests/fixtures/test-compose.yml down --volumes`.text()
  process.env.DOCKER_CONTEXT = ORIGINAL_CONTEXT
}
```

**차이점:**
- 새 디렉토리 2개 (`tests/fixtures/`, `tests/setup/`).
- 기존 *.test.ts는 모두 모듈 옆 colocated — fixtures만 별도 디렉토리.

**결정 lock:** D-A3(192.168.0.8 로컬 alpine 더미 2개 + DOCKER_CONTEXT 전환 + cleanup).

---

### 9. `agent/sse.ts` 확장 — 6→9 event union (UI-02 +3)

**Analog:** 자기 참조 — `agent/sse.ts:27-33` 기존 6 event union (text-delta / tool-start / tool-result / final / error / drift).

**재사용 패턴 — discriminated union 확장** (analog: `agent/sse.ts:27-33`):
```typescript
// agent/sse.ts:27-33 패턴 그대로 +3 events 추가.
// toSSEFrame()(`agent/sse.ts:47-49`)는 ev.type을 SSE event name으로 emit하므로 자동 호환.
export type SseEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-start"; name: string; args: unknown }
  | { type: "tool-result"; name: string; ok: boolean; summary: string }
  | { type: "final" }
  | { type: "error"; problem: string; cause: string; fix: string; retryable: boolean }
  | { type: "drift"; message: string; unknown: string[]; stale: string[] }
  // === Phase 2 추가 (UI-02 +3) ===
  | { type: "approval-required"; nonce: string; stack: string; command: string; diff: string; reasoning: string; expiresAt: number }
  | { type: "applied"; nonce: string; stack: string; command: string; sha_after: string; duration_ms: number }
  | { type: "rolled-back"; nonce: string; stack: string; reason: string; rollback_command?: string; rollback_ok?: boolean }
```

**차이점:**
- 단순 확장 (3개 union member 추가). 이외 코드(`toSSEFrame`, `createChunkWatchdog`) 수정 불필요.
- `applied`/`rolled-back` 둘 다 nonce 포함 — UI에서 이전 `approval-required` 카드 페어링 가능.

**결정 lock:** UI-02 (Phase 1 6 event lock + Phase 2 +3 lock), DESIGN.md correction #5(5-key 인라인 legend 항상 표시 — `approval-required` data에는 legend 텍스트 미포함, UI-side에서 정적 출력).

---

### 10. `agent/loop.ts` 확장 — proposePatch tool dispatch interrupt+resume (planner-결정)

**Analog:** 자기 참조 — `agent/loop.ts:191-226` `dispatch(name, input, turnId)` switch + `:286-292` external AbortSignal wire.

**재사용 패턴 — dispatch switch case 추가** (analog: `agent/loop.ts:191-226`):
```typescript
// agent/loop.ts:191-226 dispatch()에 신규 2 case 추가.
// proposePatch 결과는 즉시 LLM tool_result로 push되지 않고 approval/store.ts.set() 후 await Promise.
async function dispatch(name: string, input: unknown, turnId: bigint, sessionId: string, emit: (ev: SseEvent) => void): Promise<unknown> {
  switch (name) {
    case "listContainers": /* 기존 그대로 */
    case "readLogs":       /* 기존 그대로 */
    case "readCompose":    /* 기존 그대로 */
    case "proposePatch": {
      // 1. proposePatch tool 실행 — diff + nonce 생성, approval/store에 등록 (resolve callback 포함).
      const result = await run("proposePatch", async (s) => proposePatch(input as ProposePatchArgs), 30_000, turnId, input)
      if (isToolError(result)) return result
      // 2. SSE approval-required emit.
      emit({ type: "approval-required", ...result })
      // 3. await approval/store의 Promise — 사용자 5-key 입력까지 대기 (최대 2분 + 1초 grace).
      const decision = await waitForApproval(sessionId, result.nonce, result.expiresAt + 1000)
      // 4. decision에 따라 LLM에 줄 tool_result 결정 (D-D4 분기).
      if (decision.type === "approved") {
        const apply = await applyPatch({ ...result, ...decision }, turnId, sessionId)
        return apply  // {applied: true, sha_after} 또는 ToolError envelope
      }
      // rejected/edited/aborted/expired → ToolError envelope, retryable=false
      return { problem: `approval ${decision.type}`, cause: "사용자 5-key", fix: "다른 접근 시도", retryable: false }
    }
    default: /* 기존 그대로 */
  }
}
```

**재사용 패턴 — AbortController wire** (analog: `agent/loop.ts:286-292`):
```typescript
// agent/loop.ts:286-292의 externalSignal addEventListener 패턴 차용.
// applyPatch 진행 중 chunk timeout이 발화하면 docker exec 도중 abort — marker는 D-C2 boot detect로 회복.
ac.signal.addEventListener("abort", () => approvalStore.expire(sessionId), { once: true })
```

**차이점:**
- 기존 3 read tool: dispatch → 즉시 tool_result return → LLM에 push.
- proposePatch: dispatch → SSE emit → await human → applyPatch → tool_result return.
- LOOP-04 PITFALL #1 보장: `waitForApproval`도 throw 없이 항상 ApprovalDecision 또는 expired envelope 반환.

**결정 lock:** LOOP-04(PITFALL #1 — orphan tool_use 차단), planner-discretion(정확한 interrupt+resume 메커니즘은 plan-phase 결정).

---

### 11. `public/index.html` 5-key 확장 (DESIGN.md correction #5)

**Analog:** 자기 참조 — `public/index.html:289-399` `htmx:sseMessage` switch + `:245-255` form 패턴.

**재사용 패턴 — switch case 확장** (analog: `public/index.html:289-399`):
```javascript
// public/index.html:302의 switch (detail.type)에 3 case 추가.
case "approval-required": {
  // form 생성: hidden nonce + 5-key keyboard handler + 인라인 legend (DESIGN.md correction #5 lock).
  var card = document.createElement("section");
  card.className = "approval-card";
  // diff 영역 (createTextNode — XSS 차단, public/index.html:265 보안 원칙 그대로)
  var diffPre = document.createElement("pre");
  diffPre.textContent = String(parsed.diff || "");
  // 5-key 인라인 legend — 항상 visible
  var legend = document.createElement("div");
  legend.className = "legend";
  legend.textContent = "y=apply  n=reject  e=edit  d=diff  a=abort";
  // hidden nonce + form
  var form = document.createElement("form");
  form.method = "post";
  form.action = "/approval/" + encodeURIComponent(parsed.nonce);
  // ... (5-key keydown handler 별도)
  outputEl.appendChild(card);
  break;
}
case "applied": {
  // 기존 tool-result 카드 패턴 차용 (public/index.html:320-336) — ✓ 표시.
  ...
}
case "rolled-back": {
  // tool-result.error 패턴 차용 (public/index.html:331) — ✗ + reason 표시.
  ...
}
```

**재사용 패턴 — XSS 차단 textContent 패턴 그대로** (analog: `public/index.html:262-265, 304-307`):
```javascript
// public/index.html:262-265 보안 원칙 lock — innerHTML / 문자열-to-DOM 파싱 모두 절대 금지.
// 5-key form의 nonce 표시도 textContent / hidden input value만 사용.
var nonceInput = document.createElement("input");
nonceInput.type = "hidden";
nonceInput.name = "nonce";
nonceInput.value = String(parsed.nonce);  // 자동 escape (input value)
```

**5-key keyboard handler 신규 책임:**
- `y` / `n` / `e` / `d` / `a` 매핑 — `keydown` listener가 form scope 내에서만 활성.
- `e`(edit) UX는 plan-phase 결정 (textarea? AI 재요청? `$EDITOR`?). 기본 후보: textarea → 재제출 시 fileEdit.newContent 갱신 후 재 proposePatch 호출.
- 인라인 legend는 form 내부에 항상 visible — `aria-live` 미적용 (정적 안내).

**차이점:**
- Phase 1 6 SSE handler 모두 read-only DOM update. Phase 2의 3 신규 handler는 form interaction + nonce 추적.
- 새 form은 `hx-post="/approval/{nonce}"` 또는 raw fetch (htmx 또는 fetch 둘 다 가능 — plan-phase 결정).

**결정 lock:** DESIGN.md correction #5(5-key 인라인 legend 항상 visible), UI-02(SSE event name = type), `public/index.html:262-265` 보안 원칙(textContent only).

---

### 12. `src/server.ts` 확장 — `/approval/:id` POST + 5번째 startup probe

**Analog:** 자기 참조 — `src/server.ts:84-92` `POST /chat` route + `:191-220` startup probes.

**재사용 패턴 — Hono POST route** (analog: `src/server.ts:84-92`):
```typescript
// src/server.ts:84-92 POST /chat 패턴 그대로.
// nonce는 path param. body는 form-urlencoded ('y'/'n'/'e'/'d'/'a' + edit 시 newContent).
app.post("/approval/:id", async (c) => {
  const nonce = c.req.param("id")
  const sessionId = c.req.header("x-session-id") ?? "default"
  const body = await c.req.parseBody()
  const key = String(body.key ?? "")  // y / n / e / d / a
  const newContent = body.newContent != null ? String(body.newContent) : undefined
  try {
    const decision = mapKey(key, newContent)  // 'y' → {type:"approved"} 등
    consumeApproval(sessionId, nonce, decision)  // approval/store.ts
    return c.json({ ok: true })
  } catch (err) {
    // PITFALL #3: nonce mismatch / consumed / expired → envelope.
    return c.json({ problem: (err as Error).message, retryable: false }, 409)
  }
})
```

**재사용 패턴 — startup probe 5번째** (analog: `src/server.ts:191-220` 4 probes):
```typescript
// src/server.ts:191-220의 startup() 함수에 마지막 probe로 추가.
// console.warn + drift event (D-C2) 정책 — exit 안 함.
async function startup(): Promise<void> {
  // probe 1-4 기존 그대로
  ...
  // probe 5: pending markers (D-C1, D-C2)
  try {
    const markers = await recoverPendingMarkers()
    if (markers.length > 0) {
      console.warn(`[APPLY-05] ${markers.length} unfinished applyPatch detected — drift event will fire on next /chat-stream`)
      // 첫 /chat-stream에서 drift 형태 SSE event emit (markers 정보 포함) — module-level pendingMarkers buffer로 전달
      bufferPendingDrift(markers)
    }
  } catch (err) {
    console.warn(`[APPLY-05] recoverPendingMarkers 실패 (서버 시작 계속): ${(err as Error).message}`)
  }
}
```

**차이점:**
- POST `/chat`은 SSE wrapper만 반환. POST `/approval/:id`는 동기 응답 — 결정만 store에 set, applyPatch 자체는 LOOP가 await 중인 Promise resolve 후 진행.
- probe 5는 drift event 예약(buffer) — 첫 `/chat-stream` 진입 시 emit.

**결정 lock:** APPLY-03(승인 nonce + 2분 + consumed atomic), D-C2(boot detect → SSE drift, 자동 복구 X), `src/server.ts:191-220` startup 정책 carry-forward.

---

### 13. `tools/_index.ts` 확장 — proposePatch + applyPatch schema 추가

**Analog:** 자기 참조 — `tools/_index.ts:43-62` `TOOL_SCHEMAS: Anthropic.Tool[]` 배열 + Zod schema 정의 패턴.

**재사용 패턴 — schema 추가 + TOOL_SCHEMAS append** (analog: `tools/_index.ts:43-62`):
```typescript
// tools/_index.ts:43-62 패턴 그대로 — Zod input schema 정의 후 z.toJSONSchema 변환 + 배열 append.
// applyPatch는 사실 LLM에게 직접 노출 안 함 — proposePatch만 노출, applyPatch는 approval 후 internal call.
// Phase 2 LLM tool 노출은 proposePatch 1개만 (D-B2 단일 tool lock).

import { ProposePatchInput } from "./proposePatch"  // 또는 _index.ts에 직접 정의

export const TOOL_SCHEMAS: Anthropic.Tool[] = [
  // 기존 3개 (listContainers, readLogs, readCompose)
  ...,
  // === Phase 2 추가 ===
  {
    name: "proposePatch",
    description: "192.168.0.5 운영 서버의 docker compose 변경을 unified diff로 제안한다. 운영자 승인(5-key)이 있을 때만 적용된다. fileEdit이 None이면 command만 실행 (재시작/중지 등). reasoning 필드에 무엇을 왜 변경하는지 1-2문장 한국어로.",
    input_schema: z.toJSONSchema(ProposePatchInput) as Anthropic.Tool["input_schema"],
  },
]
```

**차이점:**
- `applyPatch`는 LLM tool로 노출 안 함 — proposePatch dispatch 결과로 internal call (D-B2 단일 tool).
- Phase 1 3개 tool과 동일 idiom — `z.toJSONSchema()` 대문자 JSON, 외부 패키지 금지.

**결정 lock:** D-B2(단일 proposePatch tool), DESIGN.md correction #3(`z.toJSONSchema` 대문자 JSON Zod v4 내장).

---

## 신규 디렉토리

| 경로 | 상태 | .gitignore 처리 | 생성 시점 |
|------|------|----------------|----------|
| `state/.pending/` | 신규 | `state/.gitignore`에 `/.pending/` 추가 (D-C1 — state/ 내부 격리) | 02-01 또는 init plan에서 mkdir |
| `data/.tmp/` | 신규 | 기존 `data/`가 .gitignore (`audit/log.ts:21`) — 자동 제외 | `state/commit.ts commitWithMessage()` 첫 호출 시 mkdir |
| `tests/fixtures/` | 신규 | gitignore 미적용 (test 코드는 commit) | D-A3 verify env plan에서 |
| `tests/setup/` | 신규 | gitignore 미적용 | D-A3 verify env plan에서 |
| `scripts/` | **기존 (확장)** | gitignore 미적용 — `init-state-compose.ts` 추가만 | init plan에서 |

**`state/.gitignore` 추가 항목** (D-C1 lock):
```
/.pending/
```

**중요:** 메인 repo `.git/hooks/pre-commit`은 `.git/` 자체가 working tree 외부이므로 main repo가 추적하지 않는다 → clone 후 자동 복구 안 됨. `scripts/install-state-hook.sh` idempotent installer가 hook 블록을 prepend + `chmod +x`. 02-10 verification에서 운영자가 한 번 실행해야 APPLY-07 활성화.

---

## 2PC 흐름 정밀 매핑

D-A5 sequence (i)~(vi) — Phase 1 분리 패턴 위에서의 정확한 호출 흐름.

```
                    ┌───────────────────────────────────────┐
                    │  agent/loop.ts iterate()              │
                    │  dispatch("proposePatch")             │
                    │   ↓                                    │
                    │  proposePatch() → diff + nonce         │
                    │   ↓                                    │
                    │  approval/store.set(sessionId, ...)    │
                    │   ↓                                    │
                    │  emit("approval-required")             │
                    │   ↓                                    │
                    │  await waitForApproval(...)  ─ ─ ─ ─ ─ ┐│
                    └───────────────────────────────────────┘│
                                                              │
   Browser 5-key                                              │
   ┌──────────────────┐                                       │
   │ 'y' keydown      │                                       │
   │ POST /approval/  │ ── server.ts → consumeApproval ── ──> resolve(decision)
   │     :nonce       │                                       │
   └──────────────────┘                                       │
                                                              │
                    ┌───────────────────────────────────────┐ │
                    │  agent/loop.ts (resumed)               │<┘
                    │  applyPatch(approved + payload)        │
                    └────────────────┬──────────────────────┘
                                     │
                    ┌────────────────▼──────────────────────────────┐
                    │  tools/applyPatch.ts (2PC, D-A5 sequence)     │
                    │                                                │
                    │  (i)  marker write (state/.pending/{n}.json)  │  ← D-C1, fsync
                    │       │                                        │
                    │  (ii) state/compose/{stack}.yml + services.yaml│  ← D-A1, sync write
                    │       fileEdit write (audit mirror)            │
                    │       │                                        │
                    │  (iii) SSH cat > /원격경로/{stack}/             │  ← D-A5 (iii)
                    │        docker-compose.yml (fileEdit only)      │      remote sync
                    │        │  fail → marker delete + ToolError    │
                    │        │  (git commit 안 함)                   │
                    │  (iv) SSH 'cd /원격경로/{stack} && docker      │  ← D-A5 (iv), D-B1
                    │       compose <cmd> <svc>'                     │      docker exec
                    │       marker update: docker_started_at         │      D-C3 점진 update
                    │       Bun.spawn → exit_code                    │
                    │       marker update: docker_finished_at +      │
                    │                       exit_code                │
                    │       │  exit≠0 → marker delete + ToolError   │
                    │       │  (git commit 안 함, APPLY-04 docker→ │
                    │       │   git 순서 보호)                       │
                    │       │                                        │
                    │  (v)  state/commit.ts buildMessage() →         │  ← D-D1, D-D3
                    │       Bun.spawn(['git','commit','-F',          │      git commit
                    │           data/.tmp/state-msg-{n}.txt,'--'])   │
                    │       │  fail (D-B3 신규):                    │
                    │       │   - 역 docker 시도 (up↔down 등)        │
                    │       │   - envelope CRITICAL alert           │
                    │       │   - SQLite events에 기록 (D-D4)        │
                    │       │                                        │
                    │  (vi) marker delete                            │  ← D-C1
                    │                                                │
                    │  → emit("applied")  또는  emit("rolled-back") │  ← UI-02 +3
                    │  → audit/log endTurn(error_envelope?)          │  ← D-14.4
                    └────────────────────────────────────────────────┘

  주의: ARCHITECTURE.md Pattern 4 prose는 git→docker로 적혀있으나 무시.
        REQUIREMENTS APPLY-04 + ROADMAP SC#2 + PITFALLS Pitfall 2 prevention 코드 모두
        docker→git 순서 — research_artifact_corrections #1 lock.
```

**Phase 1 위에서 추가되는 분리:**
- **`agent/loop.ts iterate()`는 그대로** — dispatch switch에 case 1개 추가 + Promise await 추가.
- **`tools/_envelope.run()` wrapper도 그대로** — applyPatch도 동일 envelope shape (LOOP-04 PITFALL #1 보호).
- **`audit/log.ts`도 그대로** — endTurn(error_envelope) 분기에 D-D4 적용.
- **`agent/sse.ts toSSEFrame()`도 그대로** — SseEvent union만 +3 확장.

---

## Test 패턴 매핑

Phase 1 컨벤션: 모든 *.test.ts는 모듈 옆 colocated. `tests/` 디렉토리는 fixtures/setup만 별도.

| 신설 모듈 | 옆에 *.test.ts 추가 | 이유 |
|-----------|---------------------|------|
| `tools/proposePatch.ts` | `tools/proposePatch.test.ts` | Zod schema strict + jsdiff createPatch + nonce 생성 + approval store set 호출 검증 |
| `tools/applyPatch.ts` | `tools/applyPatch.test.ts` | 2PC 6 step 모킹, D-B3 git fail 분기, D-C4 marker 존재 시 reject |
| `approval/store.ts` | `approval/store.test.ts` | nonce mismatch / consumed / expired 3 race 분기 verbatim 재현 (PITFALL #3) |
| `state/commit.ts` | `state/commit.test.ts` | buildMessage 5 action type별 grep, sanitize sequence (newline/backtick/dollar/cap), spawn -F roundtrip |
| `agent/sse.ts` | 기존 `agent/sse.test.ts` 확장 | +3 events SseEvent union 매칭 + toSSEFrame 호환 |
| `agent/loop.ts` | 기존 `agent/loop.test.ts` 확장 | dispatch proposePatch case + waitForApproval mock |
| `src/server.ts` | 기존 `src/server.test.ts` 확장 | POST /approval/:id + recoverPendingMarkers probe |

**fixtures/setup (별도 디렉토리, D-A3):**
- `tests/fixtures/test-compose.yml` — alpine 더미 stack 데이터.
- `tests/setup/docker-context.ts` — `switchToLocalContext` / `restoreContext` helper.
- E2E 검증은 `bun test tests/fixtures/`로 manual run (CI 미존재).

메인 repo `.git/hooks/pre-commit`의 state/-only 블록은 shell script — `*.test.ts` 미적용. 검증은 manual scenario(state/ 변경 stage 후 intentional rebase 시도 → exit 1 확인). 02-10 verification에서 자동화.

---

## Shared Patterns

### envelope shape carry-forward

**Source:** `tools/_envelope.ts:14-19` ToolError + `agent/sse.ts:32` error event
**Apply to:** `tools/proposePatch.ts`, `tools/applyPatch.ts`, `approval/store.ts`(rejected/expired), `state/commit.ts`(commit fail)

```typescript
// tools/_envelope.ts:14-19 ToolError shape 그대로 — Phase 2 신규 모듈 모두 동일.
// rejected/aborted/expired도 ToolError envelope으로 LLM에 전달 (D-15.4).
{ problem: string, cause: string, fix: string, retryable: boolean }
```

### SSH 옵션 lock (PITFALL #12 carry-forward)

**Source:** `tools/readCompose.ts:43-59` SSH 옵션 4종
**Apply to:** `tools/applyPatch.ts`, `scripts/init-state-compose.ts`

```typescript
// readCompose.ts:43-59 옵션 verbatim 재사용:
//   ConnectTimeout=10, ServerAliveInterval=5, ServerAliveCountMax=2, BatchMode=yes
// 모든 SSH 호출에서 동일 — Phase 2도 carry-forward.
```

### Bun.spawn args 배열 (shell injection 차단)

**Source:** `tools/readCompose.ts:43-59` Bun.spawn(string[]) 패턴
**Apply to:** `tools/applyPatch.ts`(SSH + ssh `cat >`), `state/commit.ts`(git commit -F), `scripts/init-state-compose.ts`(SSH cat × 5)

```typescript
// 모든 외부 프로세스 호출은 Bun.spawn(args[])로 — 절대 Bun.$ 또는 shell 문자열 통과 금지.
// composePath / nonce / message 등 동적 값은 모두 args 배열의 단일 요소.
```

### audit/log.ts hybrid schema 재사용

**Source:** `audit/log.ts:57-141` beginTurn / logTool / endTurn
**Apply to:** `tools/applyPatch.ts` (D-D4 — applied/rolled-back/rejected/aborted/expired 모두 SQLite events row)

```typescript
// applyPatch도 _envelope.run() 거쳐 logTool() 자동 호출 — schema 변경 없음.
// 단, applyPatch는 endTurn(error_envelope)에 추가로 'rolled-back reason' 같은 D-B3 정보 포함 가능.
```

### in-memory Map module-level singleton

**Source:** `agent/loop.ts:53-55` `inFlight = new Map<...>()` + `:82-86` `_resetForTest()`
**Apply to:** `approval/store.ts`(`pending = new Map<...>()`)

```typescript
// 테스트 isolation은 동일 idiom — _resetForTest() export.
// production code 호출 금지 + test에서만 사용.
```

### startup probe console.warn + drift event 정책

**Source:** `src/server.ts:191-220` 4 probes의 분기 정책 (probe 1-3 exit, probe 4 warn-only)
**Apply to:** `src/server.ts` 5번째 probe `recoverPendingMarkers()` (probe 4와 동일 정책 — D-C2)

```typescript
// staleCheck (probe 4)와 같이: console.warn 후 첫 /chat-stream에서 SSE event emit.
// 자동 복구 안 함, 사용자에게 a/b/c 명령 안내.
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| 메인 repo `.git/hooks/pre-commit` state/-only 블록 + `scripts/install-state-hook.sh` | shell hook 블록 + idempotent installer | event-driven (git lifecycle, state/ pathspec gated) | TS 모듈 아님, 코드베이스에 hook 미존재. APPLY-07 + PITFALL Pitfall 8 직접 명시. **D-04 lock: state/는 메인 repo subdir.** |
| `tests/fixtures/test-compose.yml` | yaml fixture | data | Phase 1은 fixture 디렉토리 미사용 — 신규 (D-A3). |
| `tests/setup/docker-context.ts` | test helper | config | Phase 1 *.test.ts colocated 컨벤션과 별도 — D-A3 신규 디렉토리. |

---

## Anti-Patterns to Avoid

다음 패턴은 research artifact / docs / 외부 라이브러리에서 보일 수 있으나 **모두 사용 금지**.

1. **ARCHITECTURE.md Pattern 4 prose의 git→docker 순서** — research_artifact_corrections #1 lock. 권위는 REQUIREMENTS APPLY-04 + ROADMAP SC#2 + PITFALLS Pitfall 2 prevention 코드(모두 docker→git). PATTERNS.md 본 문서도 docker→git만 표기.
2. **dockerode 라이브러리 사용** — PROJECT.md Out of Scope + DESIGN.md correction #2. dockerode는 named context(`home-server`) 미지원. `Bun.spawn(['ssh', ...])` 또는 `Bun.$ docker --context ...` 사용.
3. **`docker --context home-server -f /원격경로/compose.yml` 패턴** — D-A5 lock 위반. `-f` 파일 파싱이 로컬 CLI에서 일어나 원격 절대경로 미동작 + relative volume 경로 로컬 기준으로 잘못 해석. 항상 `ssh gon@192.168.0.5 'cd /원격경로/{stack} && docker compose ...'`로.
4. **`Bun.$ git commit -m "${dangerous}"` 셸 통과 패턴** — D-D3 lock 위반. 한국어 + multi-line + shell metachar는 `Bun.spawn(['git','commit','-F',tmpFile,'--'])`로. spike 04는 single-line 검증만 — Phase 2 multi-line은 spawn `-F` supersede.
5. **`docker --context ... -f` + 로컬 compose 파싱** — 위 #3 강화. 원격 파일 동기화는 `ssh ... 'cat > /path'` 또는 `scp`로 별도 처리, docker compose 명령은 원격에서 통째 실행.
6. **`zod-to-json-schema` 외부 패키지** — DESIGN.md correction #3 + `tools/_index.ts:42` 주석. Zod v4 내장 `z.toJSONSchema()`(대문자 JSON)만 사용.
7. **process.env.DOCKER_CONTEXT 직접 접근** — PITFALL #8 + `tools/listContainers.ts:9-13`. 항상 `loadEnv()` 결과의 `env.DOCKER_CONTEXT` 사용.
8. **`innerHTML` 또는 문자열-to-DOM 파싱** — `public/index.html:262-265` 보안 원칙 lock. 모든 외부 데이터(LLM 응답, diff 텍스트, error fix 등)는 `textContent` / `createTextNode` / `createElement`만 사용.

---

## Open Questions for Planner

다음 3개는 plan-phase에서 결정 (CONTEXT.md `<deferred>` 섹션 + advisor 권고와 일치):

1. **5-key `e`(edit) UX 정확한 flow** — 브라우저 textarea로 fileEdit.newContent 수정 후 재제출 → LLM에 새 proposePatch 호출 / 또는 `$EDITOR` 외부 편집 / 또는 AI에게 counter-proposal 재요청? D-B2 단일 tool 구조 위에서 결정. 기본 후보: textarea + 재제출 → 새 nonce 발급 + 기존 PendingApproval consumed=true 처리.

2. **LOOP interrupt+resume 메커니즘 정확한 구현** — `agent/loop.ts dispatch()` 안에서 `await waitForApproval(...)` Promise 대기가 LLM streaming 반응성에 미치는 영향 + `messages.create` 다음 호출까지 기다리는 시간. 후보 A: dispatch return 후 emit `approval-required` → 새 dispatch round로 LLM에 결과 전달. 후보 B: dispatch 내부 await + 즉시 applyPatch 결과 tool_result로 push. PITFALL #1(orphan tool_use) 보호와 60s SSE chunk timeout(LOOP-06) 사이 trade-off는 plan-phase 결정.

3. **D-A5 sequence (iii)+(iv) 사이 fail 분기 처리** — D-B3는 (v) git commit fail만 커버. 새 case: (iii) 원격 SSH `cat >`은 성공, (iv) docker compose는 실패 — 원격 docker-compose.yml은 이미 갱신됐고 docker는 아직 미반영. 후보 A: state/compose/{stack}.yml mirror revert + SSH `cat >` 다시 원본으로 + marker delete (rollback "to before"). 후보 B: 원격 compose 파일 그대로 두고 docker fail envelope만 → 사용자 수동 처리. plan-phase에서 결정.

---

## Metadata

**Analog search scope:**
- `/home/gon/projects/gon/gons-works/src/`
- `/home/gon/projects/gon/gons-works/tools/`
- `/home/gon/projects/gon/gons-works/agent/`
- `/home/gon/projects/gon/gons-works/audit/`
- `/home/gon/projects/gon/gons-works/kb/`
- `/home/gon/projects/gon/gons-works/public/`
- `/home/gon/projects/gon/gons-works/spikes/`
- `/home/gon/projects/gon/gons-works/scripts/`
- `/home/gon/projects/gon/gons-works/.planning/research/{ARCHITECTURE,PITFALLS}.md` (참조만, 코드 차용 없음)
- `/home/gon/projects/gon/gons-works/.planning/phases/01-read-only-knowledge-layer/01-PATTERNS.md` (Phase 1 형식 참고)

**Files scanned:** 14 source files (`src/server.ts`, `src/env.ts`, `src/docker-context-check.ts`(skim), `tools/{_envelope,_index,listContainers,readLogs,readCompose}.ts`, `agent/{loop,sse,system-prompt}.ts`, `audit/log.ts`, `audit/schema.sql`, `kb/stale-check.ts`, `kb/schema.ts`(partial), `public/index.html`, `spikes/04-git-commit.test.ts`)

**Pattern extraction date:** 2026-05-07

**Critical reminder for planner:**
- ARCHITECTURE.md Pattern 4 prose는 무시 (research_artifact_corrections #1).
- APPLY-08 텍스트 "Opus 4.7"은 D-10에 의해 `claude-opus-4-6`로 정정 (`COPILOT_MODEL_PROPOSE` env).
- D-D3 sanitization은 spike 04를 supersede (Bun.$ → spawn `-F`).
