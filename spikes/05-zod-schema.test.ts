import { describe, expect, test } from "bun:test"
import { z } from "zod"

// Spike 5 — Zod v4 z.toJSONSchema → Claude input_schema 호환 검증.
// 1개 대표 스키마: listContainers tool input.
// 나머지 4개 tool 스키마는 Phase 1에서 정의.

// listContainers tool input schema. Phase 1에서 그대로 재사용 가능하도록 정의.
const listContainersInput = z.object({
  filter: z
    .object({
      state: z.enum(["running", "stopped", "all"]).default("running"),
      namePattern: z.string().optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

describe("Spike 5: Zod v4 → Claude input_schema (BOOT-01)", () => {
  test("z.toJSONSchema가 정의되어 있다 (Zod v4 검증)", () => {
    expect(typeof z.toJSONSchema).toBe("function")
  })

  test("기본 변환은 type=object + properties 반환", () => {
    const schema = z.toJSONSchema(listContainersInput) as Record<string, unknown>
    expect(schema.type).toBe("object")
    expect(schema.properties).toBeDefined()
    expect(typeof schema.properties).toBe("object")
  })

  test("properties에 filter, limit 두 키가 모두 존재", () => {
    const schema = z.toJSONSchema(listContainersInput) as unknown as {
      properties: Record<string, unknown>
    }
    expect(schema.properties.filter).toBeDefined()
    expect(schema.properties.limit).toBeDefined()
  })

  test("limit는 number 타입 + 제약(min/max) 표현됨", () => {
    const schema = z.toJSONSchema(listContainersInput) as unknown as {
      properties: { limit: Record<string, unknown> }
    }
    const limitSchema = schema.properties.limit
    // Zod v4는 default를 별도 키로 표현하거나 anyOf로 표현할 수 있다.
    // 주요 검증: number 타입이 어딘가 있고 min=1/max=100 제약이 있다.
    const json = JSON.stringify(limitSchema)
    expect(json).toMatch(/"type":\s*"(integer|number)"/)
    expect(json).toMatch(/"minimum":\s*1/)
    expect(json).toMatch(/"maximum":\s*100/)
  })

  test("filter.state는 enum 타입으로 표현됨", () => {
    const schema = z.toJSONSchema(listContainersInput) as unknown as {
      properties: { filter: Record<string, unknown> }
    }
    const json = JSON.stringify(schema.properties.filter)
    // state enum의 3개 값이 모두 schema 안에 표현됨
    expect(json).toContain("running")
    expect(json).toContain("stopped")
    expect(json).toContain("all")
  })

  test("Anthropic input_schema 호환: 최상위 type/properties 키 존재", () => {
    // Anthropic tool-use API가 요구하는 최소 shape:
    //   { type: "object", properties: {...}, required?: [...] }
    const schema = z.toJSONSchema(listContainersInput) as Record<string, unknown>
    const requiredKeys = ["type", "properties"]
    for (const k of requiredKeys) {
      expect(schema).toHaveProperty(k)
    }
    expect(schema.type).toBe("object")
  })

  test("required 필드가 있는 스키마는 required 배열을 noun으로 표현", () => {
    const requiredFields = z.object({
      containerName: z.string().min(1),
      lines: z.number().int().min(1).max(1000),
    })
    const schema = z.toJSONSchema(requiredFields) as {
      type: string
      properties: Record<string, unknown>
      required?: string[]
    }
    expect(Array.isArray(schema.required)).toBe(true)
    expect(schema.required).toContain("containerName")
    expect(schema.required).toContain("lines")
  })

  test("모든 필드가 optional이면 required 배열은 빈 배열 또는 미정의", () => {
    const allOptional = z.object({
      a: z.string().optional(),
      b: z.number().optional(),
    })
    const schema = z.toJSONSchema(allOptional) as {
      required?: string[]
    }
    // Zod v4는 빈 required는 [] 또는 omit 둘 중 하나로 표현.
    if (schema.required !== undefined) {
      expect(schema.required.length).toBe(0)
    }
  })

  test("non-empty schema serializes to non-empty JSON (zod-to-json-schema 패키지 회귀 방지)", () => {
    // DESIGN.md correction #3: zod-to-json-schema 패키지는 Zod v4 입력에 대해 빈 {} 반환.
    // z.toJSONSchema 는 의미 있는 schema를 반환해야 한다.
    const schema = z.toJSONSchema(listContainersInput)
    const json = JSON.stringify(schema)
    expect(json.length).toBeGreaterThan(50) // 의미 있는 크기 (빈 {}는 길이 2)
    expect(json).not.toBe("{}")
  })
})
