# Phase 1: Read-Only Knowledge Layer - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Mode:** default (interactive, 4 areas × 4 questions)

<domain>
## Phase Boundary

운영자가 자연어 질의(`"ais-prod redis 어디 쓰여?"`, `"지난밤 새벽 1-3시 voice 에러 패턴"`)를 입력하면, 코파일럿이 services.yaml 도메인 지식 + 라이브 docker/SSH 결과를 결합한 답변을 SSE로 스트리밍하는 read-only 코파일럿 한 사이클 완성.

**구성 요소 (ARCHITECTURE.md build order 9단계 lock):**
1. 5 핵심 stack(news/ais/n8n/open-webui/krdn-fx)에 대한 services.yaml 보강 (KB-01 prerequisite)
2. Voyage AI voyage-4-lite 임베딩 + bun:sqlite RAG (KB-01, KB-02)
3. Drift detection: docker ps vs services.yaml semantic diff (KB-03)
4. Log sanitization: SECRET|KEY|PASSWORD|TOKEN|BEARER 라인 제거 (KB-04)
5. 3 read tools: listContainers / readLogs / readCompose (READ-01..03)
6. Agent loop (HTTP-agnostic, tool_use 루프, hard caps, history compaction) (LOOP-01..07)
7. Hono streamSSE → htmx-ext-sse 5 named events (UI-01..04)
8. AUDIT-01/03: bun:sqlite event log (turn + 자식 tool row hybrid)

**스코프 밖 (Phase 2 또는 v2):**
- proposePatch / applyPatch (APPLY-01..08) — Phase 2
- 5-key approval gate UI (APPLY-02) — Phase 2 (Phase 1은 services.yaml 보강에서 diff 표시만, 5-key는 미구현)
- state/ git audit trail (AUDIT-02) — Phase 2 (Phase 1의 audit는 SQLite에)
- multi-host / kb auto-sync / OSS — v2

**시간 예산:** ≤8h (overage 시 Phase 2 진행 전 명시적 사용자 논의 필요 — STATE.md "Blockers/Concerns")

</domain>

<decisions>
## Implementation Decisions

### services.yaml TODO 보강 방식 (D-12)

- **D-12.1:** **AI 초안 + 사용자 review** (Phase 0 D-03 패턴 재사용). `state/services.yaml`의 5 stack × 4 필드(`depends_on`, `volumes`, `normal_log_pattern`, `key_log_locations`) = 20 TODO 슬롯을 AI가 docker logs/compose 메타정보로 자동 채움 → 사용자가 `state/services.yaml.review-checklist.md`에 따라 수정.
  - **Why:** 수동 보강은 1-2h 투자 → 8h 예산 압박. 빈 채로 진행은 RAG 품질 baseline(Spike 2 sim=0.6308 / gap=0.32)에 미달 가능. AI 초안은 Phase 0 D-03이 검증한 sweet spot 패턴.
  - **How to apply:** Phase 1 첫 plan(KB-01 prerequisite)이 보강을 책임진다. AI 호출은 services.yaml + listContainers 결과 + readLogs 샘플 + readCompose 샘플을 LLM에 주고 4 필드 슬롯만 채우는 한 번의 prompt.

- **D-12.2:** **전용 스크립트 `scripts/draft-services-yaml.ts`** (agent loop 의존 없음). Phase 0 D-03 `scripts/draft-services-yaml.ts` 패턴 재사용. agent/loop.ts나 tools/ 에 의존하지 않고 독립적으로 실행. Anthropic SDK + readLogs/listContainers/readCompose 핵심 로직을 inline으로 중복 작성하거나, 작성 시점이 tools/ 모듈 완성 이후라면 import 가능.
  - **Why:** "닭과 계란" 회피 — Phase 1 read tool들이 그 자신을 보강에 사용하면 loop bug가 생기면 차단된다. 독립 스크립트가 cleanest path.
  - **How to apply:** `bun run scripts/draft-services-yaml.ts` → 출력은 `state/services.yaml.draft`. `package.json scripts`에 `draft-yaml` 별칭 추가.

- **D-12.3:** **Diff 표시 + 수동 mv + git commit.** 스크립트는 `state/services.yaml.draft`를 쓴다. CLI가 jsdiff `createPatch(filename, current, draft)`로 unified diff를 stdout에 출력 → 사용자가 시각적으로 확인 후 `mv state/services.yaml.draft state/services.yaml` + `git -C state add services.yaml && git commit`. **Phase 1에서는 5-key UX 미구현** (Phase 2로 deferred).
  - **Why:** Phase 2의 proposePatch/5-key는 Phase 2 boundary. Phase 1 boundary 안에서 diff 표시 패턴만 미리 dogfood — Phase 2 plan이 그 위에 5-key wire.
  - **How to apply:** `scripts/draft-services-yaml.ts` 마지막에 `console.log(createPatch(...))` + `console.log("Review then: mv state/services.yaml.draft state/services.yaml")` 안내.

- **D-12.4:** **Zod schema strict + unmatched는 참고만, RAG 인덱싱은 5 stack만.** `kb/schema.ts`에 Zod schema 정의 (`stacks: Record<string, StackSchema>` + `unmatched_containers: ContainerRefSchema[]` + `generated_at` + `generated_from`). RAG indexing은 `stacks.*` 만 처리, `unmatched_containers`는 future v2에서 5 stack 합류 시점에 처리.
  - **Why:** Phase 1 8h 예산 보호. 19 unmatched 컨테이너(voice/krdn-fx의 stopped, gonsai2 등)를 RAG에 넣으면 chunk 25 → 50+ 증가 + 의미 없는 retrieval noise.
  - **How to apply:** `kb/schema.ts` strict, `kb/index.ts`가 `parsed.stacks` 만 iterate. `state/services.yaml.review-checklist.md`에서 정의한 4 슬롯이 schema의 required 필드.

### RAG chunking 전략 (D-13, KB-01/KB-02)

- **D-13.1:** **필드 단위 청크** (5 stack × ~5 필드 = ~25 청크). 각 stack의 `purpose` / `depends_on` / `volumes` / `normal_log_pattern` / `key_log_locations` 가 각각 독립 chunk. `containers` 배열은 stack `purpose` chunk에 요약 포함 (별도 chunk 아님).
  - **Why:** "redis 어디 쓰여?" 같은 구체적 질의가 정확한 필드(depends_on)에 매칭됨. Stack 단위 5 큰 청크는 cosine 평균이 noise로 dilute됨. Hybrid는 청크 30+ 비용.
  - **How to apply:** `kb/index.ts` chunker가 각 stack을 iterate하며 5 필드를 분리. chunk metadata: `{ stack: 'news', field: 'depends_on' }` — retrieval 결과를 LLM 컨텍스트에 주입할 때 어느 stack의 어느 필드인지 표시.

- **D-13.2:** **자연어 문장 + stack 매그네틱 텍스트 포맷.** 각 chunk 텍스트는 자연어 한 문장 + stack 식별자 prefix. 예:
  - `news` × `depends_on` chunk text: `"news stack은 news-postgres(5433)와 news-prod-redis(6380)에 의존한다."`
  - `news` × `normal_log_pattern` chunk text: `"news stack의 normal_log_pattern: 'RSS feed parsed: 12 items'. 이 패턴이 안 보이면 worker 멈춤이나 RSS 에러 의심."`
  - **Why:** Voyage embedding은 자연어 문맥 매칭이 강점. 사용자 query("redis 어디 쓰여?")가 자연어이므로 자연어 문장과 cosine match가 더 강함. KV 원본은 구조 정확하지만 embedding 의미 매칭이 약함.
  - **How to apply:** `kb/chunker.ts`에 stack/field별 template formatter. Korean string interpolation 사용 (한국어 query에 매칭).

- **D-13.3:** **해시 기반 lazy 인덱싱.** `kb/index.ts`가 boot 시 `state/services.yaml` SHA-256 hash 계산 → bun:sqlite `kb_meta` 테이블의 마지막 hash와 비교 → 다르면 voyageai embed 호출 후 `kb_chunks` 테이블 비우고 재기록 + meta hash 갱신. 같으면 skip (cold start fast path).
  - **Why:** $0.0004 비용은 무시 가능하나 voyage API latency(~수 초)는 매 boot마다 부담. 명시적 `scripts/reindex-kb.ts`는 사용자가 잊을 위험. Boot 강제 재생성은 dev iteration 망침.
  - **How to apply:** `kb/index.ts ensureIndexed()` 함수 — server start 시점 호출. 추가로 `scripts/reindex-kb.ts`(force flag)도 제공 (review checklist 작업 후 즉시 재인덱스 원할 때).

- **D-13.4:** **KB-03 staleness detection: Boot + per-query.** server start 시 1회, 각 user turn 진입 직후 1회 (RAG retrieval 직전 또는 직후). drift 감지 시 SSE `text-delta` 첫 chunk로 warning banner 텍스트 prepend (`⚠ services.yaml may be stale: 2 docker-only services found`). Per-query는 listContainers 호출과 캐시 공유.
  - **Why:** Boot만이면 장시간 세션 중 docker 변경 감지 못함. Per-query만이면 첫 query latency 증가 + boot 시 사용자 알림 못함. Both는 양쪽 use case 모두 cover하면서 listContainers 캐시(예: 30s TTL) 공유로 추가 비용 0.
  - **How to apply:** `kb/stale-check.ts staleCheck(): StalenessReport`. listContainers 결과를 30s TTL Map에 캐시. server start 시 await 후 첫 emit, 이후 user turn마다 cached 결과로 즉시 비교.

### AUDIT-01 SQLite event log 입도 (D-14)

- **D-14.1:** **Hybrid 스키마 — turn row + 자식 tool row.** `events` 테이블 단일에 `parent_id INTEGER REFERENCES events(id)` 자기참조. parent_id NULL이면 user turn(prompt + 합계 cost), 자식이면 단일 tool call. AUDIT-01("모든 read 도구 호출 기록") + AUDIT-03("timestamp/model/token usage/tool call 횟수 저장") 둘 다 cover.
  - **Why:** turn 단일 row는 cost 합계는 쉽지만 tool 단위 디버깅 어려움 (JSON 컬럼 파싱 필요). tool 단일 row는 turn level cost 합계 매번 GROUP BY. Hybrid는 단일 SELECT로 cost (turn row) + 단일 SELECT로 tool 시간순 (parent_id) 둘 다 가능.
  - **How to apply:** `data/copilot.db`에 `events` 테이블 1개. 인덱스: `idx_events_parent_id`, `idx_events_ts`. `audit/log.ts beginTurn(prompt, model)` → turn id 반환, `audit/log.ts logTool(parent_id, name, input, result, ok, duration)`, `audit/log.ts endTurn(id, output_tokens, total_tool_calls, error_envelope?)`.

- **D-14.2:** **DB 위치: `data/copilot.db` + `.gitignore`.** STACK.md 예시(`./data/copilot.db`)를 그대로 따른다. `data/`는 .gitignore 추가 (binary SQLite 파일은 git diff 불가능). `state/`(AI intent log, git tracked)와 명시적 분리.
  - **Why:** state/는 의도(intent) + AI reasoning이 git log로 추적되어야 하는 audit trail. data/는 cost monitoring + 디버깅용 local cache. binary DB가 state/에 들어가면 fast-forward only 원칙(APPLY-07)과 충돌하고 git diff 의미 잃음.
  - **How to apply:** `.gitignore`에 `/data/` 추가. `bun:sqlite` `Database('./data/copilot.db', { create: true })`. `mkdir -p data` 를 startup 시 명시 (or `Database` create 옵션).

- **D-14.3:** **Row 필드 — 최소 (Phase 1 use case 100% cover).**
  - **turn row** (parent_id NULL): `id`, `ts`, `model`, `prompt`(≤2000자 trim), `input_tokens`, `output_tokens`, `cache_read_tokens`, `total_tool_calls`, `duration_ms`, `error_envelope` (JSON 문자열 또는 NULL).
  - **tool row** (parent_id NOT NULL): `id`, `parent_id`, `ts`, `tool_name`, `input` (JSON 문자열), `result_summary` (≤500자 trim), `ok` (BOOL), `duration_ms`.
  - **Why:** Phase 1의 cost monitoring + 디버깅에 필요한 정보만. LOOP-07 idempotency_key는 Phase 1 LOOP-07 plan task 수준에서 결정 (이 schema는 minimal로 시작, 추후 ALTER TABLE).
  - **How to apply:** `audit/schema.sql`에 CREATE TABLE 명시. `audit/log.ts`가 인터페이스. token 수치는 Anthropic SDK `final.usage` 객체에서 직접 추출.

- **D-14.4:** **모든 read tool 호출 기록.** listContainers / readLogs / readCompose 3종 모두 tool row 생성. AUDIT-01 명시 ("모든 read 도구 호출도 기록")에 부합. `result_summary`는 최대 500자로 trim — readLogs는 큰 출력이지만 metadata(라인 수, 사용된 컨테이너) 위주 요약.
  - **Why:** AUDIT-01 spec 일관성. tool name별 차별 대우는 future debugging 어려움 — "이 사용자 turn에서 어떤 tool이 어떤 순서로 돌았는지"가 가장 자주 필요한 query.
  - **How to apply:** `tools/_envelope.ts` wrapper가 audit/log.ts logTool 호출 책임. 모든 tool은 `_envelope.run()`을 거치므로 자동 적용.

### Tool error envelope → UI 노출 방식 (D-15)

- **D-15.1:** **Claude가 envelope verbatim 인용 + 한국어 설명.** system prompt에 "tool이 ToolError(`{problem, cause, fix, retryable}` 필드 포함 JSON) 반환 시 `fix` 문자열을 인용부호로 입혀서 그대로 보여주고, retryable=false이면 시도 멈춰라. 한국어로 사용자에게 무엇을 해야 하는지 설명하라." 명시.
  - **Why:** ARCHITECTURE.md Pattern 2가 이미 규정 — "Claude는 fix를 verbatim 표시." 자연어 재구성은 fix 명령(예: `unset ANTHROPIC_API_KEY`)을 LLM이 임의로 paraphrase하면 명령 작동 안 할 수 있음.
  - **How to apply:** `agent/system-prompt.ts`에 envelope 인용 규칙 명시. 예시 응답 1-2개 (few-shot) 포함 가능.

- **D-15.2:** **별도 banner + LLM 설명.** SSE `error` event는 UI #error-banner div에 sse-swap (빨간 바탕 + monospace로 fix 표시). LLM 자연어 설명은 #output에 text-delta로 들어감. UI-02의 `event:error`가 별도 div로 렌더링.
  - **Why:** 사용자가 fix 명령을 잘못 복사·타이핑하지 않도록 monospace 강조. Inline은 alert 약함, modal은 htmx-ext-sse 외 추가 JS 필요.
  - **How to apply:** `public/index.html` 의 `<div id="error-banner" hx-ext="sse" sse-swap="error">` (별도 sse-connect 가능). 빨간 banner CSS는 hidden 기본, content 들어오면 visible.

- **D-15.3:** **Timeout = envelope.** `tools/_envelope.ts`의 AbortController가 30s 도달 시 catch 블록이 `{problem: 'tool [name] timeout 30s', cause: '서버 도달·응답 지연', fix: '재시도 또는 SSH/docker context 상태 점검', retryable: true}` 반환. 60s SSE chunk timeout(LOOP-06)도 동일 envelope shape.
  - **Why:** 5 SSE event 수(UI-02 lock)와 envelope shape 일관성 둘 다 유지. LLM이 retry 결정을 envelope로 균일하게 내림.
  - **How to apply:** `_envelope.ts`의 catch가 `err.name === 'AbortError'` 분기 → timeout envelope. 60s SSE chunk는 `agent/sse.ts`의 wrapper가 동일 shape으로 SSE error event emit.

- **D-15.4:** **tool_result content = `JSON.stringify(envelope)`.** Anthropic SDK tool_result block의 content는 envelope JSON 그대로. system prompt에 "tool_result content가 problem/cause/fix/retryable 필드 가진 JSON이면 에러"로 lock. **LOOP-04 orphan tool_use 방지**: try-catch가 어디서든 fail해도 envelope JSON을 tool_result로 push.
  - **Why:** Anthropic 권장 `is_error: true`는 boolean만. envelope의 retryable / cause / fix 정보 손실. JSON.stringify는 LLM이 structured fields를 모두 볼 수 있고 retry 판단 정확도 높음.
  - **How to apply:** `agent/loop.ts dispatch()`가 try-catch로 wrapping → 항상 `{type: 'tool_result', tool_use_id, content: JSON.stringify(toolReturn)}` push (success도 같은 shape). system prompt가 "envelope shape 인식" 룰 명시.

### Claude's Discretion (plan-phase에서 결정)

다음은 사용자 결정이 아니라 Claude가 plan-phase 단계에서 결정/탐색할 영역:

- **8h 예산 내부 split** — KB-01..04 (보강 + 임베딩 + drift + sanitization), READ-01..03 (3 tool wrapper), LOOP-01..07 (loop + caps + compaction + retry/idempotency), UI-01..04 (SSE wire + 5 named event), AUDIT-01/03 (SQLite). plan-phase에서 wave 분해.
- **system prompt 본문 전체** — D-15.1의 envelope 인용 규칙 + RAG context 주입 형식 + 한국어 응답 + 5 핵심 stack 약어 + 모르는 stack 거절 정책. plan-phase 또는 LOOP-01 plan에서 작성.
- **검증 NL 쿼리** — Success Criteria 1, 2(redis 어디 쓰여? / 새벽 1-3시 voice 에러)는 lock. 추가 사용자 주관 쿼리는 plan-phase 또는 verify-phase에서 사용자가 직접 입력.
- **LOOP-07 idempotency_key 컬럼** — D-14.3는 minimum schema. SSE 재연결 race condition을 어떻게 막을지(클라이언트 token / 서버 in-memory dedupe)는 LOOP-07 plan에서.
- **history compaction 시점** — REQUIREMENTS LOOP-05 lock("토큰 50K 임계 도달 시 system + 마지막 6 exchanges 유지"). 정확한 토큰 카운팅 방법(Anthropic SDK input_tokens 누적 vs 4 char-per-token approx)은 LOOP-05 plan.
- **Phase 1 FRICTION carry-over 위치** — `.planning/phases/01-*/FRICTION.md` 신설 vs Phase 0 파일에 섹션 추가. plan-phase 또는 verify-phase 시작 시 결정 (현재로는 신설을 추천).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### 프로젝트 정의 (반드시 우선 확인)

- `.planning/PROJECT.md` — Core Value, Constraints, Key Decisions, Out of Scope. 모든 phase의 SSOT.
- `.planning/REQUIREMENTS.md` — Phase 1은 KB-01..04, READ-01..05, UI-01..04, LOOP-01..07, AUDIT-01, AUDIT-03 (총 19개) 커버.
- `.planning/ROADMAP.md` Phase 1 섹션 — Goal + Success Criteria 5개 + Critical Research Corrections 5건 (모든 Phase 1 구현은 이 5건 위반 금지).
- `.planning/STATE.md` "Blockers/Concerns" — KB-01 prerequisite 경고(`state/services.yaml` TODO 슬롯), 환경 변수 함정(`unset ANTHROPIC_API_KEY`).
- `DESIGN.md` — 원본 설계 문서 (autoplan review 5 critical correction 포함).

### Phase 0 carry-forward (재논의 금지)

- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` — D-01..D-11 모두 Phase 1에 carry-forward (특히 D-09 cli-proxy-api endpoint, D-10 sonnet-4-6 / opus-4-6, D-11 fallback schema).
- `.planning/phases/00-bootstrap-spikes/FRICTION.md` — 10개 마찰 (특히 #8 환경 변수, #10 docker context 이름).

### Phase 1 직접 인풋 (research output)

- `.planning/research/STACK.md` — 패키지 버전 lock (Bun 1.3.6 / Hono 4.x / @anthropic-ai/sdk@0.93 / voyageai@0.2.1 / zod@^4 + z.toJSONSchema / diff@9 / htmx 2.0.10 / htmx-ext-sse@2.2.4 / bun:sqlite). 모든 Phase 1 구현이 STACK.md 버전 lock 준수.
- `.planning/research/ARCHITECTURE.md` — 디렉토리 layout (agent/, tools/, kb/, state/, approval/), Phase 1 build order 9 단계, 컴포넌트 책임표, SSE event 5 종 taxonomy, 에러 envelope shape, 스테일니스 알고리즘.
- `.planning/research/PITFALLS.md` — Phase 1 critical pitfalls (#1 orphan tool_use, #4 SSE 재연결 dup, #5 token cost runaway, #6 prompt injection from logs, #8 DOCKER_CONTEXT leak, #10 bun:sqlite strict). 모든 Phase 1 plan에서 해당 pitfall 처리 task 명시.
- `.planning/research/FEATURES.md` — Phase 1 feature 우선순위 + competitor analysis.
- `.planning/research/SUMMARY.md` — 5 critical correction 표 + Phase 매핑.

### 라이브 환경 / 인프라

- `~/.claude/CLAUDE.md` "운영 서버 (192.168.0.5)" — `home-server` Docker context (FRICTION #10 — `dserver`가 아니라 `home-server`), `ssh gon@192.168.0.5` 액세스, cli-proxy-api(192.168.0.5:8317).
- `state/services.yaml` — 5 stack draft (Phase 0 산출). KB-01의 입력. **D-12에 따라 첫 보강 task가 4 필드 슬롯을 채운다.**
- `state/services.yaml.review-checklist.md` — D-12 보강 단계 사용자 review 가이드.
- `state/SPIKE-2-RESULT.md` — Voyage 4-lite baseline (top-1 sim=0.6308 / gap=0.32). KB-01/KB-02 retrieval 품질 ground truth.
- `state/SPIKE-3-RESULT.md` — htmx-ext-sse 5 chunk wire 검증.
- `state/SPIKE-6-RESULT.md` — cli-proxy-api 경유 chat / tool-use / streaming 검증.

### 외부 공식 문서

- Anthropic streaming + tool_use docs: `https://docs.anthropic.com/en/api/messages-streaming`, `https://docs.anthropic.com/en/agents-and-tools/tool-use`
- Hono streaming `streamSSE`: `https://hono.dev/docs/helpers/streaming`
- htmx-ext-sse: `https://htmx.org/extensions/sse/`
- Voyage AI embeddings: `https://docs.voyageai.com/docs/embeddings`
- Zod v4 `z.toJSONSchema`: `https://zod.dev/v4`
- Bun shell `Bun.$`: `https://bun.sh/docs/runtime/shell`
- bun:sqlite: `https://bun.com/docs/runtime/sqlite`
- jsdiff: `https://www.npmjs.com/package/diff`

### Dogfood 메타 (DOG-02)

- `~/.claude/plans/gstack-gsd-melodic-raven.md` — gstack/gsd 통합 설계. Phase 1 마찰 메모 입력처.
- `CLAUDE.md` (프로젝트 루트) — gstack+gsd 라우팅 규칙.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (Phase 0 산출)

- **`src/env.ts`** — Zod v4 schema + `loadEnv()` startup guard. ANTHROPIC_BASE_URL / API_KEY / VOYAGE_API_KEY / COPILOT_MODEL_READONLY / PROPOSE / DOCKER_CONTEXT 검증 (BOOT-04, BOOT-05). Phase 1의 모든 entrypoint(`server.ts`, `scripts/draft-services-yaml.ts`)가 첫 줄에서 호출.
- **`src/docker-context-check.ts`** — `docker context inspect $DOCKER_CONTEXT` startup 검증. `home-server` resolution 실패 시 친절한 에러. server.ts의 두 번째 startup probe.
- **`spikes/02-voyage-embed.smoke.ts`** + `spikes/02-voyage-embed.test.ts` — Voyage AI 호출 패턴 (1024차원, cosine similarity). KB-01의 `kb/index.ts`가 이 패턴 따라가면 됨.
- **`spikes/03-sse-roundtrip/`** — Hono `streamSSE` + htmx-ext-sse 5 chunk delivery. UI-01..04의 wire 검증 끝남. Phase 1의 `server.ts /chat` 핸들러 + `public/index.html`이 이 패턴 확장.
- **`spikes/04-git-commit.test.ts`** — `Bun.$` `git commit body roundtrip + escape`. D-12.3의 review 후 `git commit` step + KB-03 drift 보강 시 재사용.
- **`spikes/05-zod-schema.test.ts`** — `z.toJSONSchema()` 출력이 Anthropic `Tool['input_schema']`와 호환. tools/ 5 종 모두 이 패턴 따라간다.
- **`spikes/06-proxy-fallback.smoke.ts`** + `spikes/06-proxy-fallback.test.ts` — Anthropic SDK + cli-proxy-api(D-09) + D-11 fallback retry 패턴. agent/loop.ts가 LLM client 생성 시 동일 패턴 + retry-with-fallback 구현.
- **`state/services.yaml`** — 5 stack draft. KB-01의 입력. D-12에 따라 보강 후 RAG 인덱싱.
- **`state/services.yaml.review-checklist.md`** — D-12.1 review 가이드 (이미 작성됨, Phase 0).

### Established Patterns

- **GSD `.planning/` 컨벤션** — 모든 phase 산출물은 `.planning/phases/NN-slug/`에 들어간다. Phase 1 산출물도 `.planning/phases/01-read-only-knowledge-layer/`.
- **GSD commit convention** — `docs(NN): <메시지>` (gsd-tools.cjs 부재 시 manual git commit, FRICTION #1). 코드 commit은 `feat(NN): ...`.
- **Korean response rule** — `~/.claude/rules/korean-response.md`. 사용자 대면 출력은 한국어 (system prompt에서도). 코드 식별자는 영문, 주석은 한국어.
- **D-03 패턴 재사용** — Phase 0의 "AI 자동 생성 + 인간 review" 패턴이 D-12에서 재현. 이 패턴이 dogfood 메타로 두 phase 검증.
- **Phase 0 envelope 시연 부재** — Phase 0 spike에는 `_envelope.ts`가 없음 (spike는 단발성). Phase 1의 `tools/_envelope.ts`가 처음 등장하는 wrapper.

### Integration Points

- **`src/env.ts loadEnv()`** — server.ts와 scripts/* 진입점 첫 줄. FRICTION #8 빈 ANTHROPIC_API_KEY 감지 친절한 에러 메시지를 추가 권장.
- **`src/docker-context-check.ts`** — server.ts startup 두 번째 probe. `DOCKER_CONTEXT=home-server` 검증.
- **`docker --context home-server`** — listContainers / readLogs / KB-03 staleness check 모두 진입점. 명시적 context 인자 (FRICTION #10 lesson).
- **SSH `gon@192.168.0.5`** — readCompose 진입점. `Bun.$` shell-out으로 `ssh gon@192.168.0.5 cat <compose-path>`.
- **cli-proxy-api(192.168.0.5:8317)** — D-09 LLM endpoint. agent/loop.ts와 scripts/draft-services-yaml.ts 둘 다 사용.
- **D-11 fallback** — `ANTHROPIC_FALLBACK_BASE_URL` / `ANTHROPIC_FALLBACK_API_KEY` schema 이미 lock. agent/loop.ts에서 retry-with-fallback 정식 구현 시점이 Phase 1.

</code_context>

<specifics>
## Specific Ideas

### 사용자가 명시적으로 강조한 결정 (carry-forward)

- **`voyage-4-lite`** (DESIGN.md correction #1)
- **`Bun.$ docker --context home-server`** (FRICTION #10 — docker context 이름은 `home-server`)
- **`z.toJSONSchema()` Zod v4 내장** (DESIGN.md correction #3)
- **`htmx-ext-sse@2.2.4` 별도 로드** (DESIGN.md correction #4)
- **`unset ANTHROPIC_API_KEY` 셸 함정** (FRICTION #8 — Phase 1 startup script가 빈 값 감지 + 친절한 에러)

### 검증 쿼리 (Success Criteria lock)

ROADMAP.md Phase 1 Success Criteria가 두 NL 쿼리를 lock:
1. **"ais-prod redis 어디 쓰여?"** → services.yaml `ais.depends_on`(redis 6385) + 라이브 `docker ps`(`ais-prod-redis: Up 8 days (healthy)`) 결합 답변
2. **"지난밤 새벽 1-3시 voice 에러 패턴"** → readLogs(voice-* 컨테이너 with --since/until) + sanitized 요약

추가 사용자 주관 쿼리는 plan-phase 또는 verify-phase에서 사용자가 직접 입력 (Claude's Discretion).

### 시간 예산 강조

ROADMAP.md: **Phase 1 ≤8h.** 초과 시 Phase 2 진행 전 명시적 논의 필요. STATE.md "Blockers/Concerns"가 이미 Phase 0이 ~140분(20분 overage) 사용했음을 기록 → 18h 총 예산 중 ~15.7h 남음. plan-phase에서 8h 내부 wave 분해 시 KB-01 prerequisite(D-12 보강) 시간이 KB-01 안에 포함됨을 명시.

### dogfood 메타 강조

Phase 1은 통합 파이프라인의 두 번째 검증 사례. Phase 0 FRICTION 10개에 더해 Phase 1 신규 마찰을 누적해야 한다. 특히 `gsd-tools.cjs` (gsd-sdk 부재) 우회 패턴이 commit / state.record-session 등 부수 효과 명령에서도 잘 동작하는지 확인 필요.

</specifics>

<deferred>
## Deferred Ideas

### Phase 2로 이월

- **5-key approval gate UI prototype** — Phase 1 services.yaml 보강 단계에 dogfood 적용 가능했으나 D-12.3가 plain mv + git commit 채택 (Phase 2 boundary 보호).
- **state/ git-versioned audit trail (AUDIT-02)** — Phase 1은 SQLite event log만 (D-14). Phase 2에서 applyPatch 시점에 state/ git commit 추가.
- **proposePatch / applyPatch / state/ pre-commit hook (APPLY-*)** — Phase 2 boundary.

### plan-phase 결정 (Claude's Discretion 재출력)

- 8h 예산 내부 wave/plan split
- system prompt 본문 (envelope 인용 규칙 + few-shot)
- 추가 검증 NL 쿼리 (Success Criteria 외)
- LOOP-07 idempotency_key 컬럼 추가 시점
- history compaction 정확한 토큰 카운팅 방법
- Phase 1 FRICTION carry-over 위치 (`.planning/phases/01-*/FRICTION.md` 신설 추천)

### Future milestones (v2)

- **`unmatched_containers` RAG 인덱싱** — D-12.4. v2 OSS 공개 시 stacks/* 추가 필드 허용 검토.
- **`voyage-3.5` 또는 `voyage-4-large` 업그레이드** — Phase 1 baseline sim=0.6308이 retrieval 품질 부족 시 (sim<0.5 fallback). 같은 embedding space (Voyage 4 family) 이므로 재인덱싱만으로 마이그레이션.
- **multi-host (MULTI-01)** / **kb auto-sync (KB-AUTO-01)** / **NOTIFY-01 Discord** / **OSS-01** — REQUIREMENTS v2.

### Reviewed Todos (not folded)

(없음 — `.todos/backlog.json` 미사용)

</deferred>

---

*Phase: 1-Read-Only Knowledge Layer*
*Context gathered: 2026-05-06*
