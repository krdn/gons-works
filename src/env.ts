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
