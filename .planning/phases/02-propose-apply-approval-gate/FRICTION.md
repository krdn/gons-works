# Phase 2 — FRICTION Log

> Phase 1 carry-forward + Phase 2 진행 중 발견된 라이브 환경 결함 / 함정 / 마찰 항목.
> 각 항목은 D-E1 (`02-01-SMOKE-LOG.md`) 또는 후속 plan에서 발견되며, 해결 전까지 02-02..02-10 진입에 영향을 미칠 수 있다.

## F-1 — `agent/loop.ts` two-step tool-use turn에서 `400 invalid_request_error: "messages: at least one message is required"`

**Status:** RESOLVED in Phase 1 plan 01-10 (commit `fix(01): 10/T2 — agent/loop.ts F-1 fix`). Root cause = H4 (compactHistory array aliasing). H1/H2/H3 모두 spike 4개로 reject. 자세한 진단/fix는 `.planning/phases/01-read-only-knowledge-layer/FRICTION.md` F-1 섹션 참조.
**Severity:** HIGH (Phase 1 ROADMAP Success Criteria #1/#2/#3 동시 차단)
**Discovered:** 2026-05-07 (D-E1 게이트, `02-01-SMOKE-LOG.md` Criteria #1)
**Source:** Live smoke (raw curl `/chat-stream`)
**Audit evidence:**
- `data/copilot.db` events.id=5 (req_id=`req_011CanZMFphsM333ojVTmqCs`, 2026-05-07T04:14:00Z)
- `data/copilot.db` events.id=8 (req_id=`req_011Canaq7qP5ZbJXfECrMDt5`, 2026-05-07T04:33:25Z)
- 두 event 모두 동일 prompt("ais-prod redis 어디 쓰여?") + `total_tool_calls=2 (listContainers + readLogs)` 후 두 번째 Anthropic 호출에서 400.

**Symptom:**
- SSE wire에 drift → text-delta(intro) → tool-start/result(listContainers) → tool-start/result(readLogs) 까지는 정상 emit
- 그 후 synthesis text-delta + final event 미도달
- audit DB의 turn row만 error_envelope으로 채워짐 (wire 가시성과 audit DB의 silent 상태 일치 — F-2와 결합)

**Suspected root cause:** `agent/loop.ts` while-loop에서 첫 iteration의 tool_result block을 messages에 push한 후 두 번째 `callWithFallback`에 전달되는 messages 배열 형태가 Anthropic API 검증을 통과하지 못함. compactHistory는 messages.length=3이라 건드리지 않으므로 다른 경로 (예: tool_result content 비어있음 / role 누락 / system+empty user 패턴) — **확정 진단은 hotfix plan에서**.

**Reproduction:**
```bash
unset ANTHROPIC_API_KEY
bun run src/server.ts &
curl -s --max-time 180 "http://127.0.0.1:3000/chat-stream?prompt=ais-prod%20redis%20%EC%96%B4%EB%94%94%20%EC%93%B0%EC%97%AC%3F"
# expect: drift + text-delta + 2× (tool-start, tool-result) + final
# actual: drift + text-delta + 2× (tool-start, tool-result), no final/error
# audit DB: SELECT error_envelope FROM events WHERE id=(SELECT max(id) FROM events WHERE prompt LIKE '%redis%')
```

**Impact:**
- ❌ Criteria #1 (RAG + 라이브 docker)
- ❌ Criteria #2 (라이브 logs / readLogs) — 동일 multi-tool 흐름
- ⚠ Criteria #3 (drift) — drift 자체는 동작하지만 답변 단계 wire 차단
- ✅ Criteria #4 (audit) — error_envelope이 lock-in되어 정상 동작 입증

**Hotfix scope (다음 plan):**
1. agent/loop.ts L390-401 messages append + compaction 로직 트레이스
2. tool_result block의 content 형식 / role 검증
3. Anthropic invalid_request_error 핸들링 강화 (messages 비어있을 때의 친절 envelope)
4. integration test 보강 — 단일 turn에서 2+ tool 호출 후 synthesis 단계 PASS 검증

## F-2 — `server.ts` SSE final/synthesis emit 클라이언트 미도달 (audit 정상)

**Status:** RESOLVED in Phase 1 plan 01-10 (commit `fix(01): 10/T3 — src/server.ts F-2 fix`). pendingWrites 큐 + finally Promise.allSettled flush 패턴 적용. 자세한 진단/fix는 `.planning/phases/01-read-only-knowledge-layer/FRICTION.md` F-2 섹션 참조.
**Severity:** HIGH (Phase 1 ROADMAP Success Criteria #1/#2 wire 가시성 결함)
**Discovered:** 2026-05-07 (D-E1 게이트, `02-01-SMOKE-LOG.md` Criteria #1 hello probe)
**Source:** Live smoke + audit DB 대조
**Audit evidence:**
- `data/copilot.db` events.id=11/12/13 (prompt="hello", error_envelope=null, total_tool_calls=0, duration_ms 4-5초로 정상 종료)
- 그러나 동일 시점 SSE 클라이언트(curl `-N`)는 drift event만 받고 stream 종료 — text-delta + final 미도달

**Symptom:**
- agent loop이 정상 종료(`emit({type:"final"})` 도달)하고 audit endTurn까지 정상 기록
- 그러나 SSE 클라이언트는 final/마지막 text-delta를 받지 못함

**Suspected root cause:** `src/server.ts` L147 `emit: (ev) => { void emit(ev) }` — agent/loop.ts iterate가 sync emit 콜백을 expect, server.ts는 async writeSSE를 fire-and-forget 래핑. Hono `streamSSE` 헬퍼가 `iterate` resolve 직후 stream을 close하면 큐잉된 writeSSE Promise가 resolve 전에 swallow될 가능성. **정확한 진단은 hotfix plan에서.**

**Reproduction:**
```bash
unset ANTHROPIC_API_KEY
bun run src/server.ts &
curl -s --max-time 30 "http://127.0.0.1:3000/chat-stream?prompt=hello"
# expect: drift + text-delta(answer) + final
# actual: only drift event, stream closes silently
# audit DB: 동일 시각 events row의 error_envelope=null + output_tokens>0 (정상 종료)
```

**Impact:**
- F-1과 결합 시 운영자 디버깅 신호 손실 — wire 침묵이 audit-DB-only 가시성 모드를 강요
- Criteria #1/#2 라이브 시연 가치 훼손 (답변이 audit DB에만 기록되고 UI엔 안 나옴)

**Hotfix scope:**
1. server.ts L147 emit wrapper를 await 가능 형태로 변경 (iterate가 async emit 지원하면 await, 아니면 stream.flush 후 stream close 보장)
2. integration test — bun:test 또는 playwright로 SSE final event 클라이언트 도달 검증

## F-3 — Voyage AI 신규 발급 키 결제 미등록 무료 등급 함정

**Severity:** MEDIUM (회전 운영 절차에 카드 등록 단계 누락 시 production blocker)
**Discovered:** 2026-05-07 (D-E1 게이트, Step A → Step B 전환 시점)
**Source:** 422-tier 메시지 + 사용자 운영 단계 관찰

**Symptom:**
- voyageai dashboard에서 발급된 새 키는 결제수단 등록 전까지 reduced rate limit (3 RPM / 10K TPM)
- 단발 검증(`embed(['test'])`)은 통과 → 운영자가 회전 완료를 PASS로 오판하기 쉬움
- RAG `queryTopK` 첫 query에서 즉시 429: `"You have not yet added your payment method ... reduced rate limits ... To unlock our standard rate limits, please add..."`

**Carry-forward action:**
- Voyage 키 회전 SOP에 "회전 직후 https://dashboard.voyageai.com/billing 에서 billing tier 확인 — Free → Pay-as-you-go 전환 안 되어 있으면 결제수단 등록 후 burst 검증" 단계 추가
- D-E1 재검증 시 burst 검증 (4+ embed calls 연속) 필수 패턴으로 lock-in

**Hotfix scope:** 운영 절차 문서 업데이트 (코드 수정 없음). 02-01 SOP 보강으로 충분.

---

## F-3 — Worktree dispatcher가 stale `origin/main`을 base로 사용 (Initial commit `d4982cd`)

**Status:** WORKAROUND APPLIED (push origin main으로 origin/main 갱신 → 49892d9). Root cause = local main 121 commits ahead of origin/main, dispatcher는 origin/main을 base로 시도.
**Severity:** HIGH (worktree에 plan source 부재 → executor 작업 불가)
**Discovered:** 2026-05-07 (Phase 2 Wave 1 dispatch)
**Source:** Plan 02-03/04 executor checkpoint 반환 ("HEAD is d4982cd Initial commit, plan source not present in worktree")

**Symptom:**
- 02-03 worktree (agent-a3b391ed8ace3eddc) HEAD = `d4982cd Initial commit`
- 02-04 worktree (agent-a6b2a9482900c54ac) HEAD = `d4982cd Initial commit`
- 두 worktree 모두 phase 1/2 코드 + .planning/ 산출물 부재
- 그러나 02-02 worktree (agent-a3b2d581a1dff79fb)는 정상 시드 `a93901f` — 비결정적 동작

**Verified facts:**
- local `main` HEAD = `a93901f` (Phase 0/1 + Phase 2 plans 완성본)
- pre-push `origin/main` HEAD = `d4982cd Initial commit` (push 미실시)
- `git rev-list --count origin/main..main` = 121 (push 미실시)

**Hypothesis:**
- dispatcher가 `git worktree add` 시 명시적 base 미지정 → 일부 시점에 `origin/main` 또는 stale fetch 결과 base 사용
- 동일 시점에 02-02는 다른 코드 경로(local HEAD 또는 직전 commit)를 잡아 정상 시드
- 02-02 executor가 자체 복구(`git reset --hard a93901f`)로 우회 — 이게 운 좋은 케이스

**Workaround (적용됨):**
- `git push origin main` 실행 → origin/main = `49892d9` (hotfix 커밋)
- 이후 worktree dispatch 시 origin/main 기준으로도 정상 시드
- 모든 새 dispatch에 prompt 명시 추가: "worktree base 시작 시 HEAD 확인, d4982cd면 git reset --hard origin/main 실행"

**Root cause / proper fix (orchestrator 측):**
- dispatcher 코드 점검 필요 — `git worktree add <path> <branch>` 사용 시 base 명시 (`git worktree add -b <new> <path> main`)
- 또는 working tree에서 dispatcher가 spawn 시 항상 local HEAD 기준 prefer
- 본 issue는 gsd-execute-phase의 worktree-add 호출 부분에 적용해야 함 (gsd 측 책임)

**Carry-forward:**
- Phase 2 잔여 plan dispatch에 worktree HEAD verification 단계 prompt 명시 (02-05 ~ 02-10 모두 포함)
- 다음 milestone 시작 전 dispatcher 결함 root-cause fix 권장

---

## F-4 — Plan 02-03 / 02-PATTERNS / 02-CONTEXT / 02-10 D-04 lock 위반 (state/.git/hooks/pre-commit 표현)

**Status:** RESOLVED 2026-05-07 (commit `49892d9 docs(02): hotfix — state/.git/hooks/pre-commit 모순 정정 (D-04 lock 준수)`)
**Severity:** MEDIUM (plan-implementation 모순 — executor가 D-04 위반 코드 작성할 위험)
**Discovered:** 2026-05-07 (02-03 executor 진단 중)

**Symptom:**
- 00-CONTEXT.md line 54-56: D-04 = "메인 repo 안의 state/ 서브디렉토리. 별도 git submodule이나 별 repo로 분리하지 않는다."
- STATE.md "deferred items": "state/ git submodule 분리 → v2+"
- 그러나 02-03 PLAN.md, 02-PATTERNS.md, 02-CONTEXT.md, 02-10 PLAN.md 다수 위치에서 `state/.git/hooks/pre-commit` 경로 + "state/는 별도 git repo (D-04)" 문구 — **D-04를 정반대로 인용**

**Resolution:**
- hotfix commit `49892d9`: 5개 파일에서 `state/.git/hooks/pre-commit` → 메인 repo `.git/hooks/pre-commit` (state/ pathspec gated 블록)으로 정정
- `scripts/install-state-hook.sh` idempotent installer 신설 (clone 후 hook 자동 복구)
- state/.gitignore는 정상 (state subdir의 .gitignore — 메인 repo 추적)
- state/commit.ts spawn 호출 패턴: `cwd: 'state'` → `cwd: '.', pathspec: ['--', 'state/']`로 정정

**Why missed in plan-checker:** plan-check phase가 D-04 cross-reference를 명시 검증하지 않음. 향후 plan checker 룰 추가 검토:
- "state/.git" 패턴이 plan에 등장하면 D-04 위반 의심으로 BLOCKER 표시

---

## F-5 — `.git/hooks/pre-commit` `reset:*hard*` glob pattern 결함 (APPLY-07 reset 분기 비활성)

**Status:** RESOLVED 2026-05-07 (plan 02-10 commit `39745b5 fix(02-10): APPLY-07 hook reset glob 패턴 — 모든 reset 분기 거부`)
**Severity:** MEDIUM (APPLY-07 lock 의도 일부 우회 — `git reset` 시도가 hook 검사를 통과)
**Discovered:** 2026-05-07 (plan 02-03 advisor 권고)

**Symptom:**
- `.git/hooks/pre-commit` + `scripts/install-state-hook.sh` 의 case 패턴: `rebase*|*rewrite*|reset:*hard*`
- 그러나 `git reflog -1 --format=%gs` 출력은 `reset: moving to <ref>` 양식이며 hard/soft/mixed 옵션 정보가 포함되지 않음
- 결과: `reset:*hard*` glob 매칭 0건 → APPLY-07 의 reset 차단 의도가 실질적으로 비활성

**Verification before fix:**
```bash
git reset --soft HEAD~1   # reflog: "reset: moving to HEAD~1"
git reset --hard HEAD~1   # reflog: "reset: moving to HEAD~1"  ← hard/soft 구분 없음
```

**Root cause:**
- `git reflog`의 `%gs` 양식은 reset 명령의 옵션을 기록하지 않는다 (의도 자체를 추적하기에는 부적합).
- 안전한 정책 = state/ 변경에 대한 **모든 형태의 reset 거부** (mixed/soft 도 history rewrite 가능성 있음).

**Fix:**
- glob 패턴 변경: `rebase*|*rewrite*|reset:*hard*` → `rebase*|*rewrite*|reset:*`
- `.git/hooks/pre-commit` 와 `scripts/install-state-hook.sh` 의 BLOCK heredoc 양쪽 동일 갱신
- `bash scripts/install-state-hook.sh` 두 번째 실행 시 sha256 변화 0 (idempotent 보존)
- `bun test` 회귀 0건 (hook 은 commit 시에만 동작)

**Carry-forward:**
- 향후 hook 수정 시 reflog 양식 사전 확인 필수 (`%gs` 출력 sample 채취 후 패턴 작성)
- plan-check 룰 후보: hook script 의 case 패턴이 `git reflog %gs` 실제 출력 sample 과 매칭되는지 자동 검사

---

## F-6 — `tools/_envelope.ts:85,87` TS2454 (`Variable 'result' is used before being assigned`)

**Status:** RESOLVED 2026-05-07 (plan 02-10 commit `a32954a fix(02-10): tools/_envelope.ts TS2454 — result undefined union`)
**Severity:** LOW (CI 가 strict mode 일 때 build break, 그러나 `bun test` runtime 영향 0 — bun 은 TS 타입 검사를 build 단계에 분리)
**Discovered:** Phase 1 (carry-forward) → Phase 2 wave 3 통합 후 baseline `bunx tsc --noEmit` 으로 노출

**Symptom:**
- `let result: T | ToolError` (line 50, init 없음)
- try/catch 양 경로 모두 result 할당 후 finally 도달하지만 TS 의 control-flow analysis 가 catch 경로 + finally 의 result 사용을 init-after-throw 가능성으로 narrow 못함
- `tsc --noEmit` 출력: `Variable 'result' is used before being assigned` × 2 (line 85, 87)

**Fix (옵션 비교):**

| 옵션 | 변경 | trade-off |
|------|------|-----------|
| (a) `result: T \| ToolError \| undefined` + `result!` narrow | (선택) | 의미 동일, runtime 영향 0, finally 사용처 narrow 명시 |
| (b) try 시작에 `let result: T \| ToolError = (undefined as any)` 임시 init | reject | strict 회피 hack |
| (c) finally 블록을 try/catch 분기 내부로 이동 (audit 호출 위치 변경) | reject | logTool 항상 호출 invariant 깨짐 |

옵션 (a) 적용. finally 의 `isToolError(result!)` 외에도 line 85/87 의 result 사용처도 `const r = result!` 변수로 narrow 일원화.

**Carry-forward:**
- TS strict 환경에서 `let x: T` (init 없음) 패턴은 finally 블록 사용 시 항상 `T | undefined` 로 선언 권장
- 향후 비슷한 패턴 발견 시 동일 fix 적용

---

## F-7 — `src/server.test.ts:416` TS2345 PendingMarkerFields fixture missing fields

**Status:** RESOLVED 2026-05-07 (plan 02-10 commit `d13780c fix(02-10): src/server.test.ts:416 PendingMarkerFields fixture 보강`)
**Severity:** LOW (test 코드 type error, runtime 동작은 정상 — `bufferPendingDrift` 가 `[key: string]: unknown` index signature 로 fixture 받음)
**Discovered:** 2026-05-07 (Phase 2 wave 3 통합 후 baseline tsc 검사)

**Symptom:**
- `src/server.test.ts:416` 의 markers fixture: `[{ nonce: "a", stack: "news", command: "compose ps" }]`
- `PendingMarkerFields` interface 가 4개 추가 required field 보유 (`service`, `docker_started_at`, `docker_finished_at`, `exit_code`)
- 그러나 interface 에 `[key: string]: unknown` index signature 가 있어 runtime 동작은 정상 (`bun test` 통과)
- TS 만 strict assignability 위반 → 옵션 (a) fixture 보강 vs 옵션 (b) `Partial<PendingMarkerFields>[]` 완화

**Fix:**
- 옵션 (a) 적용 — fixture 에 4개 필드 추가 (service: "news-prod-app", docker_started_at: null, docker_finished_at: null, exit_code: null)
- production type (`src/server.ts` PendingMarkerFields interface) 영향 0
- bun test 252 pass / 0 fail / 4 skip 회귀 0건 + tsc clean

**Carry-forward:**
- test fixture 작성 시 interface 의 모든 required field 명시 권장 (index signature 가 있어도 완전한 fixture 가 readability + 향후 schema 변경 시 안전)

---

## F-8 — Plan 02-10 Task 1 = `checkpoint:human-action`, autonomous executor 가 라이브 검증을 자동화할 수 없음

**Status:** STRUCTURAL — by design (PLAN frontmatter `autonomous: false` lock)
**Severity:** LOW (PLAN 가 explicit 하게 표시했고 checkpoint_protocol 가이드를 준수하면 정상 흐름)
**Discovered:** 2026-05-07 (plan 02-10 executor advisor 호출 시점)

**Symptom:**
- Orchestrator prompt 가 "ROADMAP SC 5/5 PASS / Crash simulation 결과 / DOG-03 PR URL" 을 요구
- 그러나 PLAN.md Task 1 = `checkpoint:human-action` (운영자가 브라우저 5-key form 클릭, kill -9, pre-commit hook force-fail, /ship GH 인증 흐름 실행 필요)
- executor 는 라이브 결과를 fabricate 할 수 없음

**Resolution:**
- autonomous-first 접근 적용:
  1. 자동화 가능한 모든 단계 (3 backlog hotfix + bun test + tsc + install-state-hook idempotency + REQ-ID 표 + FRICTION) 본 plan 에서 완료
  2. 라이브 단계는 02-VERIFICATION.md 의 BLOCKED 섹션으로 명시
  3. orchestrator 에게는 checkpoint 반환으로 운영자 단계 인계
- PLAN 의 `autonomous: false` 가 olive branch 역할 — orchestrator 가 라이브 단계를 운영자에게 위임할 명시적 룰

**Carry-forward:**
- 향후 plan 의 `checkpoint:human-action` task 가 prompt 의 "deliverable" 과 충돌하면 advisor 호출 → autonomous-first 분리 후 checkpoint 반환 패턴이 안전
- gstack-gsd-melodic-raven 다음 개정판 입력: orchestrator prompt 작성 시 PLAN 의 checkpoint 타입을 사전 검사하여 deliverable 을 분리

---

## Phase 2 카운트 누적 (수정됨)

- F-1 (RESOLVED Phase 1 plan 01-10)
- F-2 (RESOLVED Phase 1 plan 01-10)
- F-3 (Voyage AI 무료 등급 함정, MEDIUM, SOP 보강)
- F-3-2 (RESOLVED — push origin main, dispatcher root-cause는 gsd 측 책임)
- F-4 (RESOLVED — 49892d9 D-04 lock hotfix)
- F-5 (RESOLVED 02-10 — hook reset glob pattern)
- F-6 (RESOLVED 02-10 — tools/_envelope.ts TS2454)
- F-7 (RESOLVED 02-10 — src/server.test.ts:416 PendingMarkerFields fixture)
- F-8 (STRUCTURAL — checkpoint:human-action 자동화 불가, autonomous-first 패턴 lock)

**Phase 2 신규 마찰 = 5건 (F-3-2, F-4, F-5, F-6, F-7, F-8 중 5+) — PLAN 의 success_criteria "5+ 마찰 항목" 충족.**

## Cross-Phase Trends (Phase 0+1+2 종합)

- **LLM 모델명 / API endpoint / SDK 호환성:** spike-driven 검증이 정답 (Phase 0 #1, Phase 2 APPLY-08 D-10 lock)
- **research artifact prose vs code lock 충돌:** REQUIREMENTS / ROADMAP 을 권위로 (Phase 2 F-4 carry, plan-check 룰 후보)
- **환경변수 빈 export 함정 (FRICTION #8):** startup probe + envelope 메시지로 친절하게
- **in-memory state singleton 의 test isolation:** `_resetForTest` 패턴 (Phase 1 LOOP-07 carry)
- **2PC orchestration:** docker exec → git commit 순서 + marker lifecycle + atomic consumed flag = 핵심 invariants (research_artifact_corrections #1 lock)
- **Hook script 정확성:** `git reflog` `%gs` 양식 사전 확인 필수 (Phase 2 F-5)
- **TS strict + finally 패턴:** `let x: T` (init 없음) → `let x: T | undefined` + `x!` narrow 권장 (Phase 2 F-6)
- **Test fixture 완전성:** interface 의 모든 required field 명시 (index signature 있어도) — readability + schema 변경 안전 (Phase 2 F-7)
- **`checkpoint:human-action` task vs orchestrator deliverable 충돌:** autonomous-first 분리 + checkpoint 반환 패턴 (Phase 2 F-8)

## 다음 개정판 입력 항목

위 마찰 항목들을 `~/.claude/plans/gstack-gsd-melodic-raven.md` 의 다음 개정판에 반영:
- gsd-tools.cjs 명령 정리 (commit 자동화) — Phase 0/1/2 carry
- DESIGN.md 내 prose vs code 모순 검출 자동화 (research_artifact_corrections 패턴) — Phase 2 F-4
- phase plan 작성 시 advisor 호출 시점 lock (orientation 후 substantive 전) — gsd-execute-phase 가이드 carry
- worktree dispatcher base ref 결함 root-cause fix (Phase 2 F-3-2)
- Plan 의 `checkpoint:human-action` task 가 orchestrator prompt 의 deliverable 과 충돌할 때의 autonomous-first 분리 패턴 lock (Phase 2 F-8)
- Hook script 작성 시 `git reflog` `%gs` 출력 sample 사전 채취 + plan-check 룰 (Phase 2 F-5)


---

## F-9 — applyPatch lifecycle-only 명령(restart/start/stop 등)이 항상 rolled-back

**Status:** RESOLVED 2026-05-07 (v1.1 hotfix)
**Severity:** HIGH (Phase 2 7-command 중 fileEdit 없는 5개 모두 영향, 라이브 검증으로만 발견)
**Discovered:** 2026-05-07 (라이브 SC#1/2/4 검증 시점, audit DB primary source)

**Symptom:**
- LLM이 proposePatch tool 호출 → user `y` approval → applyPatch 진입
- docker `compose restart test-svc-a` 정상 실행 (gons-test-svc-a 재시작 확인)
- 그러나 audit DB id=156: `outcome="rolled-back", reason="git commit 실패 (exit 1):"`
- D-B3 reverse docker 자동 시도 + 두 번째 restart 발생 (의도하지 않은 부작용)

**Root cause:**
- D-B1 7-command 중 `compose restart/start/stop/up -d/down/logs/ps`는 **fileEdit 없이 docker 명령만** 실행
- applyPatch는 fileEdit 없으면 `git add` 호출 0회 → state/ staged 변경 0건
- `state/commit.ts commitWithMessage`가 `git commit -F msg -- state/` 실행 → staged 0건이라 exit 1 ("nothing to commit, working tree clean")
- D-B3 분기 진입 → 역 docker 자동 시도 + outcome=rolled-back

**Why missed in unit tests:**
- `tools/applyPatch.test.ts`의 mock `commitWithMessage`가 무조건 성공 (`async () => { gitCommitCalled++ }`)
- production behavior(staged 0건 → throw) 모사 안 함 → 결함이 unit test로 감지 안 됨

**Fix (v1.1 hotfix):**
- `state/commit.ts commitWithMessage`에 `allowEmpty?: boolean` 4번째 파라미터 추가 (default false)
- `tools/applyPatch.ts`에서 `addPaths.length === 0` (lifecycle-only) 흐름이면 `allowEmpty=true` 전달
- D-D4 lock(applied/rolled-back만 git commit) 만족: lifecycle-only도 audit log commit 정상 생성 (commit message body의 D-D1 양식 4 필드가 audit 역할)
- 회귀 방지 unit test 2건 추가:
  1. `tools/applyPatch.test.ts`: lifecycle-only happy path가 `commitAllowEmpty=true` 전달하는지 검증 + production-realistic mock으로 outcome=applied 보장
  2. `state/commit.test.ts`: `allowEmpty=true`/false 두 분기 + 빈 commit body의 Nonce 라인 grep 검증

**Live re-verification (hotfix 적용 후):**
- commit `add0eb455...` 정상 생성: `apply(news): compose restart test-svc-a` + Nonce + 4 body 필드
- audit DB id=158/159 turn rows: tool_name=applyPatch, ok=1, outcome=applied
- D-B3 분기는 의도된 git fail simulation에서만 정상 발화 (Step 6, audit id=161)

**Carry-forward:**
- v1.2 후속: system-prompt에 `APPLY_TEST_MODE=1 시 test-svc-* 명명 허용` 추가하여 라이브 검증 자동화
- D-D4 양식 자체는 v1.0 이후 변경 없음 — `--allow-empty` 추가는 audit log 보존 범위만 확장

---

## F-10 — Bun.serve 기본 idleTimeout=10s가 30s keep-alive보다 짧아 SSE 끊김

**Status:** RESOLVED 2026-05-07 (v1.1 hotfix)
**Severity:** HIGH (라이브 5-key UX 차단 — approval 대기 도중 SSE 끊김)
**Discovered:** 2026-05-07 (브라우저 5-key 시도 시 `source.onerror` + audit DB로 backend 정상 확인)

**Symptom:**
- 브라우저 console: `htmx.min.js:1 [object Event]` + `sse.js:201 source.onerror`
- curl `/chat-stream` 요청은 정상 (60s timeout 내 모든 SSE event 도달)
- server log: `[Bun.serve]: request timed out after 10 seconds. Pass idleTimeout to configure.`

**Root cause:**
- Bun.serve의 기본 `idleTimeout = 10` (10초)
- 02-07 plan에서 추가한 `KEEP_ALIVE_INTERVAL_MS = 30_000` (30초 keep-alive comment)
- 첫 keep-alive 도달 (30s) 전에 idle timeout (10s)이 트리거 → SSE wire 끊김
- approval 대기(2분 expiresAt)는 더 긴 시간 SSE를 유지해야 하므로 더 큰 영향

**Why missed in unit tests:**
- `agent/loop.test.ts`의 keep-alive test는 `setTimeout` mock 사용 → 실제 Bun.serve와 wire 안 됨
- 브라우저 EventSource + Bun.serve 조합은 라이브 환경에서만 발견 가능
- curl 검증은 cli-side timeout이 60s라 10s idle이 보이지 않음 (curl 자체가 데이터 흐름을 받음)

**Fix (v1.1 hotfix):**
- `src/server.ts` `export default { hostname, port, fetch }` → `export default { hostname, port, idleTimeout: 0, fetch }`
- `idleTimeout: 0` = 비활성화 (장시간 SSE + 2분 approval 대기 안전 유지)
- LOOP-06 60s SSE chunk watchdog은 별도 wire로 작동 (agent/sse.ts createChunkWatchdog) → idle timeout 비활성화 안전

**Live re-verification (hotfix 적용 후):**
- 사용자 브라우저 retry 권장 (server 재시작 필요)
- curl SSE 정상 (60s+ 유지 확인)

**Carry-forward:**
- v1.2 후속: idleTimeout: 0 대신 명시적 큰 값 (예: 600 = 10분)으로 전환 검토 — keep-alive가 끊겨도 server-side cleanup이 필요할 수 있음
- Bun.serve 옵션 변경 시 frontend EventSource 동작 라이브 검증 필수 (curl만으로 cover 안 됨)

---

## F-11 — sessionId=default 다중 요청 누적으로 30회 한도 즉시 hit (라이브 발견)

**Status:** RESOLVED 2026-05-07 (v1.1 hotfix)
**Severity:** HIGH (브라우저 + curl 검증이 즉시 막힘)
**Discovered:** 2026-05-07 (라이브 5-key UI 시도 시점)

**Symptom:**
- server 재시작 후 ~7회 prompt 호출만으로 audit DB가 `세션 API 호출 한도 초과 (30회), sessionId=default` 30+ 행 채움
- 브라우저 EventSource: chat-stream status=200 + pending → 데이터 미도달 → onerror

**Root cause:**
- src/server.ts `chat-stream` route: `sessionId = c.req.header("x-session-id") ?? "default"`
- POST /chat에 sessionId 부착 안 함 → 모든 요청이 `default` 누적
- LOOP-03 `MAX_API_CALLS_PER_SESSION=30` hard cap이 모든 탭/curl/automation에 공유됨

**Fix (v1.1 hotfix):**
- public/index.html: 페이지 로드 시 `window.__sessionId = crypto.randomUUID()` 자동 생성
- public/index.html: `htmx:configRequest` hook으로 모든 htmx 요청에 `session-id` form parameter 부착
- src/server.ts POST /chat: `body["session-id"]`를 우선 읽어 sse-connect URL의 query string으로 전파 (EventSource는 custom header 미지원)
- src/server.ts GET /chat-stream: `c.req.query("session-id") ?? c.req.header("x-session-id") ?? "default"` 우선순위
- 향후 curl 검증은 `?session-id=verify-${nonce}` query 부착 권장

**Live re-verification:**
- 사용자 브라우저 새로고침 후 chat-stream 정상 200 + EventStream에 drift/text-delta/final 도달 확인 (Network tab 캡처)

**Carry-forward (v1.2):**
- localStorage에 sessionId 저장 → 브라우저 새로고침 시 동일 세션 유지 (현재는 매 reload마다 새 UUID)
- 다중 탭 시 탭별 분리 vs 사용자별 통합 결정 필요
- audit DB events에 sessionId 컬럼 추가하여 isolation 디버깅 강화

---

## F-12 — public/index.html SSE handler가 named event를 DOM에 render 안 함 (Phase 1 carry-forward)

**Status:** KNOWN, deferred to v1.2
**Severity:** HIGH (SC#1 라이브 시각 검증 BLOCKED — SSE wire는 정상이나 텍스트 화면 미표시)
**Discovered:** 2026-05-07 (F-11 fix 후 브라우저 재검증 시)

**Symptom:**
- Network tab Response/EventStream에 drift / text-delta / final event 정상 도착
- 그러나 DOM의 `#output` 영역이 빈 placeholder ("운영자 질문을 입력하면 서비스 상태와 로그를 분석합니다.") 그대로
- `htmx:sseMessage` listener가 명명된 SSE event(`event: text-delta` 등)를 dispatch 안 하는 것으로 추정

**Root cause (가설):**
- public/index.html line 434: `document.body.addEventListener("htmx:sseMessage", function (evt) { switch (evt.detail.type) { case "text-delta": ... } })`
- htmx-ext-sse@2.2.4가 `event: text-delta`처럼 named event에는 `htmx:sseMessage`를 fire 안 하는 것으로 추정 (default unnamed event만 fire)
- named events는 `sse-swap="text-delta"` 속성 또는 `htmx:sseBeforeMessage` hook 또는 별도 EventSource 직접 attach 필요

**Phase 1 carry-forward:**
- 02-01-SMOKE-LOG-2.md: SSE event 시퀀스 (drift/text-delta/final)는 wire 검증만 했고 DOM render 시각 확인 X
- 즉 본 결함은 Phase 1 (01-08 public/index.html 작성) 시점부터 존재했으나 verification gap으로 Phase 2까지 미발견

**Fix proposal (v1.2):**
- 옵션 A: `sse-swap` 속성을 사용한 declarative 패턴 (htmx-ext-sse 권장)
- 옵션 B: `htmx:sseBeforeMessage` listener로 named event capture
- 옵션 C: htmx-ext-sse 우회하여 EventSource 직접 새 코드 + addEventListener('text-delta', ...) 

옵션 A가 htmx 디자인 철학에 부합. 그러나 textContent-only 보안 lock 유지 필요 (innerHTML XSS gate 보존).

**Verification gap lesson (F-12에서 확정):**
- v1.0+v1.1까지 252+ unit tests + curl wire 검증 통과했으나 라이브 브라우저 DOM render는 처음 검증
- v1.2 Playwright 자동화 필수 — Phase 2 verification protocol에 포함

---

## F-13 — Verification process gap: live verification revealed 4 defects unit tests didn't catch

**Status:** Process improvement, deferred to v1.2 verification protocol
**Severity:** MEDIUM (process 차원, code 결함 아님)
**Discovered:** 2026-05-07 cumulative finding

**Summary:**
Phase 2 v1.0 (252 unit tests pass + tsc clean)으로는 production-ready 판정했으나 라이브 verification에서 4건 defect 발견:
- F-9 lifecycle commit (audit DB로 발견)
- F-10 Bun idleTimeout (server log 메시지로 발견)
- F-11 sessionId 누적 (audit DB error_envelope 패턴으로 발견)
- F-12 SSE DOM render (브라우저 Network/EventStream 비교로 발견)

**Pattern:** Unit test mock이 production behavior와 모사 분리됨 → wire 통합 + 라이브 환경에서만 보이는 defect 다수.

**v1.2 protocol 개선 제안:**
1. Playwright E2E 추가 — 모든 SC#1~5를 자동 라이브 검증 (브라우저 + LLM in loop 포함)
2. Mock realism 강제 — `commitWithMessage` mock이 production과 동일한 throw 조건 모사
3. Audit DB primary source 우선 — SSE wire 끊김 시 audit DB가 ground truth
4. Verification 절차에 server restart 룰 — sessionApiCalls 누적 회피
5. Browser visual checkpoint 의무 — wire 검증만으론 SC#1 PASS 불가


---

## F-14 — applyPatch audit commit이 unstaged working-tree pollution 캡처 (AUDIT-02 integrity 위반)

**Status:** ACCEPTED v1.1 trade-off, fix scheduled for v1.2
**Severity:** HIGH (audit log integrity 일시적 손상)
**Discovered:** 2026-05-07 (v1.1 hotfix 라이브 검증 도중 실시간 발견)

**Symptom:**
- audit commit `add0eb4 apply(news): compose restart test-svc-a` body가 `Diff-Summary: no-file-change` 명시
- 그러나 `git show add0eb4 -- state/`는 76 lines diff 표시 (hotfix 변경 `state/commit.ts` + `state/commit.test.ts` 캡처됨)
- 즉 **audit log message가 production code 변경을 lifecycle-only audit으로 속여 묻음**

**Mechanism (root cause):**
- `state/commit.ts commitWithMessage`의 spawn argv: `["git", "commit", "-F", msg, "--", "state/"]`
- pathspec `-- state/`가 **staged + unstaged working-tree 변경을 모두 캡처**
- v1.1 hotfix 작성 중 사용자가 `state/commit.ts` 편집 후 server 재시작 → 그 사이 사용자가 mutating 질의 → applyPatch가 `git commit -- state/` 실행 → **편집된 working tree까지 commit에 묻음**
- v1.0/v1.1의 `applyPatch.ts`는 `addPaths`를 명시 추적하지만 `commitWithMessage`에 그 list를 전달하지 않음 → pathspec이 항상 `state/` 디렉토리 전체

**v1.0 unit tests에서 미발견 이유:**
- 테스트 임시 git repo는 항상 working tree clean에서 시작 → unstaged pollution scenario 미모사
- production은 사용자가 `state/`를 편집할 수 있는 환경 → 라이브에서만 발생

**v1.2 Fix proposal:**
1. `applyPatch.ts`의 `addPaths`를 `commitWithMessage`에 전달 → spawn argv pathspec을 `addPaths` 그대로 사용 (lifecycle-only는 빈 array → pathspec 없이 `--allow-empty`만)
2. 또는 audit commit 전에 `git stash --keep-index` → audit commit → `git stash pop`으로 working tree 격리
3. 또는 `git commit-tree`로 직접 새 tree object 생성하여 staged만 정확히 commit

**Impact:**
- 현 시점 `add0eb4` audit commit은 hotfix 변경을 묻고 있어 grep `apply(news):` + `Diff-Summary: no-file-change` 패턴이 일치하지만 실제 diff와 모순
- 다른 audit commit들은 영향 없음 (이번 사고는 사용자가 편집 → 서버 재시작 사이의 race)
- AUDIT-02 grep은 commit message 양식 lock만 검증하고 actual diff는 검증 안 함 → 일시적 partial PASS

**Trade-off acceptance (옵션 B):**
- v1.1 PR에 `add0eb4` 그대로 land (revert는 추가 noise)
- F-14 FRICTION 명시 + v1.2 backlog 추가
- 운영자에게 명확히 알림: "v1.1 시점의 audit log는 unstaged pollution 위험 — v1.2 fix까지 라이브 환경에서 `state/` 편집 + applyPatch 동시 실행 회피"
