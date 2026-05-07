// tools/proposePatch.test.ts — Plan 02-05 RED gate.
//
// 검증 대상:
//   - ProposePatchInput Zod schema strict (D-B1 7-command + D-A1 4-stack + reasoning max 500
//     + service required except 'compose ps' + fileEdit.path 화이트리스트).
//   - proposePatch service의 unified diff 생성, nonce, expiresAt, approval/store.setPending 등록,
//     ApprovalDecision Promise 반환 동작.

import { describe, expect, test, beforeEach } from "bun:test"
import { ProposePatchInput, proposePatch } from "./proposePatch"
import { _resetForTest, consumeApproval } from "../approval/store"

describe("proposePatch", () => {
  beforeEach(() => {
    _resetForTest()
  })

  describe("Zod schema", () => {
    test("정상 입력 — service 포함", () => {
      expect(() =>
        ProposePatchInput.parse({
          stack: "news",
          command: "compose restart",
          service: "news-prod-app",
          reasoning: "재시작 검증",
        }),
      ).not.toThrow()
    })

    test("service 누락 (compose down) 거부", () => {
      expect(() =>
        ProposePatchInput.parse({
          stack: "news",
          command: "compose down",
          reasoning: "test",
        }),
      ).toThrow()
    })

    test("service 없는 'compose ps' 허용", () => {
      expect(() =>
        ProposePatchInput.parse({
          stack: "news",
          command: "compose ps",
          reasoning: "ps only",
        }),
      ).not.toThrow()
    })

    test("fileEdit.path strict — 외부 경로 거부", () => {
      expect(() =>
        ProposePatchInput.parse({
          stack: "news",
          command: "compose restart",
          service: "news-prod-app",
          reasoning: "test",
          fileEdit: { path: "/etc/passwd", newContent: "x" },
        }),
      ).toThrow()
    })

    test("fileEdit.path 허용 — state/compose/{stack}.yml", () => {
      expect(() =>
        ProposePatchInput.parse({
          stack: "news",
          command: "compose restart",
          service: "news-prod-app",
          reasoning: "test",
          fileEdit: { path: "state/compose/news.yml", newContent: "x" },
        }),
      ).not.toThrow()
    })

    test("fileEdit.path 허용 — state/services.yaml", () => {
      expect(() =>
        ProposePatchInput.parse({
          stack: "ais",
          command: "compose up -d",
          service: "ais-prod-web",
          reasoning: "test",
          fileEdit: { path: "state/services.yaml", newContent: "x" },
        }),
      ).not.toThrow()
    })

    test("reasoning > 500자 거부 (D-D2 lock)", () => {
      expect(() =>
        ProposePatchInput.parse({
          stack: "news",
          command: "compose restart",
          service: "news-prod-app",
          reasoning: "a".repeat(501),
        }),
      ).toThrow()
    })

    test("reasoning 빈 문자열 거부 (D-D2 lock)", () => {
      expect(() =>
        ProposePatchInput.parse({
          stack: "news",
          command: "compose restart",
          service: "news-prod-app",
          reasoning: "",
        }),
      ).toThrow()
    })

    test("4-stack 외 (open-webui) 거부 — Option A scope (v2 backlog)", () => {
      expect(() =>
        ProposePatchInput.parse({
          stack: "open-webui",
          command: "compose restart",
          service: "open-webui",
          reasoning: "test",
        }),
      ).toThrow()
    })

    test("D-B1 외 command 거부 (예: 'compose pull')", () => {
      expect(() =>
        ProposePatchInput.parse({
          stack: "news",
          command: "compose pull",
          service: "news-prod-app",
          reasoning: "test",
        }),
      ).toThrow()
    })
  })

  describe("proposePatch service", () => {
    test("no fileEdit — diff 배너 + nonce(UUID) + expiresAt 2분", async () => {
      const before = Date.now()
      const { result, decision } = await proposePatch(
        {
          stack: "news",
          command: "compose restart",
          service: "news-prod-app",
          reasoning: "재시작",
        },
        { sessionId: "s1", userPrompt: "restart news api" },
      )
      // diff 배너
      expect(result.diff).toMatch(/no file change/)
      expect(result.diff).toContain("compose restart")
      // nonce — UUID v4 형식
      expect(result.nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      // expiresAt = Date.now() + 120_000 (±200ms tolerance — 시스템 부하 고려)
      expect(result.expiresAt).toBeGreaterThanOrEqual(before + 120_000 - 200)
      expect(result.expiresAt).toBeLessThanOrEqual(before + 120_000 + 200)
      // service / stack / reasoning passthrough
      expect(result.stack).toBe("news")
      expect(result.command).toBe("compose restart")
      expect(result.service).toBe("news-prod-app")
      expect(result.reasoning).toBe("재시작")
      // fileEdit 없음
      expect(result.fileEdit).toBeUndefined()

      // decision Promise는 미해결
      let resolved = false
      decision.then(() => {
        resolved = true
      })
      await new Promise((r) => setTimeout(r, 10))
      expect(resolved).toBe(false)
    })

    test("with fileEdit — jsdiff unified format (---, +++, @@)", async () => {
      // state/services.yaml은 phase 1에 이미 존재 (234 lines).
      const { result } = await proposePatch(
        {
          stack: "news",
          command: "compose restart",
          service: "news-prod-app",
          reasoning: "test",
          fileEdit: { path: "state/services.yaml", newContent: "stacks: {}\n" },
        },
        { sessionId: "s2", userPrompt: "wipe yaml" },
      )
      // jsdiff createPatch — multiline anchors
      expect(result.diff).toMatch(/^---/m)
      expect(result.diff).toMatch(/^\+\+\+/m)
      expect(result.diff).toMatch(/@@/)
      // previousContent 보존 (D-A5 (iii) rollback용)
      expect(result.fileEdit?.previousContent.length).toBeGreaterThan(0)
      expect(result.fileEdit?.path).toBe("state/services.yaml")
      expect(result.fileEdit?.newContent).toBe("stacks: {}\n")
    })

    test("with fileEdit (파일 없음) — previousContent 빈 문자열 + 0→new diff", async () => {
      // state/compose/{stack}.yml 미러는 plan 02-04 placeholder/일부 미생성 시 빈 디렉토리.
      // 화이트리스트 path 중 하나를 사용해 파일 미존재 분기 검증.
      // 실제 존재 여부와 무관하게 — previousContent는 string 타입이며 diff는 @@ 헤더 포함.
      const path = "state/compose/krdn-fx.yml"
      const { result } = await proposePatch(
        {
          stack: "krdn-fx",
          command: "compose restart",
          service: "krdn-fx-dashboard",
          reasoning: "test missing",
          fileEdit: { path, newContent: "version: '3.8'\n" },
        },
        { sessionId: "s4", userPrompt: "edit" },
      )
      expect(typeof result.fileEdit?.previousContent).toBe("string")
      expect(result.diff).toMatch(/@@/)
    })

    test("decision Promise resolve via consumeApproval(approved)", async () => {
      const { result, decision } = await proposePatch(
        {
          stack: "news",
          command: "compose ps",
          reasoning: "ps 확인",
        },
        { sessionId: "s3", userPrompt: "ps" },
      )
      consumeApproval("s3", result.nonce, { type: "approved" })
      await expect(decision).resolves.toEqual({ type: "approved" })
    })

    test("decision Promise resolve via consumeApproval(rejected)", async () => {
      const { result, decision } = await proposePatch(
        {
          stack: "ais",
          command: "compose stop",
          service: "ais-prod-web",
          reasoning: "임시 중지",
        },
        { sessionId: "s5", userPrompt: "stop" },
      )
      consumeApproval("s5", result.nonce, { type: "rejected" })
      await expect(decision).resolves.toEqual({ type: "rejected" })
    })

    test("setPending 등록 — 같은 sessionId 중복 호출 시 throw", async () => {
      await proposePatch(
        {
          stack: "n8n",
          command: "compose ps",
          reasoning: "first",
        },
        { sessionId: "s6", userPrompt: "first" },
      )
      // 두 번째 호출은 D-C4 single-pending 위반으로 throw
      await expect(
        proposePatch(
          {
            stack: "n8n",
            command: "compose ps",
            reasoning: "second",
          },
          { sessionId: "s6", userPrompt: "second" },
        ),
      ).rejects.toThrow(/already exists/i)
    })
  })
})
