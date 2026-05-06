import { describe, expect, test } from "bun:test"

// Spike 6 단위 테스트 — fallback retry 로직 격리 검증.
// 실제 SDK 호출은 smoke test에서. 여기는 retry policy만 검증.
//
// 시나리오 (D-11):
//   1. primary 성공 → 결과 그대로 반환, fallback 미호출
//   2. primary 실패 + fallback 설정 → fallback 호출, 성공 시 반환
//   3. primary 실패 + fallback 미설정 → primary 에러 그대로 throw
//   4. primary 실패 + fallback 도 실패 → fallback 에러 throw

interface CallResult {
  source: "primary" | "fallback"
  text: string
}

interface FallbackConfig {
  primary: () => Promise<CallResult>
  fallback?: () => Promise<CallResult>
}

// Phase 1 LLM 모듈에서 동일 패턴으로 구현될 함수의 spec.
async function callWithFallback(cfg: FallbackConfig): Promise<CallResult> {
  try {
    return await cfg.primary()
  } catch (primaryErr) {
    if (!cfg.fallback) throw primaryErr
    try {
      return await cfg.fallback()
    } catch (fallbackErr) {
      // 두 에러를 묶어서 throw (Phase 1에서 envelope로 변환 예정)
      throw new Error(
        `primary 실패 + fallback 실패. primary: ${(primaryErr as Error).message} / fallback: ${(fallbackErr as Error).message}`
      )
    }
  }
}

describe("Spike 6: fallback retry 로직 (D-11)", () => {
  test("primary 성공 시 fallback 호출 안 함", async () => {
    let fallbackCalled = false
    const result = await callWithFallback({
      primary: async () => ({ source: "primary", text: "ok-primary" }),
      fallback: async () => {
        fallbackCalled = true
        return { source: "fallback", text: "ok-fallback" }
      },
    })
    expect(result.source).toBe("primary")
    expect(result.text).toBe("ok-primary")
    expect(fallbackCalled).toBe(false)
  })

  test("primary 실패 + fallback 성공 시 fallback 결과 반환", async () => {
    const result = await callWithFallback({
      primary: async () => {
        throw new Error("ECONNREFUSED 192.168.0.5:8317")
      },
      fallback: async () => ({ source: "fallback", text: "ok-from-console" }),
    })
    expect(result.source).toBe("fallback")
    expect(result.text).toBe("ok-from-console")
  })

  test("primary 실패 + fallback 미설정 시 primary 에러 throw", async () => {
    const promise = callWithFallback({
      primary: async () => {
        throw new Error("ECONNREFUSED 192.168.0.5:8317")
      },
    })
    await expect(promise).rejects.toThrow("ECONNREFUSED")
  })

  test("primary 실패 + fallback 도 실패 시 결합 에러 throw", async () => {
    const promise = callWithFallback({
      primary: async () => {
        throw new Error("primary down")
      },
      fallback: async () => {
        throw new Error("fallback also down")
      },
    })
    await expect(promise).rejects.toThrow("primary 실패")
    await expect(promise).rejects.toThrow("fallback 실패")
  })

  test("fallback 함수가 정의되었는지 hasFallback과 일관", async () => {
    const cfg1: FallbackConfig = {
      primary: async () => ({ source: "primary", text: "x" }),
    }
    const cfg2: FallbackConfig = {
      primary: async () => ({ source: "primary", text: "x" }),
      fallback: async () => ({ source: "fallback", text: "y" }),
    }
    expect(cfg1.fallback).toBeUndefined()
    expect(typeof cfg2.fallback).toBe("function")
  })
})
