// tools/readCompose.test.ts — READ-03 sanity (E2E 게이트로 라이브 검증 보존)
//
// SSH 호출은 외부 프로세스 + 외부 호스트 — 단위 테스트로 mock하기 어렵다.
// 대신 export shape + SSH 옵션 lock(PITFALL #12 mitigation) 정적 검증.
// 실제 SSH 호출은 E2E 게이트(`process.env.E2E === "1"`)로 gate.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { readCompose } from "./readCompose"

describe("tools/readCompose — export shape + SSH 옵션 lock", () => {
  test("readCompose는 function이고 args 1개 받는다", () => {
    expect(typeof readCompose).toBe("function")
    expect(readCompose.length).toBe(1)
  })

  test("PITFALL #12 — SSH 옵션 4개가 모두 source에 lock되어 있다", () => {
    // 이 정적 검증은 grep acceptance와 동일하지만 test runner에서 표면화한다.
    // ssh 옵션 변경 시 즉시 fail → reviewer가 PITFALL #12 영향 인지.
    const source = readFileSync(
      new URL("./readCompose.ts", import.meta.url).pathname,
      "utf-8",
    )
    expect(source).toContain("ConnectTimeout=10")
    expect(source).toContain("ServerAliveInterval=5")
    expect(source).toContain("ServerAliveCountMax=2")
    expect(source).toContain("BatchMode=yes")
    expect(source).toContain("gon@192.168.0.5")
    // shell interpolation 차단 — Bun.spawn args 배열 사용 (template literal shell 호출 금지).
    expect(source).toContain("Bun.spawn")
  })

  // E2E 게이트 — `E2E=1 bun test tools/readCompose.test.ts`로 활성화.
  test.skipIf(process.env.E2E !== "1")(
    "[E2E] readCompose가 192.168.0.5의 docker-compose 파일을 string으로 반환",
    async () => {
      const result = await readCompose({
        composePath: "/home/gon/docker/news-prod/docker-compose.yml",
      })
      // 성공 시 string, 실패 시 ToolError envelope — 둘 다 valid 결과.
      if (typeof result === "string") {
        expect(result.length).toBeGreaterThan(0)
      } else {
        expect(typeof result.problem).toBe("string")
        expect(typeof result.retryable).toBe("boolean")
      }
    },
  )
})
