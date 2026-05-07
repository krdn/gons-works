import { describe, test, expect } from "bun:test"

import * as DockerContext from "./docker-context"

// tests/setup/docker-context.test.ts — Phase 2 D-A3
//
// 본 테스트는 두 가지를 검증한다:
//   1) helper 모듈이 switchToLocalContext / restoreContext 두 함수를 export한다.
//      (RED 단계 lock — 모듈 export 시그니처 강제. import resolution 실패 또는
//       export 누락 시 FAIL.)
//   2) E2E=1 환경에서 actual round-trip — DOCKER_CONTEXT 설정 + alpine 더미
//      stack up → ps에 2 컨테이너 → down + DOCKER_CONTEXT 복원.
//      (E2E=1 미설정 시 graceful skip.)

describe("docker-context helper — module shape (RED gate)", () => {
  test("exports switchToLocalContext as function", () => {
    expect(typeof (DockerContext as unknown as Record<string, unknown>).switchToLocalContext).toBe("function")
  })

  test("exports restoreContext as function", () => {
    expect(typeof (DockerContext as unknown as Record<string, unknown>).restoreContext).toBe("function")
  })
})

interface SavedContext {
  originalContext: string
  testStackUp: boolean
}

describe("docker-context helper — round-trip (E2E)", () => {
  test("switch + restore round-trip: DOCKER_CONTEXT 변환 + alpine 컨테이너 라이프사이클", async () => {
    if (process.env.E2E !== "1") {
      // graceful skip — Phase 1 patterns.md과 동일한 skip pattern.
      return
    }

    const exported = DockerContext as unknown as {
      switchToLocalContext: () => Promise<SavedContext>
      restoreContext: (saved: SavedContext) => Promise<void>
    }

    const original = process.env.DOCKER_CONTEXT
    const saved = await exported.switchToLocalContext()

    expect(process.env.DOCKER_CONTEXT).toBe("default")
    expect(saved.testStackUp).toBe(true)

    // 컨테이너 ps 확인
    const ps = Bun.spawn(
      ["docker", "--context", "default", "ps", "--format", "{{.Names}}"],
      { stdout: "pipe", stderr: "pipe" },
    )
    await ps.exited
    const names = (await new Response(ps.stdout).text())
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    expect(names).toContain("gons-test-svc-a")
    expect(names).toContain("gons-test-svc-b")

    await exported.restoreContext(saved)

    // DOCKER_CONTEXT가 원본 값으로 복원되었는지 확인
    if (original === undefined) {
      expect(process.env.DOCKER_CONTEXT).toBeUndefined()
    } else {
      expect(process.env.DOCKER_CONTEXT).toBe(original)
    }
  }, 120_000) // pull + up + down 시간 고려
})
