# Phase 2 Pre-Execute Gate (D-E1) — Smoke Log

**Date:** 2026-05-07 13:35 (UTC+9)
**Operator:** gon (assisted by claude-opus-4-7 — Step A 사용자 직접, Step B~D 자동 검증)
**Basis:** Phase 1 ROADMAP Success Criteria #1/#2/#3/#4 + VOYAGE 키 회전
**Verdict:** **FAIL — D-E1 gate NOT satisfied.** 02-02..02-10 진입 차단.

> ⚠ 이 게이트는 Phase 2 본격 진입 전 라이브 환경에서만 드러나는 PITFALL을 잡기 위한 **의도된 검증**입니다. FAIL이 곧 D-E1의 가치 입증 — 22/22 unit/integration PASS임에도 라이브에서 결정적 wire 결함 2건 + 보안 함정 1건이 드러남.

## Step A — Voyage 키 회전

| 항목 | Status | Evidence |
|------|--------|----------|
| dashboard에서 새 키 발급 + 기존 revoke | PASS | 사용자 직접 수행 |
| .env `VOYAGE_API_KEY=` 새 값 갱신 | PASS | grep `^VOYAGE_API_KEY=` returns set |
| embed roundtrip (1024 dim) | PASS (1차) | `bun -e "...VoyageAIClient.embed(['test'])..."` → `OK 1024` |
| **결제 등록 후 burst 검증 (4 calls)** | PASS (2차) | `OK x4 dims=1024` (rate-limit 해제 확인) |

### Carry-forward observation
**새 키가 발급 직후 결제 미등록 무료 등급(3 RPM / 10K TPM)으로 시작.** 1차 검증은 통과했으나 RAG `queryTopK` 매 query당 voyage 호출 → Step B 진입과 동시에 429.
응답 본문: `"You have not yet added your payment method ... reduced rate limits of 3 RPM and 10K TPM. To unlock our standard rate limits, please add..."`
사용자가 `https://dashboard.voyageai.com/billing` 결제 등록으로 해결 → standard tier 활성. **다음 회전 시에도 동일 함정 — 회전 직후 dashboard에서 billing tier 즉시 확인 필수.** (FRICTION F-3에 lock-in)

## Step B — Phase 1 live smoke 5단계

| # | Criteria | Status | Evidence |
|---|----------|--------|----------|
| 0 | `unset ANTHROPIC_API_KEY` 후 `bun run src/server.ts` 시작 | PASS | startup log: `[KB] indexed=false (yaml hash unchanged), chunkCount=25 / [KB-03] services.yaml drift 감지: unknown=4, stale=1 / [server] ready — http://127.0.0.1:3000` (FRICTION #8 회피 검증) |
| 1 | "ais-prod redis 어디 쓰여?" → RAG + 라이브 docker | **FAIL** | `curl /chat-stream` SSE: drift event + text-delta `"ais-prod-redis의 용도를 확인하겠습니다..."` + tool-start `listContainers(state=running, namePattern=ais)` + tool-result `9 items` + tool-start `readLogs(ais-prod-redis, lines=50)` + tool-result `3580 chars` **— 그 후 final 미도달 + synthesis text-delta 미도달**. audit DB events.id=8: `error_envelope: "loop 실행 실패 / 400 invalid_request_error: messages: at least one message is required"` (request_id=`req_011Canaq7qP5ZbJXfECrMDt5`). 1차 시도 id=5도 동일 (req_id=`req_011CanZMFphsM333ojVTmqCs`). |
| 2 | "지난밤 새벽 1-3시 voice 에러 패턴" → readLogs | **BLOCKED** | Criteria #1 FAIL의 동일 wire 경로. 의미 있는 라이브 검증 불가 — Phase 1 hotfix 후 재검증 필요. |
| 3 | services.yaml drift → banner | **BLOCKED (partial)** | drift 검출 자체는 동작 (boot 시 + 매 query 시 unknown=4 stale=1 emit 확인). 그러나 final 미도달 wire 결함이 동일 SSE 경로를 사용하므로 운영자 시연 단계까지의 end-to-end 검증 불가. |
| 4 | `data/copilot.db events` SELECT | **PASS** | 13 rows, 위 모든 결함을 lock-in. Criteria #1의 turn(id=5, id=8) + 자식 tool rows(id=6,7 / id=9,10) + hello probe rows(id=11/12/13, error_envelope=null + duration 4-5초로 정상 종료 기록)가 모두 audit에 기록됨. **audit DB는 동작 — wire 결함이 SSE 클라이언트 가시성에만 영향.** |

### Criteria #1 wire 증거 (curl SSE 출력)
```
event: drift
data: {"type":"drift","message":"⚠ services.yaml 불일치: docker-only 4개, yaml-only 1개 발견","unknown":["vscode","cli-proxy-api","ai-afterschool-fsd-web","krdn-timescaledb"],"stale":["krdn-fx"]}

event: text-delta
data: {"type":"text-delta","delta":"ais-prod-redis의 용도를 확인하겠습니다. 라이브 상태와 로그를 동시에 확인합니다."}

event: tool-start
data: {"type":"tool-start","name":"listContainers","args":{"limit":20,"filter":{"state":"running","namePattern":"ais"}}}

event: tool-result
data: {"type":"tool-result","name":"listContainers","ok":true,"summary":"listContainers — 9 items"}

event: tool-start
data: {"type":"tool-start","name":"readLogs","args":{"containerName":"ais-prod-redis","lines":50}}

event: tool-result
data: {"type":"tool-result","name":"readLogs","ok":true,"summary":"readLogs — 3580 chars"}

(stream ends without `event: final` and without `event: error`)
```

### Criteria #4 audit DB SELECT (요약)
```
TABLES: events, sqlite_sequence, kb_meta, kb_chunks
events columns: id, ts, model, prompt, input_tokens, output_tokens, cache_read_tokens,
                total_tool_calls, duration_ms, error_envelope, parent_id, tool_name, input,
                result_summary, ok
total rows: 13

핵심 row (Criteria #1 두 번째 시도):
  id=8  ts=2026-05-07T04:33:25.430Z  prompt="ais-prod redis 어디 쓰여?"  total_tool_calls=2
        duration_ms=4017  output_tokens=188
        error_envelope={"problem":"loop 실행 실패","cause":"400 invalid_request_error: messages: at least one message is required","request_id":"req_011Canaq7qP5ZbJXfECrMDt5","fix":"재시도 또는 서버 로그 확인","retryable":true}
  id=9  parent=8  tool=listContainers  ok=1  duration=280ms
  id=10 parent=8  tool=readLogs        ok=1  duration=226ms

대조 row (hello probe — 정상 종료, 그러나 SSE wire에는 final 미도달):
  id=11/12/13  prompt="hello"  output_tokens=339/290/285  duration_ms=5706/5002/4231
              error_envelope=null  total_tool_calls=0
```

## Conclusion

- **0/5 PASS — Phase 2 진입 게이트 CLOSED (D-E1 NOT satisfied)**
- 후속 plan 02-02 ~ 02-10 진행 보류. Phase 1 carry-forward hotfix 결정이 선행 필요.
- 발견된 결함 2건 + 보안 함정 1건은 `FRICTION.md`에 상세 lock-in.
- audit DB(Criteria #4)가 정상 동작하여 모든 결함을 git-versioned 증거로 캡처. **이것이 D-E1 게이트의 직접 가치 입증.**

## Next steps (사용자 결정 대기)

1. Phase 1 hotfix를 어디에 둘지: (A) Phase 1로 되돌려 신설 plan(01-10), (B) Phase 2 신설 plan(02-00.5 또는 02-01b), (C) 02-01 task 추가 (D-E1 의도 변형)
2. hotfix 완료 후 D-E1 재검증 — 이 SMOKE-LOG는 변경 없이 보존하고 신규 SMOKE-LOG-2 작성으로 진행 권장
