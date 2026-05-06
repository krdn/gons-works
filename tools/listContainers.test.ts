// tools/listContainers.test.ts — READ-01 sanity (E2E 게이트로 라이브 검증 보존)
//
// docker는 외부 프로세스 — bun:test의 mock으로 Bun.$ template literal을 가짜화하기 어렵다.
// 대신 export shape + 시그니처 sanity만 단위 테스트하고, 실제 docker 호출은
// E2E 게이트(`process.env.E2E === "1"`)로 gate한다.
// 라이브 검증은 verify-phase 시점에 24+ 컨테이너 enumeration 확인.

import { describe, expect, test } from "bun:test"
import { listContainers, type DockerContainer } from "./listContainers"

describe("tools/listContainers — export shape + E2E sanity", () => {
  test("listContainers는 function이고 0 또는 1 인자를 받는다", () => {
    expect(typeof listContainers).toBe("function")
    // args가 default값을 가지므로 length는 0
    expect(listContainers.length).toBeLessThanOrEqual(1)
  })

  test("DockerContainer 타입은 4 필드 — TS compile에서 검증된다", () => {
    // TS 컴파일이 이 객체를 통과시키는 것이 검증.
    const sample: DockerContainer = {
      name: "news-prod-api",
      image: "news-prod-api:latest",
      state: "running",
      status: "Up 2 days",
    }
    expect(sample.name).toBe("news-prod-api")
    expect(sample.image).toBe("news-prod-api:latest")
    expect(sample.state).toBe("running")
    expect(sample.status).toBe("Up 2 days")
  })

  // E2E 게이트 — `E2E=1 bun test tools/listContainers.test.ts`로 활성화.
  test.skipIf(process.env.E2E !== "1")(
    "[E2E] listContainers({ limit: 5 })가 5개 이하 컨테이너 반환",
    async () => {
      const result = await listContainers({ limit: 5 })
      // ToolError가 아니라면 배열이고 length <= 5
      if (Array.isArray(result)) {
        expect(result.length).toBeLessThanOrEqual(5)
        for (const c of result) {
          expect(typeof c.name).toBe("string")
          expect(typeof c.state).toBe("string")
        }
      } else {
        // env가 미설정이면 ToolError envelope — 그것도 valid envelope shape 검증
        expect(typeof result.problem).toBe("string")
        expect(typeof result.retryable).toBe("boolean")
      }
    },
  )
})
