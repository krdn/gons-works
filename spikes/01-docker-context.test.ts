import { describe, expect, test } from "bun:test"
import { ensureDockerContext } from "../src/docker-context-check"

interface DockerPsRow {
  ID: string
  Names: string
  Image: string
  State: string
  Status: string
}

// docker --format json 출력 NDJSON 파싱 로직만 격리해서 테스트.
function parseNdjson(raw: string): DockerPsRow[] {
  const lines = raw.trim().split("\n").filter((l) => l.length > 0)
  return lines.map((l) => JSON.parse(l) as DockerPsRow)
}

describe("Spike 1 단위 테스트 (BOOT-01)", () => {
  test("NDJSON 빈 출력은 빈 배열로 파싱", () => {
    expect(parseNdjson("")).toEqual([])
    expect(parseNdjson("\n\n  \n")).toEqual([])
  })

  test("NDJSON 한 줄당 한 객체 파싱", () => {
    const raw = `{"ID":"abc","Names":"news-prod-api","Image":"news:latest","State":"running","Status":"Up 3 days"}
{"ID":"def","Names":"ais-prod-web","Image":"ais:latest","State":"running","Status":"Up 1 hour"}`
    const rows = parseNdjson(raw)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.Names).toBe("news-prod-api")
    expect(rows[1]?.State).toBe("running")
  })

  test("ensureDockerContext: 존재하지 않는 context는 ok=false 반환 (mock 없이 실제 docker 명령 호출)", async () => {
    // 거의 확실히 존재하지 않을 임의 이름.
    const result = await ensureDockerContext("__gons_nonexistent_context_xyz__")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem.problem).toContain("__gons_nonexistent_context_xyz__")
      expect(result.problem.fix).toBeTruthy()
    }
  })
})
