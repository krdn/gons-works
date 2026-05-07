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
