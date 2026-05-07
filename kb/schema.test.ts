import { describe, expect, test } from "bun:test"
import { ContainerRefSchema, ServicesYamlSchema, StackSchema } from "./schema"

describe("kb/schema (D-12.4 strict Zod)", () => {
  test("parse 성공: 4 슬롯 모두 채워진 valid yaml object", () => {
    const obj = {
      generated_at: "2026-05-06T11:04:05.868Z",
      generated_from: "docker --context home-server ps -a --format json",
      stacks: {
        news: {
          purpose: "RSS 수집 + 요약 워커",
          depends_on: ["news-postgres (5433)", "news-prod-redis (6380)"],
          volumes: ["news-postgres-data"],
          normal_log_pattern: "RSS feed parsed: 12 items",
          key_log_locations: ["news-prod-api", "news-prod-worker"],
          containers: [
            {
              name: "news-prod-api",
              image: "news-sentiment-prod-api",
              state: "running",
              status: "Up 8 days",
            },
          ],
        },
      },
    }
    const result = ServicesYamlSchema.parse(obj)
    expect(result).toBeDefined()
    expect(result.stacks.news?.depends_on).toHaveLength(2)
    expect(result.stacks.news?.normal_log_pattern).toBe("RSS feed parsed: 12 items")
  })

  test("parse 실패: depends_on에 number 포함하면 ZodError", () => {
    const obj = {
      generated_at: "2026-05-06T11:04:05.868Z",
      generated_from: "docker ps",
      stacks: {
        bad: {
          purpose: "test",
          depends_on: ["ok-string", 1234], // number — 실패
          volumes: [],
          normal_log_pattern: "",
          key_log_locations: [],
          containers: [],
        },
      },
    }
    expect(() => ServicesYamlSchema.parse(obj)).toThrow()
  })

  test("default 적용: 빈 stack entry는 4 슬롯이 default로 채워짐", () => {
    const minimal = {
      generated_at: "2026-05-06T11:04:05.868Z",
      generated_from: "docker ps",
      stacks: {
        empty: {
          purpose: "empty stack for default test",
        },
      },
    }
    const result = ServicesYamlSchema.parse(minimal)
    expect(result.stacks.empty?.depends_on).toEqual([])
    expect(result.stacks.empty?.volumes).toEqual([])
    expect(result.stacks.empty?.normal_log_pattern).toBe("")
    expect(result.stacks.empty?.key_log_locations).toEqual([])
    expect(result.stacks.empty?.containers).toEqual([])
  })

  test("D-12.4: stacks는 Record<string, Stack> — 키 강제하지 않음", () => {
    const obj = {
      generated_at: "2026-05-06T11:04:05.868Z",
      generated_from: "docker ps",
      stacks: {
        "any-key-name": {
          purpose: "free-form key allowed",
        },
        "another-stack": {
          purpose: "second stack",
        },
      },
    }
    const result = ServicesYamlSchema.parse(obj)
    expect(Object.keys(result.stacks)).toHaveLength(2)
  })

  test("D-12.4: unmatched_containers는 optional", () => {
    const without = {
      generated_at: "2026-05-06T11:04:05.868Z",
      generated_from: "docker ps",
      stacks: {},
    }
    expect(ServicesYamlSchema.parse(without).unmatched_containers).toBeUndefined()

    const withList = {
      ...without,
      unmatched_containers: [
        { name: "vscode", image: "codercom/code-server", state: "running" },
      ],
    }
    const parsed = ServicesYamlSchema.parse(withList)
    expect(parsed.unmatched_containers).toHaveLength(1)
  })

  test("StackSchema purpose는 비어있으면 실패 (min 1)", () => {
    expect(() =>
      StackSchema.parse({
        purpose: "",
      }),
    ).toThrow()
  })

  test("ContainerRefSchema status는 optional", () => {
    const ref = {
      name: "test",
      image: "test:latest",
      state: "running",
    }
    expect(ContainerRefSchema.parse(ref)).toBeDefined()
  })

  test("실제 state/services.yaml 파싱 성공 (E2E)", async () => {
    const { load } = await import("js-yaml")
    const text = await Bun.file("state/services.yaml").text()
    const obj = load(text)
    const result = ServicesYamlSchema.parse(obj)
    expect(Object.keys(result.stacks)).toContain("news")
    expect(Object.keys(result.stacks)).toContain("ais")
    expect(Object.keys(result.stacks)).toContain("n8n")
    expect(Object.keys(result.stacks)).toContain("open-webui")
    expect(Object.keys(result.stacks)).toContain("krdn-fx")
    // 2026-05-07 갱신: 운영자 도구 + ai-afterschool 신규 stack.
    expect(Object.keys(result.stacks)).toContain("ai-afterschool")
    expect(Object.keys(result.stacks)).toContain("vscode")
    expect(Object.keys(result.stacks)).toContain("cli-proxy-api")
    // krdn-fx는 paused 마커 — 운영자 의도된 stop.
    expect(result.stacks["krdn-fx"]?.paused).toBe(true)
    // 모든 stack의 4 슬롯이 비-empty
    for (const [name, stack] of Object.entries(result.stacks)) {
      expect(stack.depends_on.length, `${name} depends_on`).toBeGreaterThan(0)
      expect(stack.volumes.length, `${name} volumes`).toBeGreaterThan(0)
      expect(stack.normal_log_pattern.length, `${name} normal_log_pattern`).toBeGreaterThan(0)
      expect(stack.key_log_locations.length, `${name} key_log_locations`).toBeGreaterThan(0)
    }
  })
})
