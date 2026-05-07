import { describe, expect, test } from "bun:test"
import {
  ListContainersInput,
  ReadComposeInput,
  ReadLogsInput,
  TOOL_SCHEMAS,
} from "./_index"

// LOOP 03/04 prerequisite: TOOL_SCHEMAS가 Anthropic.Tool[] 형식과 호환되어야 한다.
// DESIGN.md correction #3 검증: z.toJSONSchema가 의미 있는 schema를 반환 (빈 {} 아님).

describe("tools/_index: TOOL_SCHEMAS shape", () => {
  test("TOOL_SCHEMAS는 정확히 4개 tool을 export한다 (3 read + proposePatch)", () => {
    expect(TOOL_SCHEMAS).toHaveLength(4)
  })

  test("D-B2 lock — applyPatch는 LLM에 노출 안 함 (internal call only)", () => {
    expect(TOOL_SCHEMAS.find((t) => t.name === "applyPatch")).toBeUndefined()
  })

  test("proposePatch schema에 stack, command, reasoning properties 존재 + reasoning maxLength=500", () => {
    const tool = TOOL_SCHEMAS.find((t) => t.name === "proposePatch")
    expect(tool).toBeDefined()
    const schema = tool!.input_schema as {
      properties?: Record<string, unknown>
    }
    expect(schema.properties).toBeDefined()
    expect(schema.properties!.stack).toBeDefined()
    expect(schema.properties!.command).toBeDefined()
    expect(schema.properties!.reasoning).toBeDefined()

    // D-D2 lock: reasoning max 500.
    const reasoningJson = JSON.stringify(schema.properties!.reasoning)
    expect(reasoningJson).toMatch(/"maxLength":\s*500/)
  })

  test("모든 schema의 input_schema.type === 'object' (Anthropic 호환)", () => {
    for (const tool of TOOL_SCHEMAS) {
      const schema = tool.input_schema as { type?: string }
      expect(schema.type).toBe("object")
    }
  })

  test("listContainers schema에 filter, limit properties 존재", () => {
    const tool = TOOL_SCHEMAS.find((t) => t.name === "listContainers")
    expect(tool).toBeDefined()
    const schema = tool!.input_schema as {
      properties?: Record<string, unknown>
    }
    expect(schema.properties).toBeDefined()
    expect(schema.properties!.filter).toBeDefined()
    expect(schema.properties!.limit).toBeDefined()
  })

  test("readLogs schema에 containerName, lines properties 존재 + lines maximum=1000", () => {
    const tool = TOOL_SCHEMAS.find((t) => t.name === "readLogs")
    expect(tool).toBeDefined()
    const schema = tool!.input_schema as {
      properties?: Record<string, unknown>
    }
    expect(schema.properties).toBeDefined()
    expect(schema.properties!.containerName).toBeDefined()
    expect(schema.properties!.lines).toBeDefined()

    // T-01-02-02 DoS mitigation: lines max 1000.
    const linesJson = JSON.stringify(schema.properties!.lines)
    expect(linesJson).toMatch(/"maximum":\s*1000/)
  })

  test("readCompose schema에 composePath property 존재", () => {
    const tool = TOOL_SCHEMAS.find((t) => t.name === "readCompose")
    expect(tool).toBeDefined()
    const schema = tool!.input_schema as {
      properties?: Record<string, unknown>
    }
    expect(schema.properties).toBeDefined()
    expect(schema.properties!.composePath).toBeDefined()
  })

  test("모든 input_schema가 빈 객체가 아니다 (DESIGN.md correction #3 회귀 방지)", () => {
    for (const tool of TOOL_SCHEMAS) {
      const json = JSON.stringify(tool.input_schema)
      expect(json.length).toBeGreaterThan(50)
      expect(json).not.toBe("{}")
    }
  })
})

describe("tools/_index: Zod schema parse 동작", () => {
  test("ListContainersInput.safeParse({}) 성공 — filter/limit 모두 default", () => {
    const result = ListContainersInput.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
    }
  })

  test("ReadLogsInput.safeParse({}) 실패 — containerName required", () => {
    const result = ReadLogsInput.safeParse({})
    expect(result.success).toBe(false)
  })

  test("ReadLogsInput.safeParse 정상 입력은 default 적용", () => {
    const result = ReadLogsInput.safeParse({ containerName: "news-prod-api" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.lines).toBe(200)
    }
  })

  test("ReadLogsInput.safeParse: lines > 1000 거부 (T-01-02-02 DoS)", () => {
    const result = ReadLogsInput.safeParse({
      containerName: "x",
      lines: 1000000,
    })
    expect(result.success).toBe(false)
  })

  test("ReadComposeInput.safeParse: composePath 빈 문자열 거부", () => {
    const result = ReadComposeInput.safeParse({ composePath: "" })
    expect(result.success).toBe(false)
  })
})
