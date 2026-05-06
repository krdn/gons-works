---
plan_id: "00-06"
phase: 0
title: "Spike 5 — Zod v4 z.toJSONSchema → Claude input_schema 호환"
wave: 2
depends_on: ["00-01"]
files_modified:
  - "spikes/05-zod-schema.test.ts"
requirements: ["BOOT-01"]
autonomous: true
estimated_minutes: 15
---

# 00-06: Spike 5 — Zod v4 z.toJSONSchema → Claude input_schema 호환

<objective>
ROADMAP.md 우선순위 5 spike. **`zod-to-json-schema` 패키지는 Zod v4와 호환 안 됨** (DESIGN.md correction #3). Zod v4 내장 `z.toJSONSchema(schema)` 가 Anthropic Claude tool-use API의 `input_schema` 형태와 일치하는지 검증.

**범위 (D-06):** 1개 대표 스키마(`listContainers` input)로 검증. 나머지 4개 tool 스키마는 Phase 1 LOOP-* 작업 시 정의.

`autonomous: true` — 외부 API 호출 없이 순수 변환 검증.

**must_haves.truths:**
- DESIGN.md correction #3: Zod v4 내장 `z.toJSONSchema()` 사용. `zod-to-json-schema` 패키지는 빈 `{}` 반환하므로 비-사용.
- D-06 (CONTEXT.md): 1개 대표 스키마만 검증. 나머지는 Phase 1.
- BOOT-01 Spike 5: `z.toJSONSchema(schema)` 출력이 Claude `input_schema` 형태와 일치 (`type: "object"`, `properties`, `required`).
</objective>

<must_haves>
## Truths

- DESIGN.md correction #3: `z.toJSONSchema()` Zod v4 내장 함수 사용. zod-to-json-schema 패키지 비-사용.
- D-06: Spike 범위는 1개 대표 스키마만. tool wrapper 본 정의는 Phase 1.
- Anthropic tool-use input_schema 요구 형태 (https://docs.anthropic.com/en/api/messages):
  - `type: "object"` 최상위
  - `properties: { ...field defs... }`
  - `required: [...]` (선택, 빈 배열 허용)

## Verification anchors

- `spikes/05-zod-schema.test.ts` 존재 + `z.toJSONSchema` import + `z.object` schema 정의
- `bun test spikes/05-zod-schema.test.ts` 종료 코드 0
- 출력에 schema 형태 검증 결과 표시
</must_haves>

<task id="00-06-t01" type="execute">
<title>spikes/05-zod-schema.test.ts — Zod v4 schema 변환 검증</title>
<read_first>
- `.planning/research/STACK.md` (Zod v4 섹션 — `z.toJSONSchema` 사용 명시)
- `.planning/research/SUMMARY.md` correction #3
- `.planning/ROADMAP.md` Phase 0 Spike List 5번
- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` D-06
</read_first>
<action>
`spikes/05-zod-schema.test.ts` 생성:

```typescript
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
    const schema = z.toJSONSchema(listContainersInput) as {
      properties: Record<string, unknown>
    }
    expect(schema.properties.filter).toBeDefined()
    expect(schema.properties.limit).toBeDefined()
  })

  test("limit는 number 타입 + 제약(min/max) 표현됨", () => {
    const schema = z.toJSONSchema(listContainersInput) as {
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
    const schema = z.toJSONSchema(listContainersInput) as {
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
```
</action>
<acceptance_criteria>
- `spikes/05-zod-schema.test.ts` 존재
- 파일에 `z.toJSONSchema` 호출 grep 가능
- 파일에 `listContainers` tool input schema 정의 grep 가능
- 파일에 `z.enum(["running", "stopped", "all"])` grep 가능
- `bun test spikes/05-zod-schema.test.ts` 종료 코드 0
- 출력에 `9 pass` (또는 `9 passed`) grep 가능
- `bunx tsc --noEmit` 종료 코드 0
- 외부 API 호출 없이 통과 (autonomous: true)
</acceptance_criteria>
</task>

<verification>
## 검증 (Spike 5 통과)

```bash
test -f spikes/05-zod-schema.test.ts
grep -q 'z.toJSONSchema' spikes/05-zod-schema.test.ts
grep -q 'listContainersInput' spikes/05-zod-schema.test.ts
grep -q 'z.enum' spikes/05-zod-schema.test.ts
bun test spikes/05-zod-schema.test.ts
bunx tsc --noEmit
```

`bun test`가 9 pass.

이 plan 통과 시:
- Spike 5 ✓ green (BOOT-01의 5/5 spike)
- DESIGN.md correction #3이 검증됨 (`zod-to-json-schema` 패키지 비-사용 정당화)
- Phase 1 tool-use loop의 schema 변환 path 확정
</verification>
