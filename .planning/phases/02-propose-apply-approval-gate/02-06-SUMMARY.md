---
phase: 02-propose-apply-approval-gate
plan: 06
subsystem: tools
tags:
  - phase-2
  - apply-patch
  - 2pc-orchestrator
  - pitfall-2-prevention
  - prod-safety
  - test-injection-seam

# Dependency graph
requires:
  - phase: 02-propose-apply-approval-gate
    provides: 02-02 approval/store.ts (PendingApproval / ApprovalDecision / setPending / consumeApproval / expirePending / _resetForTest)
  - phase: 02-propose-apply-approval-gate
    provides: 02-03 state/commit.ts (buildMessage / commitWithMessage / sanitize — D-D1/D-D3 lock)
  - phase: 02-propose-apply-approval-gate
    provides: 02-04 state/compose/{news,ais,n8n,krdn-fx}.yml mirror (4 stack) + tests/fixtures/test-compose.yml + tests/setup/docker-context.ts
  - phase: 02-propose-apply-approval-gate
    provides: 02-05 tools/proposePatch.ts (ProposePatchResult shape + ApprovalDecision Promise)
provides:
  - tools/applyPatch.ts — 2PC orchestrator (D-A5 6-step + D-B3 git fail rollback + D-A4 mirror staleness + D-C1/C3/C4 marker lifecycle + D-D4 commit policy)
  - tools/applyPatch.ts dependencies object — sshExec/sshWriteFile/sshReadFile/gitAdd/commitWithMessage/gitRevParseHead (test injection seam)
  - tools/applyPatch.ts makeDefaultDependencies() — APPLY_TEST_MODE 분기 (PROD SSH vs 로컬 docker compose -f tests/fixtures/test-compose.yml)
  - state/.pending/.gitkeep — marker 디렉토리 git 추적용 placeholder
  - state/.gitignore — `/.pending/*` + `!/.pending/.gitkeep` negation 룰
affects:
  - 02-07 agent/loop.ts (dispatch에 proposePatch case 추가 시 setPending Promise await + 결정에 따라 applyPatch 또는 ToolError envelope return)
  - 02-08 src/server.ts (POST /approval/:id + 5번째 startup probe `recoverPendingMarkers` — applyPatch가 만든 marker schema 사용)
  - 02-10 E2E 검증 (APPLY_TEST_MODE=1 시 라이브 NL 흐름으로 SC #2/#3 docker→git 순서 라이브 증거 가능)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dependency injection seam (export const dependencies + monkey-patch + _resetDependenciesForTest)"
    - "APPLY_TEST_MODE env 분기 — PROD 보호 + 라이브 검증 둘 다 만족"
    - "2PC orchestration with marker lifecycle (write → progressive update → delete)"
    - "Reverse docker mapping (D-B3 — up↔down/start↔stop/restart→idempotent/logs/ps→null)"
    - "Mirror staleness SHA256 비교 (D-A4 — 진입 시 1회 SSH read)"
    - "Open Q 3 옵션 A — docker fail 시 원격 파일 + state mirror 둘 다 revert"
    - "Belt-and-suspenders PROD safety — env DOCKER_CONTEXT + explicit --context positional 둘 다"
    - "Test fixture isolation — TEST_MIRROR_PATH 별도 경로로 state/compose/{stack}.yml 미터치 보장"

key-files:
  created:
    - tools/applyPatch.ts (646 LoC) — 2PC orchestrator + dependencies seam + APPLY_TEST_MODE 분기
    - tools/applyPatch.test.ts (558 LoC) — 12 시나리오 (D-C4/happy×2/D-A4 drift/(iii) fail/(iv) fail/D-B3×2/edited/D-C3/APPLY_TEST_MODE×2)
    - state/.pending/.gitkeep (0 LoC) — 디렉토리 placeholder
  modified:
    - state/.gitignore (3 → 6 LoC) — `/.pending/` → `/.pending/*` + `!/.pending/.gitkeep` negation

key-decisions:
  - "advisor flag #1 — git add cwd 수정 (state는 메인 repo subdir, D-04 lock 준수, cwd='.' + 명시 pathspec)"
  - "advisor flag #2 — sshExec 시그니처 통일 (remoteCmd: string, signal?)"
  - "advisor flag #3 — sshReadFile helper 추가 (D-A4 staleness check 필수)"
  - "advisor flag #4 — testMode docker argv 정규식 파싱으로 'compose' 중복 회피"
  - "advisor flag #5 — 테스트 격리: TEST_MIRROR_PATH 별도 fixture로 state/compose/news.yml 미터치 보장"
  - "RED→GREEN 분리 commit (TDD 게이트)"
  - "SUMMARY 시점 PROD 누수 검증 — gons-test- 패턴 + test-svc 패턴 둘 다 0 결과"
  - "초안 비분할 진행 — 90분 budget 내 완료 (실측 ~50분), 02-06b 분할 옵션 미사용"

requirements-completed:
  - APPLY-02 (applyPatch 2PC)
  - APPLY-04 (docker→git 순서 + 분기별 rollback)
  - APPLY-05 (marker write — boot detect 토대는 02-08에서 사용)
  # APPLY-08 (LLM 모델)은 본 plan에서 LLM 미호출 — 02-08(server.ts)에서 모델 swap 처리

# Metrics
duration: 약 50분 (advisor 4-bug fix + RED/GREEN 분리 + 격리 패턴 정착 + PROD 검증)
completed: 2026-05-07
---

# Phase 2 Plan 06: applyPatch 2PC Orchestrator (D-A5/B3/C1/C3/C4/D4) Summary

**Phase 2의 가장 복잡한 단일 모듈 — 6-step 2PC + 3 fail 분기 + marker lifecycle + APPLY_TEST_MODE seam을 advisor가 짚은 4개 PLAN draft 버그 모두 fix하면서 RED/GREEN TDD로 12 테스트 통과까지 완료**

## Performance

- **Duration:** 약 50분 (PLAN 추정 90분의 55%)
- **Started:** 2026-05-07T08:05:00+09:00 (대략)
- **Completed:** 2026-05-07T08:55:00+09:00 (대략)
- **Commits:** 3 (chore + RED + GREEN)
- **Files created:** 3 (applyPatch.ts / applyPatch.test.ts / state/.pending/.gitkeep)
- **Files modified:** 1 (state/.gitignore — negation rule)
- **Tests:** 12 / 12 pass / 0 fail / 64 expect calls (32ms 실행)
- **Regression:** 0 (전체 222 / 0 fail / 4 skip)

## Accomplishments

- **D-A5 6-step 시퀀스 정확 구현**: (i) marker write → (ii) state mirror write → (iii) 원격 SSH cat > → (iv) docker compose with marker 점진 update → (v) git commit → (vi) marker delete + outcome=applied.
- **D-B3 신규 분기 자동화**: docker 성공 + git commit 실패 시 역 docker (up↔down / start↔stop / restart→idempotent restart) 자동 시도 + outcome=rolled-back에 rollback_command/rollback_ok 보고.
- **D-A4 mirror staleness check**: 진입 시 1회 SSH read + SHA256 비교, drift 감지 시 즉시 ToolError throw (sync proposal 먼저 실행 안내).
- **D-C1/C3/C4 marker lifecycle**: fsync sync write → docker_started_at → docker_finished_at + exit_code 두 단계로 점진 update → 성공/실패 시 unlink + 503 reject (다른 marker 존재).
- **D-D4 commit 정책**: applied / rolled-back만 git commit (rejected/aborted/expired는 caller 책임).
- **APPLY_TEST_MODE seam (Task 3)**: PROD 보호 + SC #2/#3 라이브 증거 둘 다 만족하는 유일 경로. 02-10 Step B의 hand-wave 우회 결정과 정확히 link.
- **PROD safety belt-and-suspenders 적용**: 02-04 carry-forward를 전 코드 경로에 lock — `--context default` explicit positional + env DOCKER_CONTEXT 둘 다.
- **TDD RED → GREEN 분리 commit**: RED 단계는 모듈 부재로 import 실패, GREEN 단계가 본체 + 격리 fix 합본.
- **advisor 4-bug 사전 결정**: git add cwd / sshExec 시그니처 / sshReadFile 누락 / testMode compose 중복 — 본 plan 코드 작성 전에 모두 fix.

## Task Commits

| Order | Hash | Type | Subject |
| ----- | ---- | ---- | ------- |
| 1 | `ffa4cf4` | chore | state/.pending/ 디렉토리 + .gitkeep + .gitignore negation |
| 2 | `9574f7f` | test | applyPatch RED — 8+ 시나리오 + APPLY_TEST_MODE seam (모듈 부재로 fail) |
| 3 | `b32b2ae` | feat | applyPatch 2PC orchestrator + APPLY_TEST_MODE seam (D-A5/B3/C1/C3/C4/D4) |

총 **3 commits** (chore + RED + GREEN). REFACTOR 단계는 advisor 4 bug가 GREEN 단계 한 commit에 모두 포함되어 별도 분리 안 함 — 코드 단순성 충분.

## Files Created/Modified

### Created

- `tools/applyPatch.ts` (646 LoC) — 2PC orchestrator + dependencies object (sshExec/sshWriteFile/sshReadFile/gitAdd/commitWithMessage/gitRevParseHead) + makeDefaultDependencies() APPLY_TEST_MODE 분기 + helper builders + REVERSE_DOCKER mapping + marker helpers (write/update/delete/existing).
- `tools/applyPatch.test.ts` (558 LoC) — 12 시나리오:
  1. D-C4 marker 존재 시 503 reject
  2. happy path 무 fileEdit (compose restart)
  3. happy path with fileEdit (compose up -d + image bump)
  4. D-A4 mirror staleness drift 감지
  5. (iii) sshWriteFile fail → state mirror revert + marker delete + throw
  6. (iv) docker exit≠0 → 원격/state revert + outcome=rolled-back + git commit 호출 0
  7. (v) git commit fail D-B3 → 역 docker (compose down) + rollback_command/rollback_ok 보고
  8. (v) compose ps에서 git fail → rollback_command=undefined (read-only)
  9. decision='edited' newContent override가 fileEdit에 반영
  10. D-C3 marker 점진 update (docker_started_at → finished_at + exit_code 두 단계)
  11. APPLY_TEST_MODE=1 — sshWriteFile no-op + sshReadFile 로컬 미러
  12. APPLY_TEST_MODE 미설정 — default deps 함수 시그니처 검증
- `state/.pending/.gitkeep` (0 LoC) — 디렉토리 placeholder.

### Modified

- `state/.gitignore` (3 → 6 LoC) — `/.pending/` 디렉토리 전체 무시에서 `/.pending/*` + `!/.pending/.gitkeep` negation으로 변경. 디렉토리만 git에 keep, marker JSON은 모두 무시.

## Decisions Made

### D1: advisor 4-bug 사전 fix (PLAN draft 코드 자체 결함)

advisor가 PLAN.md draft 코드에서 4개의 명시적 결함 짚음:

1. **`git add` cwd가 잘못 박힘 (CRITICAL — D-04 lock 위반).** PLAN line 290-293의 `Bun.spawn(["git","add","-A"],{cwd:"state"})`은 state/를 별도 git repo로 가정 — 02-03 commit.ts가 명시한 D-04 lock("state/는 메인 repo subdir, 별도 git repo 아님") 위반. 또 `-A`는 메인 repo의 모든 변경(.claude/.memsearch/DESIGN.md 등 untracked) stage 위험.
   - **Fix:** `gitAdd(paths: string[], cwd=".")`로 명시 pathspec 받는 helper 분리. cwd="."(메인 repo 루트), state/compose/{stack}.yml 또는 state/services.yaml만 path로 전달.

2. **`sshExec` 시그니처가 Task 1 ↔ Task 3에서 다름.** Task 1 line 271: `sshExec(remoteCmd, signal)` 단일 string, Task 3 line 454: `sshExec(host, remoteDir, command)` 3-arg.
   - **Fix:** Task 1 시그니처 채택 — `sshExec(remoteCmd: string, signal?)`. testMode는 remoteCmd 정규식 파싱으로 docker compose 부분 추출.

3. **`sshReadFile` helper 누락.** PLAN behavior 1번이 D-A4 staleness check를 명시했으나 helper 리스트에는 sshExec/sshWriteFile만 있음.
   - **Fix:** `sshReadFile(host, remotePath, signal?) → SshExecResult` 추가. testMode는 로컬 미러를 그대로 echo (drift 0 강제).

4. **testMode docker argv `compose` 중복 위험.** Task 3 line 458-462의 testMode argv가 `["compose", ..., ...command.split(" ")]`인데 command가 `"compose restart svc"`라 `compose`가 두 번 들어감.
   - **Fix:** testMode에서 remoteCmd 정규식 매치 `/docker\s+compose\s+(.+)$/`로 subcmd+svc만 추출 → `["docker","--context","default","compose","-f", testCompose, ...subcmdAndSvc]`.

본 plan 시작 전 advisor 호출에서 모두 식별 → 코드 작성 단계에 직접 반영.

### D2: 테스트 격리 강화 — TEST_MIRROR_PATH 별도 fixture

happy path with fileEdit / decision='edited' 테스트는 처음에는 `state/compose/news.yml`(02-04 산출물)을 직접 mock content로 덮어쓰고 끝에 originalContent로 되돌리는 패턴이었음. 그런데 D-A4 staleness 테스트와 (iii)/(iv) fail 테스트는 원본 복원 코드가 누락되어 git status에 `state/compose/news.yml` 변경 잔존.

- **Fix:** TEST_MIRROR_PATH를 `state/compose/news.test-fixture.yml`로 분리. afterEach가 `cleanupTestFixture()`로 fixture 파일 삭제. 02-04 산출물은 절대 미터치.

### D3: D-C3 점진 update 테스트 hook 위치 — gitAdd → commitWithMessage

처음 RED 테스트는 git commit 직전 marker 읽기를 `gitAdd` mock에 hook했으나, fileEdit 없는 happy path에서는 `gitAdd`가 빈 path로 호출돼서 early return — snapshot 안 잡힘. `commitWithMessage`로 hook 이동하여 무 fileEdit 시나리오에서도 안정적으로 marker 점진 update 검증.

### D4: 비분할 진행 — 90분 budget 내 완료

PLAN.md line 564는 90분 초과 시 D-B3 분기를 02-06b로 분할 가능 옵션 명시. 본 plan은 advisor 사전 결정 + 격리 패턴 안정화로 ~50분에 완료 — 분할 미사용. SUMMARY에 trade-off 명시 불필요.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] git add cwd가 D-04 lock 위반 (CRITICAL)**

- **Found during:** advisor 호출 (Task 1 시작 전)
- **Issue:** PLAN.md Task 1 line 290-293의 `Bun.spawn(["git","add","-A"],{cwd:"state"})`는 state/를 별도 git repo로 가정 — D-04 lock("state/는 메인 repo subdir, 별도 git repo 아님") 위반.
- **Fix:** `gitAdd(paths: string[], cwd=".")` helper로 명시 pathspec 받음. applyPatch는 effectiveFileEdit이 있을 때만 fileEdit.path를 paths로 전달.
- **Files modified:** tools/applyPatch.ts (helper 추가 + 호출부)
- **Verification:** test 12/12 PASS, git status 깨끗.
- **Committed in:** b32b2ae

**2. [Rule 1 - Bug] sshExec 시그니처가 Task 1/Task 3 mismatch**

- **Found during:** advisor 호출
- **Issue:** Task 1은 `sshExec(remoteCmd, signal)` 단일 string, Task 3은 `sshExec(host, remoteDir, command)` 3-arg로 mismatch.
- **Fix:** Task 1 시그니처 채택 (`remoteCmd: string`). testMode는 정규식 파싱으로 docker compose 부분 추출하여 로컬 호출에 매핑.
- **Files modified:** tools/applyPatch.ts (시그니처 lock + testMode 정규식)
- **Committed in:** b32b2ae

**3. [Rule 1 - Bug] sshReadFile helper 누락 — D-A4 미동작**

- **Found during:** advisor 호출
- **Issue:** PLAN behavior 1번에 D-A4 staleness check ("원격 docker-compose.yml SHA256 비교") 명시되었으나 PLAN의 helper 리스트(line 214-222)에는 sshExec/sshWriteFile만 있음. sshReadFile 없으면 staleness check 자체 불가.
- **Fix:** `sshReadFile(host, remotePath, signal?)` helper 추가. PROD 모드는 `ssh ... cat <path>`, testMode는 로컬 `state/compose/{stack}.yml` 그대로 echo (drift 0 강제 — staleness 무력화).
- **Files modified:** tools/applyPatch.ts (helper + ApplyDependencies interface + applyPatch 본체 호출)
- **Committed in:** b32b2ae

**4. [Rule 1 - Bug] testMode docker argv 'compose' 중복**

- **Found during:** advisor 호출
- **Issue:** PLAN.md Task 3 line 458-462의 testMode argv가 `["compose","-f",testCompose,...command.split(" ")]`인데, command 인자가 `"compose restart svc"` 형태이므로 `compose`가 두 번 들어가 docker CLI 에러.
- **Fix:** testMode가 받는 remoteCmd 정규식 매치 `/docker\s+compose\s+(.+)$/`로 subcmd+svc 부분만 추출 → 그것만 spawn argv에 append.
- **Files modified:** tools/applyPatch.ts (makeTestModeSshExec 함수)
- **Committed in:** b32b2ae

**5. [Rule 1 - Bug] 테스트 격리 — state/compose/news.yml 미터치 보장**

- **Found during:** Task 2 첫 실행 직후 `git status`로 발견
- **Issue:** 처음 테스트는 mock mirror content를 `state/compose/news.yml` 직접 덮어쓰고 happy path만 끝에 복원. D-A4 staleness 테스트와 (iii)/(iv) fail 테스트는 복원 누락 — git status에 02-04 산출물 변경 잔존.
- **Fix:** TEST_MIRROR_PATH = `state/compose/news.test-fixture.yml`로 분리. afterEach가 cleanupTestFixture로 fixture 삭제. 02-04 산출물 절대 미터치.
- **Files modified:** tools/applyPatch.test.ts (격리 helper + 모든 시나리오 path 변경)
- **Verification:** `git diff state/compose/news.yml` empty.
- **Committed in:** b32b2ae

---

**Total deviations:** 5 auto-fixed (모두 Rule 1 — bug)
**Impact on plan:** advisor flag 4건은 사전 결정으로 코드 작성 단계 마찰 0. flag 5(테스트 격리)는 Task 2 첫 실행 후 즉시 발견 → ~3분 소요. 90분 budget 사용량 ~50분으로 대폭 여유 (분할 fallback 미사용).

## Issues Encountered

### Issue 1: D-C3 점진 update 테스트 hook 위치 (작은 마찰)

처음 D-C3 marker 점진 update 테스트는 git commit 직전 marker snapshot을 `gitAdd` mock에 hook. 그런데 무 fileEdit happy path에서는 effectiveFileEdit가 없어 gitAdd가 빈 paths로 호출 → early return하여 hook 트리거 안 됨. 테스트 1개 fail.

**Fix:** hook을 `commitWithMessage`로 이동 — 모든 happy path에서 안정적으로 trigger. 1차 GREEN 시도에서 11/12 PASS 후 1분 만에 식별 → 즉시 fix → 12/12 PASS.

### Issue 2: PROD 안전성 검증 패턴 (사용자 prompt 정정)

사용자 prompt는 검증 패턴으로 `--filter name=test-svc` 사용 권장. 그러나 02-04에서 만든 fixture container_name은 `gons-test-svc-a`/`gons-test-svc-b` (prefix `gons-test-`). `test-svc`로 grep해도 매칭되지만 더 정확한 패턴은 `gons-test-`. 본 plan은 둘 다 검증 (둘 다 0건이어야 PASS).

```bash
ssh gon@192.168.0.5 'docker ps -a --filter name=gons-test- --format "{{.Names}}" ; docker ps -a --filter name=test-svc --format "{{.Names}}"'
# 결과: 두 패턴 모두 0건 (출력 없음) — PROD 누수 0 확인
```

## User Setup Required

**Operator action 1 (다음 plan 시작 전):**
없음 — 02-07 (agent/loop.ts dispatch 확장)에서 본 plan의 applyPatch + dependencies seam을 직접 import하여 사용. 별도 setup 불필요.

**Operator action 2 (02-10 라이브 검증 시):**
APPLY_TEST_MODE=1 환경변수 설정 후 `bun run scripts/test-apply-patch.ts` 또는 `APPLY_TEST_MODE=1 bun run dev`로 server 띄운 후 라이브 NL 흐름. PROD 호출 절대 발생 안 함 (D-A3 lock).

**Operator action 3 (PROD 검증, 평소):**
운영 시작 시 explicit env 설정 필요 — `APPLY_TEST_MODE`가 unset일 때만 SSH 경유 PROD 모드. 실수로 testMode 들어가지 않도록 명시적 env 강제.

## Next Phase Readiness

### 다음 plan(02-07 agent/loop.ts dispatch + waitForApproval)에 대한 준비

- ✓ tools/applyPatch.ts 본체 완성 — `applyPatch(args, ctx)` import해서 dispatch case에서 호출 가능.
- ✓ ApplyPatchResult shape lock — outcome: applied | rolled-back, LOOP가 SSE event 매핑.
- ✓ approval/store.ts setPending Promise + applyPatch 결합 흐름이 명확. LOOP가 `await decision` 후 `decision.type==="approved"|"edited"`이면 applyPatch 호출, 그 외는 ToolError envelope return.
- ✓ AbortController signal seam — `ctx.signal` 통해 SSH/docker subprocess에 forward.

### 다음 plan(02-08 src/server.ts + recoverPendingMarkers + LLM 모델 swap)에 대한 준비

- ✓ marker schema lock — boot detect 시 nonce/stack/command/service/sha_before/docker_started_at/docker_finished_at/exit_code 모두 사용 가능.
- ✓ state/.pending/ 디렉토리 git 추적 보장 — clone 후 즉시 `existingMarkers()` glob 동작.
- ✓ APPLY_TEST_MODE env가 server.ts에서도 동일 의미 — `makeDefaultDependencies()`가 모듈 import 시 1회 평가되므로 `_resetDependenciesForTest()` 또는 process restart 필요 (운영 시 주의 필요).

### 다음 plan(02-10 E2E)에 대한 준비

- ✓ APPLY_TEST_MODE seam 동작 검증됨 — `bun test tools/applyPatch.test.ts -t "APPLY_TEST_MODE"` 2/2 PASS.
- ✓ 02-04 fixture (test-compose.yml + docker-context helper)와 정확히 호환 — testMode가 같은 file path 사용.
- ✓ SC #2 (docker→git 순서) + SC #3 (git fail 시 역 docker) 라이브 증거 확보 가능.

### Blockers / 우려사항

- **None blocking** — 본 plan의 모든 산출물 lock 완료, advisor 4 bug 모두 사전 fix, PROD 누수 0 검증.
- **잠재 우려 (낮음, 02-08에서 처리):** `dependencies` object는 module-level singleton — 운영 중 APPLY_TEST_MODE 토글이 즉시 반영 안 됨 (process restart 필요). 02-08 server.ts에서 process boot 시 1회 평가가 최소 충분 가정으로 운영 — 토글 시 process restart는 운영자가 인지해야 함.
- **02-06b 분할 옵션 미사용:** 90분 budget 충분 여유 — ~50분에 완료. 분할 fallback 트리거 안 함.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: marker-singleton-toggle | tools/applyPatch.ts | `dependencies`는 module-level singleton, `APPLY_TEST_MODE` 토글이 process restart 없이는 반영 안 됨. 02-08 server.ts에서 boot 시 1회 평가 정책 명시 필요. |

## Self-Check: PASSED

### Files (3 created + 1 modified)

- FOUND: tools/applyPatch.ts
- FOUND: tools/applyPatch.test.ts
- FOUND: state/.pending/.gitkeep
- MODIFIED: state/.gitignore (negation rule)

### Commits (3)

- FOUND: ffa4cf4 chore(02-06): state/.pending/ 디렉토리 + .gitkeep + .gitignore negation
- FOUND: 9574f7f test(02-06): applyPatch RED — 8+ 시나리오 + APPLY_TEST_MODE seam (모듈 부재로 fail)
- FOUND: b32b2ae feat(02-06): applyPatch 2PC orchestrator + APPLY_TEST_MODE seam (D-A5/B3/C1/C3/C4/D4)

### Verification (모든 PLAN grep 통과)

- ✓ `grep -c "marker" tools/applyPatch.ts` = 21 (≥4)
- ✓ `grep -c "sha256\|SHA256" tools/applyPatch.ts` = 4 (≥1)
- ✓ `grep -c "writeFileSync" tools/applyPatch.ts` = 3 (≥1)
- ✓ `grep -c "ssh" tools/applyPatch.ts` = 29 (≥2)
- ✓ `grep -c "rolled-back" tools/applyPatch.ts` = 6 (≥2)
- ✓ `grep -c "compose down" tools/applyPatch.ts` = 2 (≥1)
- ✓ `grep -c "git rev-parse\|gitRevParseHead" tools/applyPatch.ts` = 7 (≥1)
- ✓ `grep -c "ARCHITECTURE.md" tools/applyPatch.ts` = 0 (research_artifact_corrections #1 lock)
- ✓ `grep -c "open-webui" tools/applyPatch.ts` = 0 (Option A 4-stack 준수)
- ✓ `grep -c "\\-\\-context" tools/applyPatch.ts` = 4 (≥1, PROD safety belt 02-04 carry-forward)
- ✓ `grep -c "APPLY_TEST_MODE" tools/applyPatch.ts` = 6 (≥2)
- ✓ `test -f state/.pending/.gitkeep` PASS
- ✓ `grep "^!.*\.gitkeep$" state/.gitignore` 매치
- ✓ `bun test tools/applyPatch.test.ts` 12 pass / 0 fail / 64 expect (32ms)
- ✓ `APPLY_TEST_MODE=1 bun test tools/applyPatch.test.ts -t "APPLY_TEST_MODE"` 2 pass
- ✓ 전체 `bun test` 222 pass / 0 fail / 4 skip — 회귀 0
- ✓ PROD 누수 검증: `ssh gon@192.168.0.5 'docker ps -a --filter name=gons-test- --format "{{.Names}}" ; docker ps -a --filter name=test-svc --format "{{.Names}}"'` empty (0 컨테이너) — **PROD 누수 0 확인**

---

*Phase: 02-propose-apply-approval-gate*
*Plan: 06 (applyPatch 2PC orchestrator D-A5/B3/C1/C3/C4/D4)*
*Completed: 2026-05-07*
