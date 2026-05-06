import { describe, expect, test } from "bun:test"
import { envSchema, hasFallback } from "./env"
import { join } from "node:path"

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

describe("loadEnv FRICTION #8 (빈 셸 환경 변수)", () => {
  // loadEnv()는 process.exit(1)을 부르므로 subprocess로 격리해서 검증한다.
  // child stderr에 친절한 에러 envelope이 그대로 출력되는지만 확인.

  const projectRoot = join(import.meta.dir, "..")

  test("ANTHROPIC_API_KEY=''로 호출하면 [BOOT-05] FRICTION #8 stderr 출력 + exit 1", async () => {
    const proc = Bun.spawn(
      ["bun", "-e", "import('./src/env').then(({ loadEnv }) => loadEnv())"],
      {
        cwd: projectRoot,
        env: {
          // 빈 ANTHROPIC_API_KEY 시뮬레이션 (FRICTION #8 셸 export 시나리오)
          // VOYAGE_API_KEY는 정상 — 이 케이스가 ANTHROPIC만 빈 값임을 격리
          ANTHROPIC_API_KEY: "",
          VOYAGE_API_KEY: "pa-fake",
          PATH: process.env.PATH ?? "",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    expect(exitCode).toBe(1)
    expect(stderr).toContain("[BOOT-05]")
    expect(stderr).toContain("FRICTION #8")
    expect(stderr).toContain("unset ANTHROPIC_API_KEY")
  })

  test("ANTHROPIC_API_KEY 정상 + 다른 키 누락이면 일반 BOOT-05 envelope (FRICTION #8 분기 아님)", async () => {
    // Bun이 cwd의 .env를 자동 로드하므로, .env가 없는 임시 cwd로 spawn하고
    // src/env.ts는 절대 import 경로로 호출해 부모 .env 자동 로드를 우회한다.
    const envPath = join(projectRoot, "src/env")
    const proc = Bun.spawn(
      ["bun", "-e", `import('${envPath}').then(({ loadEnv }) => loadEnv())`],
      {
        cwd: "/tmp",
        env: {
          ANTHROPIC_API_KEY: "ok",
          // VOYAGE_API_KEY 누락 → 일반 schema 검증 실패
          PATH: process.env.PATH ?? "",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    expect(exitCode).toBe(1)
    expect(stderr).toContain("[BOOT-05]")
    // FRICTION #8 분기는 트리거되지 않아야 함 (.env 일반 검증 envelope)
    expect(stderr).not.toContain("FRICTION #8")
    expect(stderr).toContain("VOYAGE_API_KEY")
  })
})
