// agent/system-prompt.test.ts — D-15.1 + D-15.4 + PITFALL #6 + 5 stack lock 검증.
//
// 실 LLM 호출 없음 — 문자열 contract만 검증. 변경 시 LLM 행동 회귀 보장.

import { describe, expect, test } from "bun:test"
import { SYSTEM_PROMPT, formatRagContext } from "./system-prompt"
import type { KbHit } from "../kb/index"

describe("SYSTEM_PROMPT contract", () => {
  test("한국어 응답 정책 명시 (UI-SPEC.md Copywriting Contract)", () => {
    expect(SYSTEM_PROMPT).toContain("한국어")
  })

  test("D-15.1 envelope 인용 규칙 명시 (problem/cause/fix/retryable + verbatim)", () => {
    expect(SYSTEM_PROMPT).toContain("problem")
    expect(SYSTEM_PROMPT).toContain("cause")
    expect(SYSTEM_PROMPT).toContain("fix")
    expect(SYSTEM_PROMPT).toContain("retryable")
    // verbatim 인용 또는 인용부호 표현 필수 — paraphrase 금지 의미가 들어가야 한다.
    const hasVerbatimRule = /verbatim|인용부호|paraphrase/.test(SYSTEM_PROMPT)
    expect(hasVerbatimRule).toBe(true)
  })

  test("5 핵심 stack 식별자 (PROJECT.md lock — news/ais/n8n/open-webui/krdn-fx)", () => {
    expect(SYSTEM_PROMPT).toContain("news")
    expect(SYSTEM_PROMPT).toContain("ais")
    expect(SYSTEM_PROMPT).toContain("n8n")
    expect(SYSTEM_PROMPT).toContain("open-webui")
    expect(SYSTEM_PROMPT).toContain("krdn-fx")
  })

  test("PITFALL #6: rag_context + log_context fence 모두 명시 (trusted vs untrusted)", () => {
    expect(SYSTEM_PROMPT).toContain("rag_context")
    expect(SYSTEM_PROMPT).toContain("log_context")
  })

  test("3 read tool 이름 명시 (tools/_index.ts 매칭)", () => {
    expect(SYSTEM_PROMPT).toContain("listContainers")
    expect(SYSTEM_PROMPT).toContain("readLogs")
    expect(SYSTEM_PROMPT).toContain("readCompose")
  })
})

describe("formatRagContext", () => {
  test("빈 배열 → 빈 문자열", () => {
    expect(formatRagContext([])).toBe("")
  })

  test("단일 hit → rag_context fence + stack.field + similarity 표시", () => {
    const hits: KbHit[] = [
      {
        id: "news:depends_on",
        text: "news stack은 news-postgres와 news-prod-redis에 의존한다.",
        stack: "news",
        field: "depends_on",
        similarity: 0.7,
      },
    ]
    const out = formatRagContext(hits)
    expect(out).toContain("rag_context")
    expect(out).toContain("news.depends_on")
    expect(out).toContain("0.700")
    expect(out).toContain("news-postgres")
    // fence 시작/종료 둘 다 있어야 한다 (LLM이 trust boundary 인식 가능).
    expect(out.startsWith('<rag_context source="services.yaml">')).toBe(true)
    expect(out).toContain("</rag_context>")
  })

  test("복수 hit → 각 hit이 [1] [2] 인덱스로 lines 분리", () => {
    const hits: KbHit[] = [
      { id: "a", text: "first", stack: "ais", field: "purpose", similarity: 0.9 },
      { id: "b", text: "second", stack: "n8n", field: "depends_on", similarity: 0.5 },
    ]
    const out = formatRagContext(hits)
    expect(out).toContain("[1]")
    expect(out).toContain("[2]")
    expect(out).toContain("ais.purpose")
    expect(out).toContain("n8n.depends_on")
  })
})
