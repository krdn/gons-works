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
