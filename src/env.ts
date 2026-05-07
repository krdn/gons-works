import { readFileSync } from "node:fs"
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

// .env 파일에서 특정 key를 직접 읽는다 — Bun 자동 로드 우회 케이스 감지용 (FRICTION #8 확장).
// 파일 부재/parse 실패 시 null. 따옴표/주석/공백 처리.
function readDotenvKey(key: string): string | null {
  try {
    const text = readFileSync(".env", "utf8")
    const lines = text.split(/\r?\n/)
    const prefix = `${key}=`
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      if (!trimmed.startsWith(prefix)) continue
      let value = trimmed.slice(prefix.length)
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      return value
    }
    return null
  } catch {
    return null
  }
}

// startup guard. .env 파싱 실패 시 { problem, cause, fix } envelope로 종료.
export function loadEnv(): Env {
  // FRICTION #8: 셸 export가 Bun .env 자동 로드를 silently 덮어씀.
  // (1) 빈 문자열 — 명시적 차단.
  // (2) 옛날 키가 셸에 남아 있음 — .env 값과 mismatch면 셸 값이 사용됨.
  // 두 케이스 모두 운영자 디버깅 비용을 사전에 잘라낸다 (401 Invalid API key 헛수고 방지).
  const rawKey = Bun.env.ANTHROPIC_API_KEY
  if (rawKey !== undefined && rawKey === "") {
    const problem: EnvProblem = {
      problem: "ANTHROPIC_API_KEY가 빈 문자열 (FRICTION #8)",
      cause: "셸에 ANTHROPIC_API_KEY=가 빈 값으로 export되어 .env 자동 로드를 덮어씀",
      fix: "현재 셸에서 'unset ANTHROPIC_API_KEY' 실행 후 서버를 재시작하세요",
    }
    console.error(`[BOOT-05] ${problem.problem}`)
    console.error(`원인: ${problem.cause}`)
    console.error(`해결: ${problem.fix}`)
    process.exit(1)
  }

  // FRICTION #8 확장: 셸 export 값이 .env 값과 mismatch이면 .env가 무시되고 있음.
  // .env 파일을 직접 읽어 비교 — Bun 자동 로드 동작을 보강한다 (테스트 모드는 skip).
  const dotenvKey = readDotenvKey("ANTHROPIC_API_KEY")
  if (
    dotenvKey !== null &&
    rawKey !== undefined &&
    dotenvKey !== rawKey &&
    Bun.env.NODE_ENV !== "test"
  ) {
    const problem: EnvProblem = {
      problem: "ANTHROPIC_API_KEY 셸 export가 .env를 덮어쓰는 중 (FRICTION #8 확장)",
      cause: `셸 prefix=${rawKey.slice(0, 8)}... (${rawKey.length}자) vs .env prefix=${dotenvKey.slice(0, 8)}... (${dotenvKey.length}자)`,
      fix: "현재 셸에서 'unset ANTHROPIC_API_KEY' 실행 후 서버를 재시작하세요",
    }
    console.error(`[BOOT-05] ${problem.problem}`)
    console.error(`원인: ${problem.cause}`)
    console.error(`해결: ${problem.fix}`)
    process.exit(1)
  }

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
