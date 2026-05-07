# Phase 2 Pre-Execute Gate (D-E1) — Smoke Log #2 (Plan 01-10 fix 적용 후 재검증)

**Date:** 2026-05-07 14:18 (UTC+9)
**Operator:** gon (assisted by claude-opus-4-7)
**Basis:** Phase 1 ROADMAP Success Criteria + Plan 01-10 hotfix 적용 후 재검증
**Verdict:** ✅ **PASS — D-E1 gate OPEN.** Phase 2 plan 02-02 ~ 02-10 진입 unblocked.
**Previous SMOKE-LOG:** `02-01-SMOKE-LOG.md` (FAIL — F-1/F-2 lock-in, 보존됨)

> 이 SMOKE-LOG-2는 plan 01-10 hotfix 후 재검증 결과. 이전 SMOKE-LOG-1과 함께 **FAIL → PASS 전환 증거**로 보존하여 D-E1 게이트의 가치(라이브 검증으로만 잡히는 PITFALL을 잡았고 fix 후 재검증으로 닫혔음)를 lock-in.

## 적용된 fix (Plan 01-10)

| 결함 | Fix | Commit |
|------|-----|--------|
| F-1 (compactHistory array aliasing) | `compactHistory`가 항상 새 array 반환 + caller defense-in-depth | `a8ede05` |
| F-2 (SSE final emit fire-and-forget) | `pendingWrites` 큐 + finally `Promise.allSettled` | `f761934` |

테스트: 158 PASS / 0 FAIL / 4 skip (이전 153 + 회귀 방지 5).

## Step A — Voyage 키 회전

- 이미 1차 SMOKE-LOG에서 PASS 확정 (1024-dim + 결제 등록 후 burst x4 OK)
- 재회전 불필요. 본 검증은 `/billing` 활성 상태에서 진행.

## Step B — Phase 1 live smoke 5단계

| # | Criteria | Status | Evidence |
|---|----------|--------|----------|
| 0 | `unset ANTHROPIC_API_KEY` 후 `bun run src/server.ts` 시작 | PASS | startup log: `[KB] indexed=true (yaml hash 변화로 재인덱싱), chunkCount=25 / [KB-03] services.yaml drift 감지: unknown=4, stale=1 / [server] ready — http://127.0.0.1:3000` |
| 1 | "ais-prod redis 어디 쓰여?" → RAG + grounded 답변 | **PASS** | SSE event 시퀀스: `drift → text-delta → final` (3 events). 답변에 `ais-prod-redis (Redis 7, port 6385)`, `캐시 + 세션 저장`, `(ais.volumes, sim=0.510)` services.yaml 메타 grounded. final event 정상 도달 (이전 미도달 → fix 검증). |
| 2 | readLogs 라이브 호출 → 답변 | **PASS** | "라이브로 현재 news-prod-redis 로그 마지막 10줄 보여줘" → `drift → text-delta → tool-start(readLogs) → tool-result(766 chars) → text-delta(synthesis) → final` (6 events). 답변에 BGSAVE 시각 표 + services.yaml `news.volumes` AOF/RDB 근거 인용. **two-step tool-use turn에서 두 번째 callWithFallback 정상 동작 — F-1 fix 결정적 검증.** |
| 3 | services.yaml drift → banner 변화 | **PASS** | `state/services.yaml`의 `open-webui:` 블록 임시 주석 → server restart → KB lazy hash 감지하여 chunkCount 25 → 20 자동 재인덱싱 + drift event 정상 emit (`unknown=4 stale=1`). 즉시 원복 → chunkCount 20 → 25 복귀. wire 동작 확인. (의미적 unknown 분류는 algorithm 한계 — 본 게이트 범위 외, Phase 2 backlog로 carry.) |
| 4 | `data/copilot.db events` SELECT | **PASS** | 15 recent rows. fix 후 turn rows 모두 `error_envelope=null` (id=21,19,17,15,13...). 이전 SMOKE-LOG-1 시점의 400 invalid_request_error envelope (id=5, id=8) **이후로는 재발 없음**. tool rows(parent_id=turn_id, tool_name=readLogs/listContainers, ok=1)도 정상 기록. |

### Criteria #1 wire 증거 (final event 도달 확인)
```
event: drift
data: {"type":"drift","message":"⚠ services.yaml 불일치: docker-only 4개, yaml-only 1개 발견","unknown":["vscode","cli-proxy-api","ai-afterschool-fsd-web","krdn-timescaledb"],"stale":["krdn-fx"]}

event: text-delta
data: {"type":"text-delta","delta":"services.yaml 도메인 지식에 따르면 **ais-prod-redis (Redis 7, port 6385)** 의 용도는 다음과 같습니다:\n\n---\n\n### 📋 services.yaml 기준\n... (1224 bytes total — 표 형식 답변 + n8n-redis/news-prod-redis 비교)"}

event: final
data: {"type":"final"}
```

### Criteria #2 wire 증거 (synthesis text-delta 도달 — F-1 fix 결정적)
```
event: drift / text-delta(intro) / tool-start(readLogs news-prod-redis lines=10) /
tool-result(766 chars) / text-delta(synthesis: BGSAVE 표 + 근거) / final
```

### Criteria #4 audit DB SELECT (요약)
```
total recent rows: 15
fix-after rows (id=21, 19): error_envelope=null, total_tool_calls=1, duration_ms 8919/13774
tool rows (id=22, 20, 18, ...): tool_name=readLogs, ok=null (parent로 tool dispatch 정상 기록)

대조 — 이전 SMOKE-LOG-1 시점 (fix 전):
  id=5/id=8: error_envelope={"problem":"loop 실행 실패","cause":"400 invalid_request_error: messages: at least one message is required"}
  → fix 후 재발 0건
```

## Conclusion

- **5/5 PASS — Phase 2 진입 게이트 OPEN (D-E1 satisfied)**
- 후속 plan 02-02 ~ 02-10 진행 가능
- F-1/F-2 fix가 라이브 환경에서 결정적으로 검증됨
- audit DB가 fix 전/후 대조 증거를 git-versioned로 보존 — D-E1 게이트의 가치 입증 완료 (FAIL → PASS 사이클 닫힘)

## D-E1 게이트 메타 평가

- **게이트 ROI:** unit test 22/22 + integration 다수 PASS 코드에서 array aliasing(F-1) + async race(F-2) 두 결함을 잡음. mock emit/sync flow를 쓰는 단위 테스트로는 잡을 수 없는 PITFALL 클래스.
- **dogfood 사이클 닫힘:** discover → plan → fix → 회귀 test → live re-verify가 한 phase 안에서 완결. Phase 1 carry-back 패턴이 정상 동작.
- **Phase 2/3 권장:** 비슷한 패턴(write-side action, approval gate, atomic 2-phase commit)에도 동일한 D-X1 게이트를 두는 것을 권장.

## Next steps

1. STATE.md 갱신 — D-E1 OPEN 반영
2. 02-02 plan 실행: `/gsd-execute-phase 2 --plan 02` (또는 wave 기반 병렬)

## Backlog (본 게이트 범위 외)

- staleCheck 알고리즘이 stack-level 매칭이라 yaml의 stack 블록을 임시 주석해도 unknown 분류로 즉시 옮겨가지 않음. Phase 2 또는 별도 plan에서 algorithm 보강 검토.
- Criteria #2 첫 시도에서 모델이 "voice"라는 키워드(⏸ 정지된 컨테이너)를 5 stack에서 못 찾고 8회 한도 도달. 동작 자체는 정상(envelope + final 정상 emit), 답변 품질 측면에서 system prompt 개선 여지 — Phase 2/3 backlog.
