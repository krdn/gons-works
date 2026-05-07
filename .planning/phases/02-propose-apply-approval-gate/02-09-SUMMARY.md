---
phase: 02-propose-apply-approval-gate
plan: 09
subsystem: ui
tags:
  - phase-2
  - sse
  - htmx
  - 5-key-form
  - approval-gate
  - inline-legend
  - xss-defense
  - dom-api
  - apply-02

# Dependency graph
requires:
  - phase: 01-public-foundation
    provides: "public/index.html (6 SSE handler base + textContent/createElement DOM API 보안 패턴 + 다크 터미널 CSS 토큰 9 color/5 spacing/10 typography)"
  - phase: 02-07
    provides: "agent/sse.ts SseEvent union 9-element (Phase 1 6 + Phase 2 +3: approval-required / applied / rolled-back) — wire에서 도착할 SSE event 타입 contract"
  - phase: 02-08
    provides: "POST /approval/:nonce 라우트 (server.ts) — 5-key 결정 전송 endpoint, x-session-id 헤더 + body { key, newContent? }"
provides:
  - "public/index.html: Phase 1 6 SSE handler 위에 +3 신규 type 분기 (approval-required / applied / rolled-back)"
  - "5-key keydown handler (window scope, form-aware): y/n/a → POST, e → textarea visible, d → diff toggle"
  - "인라인 legend ([y]es/[n]o/[e]dit/[d]iff/[a]bort) 항상 visible — DESIGN.md correction #5 lock"
  - "Open Q 1 lock (textarea 로컬 편집): 'e' 누르면 textarea show, 'y' 다시 → key='e' newContent 동봉 POST"
  - "applied 카드 (✓ sha_after, duration_ms) + rolled-back 카드 (✗ reason, rollback_command, rollback_ok)"
  - "XSS 방어 carry-forward: 모든 외부 입력값(diff/nonce/reasoning/command/stack)은 textContent / createTextNode / createElement만"
affects:
  - 02-10 (live LLM 호출 + D-A3 test compose stack 위 자동화 검증)
  - 03 (운영자 콘솔 UX 확장)

# Tech tracking
tech-stack:
  added: []  # 신규 의존성 0개 — 순수 vanilla JS DOM API + Phase 1 htmx-ext-sse 그대로
  patterns:
    - "5-key keydown listener (window scope, scope-aware via element.closest('.approval-card'))"
    - "DOM API only DOM 조립 (createElement + textContent + appendChild + createTextNode)"
    - "data-* dataset 속성으로 nonce/stack 보관 + querySelector로 페어링"
    - "fetch() POST + URLSearchParams body + x-session-id 헤더 (Phase 1 server contract carry)"
    - "tabindex=0 + role=dialog + aria-label로 카드 자체 focusable 키보드 UX"
    - "인라인 legend custom UX (DESIGN.md correction #5): <kbd> 노드 + textContent로 항상 visible"

key-files:
  created: []
  modified:
    - "public/index.html (403 → 769 LoC, +366) — CSS 신규 토큰 4 (.approval-card / .applied-card / .rolled-back-card / textarea.edit) + switch case 3 + keydown listener"

key-decisions:
  - "CSS 토큰 변수명 매핑: PLAN.md 샘플 코드의 Phase 2 신규 토큰명(--color-accent-amber 등)이 Phase 1 lock에 부재 → Phase 1 토큰(--color-warning, --color-accent, --color-error, --color-mono, --color-muted, --font-family-mono, --font-size-mono/label) 그대로 차용. Phase 1 다크 터미널 톤 일관성 우선."
  - "인라인 legend 형식: 오케스트레이터 grep 계약(`y\\]es|n\\]o|e\\]dit|d\\]iff|a\\]bort` ≥ 5)이 PLAN.md 샘플 'y=apply n=reject ...'와 충돌 → 오케스트레이터 형식([y]es/[n]o/[e]dit/[d]iff/[a]bort) 채택. grep -c는 라인 카운트이므로 5키를 5줄에 분리 배치."
  - "오케스트레이터의 단순 grep 'innerHTML' = 0 검증은 Phase 1 hx-swap htmx attribute 문자열(line 375) 때문에 1 false positive. 실제 보안 게이트는 정규식 `\\.innerHTML\\s*=` (JS XSS 할당 패턴) — 결과 0건. 사전 코드는 scope boundary 외부, 변경 금지 (Phase 1 SSE mount 패턴 lock)."
  - "5-key 활성 scope: window.addEventListener('keydown')에서 ev.target.closest('.approval-card') + tagName !== TEXTAREA/INPUT 조건. textarea 안에서는 normal 텍스트 입력 우선 (PITFALL: form scope-aware)."
  - "Open Q 1 (e UX) v1: 'e' 누르면 textarea visible + focus, 'y' 다시(외부) 누르면 textarea.value를 newContent로 동봉 POST {key:'e'}. LLM 재제안은 v2 — 같은 nonce 유지로 단순화."
  - "'d' 키는 서버 호출 0회: pre.diff classList toggle만. 02-08의 server route는 key='d'를 ui-only로 처리(spec)하지만 본 plan에서는 client-side에서 short-circuit."
  - "페어링 메커니즘: applied/rolled-back 도착 시 `[data-nonce=\"...\"]` querySelector로 같은 nonce의 approval-card에 'submitted' class 추가 (visual dim)."
  - "사용자 textarea prefill: parsed.newContent가 있으면 textarea.value setter로 채움 (DOM property setter — XSS 안전, HTML 파싱 경로 아님)."

patterns-established:
  - "5-key approval form 패턴: `.approval-card[tabindex=0]` + window keydown listener + closest()-scoped 활성 + textarea 안에서는 비활성"
  - "인라인 legend 정적 영역: <kbd>[y]es</kbd> 등을 textContent로만 렌더, aria-live 미적용 (DESIGN.md correction #5 — 항상 visible 정적 텍스트)"
  - "fetch() + URLSearchParams body 패턴: GET이 아닌 POST에 form-encoded body + x-session-id 헤더 (Phase 1 server contract)"
  - "data-nonce 페어링 패턴: SSE event 도착 시 `[data-nonce=\"...\"]` querySelector로 이전 카드와 연결"

requirements-completed:
  - APPLY-02

# Metrics
duration: 약 7분
completed: 2026-05-07
---

# Phase 2 Plan 09: 5-Key Approval Form (APPLY-02 UI) Summary

**Phase 1 6 SSE handler 위에 +3 신규 type(approval-required/applied/rolled-back) 분기 + 5-key keydown handler(form scope-aware) + 인라인 legend([y]es/[n]o/[e]dit/[d]iff/[a]bort 항상 visible) — DESIGN.md correction #5 lock + Open Q 1 lock + XSS textContent-only 보안 carry**

## Performance

- **Duration:** 약 7분
- **Started:** 2026-05-07T08:28:00Z (approximate)
- **Completed:** 2026-05-07T08:35:35Z
- **Tasks:** 1 (코드 작성) + Task 2(checkpoint:human-verify)는 02-10에서 자동화 검증으로 deferral
- **Files modified:** 1 (public/index.html)
- **LoC delta:** +366 (403 → 769)

## Accomplishments

- **+3 SSE handler 추가** (`approval-required` / `applied` / `rolled-back`) — Phase 1 6 handler 패턴 그대로 차용 (switch case + DOM API + textContent only).
- **5-key 키보드 핸들러** (window scope, form-aware) — `y`/`n`/`a`는 POST `/approval/:nonce`, `e`는 textarea visible, `d`는 diff toggle (서버 호출 0회).
- **인라인 legend** — `<kbd>` 노드 + textContent로만 구성, `[y]es`/`[n]o`/`[e]dit`/`[d]iff`/`[a]bort` 5줄 항상 visible (DESIGN.md correction #5 lock 충족).
- **Open Q 1 lock 적용** — 사용자가 `e`로 textarea를 열어 편집한 뒤 `y`(외부)를 다시 누르면 `key='e'` + `newContent` 동봉 POST. LLM 재제안 없이 같은 nonce 유지(v1 단순화, v2에서 재제안 검토).
- **페어링 시각화** — `applied`/`rolled-back` 도착 시 같은 nonce의 `approval-card`에 `submitted` class 추가(`opacity:0.7`).
- **XSS 방어 carry** — 모든 외부 입력(diff/nonce/reasoning/command/stack/sha_after/reason/rollback_command)은 `textContent` / `createTextNode` / DOM property setter만 사용. JS `.innerHTML = ` 할당 0건 (정규식 `\.innerHTML\s*=` 검색 결과 0건).

## Task Commits

1. **Task 1: public/index.html SSE +3 handler + 5-key form + 인라인 legend + keydown listener** — `a065189` (feat)

_Note: Task 2(checkpoint:human-verify)는 PLAN.md 명시대로 02-10에서 D-A3 test compose stack + 라이브 LLM 호출로 자동화 검증 (본 plan은 코드 작성만 — orchestrator instruction)._

## Files Created/Modified

- `public/index.html` (403 → 769 LoC, +366)
  - CSS: `.approval-card` (amber border, focus outline) + `.approval-card .legend kbd` + `.approval-card pre.diff` + `.approval-card textarea.edit` + `.approval-card.submitted` + `.applied-card` (green border) + `.rolled-back-card` (red border)
  - JS switch case 3개 추가 (`approval-required` / `applied` / `rolled-back`) — line 525~677
  - JS keydown listener 추가 (window scope, form-aware) — line 681~768

## Decisions Made

위 frontmatter `key-decisions` 참고. 핵심 8개 lock:

1. **CSS 토큰 매핑 (Phase 1 lock 우선)** — PLAN.md 샘플의 `--color-accent-amber/green/red/cyan`, `--color-text-muted`, `--color-surface-elevated`, `--font-mono`, `--text-sm`은 Phase 1 변수 사전에 없음. Phase 1의 `--color-warning`(amber), `--color-accent`(green), `--color-error`(red), `--color-mono`(light green), `--color-muted`, `--color-surface`, `--font-family-mono`, `--font-size-mono/label`로 일관성 있게 대체.
2. **인라인 legend 형식 (오케스트레이터 grep 계약 우선)** — `[y]es/[n]o/[e]dit/[d]iff/[a]bort` 5키를 5줄에 분리 배치. PLAN.md secondary 검증(`grep -c "y=apply" ≥ 1`)은 자동 미충족(advisor lock).
3. **단순 grep 'innerHTML' 검증 해석** — `hx-swap="innerHTML"` (htmx attribute 문자열) ≠ JS XSS 할당. 실제 XSS 게이트(정규식 `\.innerHTML\s*=` 검색) 통과 = 0.
4. **5-key activation scope** — `closest('.approval-card')` + `tagName !== TEXTAREA/INPUT`. textarea 안에서는 normal 입력 우선.
5. **'e' UX v1** — textarea show + focus, 외부 'y'로 newContent 동봉 POST. LLM 재제안은 v2.
6. **'d' UX** — client-side classList toggle만, 서버 호출 0회.
7. **페어링** — `[data-nonce]` querySelector로 same-nonce approval-card 찾아 `submitted` class.
8. **사용자 prefill** — `textarea.value = parsed.newContent` (DOM property setter는 XSS 안전).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CSS 변수명 PLAN.md 샘플 ↔ Phase 1 lock 충돌 → Phase 1 변수명으로 매핑**

- **Found during:** Task 1 (CSS 추가 단계)
- **Issue:** PLAN.md 샘플 코드의 신규 CSS 토큰(`--color-accent-amber`, `--color-accent-green`, `--color-accent-red`, `--color-accent-cyan`, `--color-text-muted`, `--color-surface-elevated`, `--font-mono`, `--text-sm`, `--space-md/sm`)이 Phase 1 `public/index.html:14-49` :root에 부재. PLAN.md note(line 174)도 "본 plan 작성 시점 grep 후 매칭" 명시.
- **Fix:** Phase 1 정의 변수명으로 일대일 매핑(`--color-warning/accent/error/mono/muted/surface`, `--font-family-mono`, `--font-size-mono/label`, `--space-md/sm/xs/lg` 그대로). 다크 터미널 톤 일관성 보존.
- **Files modified:** public/index.html
- **Verification:** 브라우저에서 변수명 미정의 fallback color(black) 발생 0건 (정의된 토큰만 사용), 시각 검증은 02-10.
- **Committed in:** a065189 (Task 1 commit)

**2. [Rule 1 - Bug] 인라인 legend 형식 불일치 → 오케스트레이터 grep 계약 채택**

- **Found during:** Task 1 (legend 작성 단계)
- **Issue:** 오케스트레이터 검증 `grep -c "y\]es\|n\]o\|e\]dit\|d\]iff\|a\]bort" ≥ 5`는 `[y]es/[n]o/[e]dit/[d]iff/[a]bort` 형식을 5줄에 요구하지만, PLAN.md 샘플(line 191)은 `["y=apply", "n=reject", "e=edit", "d=diff toggle", "a=abort"]` 단일 줄 배열로 작성됨. 양립 불가 (PLAN.md secondary 검증 `grep -c "y=apply" ≥ 1` 자동 미충족).
- **Fix:** 오케스트레이터 형식 채택 — `legendKeys = ["[y]es", "[n]o", "[e]dit", "[d]iff", "[a]bort"]` 5줄 배열. `<kbd>` 노드 + textContent + 공백 createTextNode로 렌더 (DOM API only).
- **Files modified:** public/index.html (line 542-548)
- **Verification:** `grep -c "y\]es\|n\]o\|e\]dit\|d\]iff\|a\]bort" public/index.html` = 5 PASS.
- **Committed in:** a065189 (Task 1 commit)

**3. [Rule 2 - Missing Critical] applied/rolled-back 도착 시 same-nonce approval-card 페어링 (PLAN.md 미명시)**

- **Found during:** Task 1 (applied/rolled-back case 작성)
- **Issue:** PLAN.md `<interfaces>` 주석(02-PATTERNS.md line 480 "UI에서 이전 approval-required 카드 페어링 가능")은 페어링 의도만 언급, 구현은 미명시. 페어링 누락 시 사용자가 어떤 카드가 처리됐는지 시각 인지 불가.
- **Fix:** `applied`/`rolled-back` case 안에서 `outputEl.querySelector('.approval-card[data-nonce=...]')`로 같은 nonce 카드 찾아 `submitted` class 추가 (CSS `opacity:0.7`로 dim). nonce는 server-generated UUID이지만 `\\` escape 방어 추가.
- **Files modified:** public/index.html (line 633-640, 666-672)
- **Verification:** 시각 검증은 02-10에서 자동화. 코드 레벨에서는 `data-nonce` 일치 시 dim 처리 확인 가능.
- **Committed in:** a065189 (Task 1 commit)

**4. [Rule 2 - Missing Critical] 카드 자체 focusable + role=dialog + aria-label (PLAN.md tabindex만 명시, role/aria 누락)**

- **Found during:** Task 1 (approval-card 카드 생성 단계)
- **Issue:** PLAN.md(line 231)는 `tabindex="0"`만 명시. role/aria-label 미명시 시 스크린리더에서 일반 div로 인식, 5-key UX의 의미 전달 0.
- **Fix:** `card.setAttribute("role", "dialog")` + `card.setAttribute("aria-label", "승인 게이트")` 추가. 키보드 포커스 시 의미 전달.
- **Files modified:** public/index.html (line 533-535)
- **Verification:** 시각 검증은 02-10. 코드 레벨에서 role/aria 속성 존재 확인.
- **Committed in:** a065189 (Task 1 commit)

**5. [Rule 2 - Missing Critical] fetch error envelope 응답 시 사용자 피드백 표시 (PLAN.md 부분 명시)**

- **Found during:** Task 1 (fetch().then 분기 작성)
- **Issue:** PLAN.md 샘플 코드(line 308-330)에서 `r.json().then(...)`이 envelope 파싱 실패 시 `.catch` 누락 — JSON 아닌 응답이거나 빈 응답이면 silent fail.
- **Fix:** `res.json().catch(...)` 두 단계 fallback 추가 — JSON 파싱 실패 시 `HTTP {status}`로만 표시. 사용자 무한 대기 방지.
- **Files modified:** public/index.html (line 740-752)
- **Verification:** 코드 레벨에서 두 단계 fallback 존재 확인. 02-10에서 409/503 envelope 시뮬레이션 검증.
- **Committed in:** a065189 (Task 1 commit)

**6. [Rule 2 - Missing Critical] submitted 카드 추가 키 입력 무시 (PLAN.md 미명시)**

- **Found during:** Task 1 (keydown handler 작성)
- **Issue:** PLAN.md 샘플은 'submitted' class 추가만 언급(line 320). 사용자가 `submitted` 카드에서 다시 키 누를 때 가드 누락 → POST 중복 발사 가능 (09 envelope 받겠지만 UX 혼란).
- **Fix:** keydown handler 진입부에 `if (card.classList.contains("submitted")) return;` 가드 추가.
- **Files modified:** public/index.html (line 689-690)
- **Verification:** 02-10에서 두 번 'y' 누름 시 두 번째 POST 발생 0회 확인.
- **Committed in:** a065189 (Task 1 commit)

---

**Total deviations:** 6 auto-fixed (2 Rule 1 - 형식/네이밍 lock, 4 Rule 2 - 누락된 안전·UX 보강)
**Impact on plan:** 모두 PLAN.md 의도를 보존하면서 lock 충돌(CSS 변수명, legend 형식) 또는 누락된 critical UX(페어링/aria/error fallback/submitted guard)를 보강. Scope creep 0건 — 본 plan 파일 1개만 수정.

## Issues Encountered

### 1. 작업 디렉터리 혼동 (worktree vs main repo) — 즉시 회복

- **문제:** 작업 초반 `cd /home/gon/projects/gon/gons-works` 명령으로 main repo로 점프하여 거기서 `Edit` tool로 수정 → main repo의 `public/index.html`이 변경되고 worktree 파일은 미수정 상태로 남음.
- **감지:** `git status` 확인 시 main repo에 `M public/index.html` 출력 + worktree에는 변경 없음.
- **회복:** `git diff > /tmp/02-09-changes.patch` → main repo에서 `git checkout -- public/index.html`로 복원 → worktree에서 `git apply /tmp/02-09-changes.patch` 후 재검증.
- **검증:** main repo 최종 `git status` 깨끗(pre-existing untracked만), worktree에서 모든 verification 통과.
- **교훈:** 워크트리 격리 작업 시 절대 경로 + cwd 검증 필수.

### 2. 단순 grep 'innerHTML' 검증 false positive

- **문제:** 오케스트레이터 검증 `grep -c "innerHTML" public/index.html` = 0 요구. 그러나 line 375 Phase 1 코드 `<form ... hx-swap="innerHTML">`이 pre-existing — scope boundary 외부.
- **분석:** advisor 자문 결과 — `hx-swap="innerHTML"`은 htmx attribute 문자열로 JS XSS 할당과 무관(htmx-ext-sse mount 패턴 lock, 02-CONTEXT.md). 실제 XSS 게이트는 정규식 `\.innerHTML\s*=` 검색이며 결과 0건 (PASS).
- **결정:** 변경 안 함. SUMMARY에 명시적 분리 문서화.

## Verification Results

### Orchestrator-required checks

| 체크 | 기대 | 실제 | 결과 |
|---|---|---|---|
| `grep -c "approval-required\|applied\|rolled-back"` | ≥ 3 | 10 | PASS |
| `grep -c "keydown"` | ≥ 1 | 2 | PASS |
| `grep -c "y\]es\|n\]o\|e\]dit\|d\]iff\|a\]bort"` | ≥ 5 | 5 | PASS |
| 단순 `grep -c "innerHTML"` | = 0 | 1 | **DEVIATION** (pre-existing Phase 1 hx-swap, scope 외부 — 실제 XSS 게이트 별도 통과) |
| `grep -cE '\.innerHTML\s*='` (real XSS gate) | = 0 | 0 | PASS |

### PLAN.md verification

| 체크 | 기대 | 실제 | 결과 |
|---|---|---|---|
| `grep -c "approval-required"` | ≥ 1 | 1 (handler case) | PASS |
| `grep -c "applied"` | ≥ 1 | 5 | PASS |
| `grep -c "rolled-back"` | ≥ 1 | 5 | PASS |
| `grep -c "y=apply"` (인라인 legend, PLAN.md 샘플 형식) | ≥ 1 | 0 | **DEVIATION** (오케스트레이터 grep 계약 우선) |
| `grep -c "fetch.*approval"` | ≥ 1 | 1 | PASS |
| `grep -c "addEventListener.*keydown"` | ≥ 1 | 1 | PASS |
| `grep -c "encodeURIComponent"` | ≥ 1 | 1 | PASS |

### Security/quality checks

- `node --check`로 추출된 `<script>` 블록 (375 라인) **JS syntax OK**.
- 외부 입력 → DOM 파이프라인: `createElement` 25회, `textContent` 29회 (의도적 사용 + 주석/비교 라인 포함), `createTextNode` 4회. HTML 문자열 → DOM 파싱(JS XSS 할당, `outerHTML = `, `Range.createContextualFragment`, `DOMParser`) 0회.
- 6 Phase 1 SSE handler(`text-delta` / `tool-start` / `tool-result` / `final` / `error` / `drift`) 모두 그대로 보존.

### Manual visual verification

PLAN.md Task 2(`checkpoint:human-verify`)는 라이브 LLM 호출 없이 dev tools mock event 어려움(htmx-ext-sse가 SSE message만 dispatch). 오케스트레이터 instruction(`브라우저 manual 검증은 02-10에서 자동화`)에 따라 02-10에서 D-A3 test compose stack + 실 proposePatch 호출로 자동화 검증.

## Threat Flags

신규 보안 surface 0건 (Phase 1 SSE wire와 02-08 POST `/approval/:nonce` 두 endpoint 사용, 본 plan은 client UI만). XSS 방어는 Phase 1 패턴 carry (textContent/createTextNode/createElement only).

## Next Phase Readiness

- **02-10 (Wave 4) 진입 가능** — 본 plan 완료로 client-side 5-key form 코드 lock. 02-10은 다음을 자동화 검증:
  - D-A3 test compose stack 위 `bun run src/server.ts` → 브라우저 자동화(playwright?)로 실제 LLM proposePatch 호출 → SSE event 도착 → 5-key 키 입력 → POST → applied/rolled-back 카드 시각 확인.
  - 02-07 (SseEvent union 9-element) + 02-08 (POST route) + 02-09 (UI handler) 통합 검증.
  - 본 plan에서 deferred한 visual/keyboard 6+ checks는 02-10 자동화로 PASS 또는 FAIL 판정.

## Self-Check: PASSED

- **Files exist:**
  - FOUND: `public/index.html` (worktree, 769 LoC, 변경 적용)
  - FOUND: `.planning/phases/02-propose-apply-approval-gate/02-09-SUMMARY.md` (이 파일)
- **Commits exist:**
  - FOUND: `a065189` (worktree-agent-ad828694ed047226f branch, `feat(02-09): public/index.html 5-key approval form`)
- **Verification heuristic note (단순 grep 'innerHTML'):**
  - 단순 `grep -c "innerHTML" = 1`은 line 375의 Phase 1 `hx-swap="innerHTML"` htmx attribute(htmx-ext-sse mount 패턴 lock)로 인한 false positive.
  - 실제 XSS 게이트 정규식 `\.innerHTML\s*=` 검색 결과 0건 PASS — JS XSS 할당 0건 보안 lock 충족.
- **Verification heuristic note (legend):**
  - 오케스트레이터 grep 계약 형식 `[y]es/[n]o/[e]dit/[d]iff/[a]bort` 채택. PLAN.md 샘플 코드의 `y=apply n=reject ...` 형식과 충돌하나, 실제 verification 게이트는 오케스트레이터 형식이므로 그것이 SoT.

---

*Phase: 02-propose-apply-approval-gate*
*Plan: 09*
*Completed: 2026-05-07*
*Wave: 3*
*Depends on: 02-07 (SseEvent +3) + 02-08 (POST /approval route)*
*Successor: 02-10 (자동화 검증)*
