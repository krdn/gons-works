// tools/proposePatch.ts — APPLY-01 unified diff 제안 + D-B1/B2/D2 lock.
//
// Public API:
//   ProposePatchInput  — Zod schema strict (D-B1 7-command union literal +
//                        D-A1 Option A 4-stack + D-D2 reasoning 필수 max 500
//                        + service refine + fileEdit.path 화이트리스트).
//   proposePatch()     — args 파싱 → fileEdit이 있으면 jsdiff createPatch로 unified diff 생성,
//                        없으면 "(no file change — command only: ...)" 배너 → crypto.randomUUID()로
//                        nonce → approval/store.setPending 등록 → ApprovalDecision Promise를 별도
//                        반환 (LOOP가 await).
//
// 핵심 결정 (.planning/phases/02-propose-apply-approval-gate/02-CONTEXT.md):
//   - D-B1: 7-union command literal — AI 자유 + deny-list 우회를 화이트리스트로 차단.
//   - D-B2: 단일 propose tool, apply 단계는 LLM 미노출 — internal call after approval.
//   - D-D2: reasoning 필수, max 500 — git commit body의 AI-Reasoning이 됨.
//   - D-A1 (Option A): 4-stack(news / ais / n8n / krdn-fx). 5번째 stack은 plain docker run으로 v2 backlog.
//
// 패턴 analog (Phase 1):
//   - Zod schema export + z.infer<>: tools/_index.ts:16-39 (ListContainersInput 등).
//   - _envelope.run() wrap: LOOP가 dispatch("proposePatch", ...) 호출 시점에 wrap (02-07).
//                            본 service는 순수 함수.

import { createPatch } from "diff"
import { z } from "zod"
import {
  setPending,
  type ApprovalDecision,
  type ComposeCommand,
  type Stack,
} from "../approval/store"

// === Zod schema ===

// D-B1 7-command union literal — approval/store.ts:22-29 ComposeCommand와 1:1 매칭.
// D-A1 Option A 4-stack — 5번째 stack은 plain docker run이라 제외 (v2 backlog).
// D-D2 reasoning min 1 + max 500 — D-D1 git commit body source.
// service refine — 'compose ps'는 svc 없이 OK, 나머지는 필수.
// fileEdit.path 화이트리스트 — state/compose/{stack}.yml 또는 state/services.yaml만.
export const ProposePatchInput = z
  .object({
    stack: z.enum(["news", "ais", "n8n", "krdn-fx"]),
    command: z.union([
      z.literal("compose up -d"),
      z.literal("compose down"),
      z.literal("compose restart"),
      z.literal("compose start"),
      z.literal("compose stop"),
      z.literal("compose logs --tail=200"),
      z.literal("compose ps"),
    ]),
    service: z.string().min(1).optional(),
    fileEdit: z
      .object({
        path: z.string(),
        newContent: z.string(),
      })
      .optional(),
    reasoning: z.string().min(1).max(500),
  })
  .superRefine((val, ctx) => {
    if (val.command !== "compose ps" && (!val.service || val.service.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "service 필드는 'compose ps' 외 필수",
        path: ["service"],
      })
    }
    if (val.fileEdit) {
      const allowed = [`state/compose/${val.stack}.yml`, "state/services.yaml"]
      if (!allowed.includes(val.fileEdit.path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `fileEdit.path는 ${allowed.join(" 또는 ")}만 허용`,
          path: ["fileEdit", "path"],
        })
      }
    }
  })

export type ProposePatchArgs = z.infer<typeof ProposePatchInput>

// === Result shape ===

// SSE approval-required event payload + LOOP가 보관할 raw payload 둘 다 포함.
// applyPatch(02-06)는 fileEdit.previousContent를 D-A5 (iii) 원격 동기화 fail 시 rollback에 사용.
export interface ProposePatchResult {
  nonce: string
  stack: ProposePatchArgs["stack"] // narrow 4-union 유지 (5-union 광역화 금지)
  command: ComposeCommand
  service: string // 'compose ps'에서는 빈 문자열 (undefined 아님 — SSE 표시 일관성)
  diff: string
  reasoning: string
  expiresAt: number
  fileEdit?: {
    path: string
    newContent: string
    previousContent: string
  }
}

// === Service ===

/**
 * proposePatch — args 파싱 + diff 생성 + setPending Promise 반환.
 *
 * 호출 흐름 (LOOP-side, 02-07):
 *   1. dispatch("proposePatch", input, turnId) → run("proposePatch", () => proposePatch(...))
 *   2. result emit "approval-required" SSE
 *   3. await decision (consumeApproval 또는 expirePending까지 대기)
 *   4. decision.type === "approved"     → applyPatch 호출
 *      decision.type === "edited"       → applyPatch에 newContent 갱신해서 호출
 *      decision.type === "rejected" /
 *                       "aborted" /
 *                       "expired"       → ToolError envelope return
 *
 * @param args ProposePatchArgs — Zod parsed
 * @param ctx  LOOP가 주입하는 컨텍스트 (sessionId + userPrompt — D-D1 commit body source)
 * @returns    { result, decision } — result는 SSE emit용, decision Promise는 LOOP가 await
 */
export async function proposePatch(
  args: ProposePatchArgs,
  ctx: { sessionId: string; userPrompt: string },
): Promise<{ result: ProposePatchResult; decision: Promise<ApprovalDecision> }> {
  const parsed = ProposePatchInput.parse(args)

  // diff 생성 — fileEdit이 있으면 jsdiff createPatch, 없으면 배너.
  let diff: string
  let previousContent: string | undefined
  if (parsed.fileEdit) {
    try {
      previousContent = await Bun.file(parsed.fileEdit.path).text()
    } catch {
      // 파일 없는 경우 — diff는 0→new 전체 추가 (Bun.file().text()는 ENOENT 시 throw).
      previousContent = ""
    }
    diff = createPatch(
      parsed.fileEdit.path,
      previousContent,
      parsed.fileEdit.newContent,
      "current",
      "proposed",
    )
  } else {
    const svcSuffix = parsed.service ? ` ${parsed.service}` : ""
    diff = `(no file change — command only: ${parsed.command}${svcSuffix})`
  }

  const nonce = crypto.randomUUID()
  const expiresAt = Date.now() + 120_000 // PITFALL #3 prevention 코드 (2분)
  const service = parsed.service ?? "" // SSE 표시 일관성 (undefined 아님)

  // setPending — D-C4 single-pending. 같은 sessionId 중복 호출 시 throw 전파 (LOOP가 ToolError로 변환).
  const decision = setPending(ctx.sessionId, {
    nonce,
    diff,
    stack: parsed.stack as Stack, // narrow 4-union → 5-union widening (TS-safe)
    command: parsed.command,
    service,
    fileEdit: parsed.fileEdit,
    reasoning: parsed.reasoning,
    user_prompt: ctx.userPrompt,
    expiresAt,
  })

  const result: ProposePatchResult = {
    nonce,
    stack: parsed.stack,
    command: parsed.command,
    service,
    diff,
    reasoning: parsed.reasoning,
    expiresAt,
    fileEdit: parsed.fileEdit
      ? {
          path: parsed.fileEdit.path,
          newContent: parsed.fileEdit.newContent,
          previousContent: previousContent ?? "",
        }
      : undefined,
  }

  return { result, decision }
}
