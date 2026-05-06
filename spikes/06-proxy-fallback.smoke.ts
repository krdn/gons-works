#!/usr/bin/env bun
import Anthropic from "@anthropic-ai/sdk"
import { loadEnv } from "../src/env"

// Spike 6 — Anthropic SDK + cli-proxy-api roundtrip 검증.
// D-09, D-10 라이브 검증. proxy(192.168.0.5:8317)에 의존.
//
// 검증 항목:
//   1. SDK chat (non-streaming) — text 응답 + model echo
//   2. SDK tool-use roundtrip — tool_use block + stop_reason
//   3. SDK streaming (messages.stream) — async iterable + content_block_delta
//   4. claude-opus-4-6 (D-10) 모델 응답
//
// fallback 단위 테스트는 06-proxy-fallback.test.ts. 여기는 SDK roundtrip 만.

interface SmokeResult {
  step: string
  ok: boolean
  detail?: string
}

const results: SmokeResult[] = []

function record(step: string, ok: boolean, detail?: string): void {
  results.push({ step, ok, detail })
  const mark = ok ? "✓" : "✗"
  console.log(`[Spike 6] ${mark} ${step}${detail ? ` — ${detail}` : ""}`)
}

async function main(): Promise<void> {
  const env = loadEnv()
  console.log(`[Spike 6] baseURL=${env.ANTHROPIC_BASE_URL}`)
  console.log(`[Spike 6] readonly model=${env.COPILOT_MODEL_READONLY}`)
  console.log(`[Spike 6] propose model=${env.COPILOT_MODEL_PROPOSE}`)
  console.log("")

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL,
  })

  // 1. Chat (non-streaming) + model echo
  try {
    const msg = await client.messages.create({
      model: env.COPILOT_MODEL_READONLY,
      max_tokens: 30,
      messages: [{ role: "user", content: "reply with single word: ok" }],
    })
    const echoed = msg.model
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
    record(
      "1. SDK chat",
      echoed === env.COPILOT_MODEL_READONLY && text.length > 0,
      `model echo=${echoed}, text="${text.slice(0, 20)}"`
    )
  } catch (e) {
    record("1. SDK chat", false, (e as Error).message)
  }

  // 2. Tool-use roundtrip
  try {
    const msg = await client.messages.create({
      model: env.COPILOT_MODEL_READONLY,
      max_tokens: 200,
      tools: [
        {
          name: "list_containers",
          description: "List Docker containers",
          input_schema: {
            type: "object" as const,
            properties: {
              filter: { type: "string", description: "name filter" },
            },
          },
        },
      ],
      messages: [
        { role: "user", content: "List the containers. Use the tool." },
      ],
    })
    const toolUse = msg.content.find((b) => b.type === "tool_use")
    record(
      "2. SDK tool-use",
      msg.stop_reason === "tool_use" && toolUse !== undefined,
      `stop=${msg.stop_reason}, tool=${toolUse?.type === "tool_use" ? toolUse.name : "none"}`
    )
  } catch (e) {
    record("2. SDK tool-use", false, (e as Error).message)
  }

  // 3. Streaming (messages.stream)
  try {
    const stream = client.messages.stream({
      model: env.COPILOT_MODEL_READONLY,
      max_tokens: 50,
      messages: [{ role: "user", content: "count 1 2 3" }],
    })
    let deltaCount = 0
    let finalText = ""
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        deltaCount++
        finalText += event.delta.text
      }
    }
    const finalMsg = await stream.finalMessage()
    record(
      "3. SDK streaming",
      deltaCount > 0 && finalMsg.stop_reason === "end_turn",
      `${deltaCount} text_delta events, final stop=${finalMsg.stop_reason}, text="${finalText.slice(0, 30)}"`
    )
  } catch (e) {
    record("3. SDK streaming", false, (e as Error).message)
  }

  // 4. claude-opus-4-6 (D-10)
  try {
    const msg = await client.messages.create({
      model: env.COPILOT_MODEL_PROPOSE,
      max_tokens: 30,
      messages: [{ role: "user", content: "reply with single word: ready" }],
    })
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
    record(
      "4. claude-opus-4-6 (D-10)",
      msg.model === env.COPILOT_MODEL_PROPOSE && text.length > 0,
      `model echo=${msg.model}, text="${text.slice(0, 20)}"`
    )
  } catch (e) {
    record("4. claude-opus-4-6 (D-10)", false, (e as Error).message)
  }

  // 결과 요약
  console.log("")
  const passed = results.filter((r) => r.ok).length
  console.log(`[Spike 6] ${passed}/${results.length} 통과`)
  if (passed === results.length) {
    console.log("[Spike 6 PASS] D-09 + D-10 SDK 레이어 검증 완료")
    process.exit(0)
  } else {
    console.log("[Spike 6 FAIL] 일부 검증 실패. 상세:")
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  ✗ ${r.step}: ${r.detail ?? "(no detail)"}`)
    }
    console.log("\nFallback path: console.anthropic.com 직접 호출로 임시 전환 + proxy 점검")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("[Spike 6 FAIL] 예외:", e)
  process.exit(1)
})
