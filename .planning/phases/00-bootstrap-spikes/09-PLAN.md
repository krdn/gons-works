---
plan_id: "00-09"
phase: 0
title: "Spike 6 — Anthropic SDK + cli-proxy-api roundtrip + fallback 검증"
wave: 2
depends_on: ["00-01"]
files_modified:
  - "spikes/06-proxy-fallback.test.ts"
  - "spikes/06-proxy-fallback.smoke.ts"
requirements: ["BOOT-01"]
covers_decisions: ["D-09", "D-10", "D-11"]
autonomous: true
estimated_minutes: 25
---

# 00-09: Spike 6 — Anthropic SDK + cli-proxy-api roundtrip + fallback 검증

<objective>
**D-09 (cli-proxy-api 채택), D-10 (claude-opus-4-6), D-11 (fallback)을 라이브 검증**한다. 2026-05-06 1차 raw curl 검증 결과(chat / tool-use / streaming / model-echo PASS)는 받았지만, **`@anthropic-ai/sdk@0.93.0` 라이브러리가 `baseURL` override를 통해 동일 path를 재현하는지** 그리고 **fallback 패턴이 의도대로 동작하는지**는 별도 검증이 필요하다.

`autonomous: true` — 외부 환경은 라이브 proxy(192.168.0.5:8317)만. 사용자 동반 없이 자동 실행 가능 (`.env`에 키 채워진 상태 가정).

**must_haves.truths:**
- D-09 (CONTEXT.md): `@anthropic-ai/sdk` 의 `baseURL` override가 `/v1/messages` 호환 proxy와 동작
- D-10 (CONTEXT.md): `claude-opus-4-6` 모델이 proxy 경유로 정상 응답
- D-11 (CONTEXT.md): fallback path는 primary 실패 시 자동으로 console.anthropic.com (또는 mock URL)으로 retry
- BOOT-01: Phase 1 LOOP-01 (agent loop) + UI-02 (named SSE events) 호환성을 phase 0에서 사전 검증

## Verification anchors

- `spikes/06-proxy-fallback.test.ts` 존재 + Anthropic SDK import + `baseURL` override 사용 + tool-use / streaming 검증
- `spikes/06-proxy-fallback.smoke.ts` 존재 + 라이브 proxy 호출 + 4가지 호환성(chat / tool-use / streaming / model echo) 모두 통과
- `bun test spikes/06-proxy-fallback.test.ts` 종료 코드 0
- `bun run spikes/06-proxy-fallback.smoke.ts` 종료 코드 0 (proxy 가용 시)
</objective>

<must_haves>
## Truths

- D-09: 1차 검증 (raw curl)은 통과. SDK 레이어 검증이 누락 — 이번 spike의 핵심.
- D-10: `/v1/models`에 `claude-opus-4-6` 존재 확인 (2026-05-06). proxy 응답에서 `model` echo 검증.
- D-11: fallback 동작은 primary가 죽었을 때만 발현 — 단위 테스트로 mock URL 사용해 retry 로직 검증.
- Phase 1 LOOP-01: agent loop가 SDK `messages.stream()` async iterable을 사용. tool-use 블록 페어링(LOOP-04) + history compaction(LOOP-05) 모두 SDK 동작에 의존.
- 가드: spike의 `tools` 입력은 `listContainers` 더미 정의로 한정. 실제 Phase 1 tool 정의와 무관.

## Failure path

- proxy 가용한데 SDK 통신 실패 → SDK 버전 mismatch 또는 `baseURL` 처리 차이. STACK.md `@anthropic-ai/sdk@0.93.0` lock 재검토 필요.
- proxy 다운 + fallback 미설정 → 정상 user-facing error (이건 spike 통과 시나리오).
- proxy 다운 + fallback 설정 → fallback path 동작 (이번 spike의 핵심 시나리오 중 하나).
</must_haves>

<task id="00-09-t01" type="execute">
<title>spikes/06-proxy-fallback.test.ts — fallback retry 로직 단위 테스트</title>
<read_first>
- 방금 만든 `src/env.ts` (envSchema, hasFallback)
- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` D-11
- `.planning/research/STACK.md` (Anthropic SDK 섹션)
</read_first>
<action>
`spikes/06-proxy-fallback.test.ts` 생성. fallback 로직을 모듈화해 단위 테스트:

```typescript
import { describe, expect, test } from "bun:test"

// Spike 6 단위 테스트 — fallback retry 로직 격리 검증.
// 실제 SDK 호출은 smoke test에서. 여기는 retry policy만 검증.
//
// 시나리오:
//   1. primary 성공 → 결과 그대로 반환, fallback 미호출
//   2. primary 실패 + fallback 설정 → fallback 호출, 성공 시 반환
//   3. primary 실패 + fallback 미설정 → primary 에러 그대로 throw
//   4. primary 실패 + fallback 도 실패 → fallback 에러 throw

interface CallResult {
  source: "primary" | "fallback"
  text: string
}

interface FallbackConfig {
  primary: () => Promise<CallResult>
  fallback?: () => Promise<CallResult>
}

// Phase 1 LLM 모듈에서 동일 패턴으로 구현될 함수의 spec.
async function callWithFallback(cfg: FallbackConfig): Promise<CallResult> {
  try {
    return await cfg.primary()
  } catch (primaryErr) {
    if (!cfg.fallback) throw primaryErr
    try {
      return await cfg.fallback()
    } catch (fallbackErr) {
      // 두 에러를 묶어서 throw (Phase 1에서 envelope로 변환 예정)
      throw new Error(
        `primary 실패 + fallback 실패. primary: ${(primaryErr as Error).message} / fallback: ${(fallbackErr as Error).message}`
      )
    }
  }
}

describe("Spike 6: fallback retry 로직 (D-11)", () => {
  test("primary 성공 시 fallback 호출 안 함", async () => {
    let fallbackCalled = false
    const result = await callWithFallback({
      primary: async () => ({ source: "primary", text: "ok-primary" }),
      fallback: async () => {
        fallbackCalled = true
        return { source: "fallback", text: "ok-fallback" }
      },
    })
    expect(result.source).toBe("primary")
    expect(result.text).toBe("ok-primary")
    expect(fallbackCalled).toBe(false)
  })

  test("primary 실패 + fallback 성공 시 fallback 결과 반환", async () => {
    const result = await callWithFallback({
      primary: async () => {
        throw new Error("ECONNREFUSED 192.168.0.5:8317")
      },
      fallback: async () => ({ source: "fallback", text: "ok-from-console" }),
    })
    expect(result.source).toBe("fallback")
    expect(result.text).toBe("ok-from-console")
  })

  test("primary 실패 + fallback 미설정 시 primary 에러 throw", async () => {
    const promise = callWithFallback({
      primary: async () => {
        throw new Error("ECONNREFUSED 192.168.0.5:8317")
      },
    })
    await expect(promise).rejects.toThrow("ECONNREFUSED")
  })

  test("primary 실패 + fallback 도 실패 시 결합 에러 throw", async () => {
    const promise = callWithFallback({
      primary: async () => {
        throw new Error("primary down")
      },
      fallback: async () => {
        throw new Error("fallback also down")
      },
    })
    await expect(promise).rejects.toThrow("primary 실패")
    await expect(promise).rejects.toThrow("fallback 실패")
  })

  test("fallback 함수가 정의되었는지 hasFallback과 일관", async () => {
    const cfg1: FallbackConfig = {
      primary: async () => ({ source: "primary", text: "x" }),
    }
    const cfg2: FallbackConfig = {
      primary: async () => ({ source: "primary", text: "x" }),
      fallback: async () => ({ source: "fallback", text: "y" }),
    }
    expect(cfg1.fallback).toBeUndefined()
    expect(typeof cfg2.fallback).toBe("function")
  })
})
```

이 단위 테스트는 SDK와 무관하게 retry policy만 검증한다. 실제 SDK + proxy 통신은 smoke test에서.
</action>
<acceptance_criteria>
- `spikes/06-proxy-fallback.test.ts` 존재
- 파일에 `callWithFallback` 함수 grep 가능
- 파일에 `D-11` 키워드 grep 가능
- 파일에 4 시나리오 모두 grep 가능 (primary 성공 / fallback 성공 / fallback 미설정 / 둘 다 실패)
- `bun test spikes/06-proxy-fallback.test.ts` 종료 코드 0
- 출력에 `5 pass` 표시
- `bunx tsc --noEmit` 종료 코드 0
- 외부 네트워크 무관하게 통과 (autonomous)
</acceptance_criteria>
</task>

<task id="00-09-t02" type="execute">
<title>spikes/06-proxy-fallback.smoke.ts — 라이브 proxy + SDK roundtrip</title>
<read_first>
- 방금 만든 `spikes/06-proxy-fallback.test.ts` (callWithFallback 패턴)
- `src/env.ts` (loadEnv)
- `.planning/research/STACK.md` Anthropic SDK 섹션 — `messages.stream()` async iterable 패턴
- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` D-09, D-10
</read_first>
<action>
`spikes/06-proxy-fallback.smoke.ts` 생성. 4가지 호환성을 SDK 레이어에서 재검증:

```typescript
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
```
</action>
<acceptance_criteria>
- `spikes/06-proxy-fallback.smoke.ts` 존재
- 파일에 `import Anthropic from "@anthropic-ai/sdk"` grep 가능
- 파일에 `new Anthropic({` + `baseURL: env.ANTHROPIC_BASE_URL` grep 가능
- 파일에 `client.messages.stream(` grep 가능 (LOOP-01 사전 검증)
- 파일에 `tools: [` 정의 grep 가능 (LOOP-04 사전 검증)
- 파일에 `env.COPILOT_MODEL_PROPOSE` 호출 (D-10 검증)
- 파일에 `Spike 6 PASS` / `Spike 6 FAIL` 메시지 grep 가능
- `bunx tsc --noEmit` 종료 코드 0
- 라이브 (proxy 가용 + .env 채워진 상태): `bun run spikes/06-proxy-fallback.smoke.ts` 종료 코드 0 + 출력에 `4/4 통과` + `Spike 6 PASS`
</acceptance_criteria>
</task>

<task id="00-09-t03" type="execute">
<title>state/SPIKE-6-RESULT.md 결과 기록</title>
<read_first>
- 방금 만든 `spikes/06-proxy-fallback.smoke.ts`
</read_first>
<action>
spike 6 실행 후 결과 기록:

```bash
bun run spikes/06-proxy-fallback.smoke.ts > /tmp/spike6.out 2>&1
SPIKE6_EXIT=$?
cat /tmp/spike6.out
```

종료 코드와 출력 발췌를 `state/SPIKE-6-RESULT.md`에 기록:

```markdown
# Spike 6 결과 — Anthropic SDK + cli-proxy-api roundtrip

**Date:** YYYY-MM-DD
**Status:** PASS | FAIL — <reason>
**baseURL:** http://192.168.0.5:8317 (cli-proxy-api)
**Models tested:**
  - readonly: claude-sonnet-4-6 (proxy 가용)
  - propose:  claude-opus-4-6 (D-10)

## 4 검증 결과

| # | 검증 항목 | 결과 | 메모 |
|---|----------|------|------|
| 1 | SDK chat (non-streaming) | PASS / FAIL | model echo + text 응답 |
| 2 | SDK tool-use roundtrip | PASS / FAIL | stop_reason=tool_use + tool_use block |
| 3 | SDK streaming (messages.stream) | PASS / FAIL | content_block_delta 이벤트 + finalMessage |
| 4 | claude-opus-4-6 (D-10) | PASS / FAIL | model echo |

## 출력 발췌

(spike 실행 출력 처음 30줄)

## D-09/D-10/D-11 lock-in 결정

PASS:
- D-09 채택 확정 — Phase 1 `agent/loop.ts`에서 동일 패턴 사용
- D-10 (`claude-opus-4-6`) 확정 — Phase 2 propose/apply 모델
- D-11 schema는 정의됨, 실제 fallback 통신 검증은 Phase 1 LLM 모듈 단계로 deferred

FAIL:
- D-09 재검토 — proxy 또는 SDK 호환성 issue 격리
- 사용자에게 console.anthropic.com 키 발급 권장 + .env 임시 swap
```
</action>
<acceptance_criteria>
- `state/SPIKE-6-RESULT.md` 존재
- `Status: PASS` 또는 `Status: FAIL — <reason>` grep 가능
- 4 검증 결과 표 grep 가능
- D-09/D-10/D-11 lock-in 결정 한 줄 이상 grep 가능
</acceptance_criteria>
</task>

<verification>
## 검증 (Spike 6 통과)

```bash
test -f spikes/06-proxy-fallback.test.ts
test -f spikes/06-proxy-fallback.smoke.ts
grep -q "callWithFallback" spikes/06-proxy-fallback.test.ts
grep -q "@anthropic-ai/sdk" spikes/06-proxy-fallback.smoke.ts
grep -q "baseURL: env.ANTHROPIC_BASE_URL" spikes/06-proxy-fallback.smoke.ts
grep -q "messages.stream(" spikes/06-proxy-fallback.smoke.ts
grep -q "env.COPILOT_MODEL_PROPOSE" spikes/06-proxy-fallback.smoke.ts
bun test spikes/06-proxy-fallback.test.ts
bunx tsc --noEmit
test -f state/SPIKE-6-RESULT.md
grep -E "Status: (PASS|FAIL)" state/SPIKE-6-RESULT.md
```

이 plan 통과 시:
- BOOT-01의 6/5+ spike (Phase 0 spike 6번째) ✓
- D-09/D-10 SDK 레이어 라이브 검증 완료
- D-11 schema + helper + 단위 테스트 완료 (실제 fallback 통신 검증은 Phase 1 LLM 모듈 단계)
- Phase 1 LOOP-01/LOOP-04/UI-02의 SDK 호환성 사전 검증
</verification>
