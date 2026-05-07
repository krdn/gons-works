---
phase: 01-read-only-knowledge-layer
plan: 08
subsystem: ui
tags:
  - htmx
  - htmx-ext-sse
  - sse
  - vanilla-css
  - dark-terminal
  - korean-ui
  - frontend

requires:
  - phase: 01-read-only-knowledge-layer/07
    provides: "Hono /chat-stream SSE endpoint, /static/{htmx.min.js,sse.js} 화이트리스트 serving, POST /chat 응답에 sse-connect div"
  - phase: 01-read-only-knowledge-layer/06
    provides: "agent/sse.ts SseEvent 6 union type names — UI 측 detail.type 분기와 1:1 매핑"
provides:
  - "public/index.html 단일 파일 (~403 lines) — 다크 터미널 운영자 콘솔"
  - "6 SSE event handler (text-delta/tool-start/tool-result/final/error/drift)"
  - "UI-04 #drift-banner sticky header (KB-03 / D-13.4 amber 경고)"
  - "D-15.2 #error-banner 빨간 배너, D-15.1 fix verbatim monospace"
  - "UI-03 .tool-event 카드 — Map<name, element>로 start↔result 페어링"
  - "한국어 copywriting (placeholder/CTA/empty state/labels) 그대로 반영"
  - "raw HTML 파싱 비-사용 — XSS 차단 (T-01-08-01/02 mitigation)"
affects:
  - phase-1-09  # smoke test (live integration)
  - phase-2-*   # 5-key 승인 게이트 / proposePatch UI는 이 frontend 위에 추가됨

tech-stack:
  added:
    - "htmx.org@2.0.10 (npm dependency lock — STACK.md)"
  patterns:
    - "vanilla CSS custom properties (--color-*, --space-*, --font-*) — 토큰화"
    - "htmx 2.x + htmx-ext-sse 별도 로드 (DESIGN.md correction #4)"
    - "POST /chat → 응답 sse-connect div가 #sse-mount(hidden)로 swap → htmx-ext-sse가 EventSource 시작"
    - "htmx:beforeRequest로 새 prompt 시 output/error/status reset (drift는 유지)"
    - "Map<toolName, HTMLElement> 페어링 — CSS attribute selector 이스케이프 우회"
    - "textContent + createTextNode + createElement-only DOM 변형 (XSS 방어)"
    - "sticky positioning으로 drift/error 배너 항상 시야"

key-files:
  created:
    - "public/index.html (403 lines)"
  modified:
    - "package.json (htmx.org@2.0.10 추가)"
    - "bun.lock (htmx.org 잠금)"

key-decisions:
  - "tool-start ↔ tool-result 페어링: querySelectorAll attribute selector 대신 Map<name, element> 사용 (이스케이프 우회 + O(1))"
  - "drift 배너는 새 prompt에서도 유지 — UI-SPEC.md Interaction Contract '운영자가 인지하고 조치할 때까지 유지' 준수"
  - "sse-mount hidden div를 form 직후에 배치 — POST /chat 응답 fragment의 swap target. form 자체는 DOM에 잔류"
  - "fix label '해결 방법:'은 한국어, fix value 자체는 verbatim (D-15.1) — label만 번역"
  - "위험 식별자 substring을 코멘트에서도 사용하지 않음 — 'raw HTML 파싱 비-사용' 표현 사용 (FRICTION #9 grep false positive 차단)"

patterns-established:
  - "CSS custom properties on :root — UI-SPEC.md 토큰 그대로 반영"
  - "switch (detail.type) on htmx:sseMessage — 6 named event 분기 표준"
  - "외부 데이터 → textContent 일원화 — innerHTML 식별자 grep 0건 강제"

requirements-completed:
  - UI-01
  - UI-02
  - UI-03
  - UI-04

duration: 14min
completed: 2026-05-07
---

# Phase 1 Plan 08: htmx 다크 터미널 콘솔 — public/index.html SSE 6-event handler Summary

**htmx 2.0.10 + htmx-ext-sse@2.2.4로 단일 `public/index.html`(403 lines) 다크 터미널 운영자 콘솔 — 6 SSE event 분기, drift/error 배너, tool 카드, textContent-only XSS 방어.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-07T00:00:00Z (approximate)
- **Completed:** 2026-05-07T00:01:09Z
- **Tasks:** 2 (모두 완료)
- **Files modified:** 3 (`public/index.html` 생성, `package.json` + `bun.lock` 수정)

## Accomplishments

- **6 SSE event 핸들러 완전 wiring** — `htmx:sseMessage`에서 `detail.type` 분기로 text-delta/tool-start/tool-result/final/error/drift 모두 처리. case label 모두 더블쿼트 (`"final"`, `"error"`, `"drift"`)로 acceptance grep 통과.
- **다크 터미널 aesthetic 충실 반영** — UI-SPEC.md의 9개 color 토큰 + 5개 spacing 토큰 + 8개 typography 토큰을 `:root`에 CSS custom properties로 선언. `--font-family-mono` 4회 사용(error fix 필드 + tool 카드 + input + 코멘트).
- **drift/error 배너 분리 배치 (D-13.4 + D-15.2 reconcile)** — `#drift-banner`(amber, sticky top z-100) + `#error-banner`(red, sticky top z-99) 독립 div. 텍스트 믹스 없음.
- **tool-start ↔ tool-result 페어링 — Map 자료구조** — advisor 권고대로 `querySelectorAll('.tool-event[data-tool-name="..."]')` CSS 이스케이프 우회. `Map<name, HTMLElement>`로 set/get/delete.
- **XSS 방어 강제** — 모든 외부 데이터(LLM delta, tool args, fix verbatim, drift list)는 `textContent`/`createTextNode`/`createElement`만으로 DOM 추가. 위험 식별자 substring을 코멘트에서도 사용하지 않아 acceptance grep `\.inner[hH]tml\s*[=(]` == 0 통과.
- **htmx:beforeRequest reset 로직** — 새 prompt submit 직전 `outputEl.replaceChildren()` + error 숨김 + tool Map clear. drift 배너는 의도적으로 유지(운영자 조치 의무).

## Task Commits

각 task atomic 커밋:

1. **Task 1: package.json에 htmx.org 추가** — `eb3ba86` (chore)
   - `bun add htmx.org@2.0.10`
   - 검증: `node_modules/htmx.org/dist/htmx.min.js` + `node_modules/htmx-ext-sse/sse.js` 둘 다 존재 → server.ts STATIC_FILES 경로와 일치
2. **Task 2: public/index.html 작성 (다크 터미널 + 6 SSE handler)** — `88dd359` (feat)
   - 403 lines (요구 >= 150)
   - 모든 acceptance grep 통과 (15 항목)

## Files Created/Modified

- `public/index.html` (created, 403 lines)
  - `<head>`: htmx.min.js + sse.js 별도 script 태그 + STACK.md/DESIGN.md correction 코멘트
  - `<style>`: CSS custom properties + 6 컴포넌트 (drift-banner / error-banner / output / tool-event / status-bar / form)
  - `<body>`: `<main>` 내 7 element (drift-banner / error-banner / output / status-bar / form / sse-mount)
  - `<script>` IIFE: DOM refs + htmx:beforeRequest reset + htmx:sseMessage switch (6 case)
- `package.json` (modified)
  - `dependencies` 섹션에 `"htmx.org": "2.0.10"` 추가 (alphabetical order)
- `bun.lock` (modified)
  - htmx.org@2.0.10 lock entry 추가

## SSE Event → DOM 매핑 표

| SSE event | DOM target | 동작 | 근거 |
|-----------|-----------|------|------|
| `text-delta` | `#output` | `appendChild(createTextNode(parsed.delta))` 누적 | UI-01 |
| `tool-start` | `#output` | `.tool-event` 카드 생성, Map에 등록, "· {name} 호출 중..." | UI-03 |
| `tool-result` | `.tool-event` (same name) | Map 조회 → toggle .error → "✓/✗ {name} — {summary}" | UI-03 |
| `final` | `#status-bar` | "✓ 완료" 표시 후 1.5s `.fade` 클래스로 opacity 0 | UI-SPEC.md |
| `error` | `#error-banner` | display:block + heading/cause/fix-label/fix(monospace) 4 child | D-15.1 + D-15.2 |
| `drift` | `#drift-banner` | display:block + heading + body("docker-only N개, yaml-only M개") | UI-04 + D-13.4 |

## CSS Custom Properties 반영 (UI-SPEC.md 검증)

**Colors (9):** `--color-bg #0f1117`, `--color-surface #1a1d27`, `--color-accent #4ade80`, `--color-error #ef4444`, `--color-text #e2e8f0`, `--color-muted #64748b`, `--color-mono #86efac`, `--color-border #2d3244`, `--color-warning #f59e0b` (drift only)

**Spacing (5):** `--space-xs 4px`, `--space-sm 8px`, `--space-md 16px`, `--space-lg 24px`, `--space-xl 32px`

**Typography (10):** `--font-size-{label/body/mono/heading}` (13/15/13/17px), `--font-weight-{normal/semibold}` (400/600), `--line-height-{body/label/mono}` (1.6/1.4/1.5), `--font-family-{sans/mono}` (system-ui / JetBrains Mono stack)

UI-SPEC.md checker_flags 3건(D1/D3/D4)은 `non-blocking`으로 명시 — 그대로 반영(D3 amber-500은 `--color-warning` 토큰화, D4 13/15/17px은 그대로, D1 "전송" 단어 그대로).

## 라이브 라우팅 검증 (POST /chat → /chat-stream sse-connect 시퀀스)

1. 운영자 input → `<form hx-post="/chat" hx-target="#sse-mount" hx-swap="innerHTML">` submit
2. server.ts(eb3ba86 → main) `app.post("/chat")`이 다음 fragment 반환:
   ```html
   <div hx-ext="sse" sse-connect="/chat-stream?prompt=..." hx-swap="none"></div>
   ```
3. 이 div가 `#sse-mount`(display:none) 안으로 swap → htmx-ext-sse가 process하여 EventSource 시작
4. 서버가 staleness check 결과에 따라 `event:drift` → 클라이언트 `htmx:sseMessage` switch case `"drift"` → `#drift-banner` 표시
5. `event:text-delta` 순차 → `#output` `appendChild(createTextNode)` 누적
6. `event:tool-start` → `.tool-event` 카드 생성 + Map 등록
7. `event:tool-result` → Map 조회 → 카드 update + Map 삭제
8. `event:final` → `#status-bar` "✓ 완료" 1.5s fade
9. (오류 경로) `event:error` → `#error-banner` display:block, fix 필드 verbatim monospace

## Acceptance Verification (grep 결과)

| 검증 항목 | 요구 | 측정 | 결과 |
|----------|------|------|------|
| line count | >= 150 | 403 | OK |
| sse-connect\|sse-swap | >= 1 | 2 | OK |
| /static/htmx.min.js | >= 1 | 1 | OK |
| /static/sse.js | >= 1 | 1 | OK |
| text-delta | >= 1 | 3 | OK |
| tool-start | >= 1 | 3 | OK |
| tool-result | >= 1 | 3 | OK |
| `"final"` | >= 1 | 1 | OK |
| `"error"` | >= 1 | 2 | OK |
| `"drift"` | >= 1 | 1 | OK |
| drift-banner 식별자 | >= 2 | 5 | OK |
| error-banner 식별자 | >= 2 | 8 | OK |
| createTextNode\|createElement | >= 4 | 10 | OK |
| 한국어 copy(전송\|질문하세요) | >= 2 | 2 | OK |
| --color-bg\|--color-accent | >= 2 | 12 | OK |
| --font-family-mono | >= 1 | 4 | OK |
| **위험 식별자 grep `\.inner[hH]tml\s*[=(]`** | **== 0** | **0** | **OK (XSS 방어)** |

## Decisions Made

- **tool 페어링 자료구조 변경(advisor 권고 채택):** plan은 `querySelectorAll('.tool-event[data-tool-name="..."]')` 마지막 카드 update를 제안했으나 CSS attribute selector 이스케이프 위험 → `Map<name, HTMLElement>`로 set on tool-start, get/delete on tool-result. 정확성 + O(1) 조회.
- **drift 배너 새 prompt 시 유지:** UI-SPEC.md "운영자가 인지하고 조치할 때까지 유지" 명시 → htmx:beforeRequest에서 driftEl 건드리지 않음. 운영자가 services.yaml 수정 후 재시작해야 사라짐.
- **`#sse-mount` 패턴 채택:** form `hx-target=self`로 하면 form이 사라져 다음 prompt 입력 불가 → 별도 hidden div를 swap target으로 두고 form은 DOM 잔류.
- **위험 식별자 substring 코멘트에서도 사용 안 함:** FRICTION #9 lesson — 보안 코멘트로 `// 절대 .innerHTML 금지` 같은 표현은 mid-line `innerHTML` 등장 → grep false positive. 대신 "raw HTML 파싱 비-사용" / "T-01-08-01/02 차단" 표현 사용.
- **`--color-error-bg` / `--color-mono-on-error` / `--color-mono-bg-on-error` 보조 토큰 추가:** UI-SPEC.md text에 명시된 rgba 값(`rgba(239,68,68,0.1)`, `#fca5a5`, `rgba(0,0,0,0.3)`)을 인라인이 아닌 별도 토큰으로 노출 — 일관성 + 검색성.

## Deviations from Plan

**Total deviations:** 0 auto-fixed.
**Impact on plan:** plan 그대로 실행. advisor 권고 1건(tool 페어링 Map 사용)은 plan의 `querySelectorAll` 제안을 *기술 선택*으로 대체한 것이며 acceptance criteria에는 영향 없음(plan은 자료구조를 강제하지 않음).

None — plan이 정확한 design contract(UI-SPEC.md)를 가지고 있어 deviation 없이 1-shot 완료.

## Issues Encountered

- **`grep` shell alias 간섭:** 환경의 `rtk` 도구가 `grep`을 wrap하여 일부 옵션(특히 `-c`만 사용 + `--`)이 잘못 표시됨. 해결: `command -v grep` → `/usr/bin/grep` 직접 호출로 verify 재실행. acceptance 결과 영향 없음(모든 grep 통과 확인).

## Threat Flags

신규 위협 없음. plan의 `<threat_model>`이 정의한 6 STRIDE entry 모두 실제 구현에 반영:
- T-01-08-01/02 (XSS via SSE delta / error fix): textContent + createTextNode + createElement only — 강제 grep으로 보장
- T-01-08-03 (XSS via tool name): TOOL_SCHEMAS server-side 정의(accept)
- T-01-08-04 (DOM 거대화 DoS): outputEl.replaceChildren() on new prompt(accept Phase 1)
- T-01-08-05 (history clear): 의도적 reset on new prompt(accept)
- T-01-08-06 (재연결 dup): server-side LOOP-07 inFlight Map dedup 의존(mitigate)

## User Setup Required

None — 외부 서비스 설정 없음. `bun run dev` 후 http://127.0.0.1:3000 접속만으로 콘솔 사용 가능.

## Next Phase Readiness

- **Phase 1 Plan 09(smoke test)** 준비 완료 — 9개 plan 중 마지막 wave 4 산출물. 라이브 통합 테스트로 검증 필요:
  - "ais-prod redis 어디 쓰여?" → tool-start 카드 + text-delta 누적 + final fade
  - services.yaml 한 stack 삭제 후 query → drift 배너 표시
  - `unset DOCKER_CONTEXT && bun run dev` → boot 단계 error envelope 출력
- **DevTools 확인 사항(Plan 09에서):**
  - Console: htmx + sse.js 로드 에러 없음
  - Network: GET /chat-stream Content-Type: text/event-stream
  - EventStream 탭: 6 named event 모두 도착 확인
- Phase 2 5-key 승인 게이트 / proposePatch UI는 이 frontend 위에 추가되며, 같은 다크 터미널 토큰 시스템 재사용 가능.

## Self-Check: PASSED

- `public/index.html` 존재 (403 lines): FOUND
- Task 1 commit `eb3ba86` 존재: FOUND
- Task 2 commit `88dd359` 존재: FOUND
- 모든 17 acceptance grep 통과
- XSS 위험 식별자 0건
- 한국어 copywriting 그대로 반영
- 6 SSE event case label 모두 더블쿼트 + 분기 로직 완전

---
*Phase: 01-read-only-knowledge-layer*
*Plan: 08*
*Completed: 2026-05-07*
