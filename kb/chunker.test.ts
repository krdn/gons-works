// kb/chunker.test.ts — D-13.1 (필드 단위) + D-13.2 (자연어 템플릿) RED→GREEN.
//
// 검증 대상:
//   chunkStack(stackName, stack) → 5 chunk (purpose / depends_on / volumes / normal_log_pattern / key_log_locations)
//   chunkServicesYaml(yaml)      → 5 stack × 5 필드 = 25 chunk
//   classifyStack(containerName) → "news" / "ais" / "n8n" / "open-webui" / "krdn-fx" / null
//
// 핵심 자연어 패턴 (Spike 2 baseline sim=0.6308 보존):
//   - depends_on: "{stack} stack은 {a, b}에 의존한다."
//   - normal_log_pattern: "{stack} stack의 normal_log_pattern: \"{pattern}\". ..."
//   - 빈 슬롯: "정의 없음" 표시

import { test, expect, describe } from "bun:test"
import { load } from "js-yaml"
import {
  chunkStack,
  chunkServicesYaml,
  FIELD_TEMPLATES,
  type Chunk,
} from "./chunker"
import { classifyStack } from "./classify"
import { ServicesYamlSchema, type Stack } from "./schema"

// 가상 stack fixture (실제 services.yaml shape 모방).
const fixtureStack: Stack = {
  purpose: "테스트용 stack purpose",
  depends_on: ["news-postgres (PostgreSQL 15, port 5433)", "news-prod-redis (Redis alpine, port 6380)"],
  volumes: ["news-postgres-data", "news-redis-data"],
  normal_log_pattern: "RSS feed parsed: N items",
  key_log_locations: ["news-prod-api", "news-prod-worker"],
  containers: [],
}

describe("chunkStack — D-13.1 필드 단위", () => {
  test("1. chunkStack returns exactly 5 chunks (one per field)", () => {
    const chunks = chunkStack("news", fixtureStack)
    expect(chunks).toHaveLength(5)
  })

  test("2. chunk id pattern: '{stack}:{field}'", () => {
    const chunks = chunkStack("news", fixtureStack)
    const ids = chunks.map((c) => c.id).sort()
    expect(ids).toEqual([
      "news:depends_on",
      "news:key_log_locations",
      "news:normal_log_pattern",
      "news:purpose",
      "news:volumes",
    ])
  })

  test("3. depends_on 자연어: 'news stack은 ...에 의존한다.' 패턴", () => {
    const chunks = chunkStack("news", fixtureStack)
    const dep = chunks.find((c) => c.metadata.field === "depends_on")
    expect(dep).toBeDefined()
    expect(dep!.text).toContain("news stack은")
    expect(dep!.text).toContain("에 의존한다")
    expect(dep!.text).toContain("news-postgres")
  })

  test("4. 빈 array → '정의 없음' 표시", () => {
    const empty: Stack = { ...fixtureStack, depends_on: [] }
    const chunks = chunkStack("news", empty)
    const dep = chunks.find((c) => c.metadata.field === "depends_on")!
    expect(dep.text).toContain("정의 없음")
  })

  test("5. 빈 string normal_log_pattern → '정의 없음' 표시", () => {
    const empty: Stack = { ...fixtureStack, normal_log_pattern: "" }
    const chunks = chunkStack("news", empty)
    const log = chunks.find((c) => c.metadata.field === "normal_log_pattern")!
    expect(log.text).toContain("정의 없음")
  })

  test("6. metadata 필드 (stack, field) 모두 존재", () => {
    const chunks = chunkStack("news", fixtureStack)
    for (const c of chunks) {
      expect(c.metadata.stack).toBe("news")
      expect(c.metadata.field).toBeDefined()
      expect([
        "purpose",
        "depends_on",
        "volumes",
        "normal_log_pattern",
        "key_log_locations",
      ]).toContain(c.metadata.field)
    }
  })

  test("normal_log_pattern: pattern을 인용부호로 감싸고 안내 문구 포함", () => {
    const chunks = chunkStack("news", fixtureStack)
    const log = chunks.find((c) => c.metadata.field === "normal_log_pattern")!
    expect(log.text).toContain('"RSS feed parsed: N items"')
    // 안내 문구 (운영자가 패턴 부재 시 무엇을 의심해야 하는지)
    expect(log.text).toMatch(/(안 보이면|의심)/)
  })

  test("FIELD_TEMPLATES 5종 모두 export — RAG chunker 일관성", () => {
    const fields = Object.keys(FIELD_TEMPLATES).sort()
    expect(fields).toEqual([
      "depends_on",
      "key_log_locations",
      "normal_log_pattern",
      "purpose",
      "volumes",
    ])
  })
})

describe("chunkServicesYaml — D-13.1 N stack × 5 field", () => {
  test("7. state/services.yaml load → N stack × 5 field chunks", async () => {
    const raw = await Bun.file("state/services.yaml").text()
    const parsed = ServicesYamlSchema.parse(load(raw))
    const chunks = chunkServicesYaml(parsed)
    const stackCount = Object.keys(parsed.stacks).length
    expect(chunks).toHaveLength(stackCount * 5)
    // 모든 stack chunk 보유 — distinct stacks
    const stacks = new Set(chunks.map((c: Chunk) => c.metadata.stack))
    expect(stacks.size).toBe(stackCount)
  })
})

describe("classifyStack — stack 정규식 매핑", () => {
  test("8. classifyStack 모든 stack + null 모두 cover", () => {
    expect(classifyStack("news-prod-redis")).toBe("news")
    expect(classifyStack("news-postgres")).toBe("news")
    expect(classifyStack("ais-prod-web")).toBe("ais")
    expect(classifyStack("ais-collector-worker")).toBe("ais")
    expect(classifyStack("ai-afterschool-fsd-web")).toBe("ai-afterschool")
    expect(classifyStack("n8n")).toBe("n8n")
    expect(classifyStack("n8n-worker")).toBe("n8n")
    expect(classifyStack("open-webui")).toBe("open-webui")
    expect(classifyStack("openwebui")).toBe("open-webui")
    expect(classifyStack("krdn-fx-dashboard")).toBe("krdn-fx")
    expect(classifyStack("krdnfx-dashboard")).toBe("krdn-fx")
    // 2026-05-07 갱신: krdn-timescaledb는 krdn-fx 3-tier 일부.
    expect(classifyStack("krdn-timescaledb")).toBe("krdn-fx")
    // 2026-05-07 갱신: 운영자 도구 (vscode/cli-proxy-api)도 stack으로 승격.
    expect(classifyStack("vscode")).toBe("vscode")
    expect(classifyStack("cli-proxy-api")).toBe("cli-proxy-api")
    expect(classifyStack("gonsai2-frontend")).toBeNull()
    expect(classifyStack("nitter")).toBeNull()
  })
})
