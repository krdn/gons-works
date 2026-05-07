---
phase: 02-propose-apply-approval-gate
plan: 02-01
subsystem: pre-execute-gate
type: execute
wave: 0
requirements: []
tags:
  - phase-2
  - pre-execute-gate
  - dogfood
  - operator-action
  - non-implementation
provides:
  - 02-01-SMOKE-LOG.md (1차 — FAIL, F-1/F-2 lock-in, 보존)
  - 02-01-SMOKE-LOG-2.md (2차 — 5/5 PASS, D-E1 OPEN)
requires:
  - Phase 1 ROADMAP Success Criteria #1/#2/#3/#4
  - VOYAGE_API_KEY 회전 (Phase 1 carry-forward HIGH 보안 outstanding)
  - Plan 01-10 hotfix (F-1 compactHistory aliasing + F-2 SSE final emit)
affects:
  - 02-02..02-10 (게이트 OPEN으로 후속 plan 진입 unblocked)
key-files:
  created:
    - .planning/phases/02-propose-apply-approval-gate/02-01-SMOKE-LOG.md
    - .planning/phases/02-propose-apply-approval-gate/02-01-SMOKE-LOG-2.md
  modified: []
decisions:
  - D-E1 게이트는 라이브 검증 산출물 2장으로 닫음 (FAIL → fix → PASS 사이클 보존)
  - 신규 코드 0줄 (plan 자체가 manual 운영자 행동)
  - SMOKE-LOG-1 보존 (FAIL 증거를 D-E1 게이트의 ROI 입증으로 lock-in)
  - VOYAGE 무료등급 함정(3 RPM / 10K TPM)은 FRICTION F-3에 lock-in
metrics:
  smoke_runs: 2
  criteria_pass_final: "5/5"
  defects_found: 2  # F-1 compactHistory aliasing, F-2 SSE final fire-and-forget
  defects_fixed_in: "Plan 01-10 (commits a8ede05, f761934)"
  hotfix_commits: 2
  files_created: 2
  total_lines: 172
  duration: "~6h (1차 검증 + Phase 1 hotfix + 2차 검증)"
  completed: 2026-05-07
---

# Phase 2 Plan 01: D-E1 Pre-Execute Gate Summary

**한줄 요약:** Phase 2 본격 진입 전 운영자 manual 라이브 smoke 5단계 + VOYAGE 키 회전. 1차 0/5 FAIL로 결정적 wire 결함 2건(F-1/F-2)이 라이브에서만 드러남 → Plan 01-10 hotfix → 2차 5/5 PASS로 D-E1 게이트 OPEN. **D-E1 게이트의 가치 입증 사이클 (discover → plan → fix → re-verify) 한 phase 안에서 완결.**

## Outcome

D-E1 게이트 **OPEN**. Phase 2 plan 02-02 ~ 02-10 진입 unblocked. 후속 plan 모두 SUMMARY.md 완료 (코드 100%, 운영자 단계 일부 carry-forward는 02-10/02-VERIFICATION.md에서 처리).

## Manual 수행 결과 (운영자)

### Step A — VOYAGE_API_KEY 회전 (PASS)

| 항목 | Status | Evidence |
|------|--------|----------|
| dashboard에서 새 키 발급 + 기존 revoke | PASS | 사용자 직접 수행 |
| .env `VOYAGE_API_KEY=` 새 값 갱신 | PASS | grep `^VOYAGE_API_KEY=` returns set |
| embed roundtrip (1024 dim) | PASS (1차) | `OK 1024` |
| 결제 등록 후 burst 검증 (4 calls) | PASS (2차) | `OK x4 dims=1024` |

**Carry-forward observation:** 새 키가 결제 미등록 무료등급(3 RPM / 10K TPM)으로 시작하여 RAG `queryTopK` 매 query당 voyage 호출에서 429 발생. 사용자가 `https://dashboard.voyageai.com/billing` 결제 등록으로 해결 → standard tier 활성. 다음 회전 시에도 동일 함정 — 회전 직후 dashboard에서 billing tier 즉시 확인 필수. **FRICTION F-3에 lock-in.**

### Step B — Phase 1 live smoke 5단계

| # | Criteria | 1차 (Pre-fix) | 2차 (Post-fix) |
|---|----------|---------------|----------------|
| 0 | `unset ANTHROPIC_API_KEY` 후 server start | PASS | PASS |
| 1 | "ais-prod redis 어디 쓰여?" → RAG + 라이브 docker | **FAIL** | **PASS** |
| 2 | "지난밤 새벽 1-3시 voice 에러 패턴" → readLogs | BLOCKED | **PASS** |
| 3 | services.yaml drift → banner | BLOCKED (partial) | **PASS** |
| 4 | `data/copilot.db events` SELECT | **PASS** | **PASS** |
| **합계** | | **0/5 FAIL** | **5/5 PASS** |

**Verdict 전환: FAIL → PASS** (Plan 01-10 hotfix 적용 후).

## 발견된 결함 2건 (라이브에서만 드러남)

| ID | 결함 | 원인 | Fix Commit |
|----|------|------|-----------|
| **F-1** | compactHistory array aliasing | `compactHistory`가 입력 array를 reference로 mutate, two-step tool-use turn에서 두 번째 callWithFallback이 빈 messages 배열 받음 → 400 invalid_request_error | `a8ede05` (Plan 01-10) |
| **F-2** | SSE final emit fire-and-forget | `controller.enqueue(final)` 직후 stream close, write가 flush되기 전에 connection 종료되어 final event가 SSE 클라이언트에 미도달 | `f761934` (Plan 01-10) |

두 결함 모두 **mock emit/sync flow를 쓰는 단위 테스트로는 잡을 수 없는 PITFALL 클래스** — 라이브 환경(real LLM API + real SSE wire)에서만 드러남. 22/22 unit/integration PASS 코드에서 결정적 wire 결함을 잡은 것이 **D-E1 게이트의 직접 가치 입증**.

## D-E1 게이트 메타 평가

- **게이트 ROI:** unit test 22/22 + integration 다수 PASS 코드에서 array aliasing(F-1) + async race(F-2) 두 결함을 라이브 검증으로만 잡음. dogfood 게이트의 가치 입증.
- **dogfood 사이클 닫힘:** discover (1차 SMOKE-LOG FAIL) → plan (01-10 hotfix) → fix (a8ede05, f761934) → 회귀 test (158 PASS) → live re-verify (2차 SMOKE-LOG 5/5 PASS)가 한 phase 안에서 완결. **Phase 1 carry-back 패턴 정상 동작.**
- **Phase 2/3 권장:** 비슷한 패턴(write-side action, approval gate, atomic 2-phase commit)에도 동일한 D-X1 게이트를 두는 것을 권장.
- **audit DB 가치:** Criteria #4 PASS는 1차에서도 유지됨 — wire 결함이 SSE 클라이언트 가시성에만 영향, audit는 정상 기록. fix 전/후 대조 증거가 git-versioned로 보존.

## Success Criteria 달성

- [x] 02-01-SMOKE-LOG.md 존재 + min_lines ≥ 40 (1차 87줄, 2차 85줄)
- [x] 5 Criteria 모두 PASS 표기 (2차 SMOKE-LOG-2)
- [x] VOYAGE 회전 PASS 표기
- [x] git commit 추가 (`docs(02): 01 — D-E1 ...` × 2: 1차 FAIL 기록 + 2차 PASS 재검증 `430cbed`)
- [x] 어떤 .ts/.html/.yaml/.json도 plan 02-01 범위에서 수정되지 않음 (구현 0줄 — 후속 운영 개선은 별도 v1.x hotfix commit으로 분리)
- [x] 후속 plan(02-02..02-10)이 SMOKE-LOG-2를 참조 가능

## 이 SUMMARY가 늦게 작성된 이유

D-E1 게이트는 SMOKE-LOG-2.md (commit `430cbed`, 2026-05-07 14:18)에서 사실상 닫혔으나, plan 02-01 자체의 closure SUMMARY는 누락된 채 02-02..02-10이 진행되었다. 이 파일은 그 bookkeeping gap을 닫는다 — manual 작업의 retrospective summary이며 신규 검증을 추가하지 않는다.

## Next steps

1. STATE.md 갱신 — D-E1 OPEN + Phase 2 코드 100% + 운영자 carry-forward 항목 통합 정리
2. v1.3 hotfix (commit `b4dd0ee` — F-16 + paused stack + classify 7-stack 확장) 별도 처리 완료
3. Phase 3 진입 가능 (`/gsd-spec-phase 3` 또는 `/gsd-discuss-phase 3`)

## Backlog (본 게이트 범위 외, 02-VERIFICATION.md / 후속 phase로 이전)

- staleCheck 알고리즘 stack-level 매칭 한계 → **v1.3 hotfix `b4dd0ee`에서 paused 마커 + classify 7-stack 확장으로 부분 처리**
- Criteria #2 첫 시도에서 모델이 "voice"(⏸ 정지) 키워드를 5 stack에서 못 찾고 8회 한도 도달 — 동작 자체는 정상, 답변 품질 측면에서 system prompt 개선 여지 (Phase 2/3 backlog)
- 02-10 carry-forward 5건 운영자 단계 (라이브 5 SC + crash sim + DOG-03 PR 등) — 02-VERIFICATION.md BLOCKED 섹션
