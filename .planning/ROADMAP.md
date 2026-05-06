# Roadmap: gons-works — AI Operator Copilot

## Overview

gons-works는 192.168.0.5 홈서버의 6-10개 Docker Compose 스택을 1인 운영자가 관리하기 위한 AI 코파일럿이다. Phase 0(1-2h)에서 5개 스파이크로 기술 리스크를 전부 처리하고 services.yaml 초안을 생성한다. Phase 1(8h)에서 read-only 지식 레이어 + streaming UI를 완성해 운영자가 자연어로 라이브 환경을 물어볼 수 있게 한다. Phase 2(8h)에서 proposePatch/applyPatch + 승인 게이트로 실제 변경을 원자적으로 처리하고 모든 액션을 git-versioned audit trail로 만든다. 총 ≤18h, 주말 1사이클 내 출시.

## Phases

**Phase Numbering:**
- Integer phases (0, 1, 2): Planned milestone work
- Decimal phases: Urgent insertions only (INSERTED marker)

- [x] **Phase 0: Bootstrap & Spikes** - 6/6 spike GREEN + services.yaml 초안 + state/ 첫 commit (2026-05-06 완료, ~2.3h)
- [ ] **Phase 1: Read-Only Knowledge Layer** - AI가 services.yaml + 라이브 docker 상태로 자연어 질의에 스트리밍 답변 (≤8h)
- [ ] **Phase 2: Propose/Apply with Approval Gate** - 2PC patch + 5-key 승인 게이트 + git-versioned audit trail 완성 (≤8h)

## Phase Details

### Phase 0: Bootstrap & Spikes
**Goal**: 6개 기술 스파이크(Spike 6 = SDK + cli-proxy-api 검증 추가)가 모두 green이고, 서버 라이브 상태에서 생성된 services.yaml이 `state/` 첫 git commit으로 기록됨
**Depends on**: Nothing (first phase)
**Requirements**: BOOT-01, BOOT-02, BOOT-03, BOOT-04, BOOT-05, DOG-01
**Time budget**: ≤2h (overage requires explicit user discussion before proceeding to Phase 1)
**Success Criteria** (what must be TRUE):
  1. `docker --context dserver ps --format json` 출력이 파싱 가능한 컨테이너 배열로 반환됨 (Spike 1 green)
  2. Voyage AI `voyage-4-lite` 임베딩 벡터가 반환되고 cosine 검색이 올바른 청크를 찾음 (Spike 2 green)
  3. `streamSSE` → htmx-ext-sse 경로로 브라우저가 `text-delta` 이벤트를 실시간 수신함 (Spike 3 green)
  4. `Bun.$` git commit이 `state/` 안에 body 포함 커밋으로 기록됨 (Spike 4 green)
  5. `z.toJSONSchema(schema)` 출력이 Claude `input_schema` 형태와 일치함 (Spike 5 green)
  6. `@anthropic-ai/sdk` + `baseURL` override로 cli-proxy-api(192.168.0.5:8317) 경유 chat / tool-use / streaming / model-echo 4가지 모두 동작 (Spike 6 green, D-09/D-10/D-11)
  7. `services.yaml` 초안(5 핵심 stack: news/ais/n8n/open-webui/krdn-fx)이 `state/` 디렉토리 첫 git commit으로 기록됨
  8. `bun run dev` 실행 시 `dserver` context unreachable 또는 `.env` 필수 키(`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `COPILOT_MODEL_READONLY`, `COPILOT_MODEL_PROPOSE`) 누락 시 명시적 에러 메시지로 즉시 종료됨
**Plans**: 8 plans across 4 waves

**Wave 1** *(no dependencies, parallel)*
- `00-01-PLAN.md` — Bun 프로젝트 init + .env Zod schema + bun:test 설정 (BOOT-04, BOOT-05)
- `00-02-PLAN.md` — state/ 디렉토리 init + Spike 4 (Bun.$ git commit)

**Wave 2** *(blocked on 00-01)*
- `00-03-PLAN.md` — Spike 1 (Bun.$ docker --context dserver ps)
- `00-04-PLAN.md` — Spike 2 (Voyage AI voyage-4-lite embedding)
- `00-05-PLAN.md` — Spike 3 (Hono streamSSE → htmx-ext-sse)
- `00-06-PLAN.md` — Spike 5 (Zod v4 z.toJSONSchema)

**Wave 3** *(blocked on 00-02 + 00-03)*
- `00-07-PLAN.md` — services.yaml 초안 + state/ 첫 git commit (BOOT-02, BOOT-03)

**Wave 4** *(blocked on Wave 1-3 completion)*
- `00-08-PLAN.md` — Phase 0 검증 + DOG-01/DOG-02 dogfood 마찰 정리

**Wave 2 (continued)**
- `00-09-PLAN.md` — Spike 6 (Anthropic SDK + cli-proxy-api roundtrip + fallback) — D-09/D-10/D-11 검증

**Cross-cutting constraints:**
- D-01: Spike 코드는 모두 `spikes/` 임시 디렉토리에 격리 (적용: 02, 03, 04, 05, 09)
- D-02: No partial pass — 6/6 spike green 강제 (적용: 03, 04, 09, 08)
- D-04: state/ 메인 repo 서브디렉토리 (적용: 02, 07)
- D-09: cli-proxy-api 경유가 LLM 기본 endpoint (적용: 01, 09)
- D-10: Phase 2 모델 = `claude-opus-4-6` (적용: 01, 09)
- D-11: optional fallback schema (적용: 01, 09)
- DESIGN.md correction #1-#5: 모든 plan에서 spec lock 인용

---

#### Critical Research Corrections (Phase 0 Blockers)

다음 5가지 연구 교정 사항은 Phase 0 스파이크를 통해 검증된다. 이를 위반하는 Phase 1 구현은 무효다.

| # | 잘못된 주장 (출처) | 수정 사항 | 영향 |
|---|-----------------|-----------|------|
| 1 | "Claude Haiku embedding 사용" (DESIGN.md Issue #10) | **Anthropic에 embedding endpoint가 없음.** Voyage AI `voyage-4-lite` (`voyageai@0.2.1`) 사용. Spike 2가 이를 검증함. | Phase 1 RAG 구현 전체가 바뀜 |
| 2 | "dockerode for container control" (DESIGN.md 암묵적 가정) | dockerode는 Docker named context(`dserver`) 미지원. `Bun.$ \`docker --context dserver ...\`` 사용. | Phase 1 tool 구현 방식 |
| 3 | `zod-to-json-schema` 패키지 사용 (암묵적 가정) | Zod v4와 호환 안 됨. v4 내장 `z.toJSONSchema(schema)` 사용. Spike 5가 이를 검증함. | Phase 1 agent loop tool schema 생성 |
| 4 | htmx 2.x에 SSE 내장 (암묵적 가정) | htmx 2.x core에서 SSE 제거됨. `htmx-ext-sse@2.2.4` 별도 로드 필요. Spike 3이 이를 검증함. | Phase 1 UI 스트리밍 |
| 5 | "5-key approval gate is standard UX" (DESIGN.md) | `y/n/e/d/a`는 pre-trained muscle memory가 없는 custom UX. **모든 승인 프롬프트에 인라인 legend 필수.** | Phase 2 UX — legend는 옵션이 아님 |

> **Note on Correction #1 (DESIGN.md issue #10):** DESIGN.md는 Anthropic embedding API를 사용한다고 명시했으나 해당 API는 존재하지 않는다. PROJECT.md Key Decisions 및 STACK.md는 이미 `voyage-4-lite`로 반영되어 있다. Phase 0 Spike 2가 이 대체 동작을 검증한다.

---

#### Phase 0 Spike List (Go/No-Go Gates)

6개 스파이크가 모두 green이어야 Phase 1이 시작된다. 리스크 순으로 정렬.

| 우선순위 | 스파이크 | 통과 기준 | 실패 경로 |
|---------|---------|----------|----------|
| 1 | `Bun.$ \`docker --context dserver ps --format json\`` | 에러 없이 컨테이너 배열로 파싱됨 | 원격 tool use 전체 차단 → SSH/context 설정 점검 필요 |
| 2 | Voyage AI `voyage-4-lite` embed roundtrip | 벡터 반환 + cosine 검색이 올바른 청크 반환 | 로컬 임베딩 모델(Ollama `nomic-embed`)로 전환 + 재조사 |
| 3 | `streamSSE` → htmx-ext-sse chunk delivery | 브라우저가 `text-delta` 이벤트를 실시간 수신 | SSE 이벤트 이름 mismatch 디버깅; `Content-Type: text/event-stream` 헤더 확인 |
| 4 | `Bun.$ \`git commit -m "msg" --allow-empty\`` in `state/` | `git log`에 body 포함 커밋 기록됨 | Bun 쉘 환경의 git config 점검 |
| 5 | `z.toJSONSchema(schema)` Zod v4 | 출력이 Claude `input_schema` 형태와 일치 | Zod v3 fallback은 강제 시에만 사용; 수동 schema 문서화 |
| 6 | `@anthropic-ai/sdk` + `baseURL=http://192.168.0.5:8317` (D-09) chat / tool-use / streaming / model-echo + fallback retry policy (D-11) | 4가지 SDK 검증 모두 PASS + `claude-opus-4-6` (D-10) 응답 + fallback 단위 테스트 5/5 pass | proxy 다운 → console.anthropic.com 직접 키로 임시 swap; SDK 호환성 issue → STACK.md SDK 버전 lock 재검토 |

> **Spike 1 주의사항:** 이 스파이크는 "dockerode가 동작하는가"가 아니라 "Bun 쉘 환경에서 `Bun.$` + `--context dserver`가 원격 Docker 데몬을 안정적으로 resolve하는가"를 검증한다.

---

### Phase 1: Read-Only Knowledge Layer
**Goal**: 운영자가 자연어로 라이브 컨테이너 환경에 대해 질문하면 services.yaml 지식 + 실시간 docker 상태를 결합한 스트리밍 답변을 받음
**Depends on**: Phase 0 (all 5 spikes green)
**Requirements**: KB-01, KB-02, KB-03, KB-04, READ-01, READ-02, READ-03, READ-04, READ-05, UI-01, UI-02, UI-03, UI-04, LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06, LOOP-07, AUDIT-01, AUDIT-03
**Time budget**: ≤8h (overage requires explicit user discussion before proceeding to Phase 2)
**Success Criteria** (what must be TRUE):
  1. 운영자가 "ais-prod redis 어디 쓰여?" 를 입력하면 services.yaml RAG + `docker ps` 결합 답변이 브라우저에 스트리밍으로 표시됨
  2. 운영자가 "지난밤 새벽 1-3시 voice 에러 패턴" 을 입력하면 라이브 로그 요약 답변이 반환됨
  3. services.yaml과 실제 `docker ps` 결과가 다를 때 UI header에 drift warning이 표시됨
  4. `curl` 쿼리 후 SQLite event log에 timestamp + model + tool call 횟수가 기록됨
  5. tool iteration 8회 초과 또는 세션당 API call 30회 초과 시 루프가 hard cap으로 종료됨
**Plans**: TBD
**UI hint**: yes

---

### Phase 2: Propose/Apply with Approval Gate
**Goal**: AI가 Docker Compose 변경을 unified diff로 제안하고 운영자가 5-key 게이트로 승인하면 원자적 2PC로 적용되며 AI reasoning이 포함된 git commit이 생성됨
**Depends on**: Phase 1
**Requirements**: APPLY-01, APPLY-02, APPLY-03, APPLY-04, APPLY-05, APPLY-06, APPLY-07, APPLY-08, AUDIT-02, DOG-03
**Time budget**: ≤8h (overage requires explicit user discussion)
**Success Criteria** (what must be TRUE):
  1. `proposePatch` 실행 시 unified diff가 표시되고 화면에 `y=apply  n=reject  e=edit  d=diff  a=abort` 인라인 legend가 항상 보임
  2. 운영자가 `y`를 입력하면 docker exec이 먼저 실행되고 성공 후에만 `state/` git commit이 생성됨 (2PC 순서 검증 가능)
  3. docker 적용이 실패하면 git commit이 생성되지 않고 이전 상태로 롤백됨
  4. `git log state/` 각 커밋 body에 user prompt + AI reasoning이 포함되어 한 줄로 변경 이력 추적 가능
  5. `/ship` 실행으로 GitHub PR이 생성됨 (dogfood meta 검증)
**Plans**: TBD
**UI hint**: yes

---

#### DOG-02: Cross-Phase Dogfood Friction Memo

**DOG-02**는 유일한 cross-phase 요구사항이다 (Traceability: `Phase 0-2`). 이 프로젝트 자체가 통합 파이프라인(`/office-hours` → `/autoplan` → `/gsd-new-project --auto` → `/gsd-execute-phase`)의 첫 검증 사례이므로, 각 phase 실행 중 발생하는 마찰(tool mismatch, rate limit, subagent 제한 등)을 메모해 `~/.claude/plans/gstack-gsd-melodic-raven.md` 다음 개정판 입력으로 사용한다.

현재까지 기록된 마찰:
- gsd-sdk → gsd-tools 명령 mismatch
- sonnet 4 parallel rate limit
- subagent Write 차단

이 메모는 "exactly one phase" 규칙의 유일한 의도적 예외다. DOG-02는 특정 phase에 귀속되지 않고 프로젝트 전체에 걸쳐 지속된다.

## Progress

**Execution Order:** 0 → 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Bootstrap & Spikes | 9/9 | ✅ Complete (6/6 spike GREEN) | 2026-05-06 |
| 1. Read-Only Knowledge Layer | 0/TBD | Not started | - |
| 2. Propose/Apply with Approval Gate | 0/TBD | Not started | - |
