---
plan_id: "00-05"
phase: 0
title: "Spike 3 — Hono streamSSE → htmx-ext-sse roundtrip"
wave: 2
depends_on: ["00-01"]
files_modified:
  - "spikes/03-sse-roundtrip/server.ts"
  - "spikes/03-sse-roundtrip/index.html"
  - "spikes/03-sse-roundtrip/README.md"
requirements: ["BOOT-01"]
autonomous: false
estimated_minutes: 25
---

# 00-05: Spike 3 — Hono streamSSE → htmx-ext-sse roundtrip

<objective>
ROADMAP.md 우선순위 3 spike. **htmx 2.x core에서 SSE가 제거되었다** (DESIGN.md correction #4). `htmx-ext-sse@2.2.4`를 별도 로드해야 SSE가 동작한다. Hono의 `streamSSE` 헬퍼와 wire 호환성을 사전 검증.

**범위 (D-07):** 최소 Hono 서버 + 1개 더미 SSE endpoint. agent loop 연결 안 함 (Phase 1).

통과 기준 (ROADMAP.md): 브라우저가 `text-delta` 이벤트를 실시간 수신.

`autonomous: false` — 브라우저 수동 확인 필요.

**must_haves.truths:**
- DESIGN.md correction #4: htmx-ext-sse@2.2.4 별도 로드. htmx 2.x core가 SSE 미지원.
- D-07 (CONTEXT.md): 더미 endpoint 범위. agent loop는 Phase 1.
- D-01 (CONTEXT.md): Spike 코드는 `spikes/03-sse-roundtrip/` 디렉토리 격리.
- BOOT-01 Spike 3: 브라우저가 `text-delta` 이벤트 실시간 수신.
</objective>

<must_haves>
## Truths

- DESIGN.md correction #4: `htmx-ext-sse@2.2.4` 별도 ext, htmx 2.x core 비-호환.
- D-07: 더미 endpoint + 5개 chunk + 브라우저 수동 확인. agent loop는 Phase 1.
- Hono `streamSSE` from `hono/streaming` (STACK.md lock).
- Failure path (ROADMAP.md): SSE 이벤트 이름 mismatch 디버깅, `Content-Type: text/event-stream` 헤더 확인.

## Verification anchors

- `spikes/03-sse-roundtrip/server.ts` 존재 + Hono import + `streamSSE` 사용 + named event (`text-delta`) emission
- `spikes/03-sse-roundtrip/index.html` 존재 + htmx 2.x CDN + `htmx-ext-sse` 2.2.4 CDN + `hx-ext="sse"` + `sse-swap="text-delta"`
- `bun run spikes/03-sse-roundtrip/server.ts` 가 hono 서버 시작
- 브라우저로 `http://localhost:5173/`(또는 선택 포트) 접속 시 5개 chunk가 순차적으로 표시
</must_haves>

<task id="00-05-t01" type="execute">
<title>spikes/03-sse-roundtrip/server.ts — Hono + streamSSE 더미 endpoint</title>
<read_first>
- `.planning/research/STACK.md` (Hono / streamSSE / htmx-ext-sse 섹션)
- `.planning/research/SUMMARY.md` correction #4
- `.planning/ROADMAP.md` Phase 0 Spike List 3번
- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` D-07
</read_first>
<action>
`spikes/03-sse-roundtrip/server.ts` 생성:

```typescript
#!/usr/bin/env bun
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Spike 3 — Hono streamSSE → htmx-ext-sse roundtrip.
// 더미 endpoint 1개 + 정적 HTML 1개. agent loop 연결 없음 (Phase 1).

const PORT = Number(Bun.env.SPIKE_PORT ?? 5173)
const app = new Hono()

const indexHtmlPath = join(import.meta.dir, "index.html")
const indexHtml = readFileSync(indexHtmlPath, "utf8")

app.get("/", (c) => c.html(indexHtml))

// SSE endpoint. Phase 1과 동일한 named event 패턴.
app.get("/sse-test", (c) => {
  return streamSSE(c, async (stream) => {
    const chunks = [
      "안녕, ",
      "이건 ",
      "Spike 3 ",
      "스트림 ",
      "테스트입니다.",
    ]
    for (const chunk of chunks) {
      await stream.writeSSE({
        event: "text-delta",
        data: JSON.stringify({ text: chunk }),
      })
      await stream.sleep(400) // 5개 청크 × 400ms
    }
    await stream.writeSSE({
      event: "final",
      data: JSON.stringify({ message: "Spike 3 PASS" }),
    })
  })
})

console.log(`[Spike 3] Hono server listening on http://localhost:${PORT}`)
console.log(`[Spike 3] 브라우저로 위 URL을 열고 "Start" 버튼을 누르세요.`)
console.log(`[Spike 3] 5개 chunk가 순차 표시되면 PASS, "final" 후 자동 종료.`)

export default {
  port: PORT,
  fetch: app.fetch,
}
```
</action>
<acceptance_criteria>
- `spikes/03-sse-roundtrip/server.ts` 존재
- 파일에 `import { Hono } from "hono"` grep 가능
- 파일에 `import { streamSSE } from "hono/streaming"` 정확히 grep 가능
- 파일에 `event: "text-delta"` grep 가능
- 파일에 `event: "final"` grep 가능
- 파일에 5개 chunk 배열 grep 가능
- `bunx tsc --noEmit` 종료 코드 0
- (라이브) `bun run spikes/03-sse-roundtrip/server.ts` 시작 시 listening 메시지 출력
</acceptance_criteria>
</task>

<task id="00-05-t02" type="execute">
<title>spikes/03-sse-roundtrip/index.html — htmx 2.x + ext-sse</title>
<read_first>
- 방금 만든 `spikes/03-sse-roundtrip/server.ts` (named event 이름)
- `.planning/research/STACK.md` (htmx + htmx-ext-sse 섹션)
</read_first>
<action>
`spikes/03-sse-roundtrip/index.html` 생성. 보안: textContent + DOM API만 사용 (innerHTML 사용 금지):

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>Spike 3 — SSE roundtrip</title>
    <!-- htmx 2.x core -->
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
    <!-- htmx-ext-sse 2.2.4 (DESIGN.md correction #4: htmx 2.x core에서 SSE 제거됨) -->
    <script src="https://unpkg.com/htmx-ext-sse@2.2.4"></script>
    <style>
      body { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; padding: 2rem; max-width: 720px; margin: 0 auto; }
      #log { white-space: pre-wrap; padding: 1rem; background: #f5f5f5; border-radius: 4px; min-height: 4rem; }
      .meta { color: #888; font-size: 0.85em; margin-top: 1rem; }
      button { padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; }
      .ok { color: #0a7d23; font-weight: bold; }
    </style>
  </head>
  <body>
    <h1>Spike 3 — SSE roundtrip</h1>
    <p>htmx 2.x + <code>htmx-ext-sse@2.2.4</code> 로 Hono <code>streamSSE</code> 와 통신.</p>

    <button id="start" type="button">Start (Connect SSE)</button>

    <div id="container" style="margin-top: 1rem;">
      <div id="log" hx-ext="sse" sse-connect="/sse-test">(아직 connect 안 됨)</div>
      <div id="final-area"></div>
    </div>

    <p class="meta">
      통과 기준: 위 영역에 "안녕, 이건 Spike 3 스트림 테스트입니다." 가 5조각으로 차례차례 누적 표시되면 OK.
      이벤트 이름이 mismatch면 아무것도 표시되지 않으니 DevTools Network → EventStream 탭으로 확인.
    </p>

    <script>
      // 보안: 모든 DOM 변형은 textContent 또는 createElement + appendChild로만.
      // SSE payload는 외부 데이터로 간주하므로 innerHTML 비-사용.
      var startBtn = document.getElementById("start")
      var logEl = document.getElementById("log")
      var finalEl = document.getElementById("final-area")

      startBtn.addEventListener("click", function () {
        // placeholder를 textContent로 비우기 (innerHTML 비-사용)
        logEl.textContent = ""
      })

      // htmx-ext-sse가 디스패치하는 sseMessage 이벤트.
      // type === "text-delta" 또는 "final" 분기.
      window.addEventListener("htmx:sseMessage", function (evt) {
        var detail = evt.detail
        if (!detail || typeof detail.data !== "string") return
        try {
          var parsed = JSON.parse(detail.data)
          if (detail.type === "text-delta" && typeof parsed.text === "string") {
            // textContent로만 누적 (innerHTML 절대 비-사용 — XSS 방지)
            logEl.appendChild(document.createTextNode(parsed.text))
            evt.preventDefault()
          } else if (detail.type === "final" && typeof parsed.message === "string") {
            // ok class를 가진 div를 createElement로 생성해서 textContent 채우기
            var ok = document.createElement("div")
            ok.className = "ok"
            ok.textContent = parsed.message
            // 기존 final-area 자식 제거 후 새 div 추가
            while (finalEl.firstChild) finalEl.removeChild(finalEl.firstChild)
            finalEl.appendChild(ok)
            evt.preventDefault()
          }
        } catch (e) {
          // JSON parse 실패는 무시 (다른 SSE 메시지일 수 있음)
        }
      })
    </script>
  </body>
</html>
```

이 spike는 의도적으로 htmx의 declarative `sse-connect` + JS event listener 패턴을 보여준다. 보안 원칙: 외부 SSE 페이로드는 절대 innerHTML로 삽입하지 않음 (textContent + createElement 만 사용).
</action>
<acceptance_criteria>
- `spikes/03-sse-roundtrip/index.html` 존재
- 파일에 `https://unpkg.com/htmx.org@2.0` (htmx 2.x CDN) grep 가능
- 파일에 `https://unpkg.com/htmx-ext-sse@2.2.4` 정확한 버전 grep 가능
- 파일에 `hx-ext="sse"` grep 가능
- 파일에 `sse-connect="/sse-test"` grep 가능
- 파일에 `htmx:sseMessage` 이벤트 listener grep 가능
- 파일에 `innerHTML` **비**-사용 (`grep -c innerHTML index.html` 가 0)
- 파일에 `textContent` 사용 grep 가능
- 파일에 `createTextNode` 또는 `createElement` 사용 grep 가능
</acceptance_criteria>
</task>

<task id="00-05-t03" type="execute">
<title>spikes/03-sse-roundtrip/README.md + 라이브 검증</title>
<read_first>
- 방금 만든 `server.ts`와 `index.html`
</read_first>
<action>
`spikes/03-sse-roundtrip/README.md` 생성:

```markdown
# Spike 3 — Hono streamSSE → htmx-ext-sse roundtrip

## 실행

```bash
bun run spikes/03-sse-roundtrip/server.ts
```

브라우저 http://localhost:5173 접속 → "Start" 클릭 → 5개 chunk가 순차 표시되면 PASS.

## 통과 기준

- 5개 청크("안녕, ", "이건 ", "Spike 3 ", "스트림 ", "테스트입니다.")가 ~400ms 간격으로 누적 표시
- "Spike 3 PASS" final 메시지 표시
- DevTools Network → EventStream 탭에서 `event: text-delta` × 5 + `event: final` × 1 확인 가능

## 실패 시 디버깅

1. 아무것도 표시 안 됨:
   - Network 탭 → EventStream 응답 확인. `text/event-stream` content-type인가?
   - htmx-ext-sse 버전이 정확히 2.2.4인가? (1.x는 다른 API)
   - `hx-ext="sse"` 속성이 div에 붙어 있는가?

2. JSON.stringify 결과가 raw로 표시:
   - `htmx:sseMessage` listener에서 parse + textContent 패턴이 동작하는지 확인.

3. final 이벤트 미동작:
   - parseHandler 가 `detail.type === "final"` 분기를 타는지 console.log로 확인.

## Phase 1과의 차이

이 spike는 wire 검증만. Phase 1에서는:
- agent loop 연결 (Claude tool-use → text-delta + tool-start + tool-result + final)
- error 이벤트 + reconnect idempotency token (LOOP-07)
- htmx UI 한 줄 입력 form + SSE response area (UI-01..UI-04)

## 보안 메모

이 spike는 외부 SSE 페이로드를 textContent + createElement로만 DOM에 삽입한다. innerHTML 비-사용. Phase 1 UI도 같은 패턴 유지 (Phase 2에서 sanitization 강화).
```

**라이브 검증 (사용자 실행):**

```bash
bun run spikes/03-sse-roundtrip/server.ts
# 다른 터미널 또는 브라우저로 http://localhost:5173 접속
# "Start" 버튼 클릭 후 5개 청크 + final 메시지 확인
```

결과를 `state/SPIKE-3-RESULT.md`에 기록:

```markdown
# Spike 3 결과 — Hono SSE roundtrip

**Date:** YYYY-MM-DD
**Status:** PASS | FAIL — <reason>
**Browser tested:** Firefox / Chrome / etc
**Chunks received:** 5 (expected) | N (FAIL)
**Final event:** received | not received

## 출력 / 스크린샷

(가능하면 DevTools Network → EventStream 스크린샷 첨부)
```
</action>
<acceptance_criteria>
- `spikes/03-sse-roundtrip/README.md` 존재
- README에 통과 기준 (5 청크 + final) grep 가능
- README에 디버깅 가이드 (Content-Type, ext-sse 버전) grep 가능
- README에 보안 메모 (innerHTML 비-사용) 한 줄 이상 grep 가능
- 라이브: `bun run spikes/03-sse-roundtrip/server.ts` 가 5초 이상 idle 실행
- `state/SPIKE-3-RESULT.md` 생성 + Status grep 가능
</acceptance_criteria>
</task>

<verification>
## 검증 (Spike 3 통과)

```bash
test -f spikes/03-sse-roundtrip/server.ts
test -f spikes/03-sse-roundtrip/index.html
test -f spikes/03-sse-roundtrip/README.md
grep -q 'streamSSE' spikes/03-sse-roundtrip/server.ts
grep -q 'event: "text-delta"' spikes/03-sse-roundtrip/server.ts
grep -q 'event: "final"' spikes/03-sse-roundtrip/server.ts
grep -q 'htmx-ext-sse@2.2.4' spikes/03-sse-roundtrip/index.html
grep -q 'hx-ext="sse"' spikes/03-sse-roundtrip/index.html
grep -q 'sse-connect="/sse-test"' spikes/03-sse-roundtrip/index.html
grep -c innerHTML spikes/03-sse-roundtrip/index.html
# 위 grep -c 결과가 0이어야 함 (innerHTML 비-사용)
grep -q 'textContent' spikes/03-sse-roundtrip/index.html
bunx tsc --noEmit
test -f state/SPIKE-3-RESULT.md
grep -E "Status: (PASS|FAIL)" state/SPIKE-3-RESULT.md
```

이 plan 통과 시: Spike 3 ✓ green (BOOT-01의 3/5 spike). DESIGN.md correction #4가 라이브로 검증됨.
</verification>
