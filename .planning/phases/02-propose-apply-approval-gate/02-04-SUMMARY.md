---
phase: 02-propose-apply-approval-gate
plan: 04
subsystem: infra
tags:
  - phase-2
  - bootstrap
  - test-fixture
  - dogfood
  - docker-compose
  - ssh
  - alpine
  - state-mirror

# Dependency graph
requires:
  - phase: 01-read-only-knowledge-layer
    provides: tools/readCompose.ts SSH 옵션 패턴 (ConnectTimeout=10/ServerAliveInterval=5/BatchMode=yes)
  - phase: 02-propose-apply-approval-gate
    provides: 02-01 D-E1 게이트 PASS (Phase 1 live runtime smoke 5/5)
provides:
  - state/compose/{news,ais,n8n,krdn-fx}.yml 4 mirror — applyPatch ground truth + audit/diff 표시 source
  - tests/fixtures/test-compose.yml — 192.168.0.8 로컬 alpine:3 더미 stack 2개 (gons-test-svc-a/b)
  - tests/setup/docker-context.ts — switchToLocalContext / restoreContext helper (PROD 안전 격리)
  - scripts/init-state-compose.ts — SSH cat × 4 일회성 복사 + 단일 mainline commit (idempotent)
affects:
  - 02-05 proposePatch tool (state/compose/{stack}.yml 경로 strict-validate에 mirror 사용)
  - 02-06 applyPatch tool (mirror staleness check + state/ git commit ground truth)
  - 02-08+ E2E 검증 (test-compose.yml 위에서 모든 2PC 시나리오 재현)

# Tech tracking
tech-stack:
  added:
    - alpine:3 (tests/fixtures/test-compose.yml)
  patterns:
    - SSH cat one-shot mirror (D-A2 lock, idempotent commit)
    - Docker context safety belt-and-suspenders (env + explicit --context positional)
    - Test fixture with prefix isolation (gons-test-* container_name)
    - Helper try/throw with cleanup-on-error (env restore even when up fails)

key-files:
  created:
    - scripts/init-state-compose.ts
    - state/compose/news.yml
    - state/compose/ais.yml
    - state/compose/n8n.yml
    - state/compose/krdn-fx.yml
    - tests/fixtures/test-compose.yml
    - tests/setup/docker-context.ts
    - tests/setup/docker-context.test.ts
  modified: []

key-decisions:
  - "Option A 4-stack scope 적용 — open-webui는 192.168.0.5에서 plain `docker run`으로 실행되어 compose 미관리 → Phase 2 제외, v2 backlog"
  - "PROD 안전성 belt-and-suspenders — 모든 docker 명령에 `--context default` explicit positional + env 설정 둘 다 (PROD 침해 사고 발견 후 보강)"
  - "init script idempotent — 두 번째 실행 시 status 변경 없으면 commit skip"
  - "D-04 lock 준수 — state/는 메인 repo subdir, cwd는 메인 repo 루트 + pathspec state/compose/"

patterns-established:
  - "Pattern A: SSH cat one-shot init script — Phase 2 D-A2 lock 형태로 4 stack mirror 일회성 복사 + 단일 commit. 평소 sync 없음"
  - "Pattern B: Docker context safety belt-and-suspenders — env 설정 + explicit --context default positional 둘 다 적용으로 active context (PROD home-server) fallback 차단"
  - "Pattern C: Test fixture container_name prefix isolation — gons-test-* 으로 다른 컨테이너와 분리"
  - "Pattern D: Helper cleanup-on-error — switchToLocalContext가 up 실패 시 env 원복 후 throw, caller가 cleanup 호출 안 해도 안전"

requirements-completed: []

# Metrics
duration: 약 35분 (PROD 사고 진단 + 정리 + root-cause fix 포함)
completed: 2026-05-07
---

# Phase 2 Plan 04: state/compose mirror init + test fixtures (D-A2/D-A3) Summary

**4 stack 원격 docker-compose.yml을 SSH cat으로 일회성 mirror + alpine 더미 stack 2개 + DOCKER_CONTEXT belt-and-suspenders helper로 PROD 안전 격리 검증 환경 구축**

## Performance

- **Duration:** 약 35분 (PROD 침해 사고 진단 + cleanup + root-cause fix 포함)
- **Started:** 2026-05-07T07:07:00Z (대략)
- **Completed:** 2026-05-07T07:42:46Z
- **Tasks:** 4 (Task 1 검증만, Task 2-4 구현)
- **Files created:** 8

## Accomplishments

- 192.168.0.5 운영 서버 4 stack의 docker-compose.yml을 state/compose/{stack}.yml에 SSH cat으로 일회성 복사 (D-A2 lock) — applyPatch ground truth + audit/diff 표시 source 확보
- 192.168.0.8 로컬 alpine:3 더미 stack 2개 (test-svc-a/b) 신설 — applyPatch 2PC E2E 검증을 PROD 절대 조작 금지 원칙 위에서 가능 (D-A3 lock)
- switchToLocalContext / restoreContext helper로 DOCKER_CONTEXT 라이프사이클 캡슐화 — env + explicit `--context default` belt-and-suspenders 패턴으로 PROD fallback 차단
- init script idempotent — 두 번째 실행 시 status 변경 없으면 commit skip (실수로 재실행해도 commit 노이즈 안 생김)
- TDD RED → GREEN 사이클 lock — module-shape test가 RED 게이트, E2E=1 환경에서 actual round-trip 검증

## Task Commits

각 task는 atomic하게 commit:

1. **Task 1: 운영 서버 5 stack 절대경로 확인 (검증만)** — pre-existing 4-stack hotfix(`a91a514`) + dispatcher가 SSH `test -f` × 4로 사전 검증, 본 plan에서 추가 commit 없음
2. **Task 2: scripts/init-state-compose.ts 작성 + 실행 + state/ 단일 commit** — 2 commits:
   - `f537e69` (feat) — init script 자동 수행한 mainline commit `bootstrap state/compose mirror (4 stacks via SSH cat)` (4 mirror YAML)
   - `6a5a60e` (feat) — script 파일 자체 commit `scripts/init-state-compose.ts 추가`
3. **Task 3: tests/fixtures/test-compose.yml 작성** — `ed7eb56` (feat) — alpine 더미 stack 2 컨테이너 정의 + manual round-trip 검증 통과
4. **Task 4: tests/setup/docker-context.ts + 단위 테스트 (TDD)** — 2 commits:
   - `9e09e2b` (test) — RED: 빈 helper + module-shape test 2개 FAIL 강제
   - `4c20e76` (feat) — GREEN: helper 구현 + PROD safety fix (Rule 1 deviation)

**총 5 commits** (state mirror commit + script + fixture + RED + GREEN).

_Note: TDD task의 RED/GREEN 별도 commit 분리 lock. REFACTOR 단계는 helper가 충분히 단순하여 생략._

## Files Created/Modified

### Created

- `scripts/init-state-compose.ts` (111 LoC) — 4 stack SSH cat 일회성 복사 + 단일 mainline commit (idempotent)
- `state/compose/news.yml` (54 LoC) — news stack mirror
- `state/compose/ais.yml` (247 LoC) — ais stack mirror
- `state/compose/n8n.yml` (220 LoC) — n8n stack mirror
- `state/compose/krdn-fx.yml` (49 LoC) — krdn-fx stack mirror
- `tests/fixtures/test-compose.yml` (24 LoC) — alpine:3 더미 stack 2 컨테이너 (gons-test-svc-a/b)
- `tests/setup/docker-context.ts` (90 LoC) — switchToLocalContext / restoreContext helper
- `tests/setup/docker-context.test.ts` (74 LoC) — module-shape (RED gate) 2 + E2E round-trip 1 (E2E=1 시 actual)

### Modified

(없음 — 모두 신규 파일)

## Decisions Made

### D1: Init script가 자동 수행하는 mainline commit과 script 자체 commit을 분리

PLAN의 "단일 transaction" 표현은 mirror commit이 atomic임을 의미했고, script 파일 자체는 별도 task commit이 필요하다(advisor 자문 lock). 결과: `f537e69` (mirror) + `6a5a60e` (script)로 2 commit으로 분리. Idempotent 검증 시(두 번째 실행) script도 함께 추적되어야 하기 때문.

### D2: Init script commit message에 "5 stacks" → "4 stacks" 자동 수정 (Rule 1 deviation)

PLAN.md Task 2 line 203의 commit message에는 "5 stacks via SSH cat"으로 적혀 있었으나 Option A hotfix(2026-05-07)로 scope이 4-stack으로 축소되었음. 자동으로 "4 stacks"으로 수정 — message-content mismatch는 Rule 1 bug.

### D3: Docker context safety belt-and-suspenders — explicit `--context default` positional 추가 (Rule 1 deviation)

초안은 `process.env.DOCKER_CONTEXT = "default"` 설정만으로 자식 docker CLI에 컨텍스트가 전파될 거라 가정했으나 Bun.spawn 자식 프로세스에서 env propagation이 불안정. 첫 E2E 시도에서 alpine 더미 컨테이너 2개가 PROD(192.168.0.5)에 생성되는 침해 발생 → 즉시 SSH 정리 후 root-cause fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Init script commit message "5 stacks" → "4 stacks"**

- **Found during:** Task 2 (script 작성)
- **Issue:** PLAN.md line 203의 commit message가 "5 stacks via SSH cat"으로 hotfix 이전 텍스트 잔존. Option A 4-stack scope hotfix(2026-05-07)와 mismatch.
- **Fix:** "4 stacks via SSH cat"으로 수정해서 작성 + 실행. mainline commit `f537e69 feat(02): bootstrap state/compose mirror (4 stacks via SSH cat)`로 정확.
- **Files modified:** scripts/init-state-compose.ts (신규 작성 시점에 적용)
- **Verification:** `git log --oneline -- state/compose/` 결과에 "4 stacks" 포함.
- **Committed in:** 6a5a60e (script 자체)

**2. [Rule 1 - Bug, CRITICAL PROD safety] DOCKER_CONTEXT env propagation 불안정 → PROD 침해 사고**

- **Found during:** Task 4 (E2E=1 첫 시도 — RED→GREEN 직후)
- **Issue:** 초안 helper는 `process.env.DOCKER_CONTEXT = "default"` 설정만 함. Bun.spawn된 자식 docker CLI가 env를 안정적으로 받지 못해 active context(home-server = PROD 192.168.0.5)로 fallback. 결과: `gons-test-svc-a` / `gons-test-svc-b` 더미 컨테이너 2개 + `fixtures_default` 네트워크 1개가 **PROD에 생성됨**. ps stdout이 비어있는 시그널로 advisor가 root-cause 식별.
- **Fix (3 단계):**
  1. **즉시 정리:** `ssh gon@192.168.0.5 'docker rm -f gons-test-svc-a gons-test-svc-b; docker network rm fixtures_default'` — PROD 컨테이너/네트워크 모두 제거 후 `ssh ... ps -a --filter name=gons-test-` 비어있음 / `network ls | grep fixtures` 비어있음 확인.
  2. **Root-cause fix:** helper의 모든 `Bun.spawn(["docker", "compose", ...])`을 `Bun.spawn(["docker", "--context", "default", "compose", ...])`로 변경. env 변경은 보조 안전망으로 유지(다른 docker-touching 코드 안전성).
  3. **재검증:** `E2E=1 bun test` → 3 pass / 7 expect / 11s. PROD `ps -a --filter name=gons-test-` 빈 결과, 로컬도 깨끗(restoreContext가 down --volumes 정상 수행).
- **Files modified:** tests/setup/docker-context.ts (해당 파일은 GREEN 단계 단일 commit에 fix 통합)
- **Verification:** 사고 후 PROD 재확인 0 컨테이너 + 0 fixtures network. E2E=1 round-trip 11초로 정상 통과.
- **Committed in:** 4c20e76 (Task 4 GREEN — fix가 GREEN과 함께 commit됨, message에 사고/fix 명시)

---

**Total deviations:** 2 auto-fixed (둘 다 Rule 1 — bug)
**Impact on plan:** D2(commit message mismatch)는 단순 텍스트 수정. D3(PROD 침해)는 critical safety 사고 + root-cause fix를 deviation으로 lock — 본 plan의 hard-learned lesson을 02-06+ applyPatch에서도 동일 패턴(explicit `--context` everywhere)으로 carry-forward 필수. 시간 cost ~10-15분 (PROD 진단 + cleanup + 재검증).

## Issues Encountered

### Issue 1: PROD 침해 사고 (가장 큰 마찰)

위 Deviation #2가 정확한 기록. 핵심: **env-only context 설정은 신뢰 불가, explicit positional 인자 필수**. 본 plan이 발견한 Phase 2 운영 안전망의 가장 critical lesson — applyPatch (02-06)는 SSH command를 직접 호출하지만, listContainers / readCompose / readLogs 같은 read-only docker 호출도 모두 explicit `--context home-server` (or `default` for tests) 패턴을 따라야 함.

**Phase 1 코드 재점검 결과 (advisor 권고 후 즉시 수행):** `rg "DOCKER_CONTEXT|docker --context|docker compose|docker run" tools/ kb/`로 점검. 결과: Phase 1의 모든 docker 호출은 이미 안전 — `tools/listContainers.ts:63`, `tools/readLogs.ts:84-88`, `kb/stale-check.ts:119`, `scripts/draft-services-yaml.ts:50` 모두 `Bun.$\`docker --context ${env.DOCKER_CONTEXT} ...\`` 패턴으로 explicit `--context` positional을 사용 중 (PITFALL #8 prevention 명시). 본 plan helper는 처음 작성 시 env-only 가정으로 일시 lapse했고 GREEN commit에서 동일 패턴으로 수정 완료. **Phase 1 tools는 추가 작업 불필요.**

### Issue 2: Worktree path confusion (소규모, 자체 해결)

처음 Write tool 사용 시 worktree 절대경로 대신 main repo 절대경로(`/home/gon/projects/gon/gons-works/scripts/init-state-compose.ts`)에 파일을 만들어 `bun run`이 worktree cwd에서 module not found. 즉시 main repo 파일 삭제 → worktree 정확한 절대경로(`.claude/worktrees/agent-a5aefe9a0b0804a4f/scripts/init-state-compose.ts`)로 재작성 → 정상 진행. main repo는 손대지 않은 원본 상태로 복원 검증 완료.

## User Setup Required

**Operator action 1 (병합 후 1회 필수):** 메인 repo `.git/hooks/pre-commit`에 02-03이 install한 APPLY-07 ff-only block은 worktree에서 자동 활성됨(메인 repo의 공유 hooks). 별도 작업 없음.

**Operator action 2 (선택):** init script는 이미 1회 실행되어 mirror committed. 향후 OOB drift 감지 시 별도 sync proposal 흐름(02 후속 plan)에서 재실행 검토.

**Operator action 3 (테스트):** `E2E=1 bun test tests/setup/docker-context.test.ts` — 11초 alpine pull/up/down. 평소(unset E2E)는 module-shape만 7ms로 통과.

## Next Phase Readiness

### 다음 plan(02-05 proposePatch)에 대한 준비

- ✓ state/compose/{news,ais,n8n,krdn-fx}.yml 4 mirror — proposePatch fileEdit.path strict validate에 사용 (D-B2 lock)
- ✓ test fixture (gons-test-svc-a/b) — proposePatch가 test stack 대상으로 propose / E2E 시나리오 재현 가능
- ✓ docker-context helper — beforeAll/afterAll에서 라이프사이클 관리

### 다음 plan(02-06 applyPatch)에 대한 준비

- ✓ state/compose mirror = applyPatch가 수정/staleness check할 ground truth
- ✓ test stack = 2PC E2E 검증 (success / docker fail rollback / git commit fail rollback / crash window) 모든 시나리오 재현 가능
- **CRITICAL carry-forward:** explicit `--context` positional 패턴은 02-06 applyPatch SSH/docker 모든 호출 지점에 적용 필수. env propagation에 의존 않는다(본 plan의 hard-learned lesson).

### Blockers / 우려사항

- **None blocking** — 본 plan의 모든 산출물 lock 완료, 4 stack scope 적용 일관, PROD 안전성 검증 완료.
- **Carry-forward 우려 (낮음):** 02-06 applyPatch가 docker `--context home-server` 사용 시 동일 belt-and-suspenders 적용 여부 — plan-phase 또는 review에서 명시.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: prod-context-fallback | tests/setup/docker-context.ts | env-only DOCKER_CONTEXT 설정은 Bun.spawn 자식에 안정적으로 전파되지 않을 수 있음. 모든 docker 명령에 explicit `--context default`(또는 의도하는 컨텍스트) positional 필수. 본 plan이 첫 발견한 PROD safety 모드 — 02-06 applyPatch에 carry-forward. |

## Self-Check: PASSED

### Files (8 created)

- FOUND: scripts/init-state-compose.ts
- FOUND: state/compose/news.yml
- FOUND: state/compose/ais.yml
- FOUND: state/compose/n8n.yml
- FOUND: state/compose/krdn-fx.yml
- FOUND: tests/fixtures/test-compose.yml
- FOUND: tests/setup/docker-context.ts
- FOUND: tests/setup/docker-context.test.ts

### Commits (5)

- FOUND: f537e69 feat(02): bootstrap state/compose mirror (4 stacks via SSH cat)
- FOUND: 6a5a60e feat(02-04): scripts/init-state-compose.ts 추가
- FOUND: ed7eb56 feat(02-04): tests/fixtures/test-compose.yml — alpine 더미 stack
- FOUND: 9e09e2b test(02-04): tests/setup/docker-context — RED (export 시그니처 강제)
- FOUND: 4c20e76 feat(02-04): tests/setup/docker-context — GREEN (helper 구현)

### Verification

- ✓ `find state/compose -name "*.yml" | wc -l` = 4
- ✓ `git log --oneline -- state/compose/` = single commit "bootstrap state/compose mirror (4 stacks via SSH cat)"
- ✓ `grep -c "test-svc-a" tests/fixtures/test-compose.yml` ≥ 1 (3 매치 — 코멘트 + container_name + service 키)
- ✓ `grep -c "process.env.DOCKER_CONTEXT" tests/setup/docker-context.ts` = 7 (set + restore + delete 모두)
- ✓ `bun test tests/setup/docker-context.test.ts` → 3 pass / 0 fail (no E2E)
- ✓ `E2E=1 bun test ...` → 3 pass / 0 fail / 7 expect calls / 11s
- ✓ PROD `ssh ... ps -a --filter name=gons-test-` 빈 결과 — 침해 사고 후 cleanup 검증 완료
- ✓ PROD `ssh ... network ls | grep fixtures` 빈 결과

---

*Phase: 02-propose-apply-approval-gate*
*Plan: 04 (state/compose mirror init + test fixtures D-A2/D-A3)*
*Completed: 2026-05-07*
