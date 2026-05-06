---
plan_id: "00-01"
phase: 0
title: "Bun 프로젝트 초기화 + .env 검증 + bun:test 설정"
wave: 1
depends_on: []
files_modified:
  - "package.json"
  - "tsconfig.json"
  - ".env.example"
  - ".gitignore"
  - "src/env.ts"
  - "src/env.test.ts"
  - "bunfig.toml"
requirements: ["BOOT-04", "BOOT-05", "DOG-01"]
covers_decisions: ["D-05", "D-08", "D-09", "D-10", "D-11"]
autonomous: true
estimated_minutes: 20
---

# 00-01: Bun 프로젝트 초기화 + .env 검증 + bun:test 설정

<objective>
Bun 1.2+ 기반 프로젝트 부트스트랩. `package.json`/`tsconfig.json` 생성, 핵심 의존성 설치 (Hono, Anthropic SDK, Voyage AI, Zod v4, jsdiff, htmx-ext-sse), `.env` Zod schema + startup guard 구현, `bun:test` smoke 테스트로 환경 검증.

이 plan은 Phase 0의 모든 후속 spike의 기반이며 BOOT-04 (`docker context inspect dserver` 검증), BOOT-05 (`.env` 필수 키 존재 검증)을 동시에 만족한다.

**must_haves.truths:**
- D-05 (CONTEXT.md): Phase 0에서 `.env` schema + startup guard 둘 다 작성
- D-08 (CONTEXT.md): `bun:test`를 단위 테스트 프레임워크로 사용 (Vitest/Jest 추가 금지)
- D-09 (CONTEXT.md): cli-proxy-api(192.168.0.5:8317) 경유가 기본 — `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` 2개 필드 schema에 정의
- D-10 (CONTEXT.md): `COPILOT_MODEL_PROPOSE` 기본값 = `claude-opus-4-6` (4-7 외부 미공개)
- D-11 (CONTEXT.md): `ANTHROPIC_FALLBACK_BASE_URL` + `ANTHROPIC_FALLBACK_API_KEY` optional 필드로 self-reference risk 완화
- STACK.md lock: Bun 1.2+ / Hono 4.x / `@anthropic-ai/sdk@0.93.0` / `voyageai@0.2.1` / `zod@^4.0.0` / `diff@9.0.0` / `htmx-ext-sse@2.2.4`
</objective>

<must_haves>
## Truths (load-bearing decisions this plan inherits)

- D-05: `.env` schema (Zod v4) + startup guard 둘 다 Phase 0에 포함 — Phase 1 첫 코드에서 키 누락 디버깅 시간 낭비 방지
- D-08: 테스트는 `bun:test`로 작성 — 별도 Vitest/Jest dependency 추가 금지
- D-09: 기본 LLM endpoint = cli-proxy-api(192.168.0.5:8317). 2026-05-06 라이브 검증 완료 (chat/tool-use/streaming/model-echo)
- D-10: Phase 2 모델 = `claude-opus-4-6` (가용한 가장 최신 Opus). 4-7로 마이그레이션은 .env 한 줄 변경
- D-11: optional fallback (`api.anthropic.com` 직접) — proxy 다운 시 self-reference 회피
- BOOT-04: `docker context inspect dserver` 실패 시 명시적 에러로 즉시 종료
- BOOT-05: `.env` 필수 키 모두 존재해야 startup 성공 — 이번 갱신으로 키 셋이 6개로 확장 (ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, VOYAGE_API_KEY, COPILOT_MODEL_READONLY, COPILOT_MODEL_PROPOSE, DOCKER_CONTEXT)

## Verification anchors

- `package.json` 존재 + `dependencies`에 hono / @anthropic-ai/sdk / voyageai / zod / diff / htmx-ext-sse 6개 모두 grep 가능
- `src/env.ts` 존재 + `z.object(`로 schema 정의 + `ANTHROPIC_BASE_URL` 필드 + `ANTHROPIC_FALLBACK_BASE_URL` optional 필드
- `.env.example` 존재 + cli-proxy-api 기본 + console.anthropic.com fallback 2개 path 모두 표현 + `claude-opus-4-6` 명시
- `bun test src/env.test.ts` 종료 코드 0
</must_haves>

<task id="00-01-t01" type="execute">
<title>package.json 생성 + 핵심 의존성 설치</title>
<read_first>
- `.planning/research/STACK.md` (의존성 버전 lock 표 — 11번째 줄부터)
- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` (D-08, canonical_refs 섹션)
</read_first>
<action>
프로젝트 루트에서 다음 명령 순서대로 실행:

```bash
bun init -y
```

생성된 `package.json`의 `"name"`을 `"gons-works"`로, `"description"`을 `"AI Operator Copilot for 192.168.0.5 — gons-works"`로 수정.

다음 의존성을 정확한 버전으로 설치:

```bash
bun add hono@^4.0.0 @anthropic-ai/sdk@0.93.0 voyageai@0.2.1 zod@^4.0.0 diff@9.0.0 htmx-ext-sse@2.2.4
bun add -d @types/diff
```

설치 후 `package.json`의 `"dependencies"`에 정확히 6개 (hono, @anthropic-ai/sdk, voyageai, zod, diff, htmx-ext-sse) 모두 표시되는지 확인.

`"scripts"`에 다음 추가:
```json
"scripts": {
  "dev": "bun run src/server.ts",
  "test": "bun test",
  "spike": "bun run"
}
```
</action>
<acceptance_criteria>
- `package.json`이 프로젝트 루트에 존재
- `package.json` 안에 `"name": "gons-works"` grep 가능
- `package.json`의 `dependencies`에 정확히 다음 6개 키가 모두 grep 가능: `hono`, `@anthropic-ai/sdk`, `voyageai`, `zod`, `diff`, `htmx-ext-sse`
- `@anthropic-ai/sdk` 버전이 정확히 `0.93.0` (또는 `^0.93.0`), `voyageai` 정확히 `0.2.1`, `htmx-ext-sse` 정확히 `2.2.4`, `diff` 정확히 `9.0.0`
- `package.json`의 `scripts.test`가 `"bun test"`
- `bun --version`이 `1.2` 이상 출력
- `node_modules/`가 생성되고 위 6개 패키지 디렉토리 모두 존재
</acceptance_criteria>
</task>

<task id="00-01-t02" type="execute">
<title>tsconfig.json + bunfig.toml 작성</title>
<read_first>
- 방금 생성된 `tsconfig.json` (bun init이 만든 기본 파일)
- `.planning/research/STACK.md` (Bun + TypeScript 섹션)
</read_first>
<action>
`bun init`이 생성한 `tsconfig.json`을 다음 내용으로 덮어쓴다 (Bun + Zod v4 + 엄격 모드):

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": false,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false,
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "spikes/**/*"],
  "exclude": ["node_modules", "state"]
}
```

프로젝트 루트에 `bunfig.toml` 생성:

```toml
[install]
exact = true

[test]
preload = []
coverage = false
```

`exact = true`는 dependency lock을 명시적으로 강제 (`^` 자동 추가 안 함).
</action>
<acceptance_criteria>
- `tsconfig.json` 존재 + `"strict": true` grep 가능 + `"target": "ESNext"` grep 가능
- `tsconfig.json`의 `"include"`에 `"src/**/*"`와 `"spikes/**/*"` 둘 다 포함
- `bunfig.toml` 존재 + `[install]` 섹션 + `exact = true` grep 가능
- `bunx tsc --noEmit` 종료 코드 0 (현재 src 비어있어도 통과)
</acceptance_criteria>
</task>

<task id="00-01-t03" type="execute">
<title>.gitignore + .env.example 작성</title>
<read_first>
- 프로젝트 루트의 기존 `.gitignore` (있다면)
- `.planning/REQUIREMENTS.md` BOOT-05 섹션
</read_first>
<action>
프로젝트 루트의 `.gitignore`에 다음 항목이 모두 포함되도록 보강 (이미 있는 라인은 중복 추가 금지):

```
# Bun
node_modules/
bun.lockb

# Env
.env
.env.local

# Build artifacts
dist/
*.tgz

# State 자체는 git tracked 이지만 .DS_Store 등은 제외
.DS_Store

# IDE
.vscode/
.idea/

# Test
coverage/
```

프로젝트 루트에 `.env.example` 생성 (커밋되어 placeholder 역할):

```
# gons-works .env example — 실제 값은 .env에 채우고, .env는 .gitignore 처리됨

# ============================================================
# Anthropic Claude API endpoint
# ============================================================
# 기본 (D-09): cli-proxy-api(192.168.0.5:8317) 경유.
# Max plan OAuth 세션을 proxy가 재사용 → 토큰 비용 0.
# 2026-05-06 라이브 검증 완료 (chat / tool-use / streaming / model-echo).
ANTHROPIC_BASE_URL=http://192.168.0.5:8317
ANTHROPIC_API_KEY=my-proxy-key

# 대안 (console.anthropic.com 직접 — 토큰 비용 발생):
# ANTHROPIC_BASE_URL=https://api.anthropic.com
# ANTHROPIC_API_KEY=sk-ant-api03-...

# ============================================================
# Optional fallback (D-11): proxy 다운 시 self-reference 회피
# ============================================================
# 192.168.0.5가 진단 대상일 때 코파일럿이 같이 죽지 않도록.
# console.anthropic.com 별도 키 발급 후 채우면 fallback 활성.
# 미설정 시 fallback 없이 primary 실패가 user-facing error.
# ANTHROPIC_FALLBACK_BASE_URL=https://api.anthropic.com
# ANTHROPIC_FALLBACK_API_KEY=sk-ant-api03-...

# ============================================================
# Voyage AI (embedding for services.yaml RAG)
# ============================================================
# proxy 미경유 (Anthropic 전용). dash.voyageai.com/api-keys 에서 발급.
VOYAGE_API_KEY=pa-PLACEHOLDER

# ============================================================
# LLM model selection (env-var 추출, .env 한 줄 swap으로 마이그레이션)
# ============================================================
# Phase 1 read-only — sonnet 4.6 (proxy 가용 확인됨).
COPILOT_MODEL_READONLY=claude-sonnet-4-6
# Phase 2 propose/apply — opus 4-6 (D-10).
# claude-opus-4-7은 외부 API에 미공개. 추후 가용 시 한 줄 변경.
COPILOT_MODEL_PROPOSE=claude-opus-4-6

# ============================================================
# Docker context for managed server (must exist in `docker context ls`)
# ============================================================
DOCKER_CONTEXT=dserver
```

`DOCKER_CONTEXT`는 BOOT-04 검증 시 사용. 기본값 `dserver`로 .env에서 override 가능.
`ANTHROPIC_BASE_URL` 기본값 `http://192.168.0.5:8317`은 D-09 채택안. console 직접 호출은 사용자가 위 주석 블록 참고해 swap.
</action>
<acceptance_criteria>
- `.gitignore`에 `.env`, `node_modules/`, `bun.lockb` 모두 grep 가능
- `.env.example`이 프로젝트 루트에 존재
- `.env.example`에 다음 키가 모두 grep 가능 (uncommented): `ANTHROPIC_BASE_URL=`, `ANTHROPIC_API_KEY=`, `VOYAGE_API_KEY=`, `COPILOT_MODEL_READONLY=`, `COPILOT_MODEL_PROPOSE=`, `DOCKER_CONTEXT=`
- `.env.example`의 `ANTHROPIC_BASE_URL` 기본값이 정확히 `http://192.168.0.5:8317`
- `.env.example`의 `ANTHROPIC_API_KEY` 기본값이 정확히 `my-proxy-key`
- `.env.example`의 `COPILOT_MODEL_PROPOSE` 기본값이 정확히 `claude-opus-4-6` (4-7 아님)
- `.env.example`에 `ANTHROPIC_FALLBACK_BASE_URL` + `ANTHROPIC_FALLBACK_API_KEY`가 commented-out 상태로 등장 (optional fallback)
- `git status`에서 `.env`가 untracked로 표시되지 않음 (`.env` 미존재 시는 통과)
- `git check-ignore .env`가 종료 코드 0 (.gitignore 매치 확인)
</acceptance_criteria>
</task>

<task id="00-01-t04" type="execute">
<title>src/env.ts — Zod v4 schema + startup guard</title>
<read_first>
- 방금 만든 `.env.example`
- `.planning/research/STACK.md` Zod v4 섹션 (`z.toJSONSchema` 언급 부분)
- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` D-05
</read_first>
<action>
`src/env.ts` 생성. 내용:

```typescript
import { z } from "zod"

// 환경변수 schema. Phase 0의 BOOT-05 + D-09/D-10/D-11 만족.
// 필수: ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, VOYAGE_API_KEY
// 모델: COPILOT_MODEL_READONLY (default sonnet-4-6), COPILOT_MODEL_PROPOSE (default opus-4-6)
// Docker: DOCKER_CONTEXT (default dserver)
// Optional fallback (D-11): ANTHROPIC_FALLBACK_BASE_URL, ANTHROPIC_FALLBACK_API_KEY
export const envSchema = z.object({
  // D-09: 기본은 cli-proxy-api 경유. 사용자가 console.anthropic.com 직접으로 swap 시 .env 변경.
  ANTHROPIC_BASE_URL: z
    .string()
    .url()
    .default("http://192.168.0.5:8317"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY는 비어있을 수 없습니다"),

  // D-11: optional fallback. 미설정 시 primary 실패 = user-facing error.
  ANTHROPIC_FALLBACK_BASE_URL: z.string().url().optional(),
  ANTHROPIC_FALLBACK_API_KEY: z.string().min(1).optional(),

  // Voyage embedding (proxy 미경유)
  VOYAGE_API_KEY: z.string().min(1, "VOYAGE_API_KEY는 비어있을 수 없습니다"),

  // D-10: model env-var 추출. 4-7은 외부 미공개이므로 4-6이 기본.
  COPILOT_MODEL_READONLY: z.string().min(1).default("claude-sonnet-4-6"),
  COPILOT_MODEL_PROPOSE: z.string().min(1).default("claude-opus-4-6"),

  DOCKER_CONTEXT: z.string().min(1).default("dserver"),
})

export type Env = z.infer<typeof envSchema>

export interface EnvProblem {
  problem: string
  cause: string
  fix: string
}

// fallback 설정 여부 헬퍼 (Phase 1 LLM 모듈에서 사용 예정)
export function hasFallback(env: Env): boolean {
  return env.ANTHROPIC_FALLBACK_BASE_URL !== undefined && env.ANTHROPIC_FALLBACK_API_KEY !== undefined
}

// startup guard. .env 파싱 실패 시 { problem, cause, fix } envelope로 종료.
export function loadEnv(): Env {
  const result = envSchema.safeParse(Bun.env)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n")
    const problem: EnvProblem = {
      problem: ".env 검증 실패",
      cause: `누락 또는 빈 값:\n${issues}`,
      fix: ".env.example을 참고해 .env에 모든 키를 채우세요. (cp .env.example .env)",
    }
    console.error(`[BOOT-05] ${problem.problem}`)
    console.error(`원인:\n${problem.cause}`)
    console.error(`해결:\n${problem.fix}`)
    process.exit(1)
  }
  return result.data
}
```

`src/docker-context-check.ts` 생성 (BOOT-04 검증):

```typescript
import type { EnvProblem } from "./env"

// BOOT-04: docker context inspect <DOCKER_CONTEXT> 검증.
// Bun.$ shell-out으로 동기 실행. 실패 시 envelope 반환.
// 실제 호출은 Spike 1에서 검증되며, 여기서는 검증 함수만 export.
export async function ensureDockerContext(name: string): Promise<{ ok: true } | { ok: false; problem: EnvProblem }> {
  const proc = Bun.spawn(["docker", "context", "inspect", name], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  if (exitCode === 0) return { ok: true }
  const stderr = await new Response(proc.stderr).text()
  return {
    ok: false,
    problem: {
      problem: `Docker context "${name}" not found or unreachable`,
      cause: stderr.trim() || `docker context inspect ${name} 종료 코드 ${exitCode}`,
      fix: `docker context create ${name} --docker host=ssh://gon@192.168.0.5 명령으로 등록하거나, .env의 DOCKER_CONTEXT 값을 다른 이름으로 변경하세요.`,
    },
  }
}
```
</action>
<acceptance_criteria>
- `src/env.ts` 존재 + `z.object(` grep 가능
- `src/env.ts`에 다음 필드 모두 grep 가능: `ANTHROPIC_BASE_URL:`, `ANTHROPIC_API_KEY:`, `ANTHROPIC_FALLBACK_BASE_URL:`, `ANTHROPIC_FALLBACK_API_KEY:`, `VOYAGE_API_KEY:`, `COPILOT_MODEL_READONLY:`, `COPILOT_MODEL_PROPOSE:`, `DOCKER_CONTEXT:`
- `src/env.ts`의 `ANTHROPIC_BASE_URL` default가 `"http://192.168.0.5:8317"` (D-09)
- `src/env.ts`의 `COPILOT_MODEL_PROPOSE` default가 `"claude-opus-4-6"` (D-10, 4-7 아님)
- `src/env.ts`의 fallback 두 필드가 `.optional()` 호출 (D-11)
- `src/env.ts`에 `hasFallback` 헬퍼 함수 export
- `src/env.ts`에 `loadEnv` 함수 export + `process.exit(1)` 호출 grep 가능 (startup guard)
- `src/env.ts`에 `EnvProblem` 인터페이스 export (`problem`, `cause`, `fix` 3 필드)
- `src/docker-context-check.ts` 존재 + `ensureDockerContext` export + `Bun.spawn` 호출 grep 가능
- `bunx tsc --noEmit` 종료 코드 0
</acceptance_criteria>
</task>

<task id="00-01-t05" type="execute">
<title>src/env.test.ts — bun:test smoke test</title>
<read_first>
- 방금 만든 `src/env.ts`
- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` D-08
</read_first>
<action>
`src/env.test.ts` 생성:

```typescript
import { describe, expect, test } from "bun:test"
import { envSchema, hasFallback } from "./env"

describe("envSchema (BOOT-05 + D-09/D-10/D-11)", () => {
  test("정상 입력은 parse 성공", () => {
    const result = envSchema.safeParse({
      ANTHROPIC_BASE_URL: "http://192.168.0.5:8317",
      ANTHROPIC_API_KEY: "my-proxy-key",
      VOYAGE_API_KEY: "pa-test",
      COPILOT_MODEL_READONLY: "claude-sonnet-4-6",
      COPILOT_MODEL_PROPOSE: "claude-opus-4-6",
      DOCKER_CONTEXT: "dserver",
    })
    expect(result.success).toBe(true)
  })

  test("ANTHROPIC_API_KEY 누락 시 parse 실패", () => {
    const result = envSchema.safeParse({
      VOYAGE_API_KEY: "pa-test",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."))
      expect(paths).toContain("ANTHROPIC_API_KEY")
    }
  })

  test("ANTHROPIC_API_KEY가 빈 문자열이면 parse 실패", () => {
    const result = envSchema.safeParse({
      ANTHROPIC_API_KEY: "",
      VOYAGE_API_KEY: "pa-test",
    })
    expect(result.success).toBe(false)
  })

  test("D-09: ANTHROPIC_BASE_URL 누락 시 기본값 = cli-proxy-api", () => {
    const result = envSchema.parse({
      ANTHROPIC_API_KEY: "my-proxy-key",
      VOYAGE_API_KEY: "pa-test",
    })
    expect(result.ANTHROPIC_BASE_URL).toBe("http://192.168.0.5:8317")
  })

  test("D-09: ANTHROPIC_BASE_URL이 invalid URL이면 parse 실패", () => {
    const result = envSchema.safeParse({
      ANTHROPIC_BASE_URL: "not a url",
      ANTHROPIC_API_KEY: "my-proxy-key",
      VOYAGE_API_KEY: "pa-test",
    })
    expect(result.success).toBe(false)
  })

  test("D-10: COPILOT_MODEL_PROPOSE 기본값은 claude-opus-4-6 (4-7 아님)", () => {
    const result = envSchema.parse({
      ANTHROPIC_API_KEY: "my-proxy-key",
      VOYAGE_API_KEY: "pa-test",
    })
    expect(result.COPILOT_MODEL_READONLY).toBe("claude-sonnet-4-6")
    expect(result.COPILOT_MODEL_PROPOSE).toBe("claude-opus-4-6")
    expect(result.DOCKER_CONTEXT).toBe("dserver")
  })

  test("D-11: fallback 필드는 optional — 미설정도 parse 성공", () => {
    const result = envSchema.parse({
      ANTHROPIC_API_KEY: "my-proxy-key",
      VOYAGE_API_KEY: "pa-test",
    })
    expect(result.ANTHROPIC_FALLBACK_BASE_URL).toBeUndefined()
    expect(result.ANTHROPIC_FALLBACK_API_KEY).toBeUndefined()
    expect(hasFallback(result)).toBe(false)
  })

  test("D-11: fallback 둘 다 설정 시 hasFallback true", () => {
    const result = envSchema.parse({
      ANTHROPIC_API_KEY: "my-proxy-key",
      ANTHROPIC_FALLBACK_BASE_URL: "https://api.anthropic.com",
      ANTHROPIC_FALLBACK_API_KEY: "sk-ant-fallback",
      VOYAGE_API_KEY: "pa-test",
    })
    expect(hasFallback(result)).toBe(true)
    expect(result.ANTHROPIC_FALLBACK_BASE_URL).toBe("https://api.anthropic.com")
  })

  test("D-11: fallback URL만 있고 key 없으면 hasFallback false", () => {
    const result = envSchema.parse({
      ANTHROPIC_API_KEY: "my-proxy-key",
      ANTHROPIC_FALLBACK_BASE_URL: "https://api.anthropic.com",
      VOYAGE_API_KEY: "pa-test",
    })
    expect(hasFallback(result)).toBe(false)
  })
})
```
</action>
<acceptance_criteria>
- `src/env.test.ts` 존재 + `import { describe, expect, test } from "bun:test"` grep 가능
- `import` 라인에 `hasFallback` 포함
- `bun test src/env.test.ts` 종료 코드 0
- 출력에 `9 pass` (또는 `9 passed`) grep 가능
- `bun test`로도 (전체) 종료 코드 0
</acceptance_criteria>
</task>

<verification>
## 검증 (Phase 0 BOOT-04, BOOT-05 + D-09/D-10/D-11 부분 만족)

다음 모든 명령이 종료 코드 0을 반환해야 한다:

```bash
test -f package.json
test -f tsconfig.json
test -f bunfig.toml
test -f .env.example
test -f .gitignore
test -f src/env.ts
test -f src/env.test.ts
test -f src/docker-context-check.ts
grep -q '"hono"' package.json
grep -q '"@anthropic-ai/sdk"' package.json
grep -q '"voyageai"' package.json
grep -q '"zod"' package.json
grep -q '"diff"' package.json
grep -q '"htmx-ext-sse"' package.json
# D-09: cli-proxy-api 기본 endpoint
grep -q "^ANTHROPIC_BASE_URL=http://192.168.0.5:8317" .env.example
grep -q "^ANTHROPIC_API_KEY=my-proxy-key" .env.example
# D-11: fallback 필드 (commented out)
grep -q "^# ANTHROPIC_FALLBACK_BASE_URL=" .env.example
grep -q "^# ANTHROPIC_FALLBACK_API_KEY=" .env.example
# D-10: 4-6 모델 (4-7 아님)
grep -q "^COPILOT_MODEL_PROPOSE=claude-opus-4-6" .env.example
! grep -q "claude-opus-4-7" .env.example
grep -q "^COPILOT_MODEL_READONLY=claude-sonnet-4-6" .env.example
grep -q "^DOCKER_CONTEXT=" .env.example
grep -q "^VOYAGE_API_KEY=" .env.example
# src/env.ts schema
grep -q "z.object(" src/env.ts
grep -q "ANTHROPIC_BASE_URL" src/env.ts
grep -q "ANTHROPIC_FALLBACK_BASE_URL" src/env.ts
grep -q "hasFallback" src/env.ts
grep -q "process.exit(1)" src/env.ts
bunx tsc --noEmit
bun test src/env.test.ts
```

`bun test src/env.test.ts`가 9 pass.
`bunx tsc --noEmit`가 에러 없이 종료.

이 plan이 통과하면:
- BOOT-04 50% (검증 함수 작성, 실제 docker context 호출은 Spike 1에서)
- BOOT-05 100% (.env 6 키 + 2 optional fallback schema + startup guard)
- D-09 schema 차원 만족 (실제 proxy 호출 검증은 Spike 6 / 09-PLAN)
- D-10 lock-in (`claude-opus-4-6` 기본값)
- D-11 schema + helper (실제 fallback 동작 검증은 Spike 6)
- 후속 7개 plan의 토대 마련
</verification>
