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
