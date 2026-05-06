---
plan_id: "00-08"
phase: 0
title: "Phase 0 검증 + DOG-01/DOG-02 dogfood 마찰 정리"
wave: 4
depends_on: ["00-02", "00-03", "00-04", "00-05", "00-06", "00-07", "00-09"]
files_modified:
  - "state/PHASE-0-VERIFICATION.md"
  - ".planning/phases/00-bootstrap-spikes/FRICTION.md"
requirements: ["BOOT-01", "DOG-01", "DOG-02"]
autonomous: true
estimated_minutes: 15
---

# 00-08: Phase 0 검증 + DOG-01/DOG-02 dogfood 마찰 정리

<objective>
모든 Phase 0 산출물이 제자리에 있는지 검증하고 (D-02 No partial pass 강제), Phase 0 통과 단일 보고서를 `state/PHASE-0-VERIFICATION.md`로 기록. 동시에 dogfood meta 의무 (DOG-01, DOG-02) — 이 빌드의 모든 단계에서 발견된 통합 파이프라인 마찰을 `FRICTION.md`로 정리해 다음 `~/.claude/plans/gstack-gsd-melodic-raven.md` 개정판 입력으로 사용한다.

**must_haves.truths:**
- D-02 (CONTEXT.md): No partial pass — 6 spike 모두 green이어야 Phase 1 진행 가능
- DOG-01: 통합 파이프라인 (`/office-hours` → `/autoplan` → `/gsd-new-project --auto` → `/gsd-execute-phase`)이 정상 흘러갔는지 메타 검증
- DOG-02: 마찰 메모를 `~/.claude/plans/gstack-gsd-melodic-raven.md` 다음 개정판 입력으로 사용
- BOOT-01: 5 spike 모두 green
</objective>

<must_haves>
## Truths

- D-02: 6 spike 결과 (`state/SPIKE-1/2/3/6-RESULT.md` + Wave 1의 bun:test 결과 + Wave 2의 Spike 5 unit test 결과)가 모두 PASS여야 Phase 1 진행.
- DOG-01: gsd 통합 파이프라인의 첫 검증 사례로서 마찰 기록 필수.
- DOG-02: FRICTION.md는 dogfood 메타 산출물로서 본 phase의 차별화 가치 중 하나.

## Verification anchors

- `state/PHASE-0-VERIFICATION.md` 존재 + 5 spike 모두 PASS 상태 표시
- `.planning/phases/00-bootstrap-spikes/FRICTION.md` 존재 + 최소 5개 마찰 항목 (gsd-sdk 미존재, codex 금지, sonnet 병렬 rate limit 등)
- 모든 Wave 1-3 plan의 산출물 파일이 disk에 존재
- 모든 Wave 1-3 단위 테스트 (`bun test`)가 종료 코드 0
</must_haves>

<task id="00-08-t01" type="execute">
<title>state/PHASE-0-VERIFICATION.md — 5 spike PASS 보고서</title>
<read_first>
- `state/SPIKE-1-RESULT.md`
- `state/SPIKE-2-RESULT.md`
- `state/SPIKE-3-RESULT.md`
- `.planning/ROADMAP.md` Phase 0 Success Criteria 섹션
</read_first>
<action>
다음 명령으로 모든 단위 테스트 일괄 실행:

```bash
bun test
```

종료 코드 0 + 모든 테스트 PASS 확인. 결과를 `state/PHASE-0-VERIFICATION.md`로 기록:

```markdown
# Phase 0 Verification Report

**Date:** YYYY-MM-DD
**Status:** PASS | FAIL — <count> spike(s) failed
**Time spent:** N minutes (target ≤120 min from ROADMAP.md)

## Spike Results (D-02: No partial pass — 6/6 green 강제)

| # | Spike | Status | Result file | Verification anchor |
|---|-------|--------|-------------|---------------------|
| 1 | Bun.$ docker --context dserver ps | PASS / FAIL | state/SPIKE-1-RESULT.md | top-1 N containers |
| 2 | Voyage AI voyage-4-lite embedding | PASS / FAIL | state/SPIKE-2-RESULT.md | cosine sim N.NNNN |
| 3 | Hono streamSSE → htmx-ext-sse | PASS / FAIL | state/SPIKE-3-RESULT.md | 5/5 chunks received |
| 4 | Bun.$ git commit body roundtrip | PASS / FAIL | spikes/04-git-commit.test.ts | bun test 2/2 pass |
| 5 | Zod v4 z.toJSONSchema | PASS / FAIL | spikes/05-zod-schema.test.ts | bun test 9/9 pass |
| 6 | Anthropic SDK + cli-proxy-api roundtrip + fallback (D-09/D-10/D-11) | PASS / FAIL | state/SPIKE-6-RESULT.md + spikes/06-proxy-fallback.test.ts | smoke 4/4 pass + bun test 5/5 pass |

## ROADMAP.md Success Criteria

- [ ] 1. docker --context dserver ps 출력이 파싱 가능한 컨테이너 배열로 반환됨 (Spike 1)
- [ ] 2. Voyage voyage-4-lite 벡터 + cosine 검색 (Spike 2)
- [ ] 3. streamSSE → htmx-ext-sse 브라우저 text-delta 수신 (Spike 3)
- [ ] 4. Bun.$ git commit body 포함 commit 기록 (Spike 4)
- [ ] 5. z.toJSONSchema → Claude input_schema 호환 (Spike 5)
- [ ] 6. Anthropic SDK + cli-proxy-api roundtrip 4가지 (chat / tool-use / streaming / model-echo) + claude-opus-4-6 (Spike 6, D-09/D-10) + fallback retry policy 단위 테스트 5/5 (D-11)
- [ ] 7. services.yaml 초안 5 핵심 stack 포함 + state/ 첫 commit (BOOT-02 + BOOT-03)
- [ ] 8. .env 검증 startup guard 동작 (BOOT-04 + BOOT-05, ANTHROPIC_BASE_URL 포함 6 키 + 2 optional fallback)

## Phase 1 Unblocking Decision

6/6 spike PASS → Phase 1 (`/gsd-discuss-phase 1`) 진행 가능.
5/6 이하 → 실패한 spike의 fallback path 활성화 후 Phase 0 재진입.

## Time Budget

| Plan | Estimated | Actual |
|------|-----------|--------|
| 00-01 | 20 min | NN min |
| 00-02 | 15 min | NN min |
| 00-03 | 20 min | NN min |
| 00-04 | 25 min | NN min |
| 00-05 | 25 min | NN min |
| 00-06 | 15 min | NN min |
| 00-07 | 30 min | NN min |
| 00-08 | 15 min | NN min |
| 00-09 | 25 min | NN min |
| **Total** | **190 min** | **NN min** |

⚠ ROADMAP.md target ≤120 min. 추정치가 이미 초과(+70 min, Spike 6 추가로 +25min) — Wave 2의 Spike 1/2/5/6은 모두 wave 1만 끝나면 wall-clock 병렬 가능. 실제 측정 시 cumulative 190 min ≠ wall-clock 190 min일 수 있음. 차이가 크면 다음 milestone에 phase 분할 고려.
```
</action>
<acceptance_criteria>
- `state/PHASE-0-VERIFICATION.md` 존재
- 파일에 6 spike 모두 표시 + 각각 PASS/FAIL 상태 grep 가능
- 파일에 ROADMAP.md success criteria 8개 모두 grep 가능 (`docker --context`, `Voyage`, `streamSSE`, `git commit`, `toJSONSchema`, `cli-proxy-api`, `services.yaml`, `.env`)
- 파일에 D-02 (No partial pass) 정책 한 줄 이상 grep 가능
- `bun test` 가 phase 0 전체에서 종료 코드 0 (실패 케이스 명확히 표시)
</acceptance_criteria>
</task>

<task id="00-08-t02" type="execute">
<title>FRICTION.md — DOG-02 dogfood 마찰 정리</title>
<read_first>
- `~/.claude/plans/gstack-gsd-melodic-raven.md` (다음 개정판 입력 대상)
- `.memsearch/memory/2026-05-06.md` (오늘 세션 메모리)
- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` (Phase 0 진행 중 발견된 D-XX 결정들)
</read_first>
<action>
`.planning/phases/00-bootstrap-spikes/FRICTION.md` 생성:

```markdown
# Phase 0 Dogfood Friction Memo (DOG-02)

이 문서는 통합 파이프라인 (`/office-hours` → `/autoplan` → `/gsd-new-project --auto` → `/gsd-discuss-phase --auto` → `/gsd-plan-phase --auto`)의 첫 dogfood 검증에서 발견된 마찰을 정리한다.

다음 `~/.claude/plans/gstack-gsd-melodic-raven.md` 개정판의 입력으로 사용한다.

## 발견된 마찰

### 1. `gsd-sdk` CLI 부재

**증상:** `/gsd-new-project --auto`, `/gsd-discuss-phase`, `/gsd-plan-phase` 워크플로우의 거의 모든 step이 `gsd-sdk query <command>` 호출로 시작하는데, 시스템에 `gsd-sdk` 바이너리가 없다 (`zsh: command not found: gsd-sdk`).

**워크어라운드:** Claude가 직접 파일을 읽고/쓰고/grep하여 init JSON을 시뮬레이션. 워크플로우 스텝 그대로 따라가지만 SDK 의존 부분만 우회.

**영향:**
- `init.phase-op`/`init.plan-phase` 의 JSON output을 직접 만들 수 없어, 매 step에서 파일 시스템 검사 + 추론으로 대체
- `state.record-session`/`commit` 같은 부수 효과는 직접 `git commit`으로 대체
- 일관성 risk: SDK가 보장하는 invariant가 누락될 수 있음

**제안:** gstack-gsd-melodic-raven.md의 다음 개정판에서 다음 중 하나로 정리:
- (a) `gsd-sdk` 바이너리 설치 가이드를 setup 단계에 명시
- (b) SDK 의존을 줄이고 워크플로우가 직접 파일 시스템 명령으로 동작하게 재작성
- (c) `gsd-sdk` 미설치 감지 시 graceful degradation path를 워크플로우에 추가

### 2. Phase 0 = research 자체 (standard 파이프라인 mismatch)

**증상:** 표준 plan-phase 워크플로우는 `research → plan → verify` 인데, Phase 0의 본질이 5개 go/no-go spike — 즉 research가 spike 자체다. 별도 RESEARCH.md를 만드는 건 같은 내용을 다른 양식으로 재포장.

**워크어라운드:** advisor 도구로 검증 후 RESEARCH.md/PATTERNS.md 모두 skip.

**제안:** ROADMAP.md에 phase type marker (`type: bootstrap | feature | refactor | spike-only`)를 두고, `bootstrap`/`spike-only` phase는 research를 자동으로 skip.

### 3. Pattern-mapper greenfield idle

**증상:** `/gsd-plan-phase`는 항상 `gsd-pattern-mapper`를 spawn하지만, 그린필드(`ls`가 `CLAUDE.md / DESIGN.md / LICENSE / README.md`)에서는 매핑할 패턴이 0개. 워크플로우의 "Skip if no CONTEXT.md and no RESEARCH.md" 조건은 그린필드를 직접 다루지 않는다.

**워크어라운드:** advisor 권고로 skip.

**제안:** `gsd-pattern-mapper`에 "greenfield-aware" 모드 — `find . -name '*.ts' -not -path './node_modules/*' | wc -l` 가 0이면 즉시 NO_PATTERNS_FOUND 반환.

### 4. Sonnet 병렬 spawn rate limit (balanced profile)

**증상:** `/gsd-new-project --auto`가 4개 `gsd-project-researcher`를 sonnet 모델로 background에서 동시 spawn했더니 rate limit 도달 → 4개 모두 실패.

**워크어라운드:** 한 시간 후 재시도 후 성공 (어제 메모리 참조).

**제안:**
- balanced profile에서 동시 sonnet spawn 개수 cap (e.g., max 2)
- 또는 default를 haiku로 두고, sonnet 필요 시 명시적 opt-in
- rate limit retry-with-backoff를 SDK 레벨에 내장

### 5. Codex CLI 전역 deny (CLAUDE.md 규칙)

**증상:** `/gsd-plan-phase` 등이 cross-AI peer review로 `codex` 호출을 옵션으로 제공하지만, 사용자 글로벌 CLAUDE.md "Codex CLI 사용 금지" 규칙으로 모두 deny.

**워크어라운드:** Haiku subagent (`Agent(code-reviewer, model=haiku)`)로 대체.

**제안:** 워크플로우에서 codex 호출 전에 CLAUDE.md deny 패턴을 감지하고 자동으로 Haiku subagent로 라우팅.

### 6. Boundary mismatch — Phase 0 시간 예산 초과 가능성

**증상:** ROADMAP.md는 Phase 0을 ≤2h(120분)로 잡았는데, plan-phase 산출물 8개 plan의 estimated 합산이 165분 (+45분 초과).

**관찰:** plan을 잘게 쪼개면 추정치가 누적되어 boundary 초과처럼 보이지만, 일부는 병렬 가능 (Wave 2의 Spike 1/2/3/5는 모두 Wave 1만 끝나면 동시 진행 가능). 실제 wall-clock은 165분이 아닐 수 있음.

**제안:** ROADMAP.md의 phase time budget이 wall-clock 인지 cumulative effort 인지 명시 필요.

### 7. Discuss-phase `--auto` 모드 vs spec-locked phase

**증상:** Phase 0이 이미 ROADMAP.md + REQUIREMENTS.md + DESIGN.md correction에 의해 거의 모든 결정이 lock된 상태인데, `discuss-phase --auto`가 여전히 8개 gray area를 만들고 추천 옵션을 선택.

**관찰:** 8개 중 4-5개는 진짜 ambiguity, 나머지는 lock된 결정의 재확인. Spec-locked phase에서 `--auto`는 좀 더 적극적으로 "이미 결정됨" 분류해야 할 수 있음.

**제안:** discuss-phase가 `<prior_decisions>` 스캔 시 PROJECT.md Key Decisions / DESIGN.md correction 까지 명시적으로 참조하고, lock된 항목은 gray area에서 자동 제외.

## 통합 파이프라인 검증 (DOG-01)

| 단계 | 결과 | 메모 |
|------|------|------|
| `/office-hours` | (사전 진행) | DESIGN.md 산출 |
| `/autoplan` | (사전 진행) | 5개 critical correction 도출 |
| `/gsd-new-project --auto @DESIGN.md` | △ 부분 성공 | 1차 sonnet 병렬 fail → 재시도 시 성공 (마찰 #4) |
| `/gsd-discuss-phase 0 --auto` | ✓ 성공 | 8 gray areas 자동 결정. CONTEXT.md/DISCUSSION-LOG.md commit |
| `/gsd-plan-phase 0 --auto` | △ adapted | gsd-sdk 부재로 워크플로우 step 우회. RESEARCH/PATTERNS skip. plan 직접 작성 |
| `/gsd-execute-phase 0` | (다음 단계) | autonomous 가 아닌 task가 다수 (live env 의존) → 실제 실행은 사용자 동반 |

## 다음 개정판에 반영할 우선순위

1. **HIGH**: gsd-sdk 의존성 정리 (마찰 #1)
2. **HIGH**: phase type marker로 bootstrap phase의 research auto-skip (마찰 #2)
3. **MEDIUM**: balanced profile 동시 spawn cap (마찰 #4)
4. **MEDIUM**: codex deny 감지 + 자동 라우팅 (마찰 #5)
5. **LOW**: pattern-mapper greenfield 가드 (마찰 #3)
6. **LOW**: time budget 시맨틱 명확화 (마찰 #6)
7. **LOW**: discuss-phase의 spec-locked decision 자동 제외 (마찰 #7)
```
</action>
<acceptance_criteria>
- `.planning/phases/00-bootstrap-spikes/FRICTION.md` 존재
- 파일에 최소 5개 별개의 마찰 항목 (`### N.`) grep 가능
- 파일에 `gsd-sdk` 키워드 grep 가능 (마찰 #1)
- 파일에 `Phase 0 = research` 또는 `bootstrap phase` 키워드 (마찰 #2)
- 파일에 `sonnet 병렬` 또는 `rate limit` 키워드 (마찰 #4)
- 파일에 `codex` 키워드 (마찰 #5)
- 파일에 통합 파이프라인 단계 표 grep 가능 (DOG-01)
- 파일에 `우선순위` 또는 priority 표 grep 가능
</acceptance_criteria>
</task>

<verification>
## 검증 (BOOT-01 + DOG-01 + DOG-02 만족)

```bash
test -f state/PHASE-0-VERIFICATION.md
test -f .planning/phases/00-bootstrap-spikes/FRICTION.md
grep -E "Status: (PASS|FAIL)" state/PHASE-0-VERIFICATION.md
grep -c "^### [0-9]+\." .planning/phases/00-bootstrap-spikes/FRICTION.md
# 위 결과가 5 이상
grep -q "gsd-sdk" .planning/phases/00-bootstrap-spikes/FRICTION.md
grep -q "DOG-01\|통합 파이프라인" .planning/phases/00-bootstrap-spikes/FRICTION.md
bun test
# 종료 코드 0
```

이 plan 통과 시:
- BOOT-01 ✓ 5 spike 모두 명시적으로 PASS/FAIL 기록
- DOG-01 ✓ 통합 파이프라인 검증 보고서
- DOG-02 ✓ 마찰 메모 다음 개정판 입력으로 정리

Phase 0 전체 통과 → `/gsd-discuss-phase 1 --auto`로 진행 가능.
</verification>
