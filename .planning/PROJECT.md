# gons-works — AI Operator Copilot for 192.168.0.5

## What This Is

192.168.0.5 운영서버에 누적된 6-10개 Docker Compose 스택을 1인 운영자가 관리하기 위한 **AI operator copilot**. 대시보드 UI가 아니라 **터미널 같은 대화 인터페이스 + git-versioned `state/` 디렉토리**가 제품. AI가 내 환경의 도메인 지식(`services.yaml`)을 알고 있고, 모든 액션이 git 커밋이 되어 `git log`가 운영 일지·감사 추적·재현 도구가 동시에 된다.

## Core Value

**AI가 내 운영 환경의 도메인 지식을 알고 있고, 모든 운영 액션이 git-versioned audit trail이 된다.** "AI가 단추 누르는 대시보드"가 아니라 "AI가 내 환경을 *기억*하고 모든 변경이 추적되는 대화형 터미널".

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] **services.yaml knowledge layer** — 5 핵심 stack(news/ais/n8n/open-webui/krdn-fx) 도메인 지식 RAG
- [ ] **Read-only operator queries** — "ais-prod redis 어디 쓰여?" 같은 질문에 services.yaml + 라이브 docker 결합 답변
- [ ] **Live log query** — "지난밤 새벽 1-3시 voice 에러" 같은 질문에 라이브 로그 200줄 + 요약
- [ ] **state-as-git audit trail** — 모든 AI 액션이 `state/` 디렉토리 git commit 으로 기록 (커밋 메시지에 user prompt + AI reasoning)
- [ ] **proposePatch/applyPatch with approval gate** — unified diff 표시 → y/n/edit/diff/abort 5-key → state/ commit + Docker 명령 실행 + 실패 시 rollback
- [ ] **htmx UI** — 한 줄 입력 + SSE 스트리밍 응답 + 5-key 승인
- [ ] **services.yaml staleness detection** — `docker ps` vs yaml 차이 감지, header warning
- [ ] **Error envelope { problem, cause, fix }** — 모든 tool wrapper try-catch + 일관 shape
- [ ] **Log sanitization for prompt injection prevention** — RAG 인덱싱 전 SECRET/KEY/PASSWORD 라인 제거
- [ ] **dogfood meta-objective** — 통합 파이프라인(`/office-hours` → `/autoplan` → `/gsd-new-project --auto` → `/gsd-execute-phase`) 첫 검증

### Out of Scope

- **멀티유저 / 인증** — 1인 단일 호스트 도구. SaaS 일반화는 비-목표.
- **Next.js / React FSD UI** — htmx + plain HTML로 충분. 평소 stack과 거리 있지만 16h 주말 minimum viable에 부합.
- **Postgres 이벤트 스토어** — SQLite로 시작. 필요해지면 Phase 2.5 이후 마이그레이션.
- **k8s / 멀티 호스트** — 192.168.0.5 단일 호스트 우선. 추후 milestone.
- **메트릭 그래프 / 대시보드 UI** — Beszel/Dozzle이 50% 해결, 직접 만들 50%는 knowledge + state-as-git이지 시각화가 아님.
- **OAuth / Magic link** — 인증 없음 (1인 사용).
- **OpenWebUI 경유 LLM** — 첫 milestone에서 OpenWebUI를 LLM 백엔드로 두지 않음 (streaming/tool-use 호환성 손실, OpenAI-호환 변환에서 Anthropic native event lossy). 다만 cli-proxy-api(192.168.0.5:8317) 경유는 별개 — Anthropic native protocol을 1:1 보존하므로 D-09로 채택됨.

## Context

- **운영 환경:** Ubuntu 24.04.4 LTS Server (192.168.0.5). Docker Compose 6-10 스택 (news-prod, ais-prod, voice, krdn-fx, n8n, open-webui, ai-afterschool-fsd-web 등).
- **개발 환경:** Ubuntu 24.04.4 Desktop (192.168.0.8). Bun 1.x + Hono 런타임 예정.
- **기존 자산:** Docker contexts (`dlocal`/`dserver`), Claude API key, SSH 액세스, 기존 docker-compose 파일.
- **운영 부담의 핵심 3가지:** (1) 컨텍스트 손실 — `ais-prod redis 메모리가 왜 늘었는지` 매번 재구성, (2) 상태 변경 추적 부재 — 액션이 어디에도 안 남음, (3) 반복 명령 — 평일 9-15시만 띄울 서비스 같은 운영 규칙 매번 다시 작성.
- **기존 도구 한계:** Portainer / Dockge / Beszel / Dozzle / k8sgpt / Robusta 등은 (1) "내 도메인 컨텍스트"를 모름. 일반화된 SaaS이기 때문.
- **크로스 모델 인사이트:** 차별화 축은 *"AI knows my environment"* — controls 가 아니라 knows. 근육 만들기 전에 기억부터 만들어라. 50% 시작점은 Dozzle + Beszel, 직접 만들 50%는 services.yaml RAG + tool-use bridge + state-as-git.
- **dogfood 메타-목적:** 이 빌드의 매 phase가 통합 파이프라인의 처음 검증 사례. 마찰을 메모해서 `~/.claude/plans/gstack-gsd-melodic-raven.md` 다음 개정판 입력으로 사용.

## Constraints

- **Tech stack**: Bun 1.x + Hono + SQLite + Claude API + plain HTML/htmx — 1인 minimum viable. React/FSD/Next.js 비사용.
- **Timeline**: 주말 16시간 첫 출시. Phase 0(1-2h) + Phase 1(8h) + Phase 2(8h) ≤ 18시간. dogfood 메타-목적이 늦어지면 통합 파이프라인 검증도 늦어짐.
- **Boundary**: 192.168.0.8 (copilot 런타임) — SSH/docker context — 192.168.0.5 (managed services). 코파일럿 자체는 192.168.0.8 로컬 실행.
- **Security**: PROD 절대 조작 금지 (E2E 테스트는 192.168.0.8 로컬 test docker-compose 사용). state/ git은 fast-forward only.
- **LLM cost**: Phase 1 read-only는 Sonnet 4.6, Phase 2 propose/apply는 Opus 4-6 default (4-7은 외부 API 미공개 — D-10). model 선택은 환경변수로 추출. 기본 endpoint는 cli-proxy-api(192.168.0.5:8317) 경유로 Max plan OAuth 재사용 → 토큰 비용 0 (D-09). console.anthropic.com 직접 호출은 fallback path로 보존 (D-11).
- **Reuse**: Docker contexts (dlocal/dserver), Claude API key, 기존 docker-compose 파일, 192.168.0.5 SSH 인프라 그대로 활용.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Approach A (Minimal Viable htmx/Bun) 선택 | dogfood 우선 + 16h 주말 사이클로 통합 파이프라인 한 바퀴 검증 | — Pending |
| state/ 를 본 repo에 두고 별도 submodule 비-사용 | 첫 milestone 단순화, 추후 분리 가능 | — Pending |
| Claude API 호출 — cli-proxy-api(192.168.0.5:8317) 경유 (D-09) | Max plan OAuth 세션 재사용 → 토큰 비용 0. Anthropic native protocol 1:1 보존, SDK 변경 0. open-webui 경유는 여전히 Out of Scope (streaming/tool-use 호환성 손실) | ✓ Validated 2026-05-06 (chat / tool-use / streaming / model-echo 라이브 검증) |
| Phase 2 모델 = claude-opus-4-6 (D-10, 4-7 아님) | claude-opus-4-7은 외부 API 미공개 (proxy /v1/models + 외부 SDK 모두에 부재). 가용한 가장 최신 Opus가 4-6. 4-7 출시 시 .env 한 줄 변경 | ✓ Validated 2026-05-06 |
| Optional fallback (D-11) — ANTHROPIC_FALLBACK_BASE_URL/KEY로 console.anthropic.com 직접 path | 192.168.0.5 자기참조 회피 — proxy 다운 시(=운영 서버 진단 대상일 때) 코파일럿 self-kill 방지 | — Schema 정의됨 (Phase 0 09-PLAN), 통신 검증은 Phase 1 LLM 모듈 단계 |
| copilot 런타임은 192.168.0.8 로컬 | dserver context로 원격 제어가 가장 단순, SSH tunnel 불필요 | — Pending |
| 5 핵심 stack(news/ais/n8n/open-webui/krdn-fx)부터 services.yaml 작성 | 10개 전체 손작업은 2-4h 소비 → Phase 1 시간 폭발 | — Pending |
| Phase 0 신설 — AI가 docker ps로 services.yaml 초안 생성 | Phase 1 시간 예산 보호 + dogfood 메타-목적 강화 (autoplan 권고) | — Pending |
| LLM model 환경변수 추출 (Phase 1: Sonnet 4.6, Phase 2: Opus 4.7) | Phase 별 비용/정확도 trade-off | — Pending |
| Approval gate 5-key (y/n/e/d/a) | DX critical, escape hatch 필수 (autoplan 권고) | — Pending |
| Codex → Claude Haiku subagent 대체 (review 모든 phase) | 글로벌 CLAUDE.md "Codex CLI 사용 금지" 규칙 | ✓ Good (autoplan 검증) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-06 after initialization*
