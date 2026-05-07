# Requirements: gons-works — AI Operator Copilot

**Defined:** 2026-05-06
**Core Value:** AI가 내 운영 환경의 도메인 지식을 알고 있고, 모든 운영 액션이 git-versioned audit trail이 된다.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Bootstrap

- [ ] **BOOT-01**: 5개 Phase 0 spike (docker context / Voyage embed / SSE roundtrip / git commit / Zod v4 schema) 모두 통과해야 Phase 1 시작 가능
- [ ] **BOOT-02**: AI가 `docker --context dserver ps --format json` 출력을 읽고 5 핵심 stack(news/ais/n8n/open-webui/krdn-fx) services.yaml 초안 생성
- [ ] **BOOT-03**: services.yaml 초안이 `state/` 디렉토리에 첫 git commit으로 기록됨
- [ ] **BOOT-04**: 서버 startup에서 `docker context inspect dserver` 검증 — 실패 시 명시적 에러 메시지로 종료
- [ ] **BOOT-05**: `.env` 파일 검증 — `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `COPILOT_MODEL_READONLY`, `COPILOT_MODEL_PROPOSE` 존재 확인

### Knowledge Layer (services.yaml + RAG)

- [ ] **KB-01**: services.yaml의 각 stack 정보(목적/의존성/볼륨/정상 패턴/주요 로그 위치)가 Voyage AI `voyage-4-lite`로 임베딩되어 SQLite에 저장
- [ ] **KB-02**: 사용자 질문에 대해 cosine similarity top-k(k=5) 검색으로 관련 services.yaml 청크가 LLM 컨텍스트에 주입됨
- [ ] **KB-03**: services.yaml staleness detection — `docker ps` 결과 vs yaml 차이 감지, UI header에 warning 표시
- [ ] **KB-04**: 로그 sanitization — RAG 인덱싱 전 `SECRET|KEY|PASSWORD|TOKEN|BEARER` 패턴 라인 제거 (prompt injection 방지)

### Read-Only Operator Queries

- [ ] **READ-01**: `listContainers` tool — `docker --context dserver ps --format json` 호출 후 컨테이너 목록 반환
- [ ] **READ-02**: `readLogs` tool — 컨테이너 이름과 라인 수(기본 200, 최대 1000) 입력받아 sanitized 로그 반환
- [ ] **READ-03**: `readCompose` tool — `ssh gon@192.168.0.5 cat <compose-path>` 호출로 docker-compose.yml 내용 반환
- [ ] **READ-04**: 자연어 질문 → AI tool-use loop → tool 결과 grounded 답변 (예: "ais-prod redis 어디 쓰여?" → services.yaml + `docker ps` 결합 답변)
- [ ] **READ-05**: 라이브 로그 시간대 질문 (예: "지난밤 새벽 1-3시 voice 에러 패턴") → readLogs + 요약 답변

### Streaming UI (htmx + SSE)

- [ ] **UI-01**: 한 줄 입력 form + SSE 스트리밍 응답 (htmx 2.x + `htmx-ext-sse@2.2.4`)
- [ ] **UI-02**: Named SSE 이벤트 (`text-delta` / `tool-start` / `tool-result` / `final` / `error`) — htmx `sse-swap`이 이벤트별 처리
- [ ] **UI-03**: 각 tool call이 스트림에 가시화 ("calling listContainers..." → 결과 chunk → 계속)
- [ ] **UI-04**: services.yaml drift warning이 UI header에 표시됨 (KB-03 연결)

### Agent Loop

- [ ] **LOOP-01**: `agent/loop.ts` — Claude tool-use 루프 (HTTP-agnostic, 단위 테스트 가능)
- [ ] **LOOP-02**: 모든 tool wrapper가 공통 error envelope `{ problem, cause, fix, retryable }` 반환 (`tools/_envelope.ts`)
- [ ] **LOOP-03**: Hard caps — `MAX_TOOL_ITERATIONS=8`/loop, `MAX_API_CALLS_PER_SESSION=30` (cost runaway 방지)
- [ ] **LOOP-04**: 모든 `tool_use` 블록이 다음 API call 전에 `tool_result`와 짝지어짐 (orphan 방지)
- [ ] **LOOP-05**: 대화 토큰 50K 임계 도달 시 history compaction (system + 마지막 6 exchanges 유지)
- [ ] **LOOP-06**: 30초 tool timeout + 60초 stream chunk timeout (SSE leak 방지)
- [ ] **LOOP-07**: SSE 재연결 시 idempotency token으로 중복 Claude API call 방지

### Propose / Apply with Approval Gate

- [ ] **APPLY-01**: `proposePatch` tool — unified diff 생성 (jsdiff `createPatch()`), 실제 적용 안 함
- [ ] **APPLY-02**: 승인 게이트 5-key 입력 (`y` apply, `n` reject, `e` edit, `d` show diff, `a` abort) — UI에 inline legend 항상 표시
- [ ] **APPLY-03**: 승인 nonce 생성 + 2분 만료 + `consumed` 플래그 atomic set — race condition 방지
- [ ] **APPLY-04**: `applyPatch` 2-phase commit — (1) docker exec on remote → (2) `state/` git commit. (1) 실패 시 git commit 시도 안 함, (2) 실패 시 `git revert <sha>` 롤백
- [ ] **APPLY-05**: Crash window 보호 — pending marker 파일 작성, 서버 재기동 시 detect → 사용자에게 경고
- [ ] **APPLY-06**: 커밋 메시지 본문에 user prompt + AI reasoning 포함 (sanitization 후, shell metachar escape, `--` 분리자 사용, newline strip, 500자 cap)
- [ ] **APPLY-07**: `state/` git 저장소는 fast-forward only (pre-commit hook), 동시 쓰기 보호
- [ ] **APPLY-08**: Phase 2 LLM은 Opus 4.7 (`COPILOT_MODEL_PROPOSE` 환경변수)

### Audit Trail

- [ ] **AUDIT-01**: 모든 read 도구 호출도 `state/` 또는 SQLite event log에 기록 (Phase 1: SQLite 우선, Phase 2: state/ git commit 가능)
- [ ] **AUDIT-02**: `git log state/`만으로 지난주 변경 이력 추적 가능 — 각 commit이 1 user prompt + AI 액션 + 결과 요약
- [ ] **AUDIT-03**: SQLite event log에 timestamp, model, token usage, tool call 횟수 저장 (cost 모니터링)

### Dogfood Meta

- [ ] **DOG-01**: 통합 파이프라인 (`/office-hours` → `/autoplan` → `/gsd-new-project --auto` → `/gsd-execute-phase`)이 이 design doc을 입력으로 받아 `.planning/` 구조 + Phase 0/1/2 plan을 정상 생성
- [ ] **DOG-02**: 각 단계의 마찰을 메모하여 `~/.claude/plans/gstack-gsd-melodic-raven.md` 다음 개정판 입력으로 사용 (현재까지 마찰: gsd-sdk → gsd-tools 명령 mismatch, sonnet 4 parallel rate limit, subagent Write 차단 등)
- [ ] **DOG-03**: `/ship`으로 GitHub PR 생성까지 매끄럽게 흘러감

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Phase 2.5+ (Future Milestone)

- **MULTI-01**: 멀티 호스트 지원 (현재 192.168.0.5만)
- **KB-AUTO-01**: services.yaml 자동 동기화 (drift 감지 → AI가 자동 갱신 제안)
- **NOTIFY-01**: applyPatch 실패 시 Discord webhook 알림 (10줄 추가, low-cost high-value, fast-follow 후보)
- **OSS-01**: services.yaml 추상화 + LLM provider 추상화 후 별도 repo로 분리해 OSS 공개
- **STATE-SUB-01**: `state/`를 별도 `homelab-state` repo로 분리해 submodule로 관리
- **PROVIDER-01**: open-webui 경유 LLM 호출 fallback 옵션 (현재 Claude API 직접만)
- **STORAGE-01**: SQLite → Postgres 마이그레이션 (이벤트 스토어 확장 시)
- **APPROVAL-MOBILE-01**: 5-key를 키보드 단축키 + 클릭 가능 htmx 버튼 동시 렌더링 (모바일 브라우저 접근)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| 멀티유저 / 인증 / OAuth / Magic link | 1인 단일 호스트 도구. SaaS 일반화는 비-목표. |
| Next.js / React FSD UI | htmx + plain HTML로 충분. 평소 stack과 거리 있지만 16h 주말 minimum viable에 부합. |
| Postgres 이벤트 스토어 (Phase 1-2) | SQLite로 시작. Phase 2.5+ 마이그레이션 옵션. |
| k8s / 멀티 호스트 (Phase 1-2) | 192.168.0.5 단일 호스트 우선. |
| 메트릭 그래프 / 대시보드 UI | Beszel/Dozzle이 50% 해결, 차별화 축은 knowledge + state-as-git이지 시각화가 아님. |
| OpenWebUI 경유 LLM (Phase 1-2) | 첫 milestone는 Claude API 직접 호출. |
| TSDB / Prometheus 통합 | 다른 제품 영역. |
| PagerDuty / 알림 라우팅 | 1인 사용자, 본인이 보면 됨. |
| 모바일 전용 UI | htmx는 자체적으로 responsive. |
| dockerode 라이브러리 사용 | dockerode는 Docker named context 미지원. `Bun.$ docker --context dserver` shell-out 사용. |
| `zod-to-json-schema` 패키지 | Zod v4와 호환 안 됨. v4 내장 `z.toJSONSchema()` 사용. |
| Anthropic 자체 embedding API | 존재하지 않음. Voyage AI `voyage-4-lite` 사용. |
| htmx 1.x | 2.x 사용 (`htmx-ext-sse@2.2.4` 별도). |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BOOT-01 | Phase 0 | ✅ Complete |
| BOOT-02 | Phase 0 | ✅ Complete |
| BOOT-03 | Phase 0 | ✅ Complete |
| BOOT-04 | Phase 0 | ✅ Complete |
| BOOT-05 | Phase 0 | ✅ Complete |
| KB-01 | Phase 1 | ✅ Complete |
| KB-02 | Phase 1 | ✅ Complete |
| KB-03 | Phase 1 | ✅ Complete |
| KB-04 | Phase 1 | ✅ Complete |
| READ-01 | Phase 1 | ✅ Complete |
| READ-02 | Phase 1 | ✅ Complete |
| READ-03 | Phase 1 | ✅ Complete |
| READ-04 | Phase 1 | ✅ Complete |
| READ-05 | Phase 1 | ✅ Complete |
| UI-01 | Phase 1 | ✅ Complete |
| UI-02 | Phase 1 | ✅ Complete |
| UI-03 | Phase 1 | ✅ Complete |
| UI-04 | Phase 1 | ✅ Complete |
| LOOP-01 | Phase 1 | ✅ Complete |
| LOOP-02 | Phase 1 | ✅ Complete |
| LOOP-03 | Phase 1 | ✅ Complete |
| LOOP-04 | Phase 1 | ✅ Complete |
| LOOP-05 | Phase 1 | ✅ Complete |
| LOOP-06 | Phase 1 | ✅ Complete |
| LOOP-07 | Phase 1 | ✅ Complete |
| APPLY-01 | Phase 2 | ✅ Complete |
| APPLY-02 | Phase 2 | ✅ Complete |
| APPLY-03 | Phase 2 | ✅ Complete |
| APPLY-04 | Phase 2 | ✅ Complete |
| APPLY-05 | Phase 2 | ✅ Complete |
| APPLY-06 | Phase 2 | ✅ Complete |
| APPLY-07 | Phase 2 | ✅ Complete |
| APPLY-08 | Phase 2 | ✅ Complete |
| AUDIT-01 | Phase 1 | ✅ Complete |
| AUDIT-02 | Phase 2 | ✅ Complete |
| AUDIT-03 | Phase 1 | ✅ Complete |
| DOG-01 | Phase 0 | ✅ Complete |
| DOG-02 | Phase 0-2 | ✅ Complete |
| DOG-03 | Phase 2 | ✅ Complete |

**Coverage:**
- v1 requirements: 39 total
- Mapped to phases: 39
- Unmapped: 0 ✓
- **Status: 39/39 Complete ✅ (v1 milestone closed 2026-05-08)**

---
*Requirements defined: 2026-05-06*
*Last updated: 2026-05-08 — v1 milestone closure: all 39 requirements marked Complete, v2 항목 8건은 deferred (별도 milestone)*
