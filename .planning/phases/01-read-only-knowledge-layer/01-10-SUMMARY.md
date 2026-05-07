# Plan 01-10 — Hotfix Summary (F-1/F-2 carry-forward from Phase 2 D-E1)

**Date:** 2026-05-07 (UTC+9)
**Type:** hotfix (Phase 1 carry-forward, gap_closure=true)
**Result:** ✅ COMPLETE — 5/5 tasks, 6 commits, 158 PASS / 0 FAIL / 4 skip

## 진단 결론 (Task 1)

**F-1 root cause = H4: `compactHistory` array aliasing.** H1/H2/H3 모두 reject.

| 가설 | 평가 | 근거 |
|------|------|------|
| H1 (HIGH) — cli-proxy-api messages 변환 결함 | ❌ reject | spike 4개 모두 cli-proxy-api 통한 호출 정상 |
| H2 (MED) — tool_result content shape | ❌ reject | spike 3에서 실제 dispatch 결과 사용해도 PASS |
| H3 (LOW) — compactHistory length 분기 | ❌ reject | length=3은 그대로 통과해야 정상 |
| **H4 (NEW) — array aliasing** | ✅ **확정** | 1줄 reproduce: `const a=[1,2,3]; const b=a; a.length=0; a.push(...b)` → `len=0` |

**진단 spike 4개** (`tmp/diagnose-f1{,b,c,d}.ts`, gitignored):
1. v1: 1-tool 시나리오 — PASS (변별력 부족)
2. v2: 2-tool 강제 + 큰 fake content — PASS
3. v3: 실제 RAG + dispatch — PASS
4. v4: 강제 2-tool + while loop — PASS

→ spike 4개가 모두 PASS한 이유: 모두 `client.messages.create({ messages: compacted })`로 직접 호출했지 agent/loop.ts L401-403의 in-place reset (`messages.length=0; messages.push(...compacted)`)을 적용하지 않았음. 그 한 줄이 통째로 빠져있던 게 spike의 변별 실패 원인이자 H4 root cause의 정확한 위치.

## 적용된 fix

### F-1 — `agent/loop.ts` (commit `fix(01): 10/T2`)

```diff
- if (estimateTokens(messages) < threshold) return messages
- if (messages.length <= 7) return messages
+ if (estimateTokens(messages) < threshold) return [...messages]
+ if (messages.length <= 7) return [...messages]
```

`compactHistory`가 항상 새 array 반환하도록 변경. caller에 defense-in-depth `if (messages.length === 0) throw` 추가.

### F-2 — `src/server.ts` (commit `fix(01): 10/T3`)

```diff
+ const pendingWrites: Promise<void>[] = []
- const emit = async (ev: SseEvent): Promise<void> => {
+ const emit = (ev: SseEvent): void => {
    watchdog.reset()
-   await stream.writeSSE(toSSEFrame(ev))
+   const p = stream.writeSSE(toSSEFrame(ev)).catch(() => {})
+   pendingWrites.push(p)
    if (ev.type === "final" || ev.type === "error") watchdog.cancel()
  }
  ...
  } finally {
    watchdog.cancel()
+   await Promise.allSettled(pendingWrites)
  }
```

emit 콜백을 sync void로 변경 + `pendingWrites` 큐 + finally `Promise.allSettled`로 stream close 전 모든 emit flush.

## 테스트 결과

| 파일 | Before | After | 신규 |
|------|--------|-------|------|
| agent/loop.test.ts | 12 | 15 | +3 (T1: compactHistory ref 검증, aliasing 안전성, 2-iteration messages.length>0) |
| src/server.test.ts | 8 | 10 | +2 (T2: Promise.allSettled flush 패턴, rejected swallow 안전성) |
| **전체** | **153** | **158** | **+5 PASS / 0 FAIL / 4 skip** |

## Commits (6개, atomic)

| # | Commit | Task |
|---|--------|------|
| 1 | `chore(01): 10/T1 — .gitignore에 /tmp/ 추가` | 1 |
| 2 | `fix(01): 10/T2 — agent/loop.ts F-1 fix (compactHistory array aliasing)` | 2 |
| 3 | `fix(01): 10/T3 — src/server.ts F-2 fix (SSE final emit pending writes flush)` | 3 |
| 4 | `test(01): 10/T4 — F-1/F-2 회귀 방지 integration test 추가` | 4 |
| 5 | `docs(01): 10/T5 — FRICTION.md F-1/F-2 carry-back + Phase 2 양방향 동기화` | 5 |
| (선행) | `docs(01): 10/PLAN — Phase 2 D-E1 carry-forward hotfix plan 추가` | - |

## D-E1 재실행 안내

본 plan은 코드 + 테스트 단위 검증까지. 라이브 검증은 Phase 2 D-E1을 재실행하여 수행:

```bash
# 사용자 호출
/gsd-execute-phase 2 --plan 01
```

이전 SMOKE-LOG (`.planning/phases/02-propose-apply-approval-gate/02-01-SMOKE-LOG.md`)는 변경 없이 보존하고, 재검증 결과는 새 SMOKE-LOG-2.md로 기록 권장 (FAIL → PASS 전환 증거 추적).

기대 결과:
- Step A: VOYAGE 키 회전은 이미 완료 (1024-dim, billing tier 활성). 재회전 불필요.
- Step B Criteria #1~#4: 5/5 PASS 도달 가능 — F-1/F-2 fix로 wire 결함 해소.
- D-E1 게이트 OPEN → Phase 2 plan 02-02 ~ 02-10 진행 unblock.

## 메타 노트

D-E1 게이트가 정확히 자기 의도대로 동작했다 — 22/22 unit/integration PASS인 코드에서 array aliasing(H4) + async emit fire-and-forget(F-2) 두 결함을 잡았다. 이 두 결함은 mock emit / sync flow를 쓰는 unit test로는 잡을 수 없는 PITFALL 클래스. `integration smoke + audit DB cross-check` 패턴이 결정적 진단 도구임을 dogfood로 lock-in.

향후 Phase 2/3에서도 비슷한 패턴(write-side action / approval gate / atomic 2-phase commit)에 대해 동일한 게이트를 둘 것을 권장.
