# Phase 1: Read-Only Knowledge Layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 1-Read-Only Knowledge Layer
**Areas discussed:** services.yaml TODO 보강 방식, RAG chunking 전략 (KB-01/KB-02), AUDIT-01 SQLite event log 입도, Tool error envelope → UI 노출 방식
**Mode:** default (4 areas × 4 questions)
**Locked-by-prior context (재논의 없음):** Phase 0 D-01..D-11, STACK.md 패키지 lock, ARCHITECTURE.md 디렉토리/build order, REQUIREMENTS.md 19개 요구사항(KB-01..04 / READ-01..05 / UI-01..04 / LOOP-01..07 / AUDIT-01,03), DESIGN.md 5 critical correction.

---

## services.yaml TODO 보강 방식

### Q1: TODO 20 슬롯 누가/언제 채우나?

| Option | Description | Selected |
|--------|-------------|----------|
| AI 초안 + 사용자 review | Phase 0 D-03 패턴. AI가 docker logs/compose/listContainers로 슬롯 자동 채움 → 사용자 review-checklist.md 따라 수정. 시간/품질 sweet spot. | ✓ |
| 수동 채움 | 사용자가 services.yaml.review-checklist.md 보고 손으로. 정확하나 1-2h 투자 → 8h 예산 압박. | |
| 빈 채로 진행 | 빈 채로 KB-01/02 완성 → retrieval 보고 fix. baseline sim=0.6308 / gap=0.32 미달 risk. | |

**User's choice:** AI 초안 + 사용자 review
**Notes:** Phase 0 D-03이 같은 패턴으로 검증 완료 — dogfood 메타로 두 phase 패턴 재사용.

### Q2: AI 보강 초안 생성 경로?

| Option | Description | Selected |
|--------|-------------|----------|
| 전용 스크립트 scripts/draft-services-yaml.ts | Phase 0 D-03 패턴 재사용. agent loop / tools 의존 없이 독립 실행. | ✓ |
| Phase 1 dogfood — chat에서 AI에게 부탁 | agent/loop.ts + tools 동작 후 코파일럿 자체에 부탁. 재귀 dogfood이지만 loop bug → 차단 risk. | |
| Inline KB-01 plan task | scripts/ 없이 KB-01 plan 첫 task에 prompt + AI 호출. Phase 0 패턴과 불일치. | |

**User's choice:** 전용 스크립트 scripts/draft-services-yaml.ts
**Notes:** "닭과 계란" 회피 — read tool들이 자기 자신 보강에 사용되면 차단 risk.

### Q3: 산출물 다음 단계?

| Option | Description | Selected |
|--------|-------------|----------|
| Diff 표시 + 수동 mv | jsdiff createPatch로 diff 출력 → 사용자 확인 후 mv + git commit. Phase 2 5-key는 stub만, 실제 적용은 Phase 2. | ✓ |
| 5-key UI prototype 구현 (Phase 2 조기 dogfood) | Phase 1에 approval/store.ts + 5-key keydown handler 구현. yaml mv가 첫 승인 흐름 모르모트. Phase 2 명세 + Phase 1 예산 충돌. | |
| Plain mv + git commit | 스크립트 실행 → 사용자 수동 편집 → git commit. 승인 게이트 논의 별도. | |

**User's choice:** Diff 표시 + 수동 mv
**Notes:** Phase 2 boundary 보호하면서 Phase 1에서 diff 표시 패턴 dogfood.

### Q4: Schema 단수 + unmatched_containers 처리?

| Option | Description | Selected |
|--------|-------------|----------|
| Zod strict + unmatched는 참고만, RAG는 5 stack만 | Phase 0 services.yaml의 unmatched는 보존(참고). RAG는 stacks/* 만 chunk. Phase 1 시간 보호. | ✓ |
| Zod strict + unmatched도 간소화 청크 인덱싱 | voice/krdn-fx/gonsai2 등 19 컨테이너도 RAG에. cover 넓지만 chunk 25 → 50+, retrieval noise. | |
| Zod loose (record passthrough) + 5 stack만 인덱싱 | stacks/* 추가 필드 허용. v2 OSS 시 사용자별 커스텀 필드 가능하나 Phase 1 strict 검증 회피. | |

**User's choice:** Zod schema strict + unmatched는 참고만, RAG 인덱싱은 5 stack만
**Notes:** v2 (OSS 공개 시 stacks/* 추가 필드 허용 검토)에 deferred.

---

## RAG chunking 전략 (KB-01/KB-02)

### Q1: 청크 단위?

| Option | Description | Selected |
|--------|-------------|----------|
| 필드 단위 청크 | 5 stack × ~5 필드 = ~25 작은 청크. 구체적 질의("redis 어디 쓰여")가 정확한 필드(depends_on)에 매칭. 임베딩 비용 미소. | ✓ |
| Stack 단위 청크 | 5 stack = 5 큰 청크. 수단 질의는 잘 동작하나 특정 필드 질의 noise. cosine 평균 dilute. | |
| Hybrid — stack 요약 + 필드 청크 | stack 5 요약 + 필드 25 청크 = 30+ chunks. 양쪽 cover하나 구현 복잡도 증가. | |

**User's choice:** 필드 단위 청크
**Notes:** Spike 2 baseline sim=0.6308이 어떤 청크 모양에서 측정됐는지 plan-phase가 SPIKE-2-RESULT.md 재확인 권장.

### Q2: 청크 텍스트 포맷?

| Option | Description | Selected |
|--------|-------------|----------|
| 자연어 문장 + stack 매그네틱 | 예: "news stack의 normal_log_pattern: '...' — 이 패턴이 안 보이면 worker 멈춤이나 RSS 에러 의심". 자연어 query에 강함. | ✓ |
| Key-value 원본 (yaml 조각만) | 예: "news.depends_on: [news-postgres, news-prod-redis]". 컴팩트하나 자연어 매칭 약함. | |
| Hybrid — 자연어 설명 + key-value tail | 위 두 개 합침. 풍부하나 generate 로직 추가. | |

**User's choice:** 자연어 문장 + stack 매그네틱
**Notes:** 한국어 query에 매칭 우선. Voyage embedding이 자연어 문맥 매칭 강점.

### Q3: 임베딩 인덱스 재생성 시점?

| Option | Description | Selected |
|--------|-------------|----------|
| 해시 기반 lazy | services.yaml SHA-256 hash 비교 → 다르면 re-embed. 비용 ~$0.0004 (1회). | ✓ |
| 명시적 독립 스크립트 scripts/reindex-kb.ts | 사용자가 yaml 편집 후 수동 호출. 의도 제어 가능하나 잊는 일 있음. | |
| Server boot 시 매번 재생성 | bun run dev 시작 시 무조건 voyage embed. 명확하나 불필요 비용 + 시간. | |

**User's choice:** 해시 기반 lazy
**Notes:** scripts/reindex-kb.ts (force flag)도 보조로 제공 (review checklist 작업 후 즉시 재인덱스 원할 때).

### Q4: KB-03 staleness detection 타이밍?

| Option | Description | Selected |
|--------|-------------|----------|
| Boot + per-query | server start 1회 + 각 user turn 진입 시 1회. listContainers 캐시 재사용 → 추가 비용 0. ARCHITECTURE.md 권장. | ✓ |
| Boot만 | 단순. 장시간 세션 중 docker 변화 감지 못함. | |
| Per-query만 | boot 빠르나 첫 질의 latency 증가. cold start UX 악화. | |

**User's choice:** Boot + per-query
**Notes:** listContainers 30s TTL 캐시로 추가 비용 회피.

---

## AUDIT-01 SQLite event log 입도

### Q1: Row 입도?

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid — turn row + 자식 tool row | events 테이블 1개 + parent_id 자기참조. turn(parent_id NULL) + tool(parent_id=turn_id). cost 합계 + 디버깅 양쪽 cover. | ✓ |
| User turn 1 row만 | 1 turn = 1 row. tool calls는 JSON 컬럼. schema 단순하나 tool 단위 디버깅 시 JSON 파싱. | |
| Tool call N row, turn은 세션 ID만 | 가장 세밀하나 cost 합계 매번 GROUP BY. turn prompt 자연어 별도 보관 어려움. | |

**User's choice:** Hybrid — turn row + 자식 tool row
**Notes:** 단일 테이블 self-referencing FK. 인덱스 idx_events_parent_id, idx_events_ts.

### Q2: DB 위치?

| Option | Description | Selected |
|--------|-------------|----------|
| data/copilot.db + .gitignore | STACK.md 예시 따름. state/(intent log)와 분리. binary DB는 git diff 불가. | ✓ |
| state/copilot.db (git tracked) | DB도 audit 일부. 하지만 binary는 fast-forward only(APPLY-07)와 충돌. | |
| Bun in-memory (:memory:) | 세션 종료 시 휘발. AUDIT-02(state/git)와 대체하려는 목적. cost monitoring use case와 충돌. | |

**User's choice:** data/copilot.db + .gitignore
**Notes:** state/는 AI intent log(git tracked), data/는 local-only audit cache. 명시적 분리.

### Q3: Row 필드 깊이?

| Option | Description | Selected |
|--------|-------------|----------|
| 최소 (Phase 1 use case 100% cover) | turn: id/ts/model/prompt/input·output·cache_read_tokens/total_tool_calls/duration_ms/error_envelope. tool: id/parent_id/ts/name/input/result_summary/ok/duration_ms. | ✓ |
| 최소 + idempotency | 위 + idempotency_key (LOOP-07 SSE 재연결 dedupe). schema 복잡도 증가. | |
| 최소 + 모든 SSE event row | tool 명세 + text-delta 명세 row까지. 디버깅 최고이나 DB 수십 MB 위험. | |

**User's choice:** 최소
**Notes:** LOOP-07 idempotency는 LOOP-07 plan task 수준에서 결정 (필요 시 ALTER TABLE).

### Q4: Read tool 호출도 events에 기록?

| Option | Description | Selected |
|--------|-------------|----------|
| 모든 read tool 기록 | listContainers/readLogs/readCompose 3종 모두 tool row. AUDIT-01 명시 그대로. cost 포함. | ✓ |
| tool name별 선별 (대용량 제외) | readLogs 결과는 result_summary만, listContainers 메타만, readCompose 파일 전체 제외. AUDIT-01 부분 위반. | |
| Tool result는 hash만 기록 | result_hash로 cost cover하나 디버깅 시 재현 어려움. | |

**User's choice:** 모든 read tool 기록
**Notes:** result_summary 500자 trim으로 DB 크기 관리. tools/_envelope.ts wrapper가 audit 책임.

---

## Tool error envelope → UI 노출 방식

### Q1: 사용자가 보는 최종 SSE 텍스트?

| Option | Description | Selected |
|--------|-------------|----------|
| Claude가 envelope verbatim 인용 + 한국어 설명 | system prompt: "fix를 인용부호로 그대로 보여라, retryable=false면 멈춰라". 정확한 fix 안내 손실 없음. ARCHITECTURE Pattern 2 일치. | ✓ |
| Claude 잠재 자연어 재구성 | LLM이 자연어로 paraphrase. 자연스러우나 fix 명령(예: unset ANTHROPIC_API_KEY) paraphrase 시 작동 안 할 risk. | |
| Hybrid — retryable=false일 때만 verbatim | retryable=true는 silent retry, false만 verbatim. 세밀하나 retry policy 추가 필요. | |

**User's choice:** Claude가 envelope verbatim 인용 + 한국어 설명
**Notes:** system prompt에 envelope 인용 규칙 + few-shot 예시 1-2개 포함.

### Q2: SSE 'error' 이벤트 UI 렌더링?

| Option | Description | Selected |
|--------|-------------|----------|
| 별도 banner + LLM 설명 | #error-banner div에 sse-swap (빨간 바탕 + monospace fix). LLM 설명은 #output에 text-delta. | ✓ |
| Inline — #output에 모든 것 합쳐 보여줌 | error event도 #output에 렌더. 단순하나 알림성 약함. | |
| Modal/toast | error event → dismissible toast. fit하나 htmx-ext-sse 외 추가 JS 필요. | |

**User's choice:** 별도 banner + LLM 설명
**Notes:** 빨간 banner CSS hidden 기본, content 들어오면 visible. monospace로 fix 강조.

### Q3: Timeout (LOOP-06)도 envelope shape?

| Option | Description | Selected |
|--------|-------------|----------|
| 예 — timeout = envelope | _envelope.ts AbortError catch → {problem: 'tool [name] timeout 30s', fix: '재시도 또는 SSH/docker 점검', retryable: true}. shape 일관성 최고. | ✓ |
| Timeout 전용 SSE event 'timeout' | envelope 아닌 4번째 SSE event 추가. UI-02의 5 event lock 위반. | |
| Hybrid — envelope + 'tool-timeout' 키워드 | envelope shape 유지 + tool-result event에 timeout: true 플래그. 일관성 + 표현력 둘 다 챙김 (대안). | |

**User's choice:** 예 — timeout = envelope
**Notes:** UI-02의 5 event 수 lock 유지하면서 envelope shape 일관성.

### Q4: tool_result content (LOOP-04 orphan 방지)?

| Option | Description | Selected |
|--------|-------------|----------|
| JSON.stringify(envelope) | tool_result content = envelope JSON 그대로. system prompt가 "envelope shape 인식" 룰 lock. 모든 structured field 보존. | ✓ |
| 자연어 요약 문장 | "에러: SSH 접속 실패 — 서버 상태 확인". LLM 읽기 쉬우나 retryable/cause 손실. | |
| is_error: true + content text | Anthropic 공식 is_error 플래그 + 자연어. SDK 권장이나 envelope structured info 손실. | |

**User's choice:** JSON.stringify(envelope)
**Notes:** orphan 방지(LOOP-04)는 dispatch 함수의 try-catch로 모든 path가 tool_result 보장.

---

## Claude's Discretion (plan-phase에서 결정)

다음은 사용자 결정이 아니라 Claude/plan-phase agent가 결정/탐색할 영역으로 둠:

- **8h 예산 내부 split** — KB-01..04 / READ-01..03 / LOOP-01..07 / UI-01..04 / AUDIT-01,03의 wave 분해
- **system prompt 본문 전체** — D-15.1의 envelope 인용 규칙 + RAG 컨텍스트 주입 형식 + 한국어 응답 + 5 핵심 stack 약어 + 모르는 stack 거절 정책
- **검증 NL 쿼리 추가분** — Success Criteria 두 쿼리 외 사용자 주관 쿼리는 plan-phase / verify-phase에서 직접 입력
- **LOOP-07 idempotency_key 컬럼 추가 시점** — D-14.3 minimum schema는 시작점, 필요 시 ALTER TABLE
- **history compaction 정확한 토큰 카운팅** — REQUIREMENTS LOOP-05 lock(50K 임계, system + 마지막 6 exchanges 유지)을 어떤 방법으로 측정(Anthropic SDK input_tokens 누적 vs 4 char-per-token approx)
- **Phase 1 FRICTION carry-over 위치** — `.planning/phases/01-*/FRICTION.md` 신설 (추천) vs Phase 0 파일에 섹션 추가 vs 루트 `.planning/FRICTION.md`로 통합

---

## Deferred Ideas

논의 중 떠오른 아이디어이지만 Phase 1 boundary 밖이라 후속 phase로 이월:

### Phase 2로 이월

- **5-key approval gate UI prototype** — Phase 1 services.yaml 보강에 dogfood 적용 가능했으나 D-12.3가 plain mv + git commit 채택. Phase 2 boundary 보호.
- **state/ git-versioned audit trail (AUDIT-02)** — Phase 1은 SQLite event log만 (D-14). Phase 2에서 applyPatch 시점에 state/ git commit 추가.

### Future milestones (v2)

- **`unmatched_containers` RAG 인덱싱** (D-12.4)
- **`voyage-3.5` 또는 `voyage-4-large` 업그레이드** — sim<0.5 fallback 시
- **multi-host (MULTI-01) / kb auto-sync (KB-AUTO-01) / NOTIFY-01 / OSS-01** — REQUIREMENTS v2

---

*Discussion captured: 2026-05-06*
