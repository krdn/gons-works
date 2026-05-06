# Phase 0: Bootstrap & Spikes - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Mode:** `--auto` (Claude selected recommended options; auto-advance to plan-phase)

<domain>
## Phase Boundary

Phase 0은 두 가지를 동시에 처리한다:

1. **5개 Go/No-Go Spike** — Phase 1/2의 모든 기술 가정을 사전 검증한다. 5개 모두 green이어야 Phase 1 시작 가능.
   - Spike 1: `Bun.$ \`docker --context dserver ps --format json\`` 원격 컨테이너 enumeration
   - Spike 2: Voyage AI `voyage-4-lite` embedding roundtrip + cosine 검색
   - Spike 3: `streamSSE` (hono) → `htmx-ext-sse@2.2.4` 브라우저 chunk delivery
   - Spike 4: `Bun.$ \`git commit --allow-empty\`` (state/ 디렉토리)
   - Spike 5: `z.toJSONSchema(schema)` Zod v4 → Claude `input_schema` 호환

2. **services.yaml 초안 생성** — AI가 라이브 `docker --context dserver ps --format json` 출력을 읽고 5 핵심 stack(news / ais / n8n / open-webui / krdn-fx)에 대한 services.yaml 초안 생성, `state/` 디렉토리 첫 git commit으로 기록.

**시간 예산:** ≤2h (초과 시 Phase 1로 진행 전 명시적 사용자 논의 필요)

**스코프 밖 (다른 phase):**
- 실제 RAG 인덱싱 / cosine top-k 검색 (Phase 1 KB-01, KB-02)
- AI tool-use loop / agent/loop.ts (Phase 1 LOOP-*)
- Hono 서버 / SSE 라우터 / htmx UI 풀 빌드 (Phase 1)
- proposePatch / applyPatch / 5-key 승인 게이트 (Phase 2)

</domain>

<decisions>
## Implementation Decisions

### Spike 실행 환경 — `state/` 디렉토리 격리 vs 메인 repo 통합

- **D-01:** Spike는 모두 메인 repo 안에서 실행하되, **`spikes/` 임시 디렉토리**에 격리된 단발성 스크립트로 작성한다. 각 spike는 `bun run spikes/01-docker-context.ts` 형태로 독립 실행 가능. 메인 코드(`src/`, `state/`)와 디렉토리 분리 → green pass 후 spike 코드 삭제(또는 `state/`에 결과만 commit).
  - **Why:** 메인 코드 구조를 spike가 오염시키지 않음. 각 spike가 독립 검증 단위라는 원칙 유지. `state/`는 services.yaml 산출물 전용으로 깨끗하게 시작.
  - **How to apply:** `gsd-plan-phase`에서 spike별 plan 파일을 만들 때 출력 위치를 `spikes/0X-*.ts`로 잡는다. 스파이크 후 cleanup task 추가.

### Spike 실패 처리 — 부분 통과 시 Phase 1 진행 가능 여부

- **D-02:** **No partial pass.** 5개 spike 모두 green이어야 Phase 1 진행. 하나라도 실패하면 ROADMAP.md `failure_path` 컬럼의 fallback을 따른다 (예: Spike 2 실패 → 로컬 임베딩 모델 Ollama `nomic-embed`로 전환 + 재조사).
  - **Why:** Phase 0의 존재 이유는 "Phase 1에서 발견될 risk를 사전에 처리"하는 것. 부분 통과로 진행하면 Phase 1 시간 예산이 폭발한다.
  - **How to apply:** `verify_phase` 단계에서 spike 5개 모두 green인지 자동 확인. 한 개라도 red면 Phase 0 미완료 처리.

### services.yaml 초안 자동 생성 vs 수동 작성

- **D-03:** **AI 자동 생성, 사용자 수동 review/edit.** Spike 1 통과 후 `bun run scripts/draft-services-yaml.ts`가 `docker --context dserver ps --format json` 출력을 파싱해 5 핵심 stack에 대한 services.yaml 초안을 작성한다. 사용자는 출력을 검토 후 누락된 의존성/볼륨/정상 패턴/주요 로그 위치를 손으로 보강하고, `state/` 첫 git commit으로 기록.
  - **Why:** 10개 stack 전체를 손으로 작성하면 2-4h 소요 → Phase 1 시간 예산 폭발 (이게 Phase 0이 신설된 직접적 이유). AI 초안 + 인간 review가 시간/품질 trade-off의 sweet spot.
  - **How to apply:** Phase 0 plan에 (1) draft 스크립트 작성, (2) AI 실행 후 수동 review checklist, (3) `state/` 첫 commit 단계를 분리해서 task로 둔다.

### `state/` 디렉토리 init — 별도 submodule vs 메인 repo

- **D-04:** **메인 repo 안의 `state/` 서브디렉토리.** 별도 git submodule이나 별 repo로 분리하지 않는다. PROJECT.md Key Decisions에 이미 lock되어 있음.
  - **Why:** 첫 milestone 단순화. 추후 분리 옵션은 v2 STATE-SUB-01에 보존.
  - **How to apply:** `state/` 디렉토리를 `git init` 없이 메인 repo의 일부로 둔다. fast-forward only enforcement는 pre-commit hook으로 (Phase 2 APPLY-07 범위, Phase 0에서는 디렉토리만 만든다).

### 환경변수 검증 시점 — Phase 0 vs Phase 1

- **D-05:** **Phase 0에서 `.env` schema 검증 + startup guard 둘 다 작성한다.** BOOT-04, BOOT-05 요구사항. `Bun.env.ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `COPILOT_MODEL_READONLY`, `COPILOT_MODEL_PROPOSE` 4개 키와 `docker context inspect dserver` 검증을 spike와 함께 이번 phase에서 처리.
  - **Why:** Phase 1 첫 코드 실행에서 `.env` 누락 발견하면 디버깅 시간 낭비. Phase 0의 "기반 설정"이라는 boundary에 명확히 부합.
  - **How to apply:** `src/config.ts` 또는 `src/env.ts`에 Zod v4 schema로 정의. `bun run dev` 진입점에서 가장 먼저 실행. 키 누락 시 `{ problem, cause, fix }` envelope로 종료.

### Spike 5 (Zod schema) 검증 범위 — 1개 스키마 vs 5개 tool 스키마 모두

- **D-06:** **1개 대표 스키마(`listContainers` input)로 검증.** Phase 0 spike는 "Zod v4 → Claude `input_schema` 변환이 동작하는가"를 보는 것이지, 5개 tool 모두 미리 정의하는 게 아니다. 나머지 4개는 Phase 1에서 actually tool wrapper 작성 시 함께 정의.
  - **Why:** Spike의 목적은 "기술 가정 검증"이지 "Phase 1 코드 미리 작성"이 아니다. Phase 0 시간 폭발 방지.
  - **How to apply:** `spikes/05-zod-schema.ts`에 단일 schema 정의 + `z.toJSONSchema()` 결과가 `{ type: "object", properties: {...}, required: [...] }` 형태인지 assert.

### Spike 3 (SSE) 검증 범위 — 더미 endpoint vs 실제 Hono 라우터

- **D-07:** **최소 Hono 서버 + 1개 더미 SSE endpoint.** "Hello world" 수준의 hono 앱에 `/sse-test` 라우터 1개를 두고, `streamSSE` 핸들러가 5개 더미 chunk를 보내고, `public/sse-test.html`이 `htmx-ext-sse` 로 chunk를 받아서 DOM에 표시되는지 확인. 실제 agent loop 연결은 Phase 1.
  - **Why:** "wire가 동작하는가"가 spike 목적. agent loop를 미리 만들면 Phase 0 boundary 초과.
  - **How to apply:** `spikes/03-sse-roundtrip/server.ts` + `spikes/03-sse-roundtrip/index.html` 2개 파일로 격리. 브라우저 수동 확인.

### Test framework — bun test vs 별도 Vitest

- **D-08:** **`bun:test` 사용.** Phase 0 spike는 일부는 통합/manual 검증이 필요하지만(SSE 브라우저 확인 등), automatable한 검증(docker context, embedding roundtrip, git commit, zod schema)은 `bun:test` 단위 테스트로 작성.
  - **Why:** STACK.md에 이미 `bun:test`가 lock되어 있음. Vitest/Jest 추가는 dependency 증가 + 16h 예산 위반.
  - **How to apply:** `spikes/*.test.ts` 형태로 작성. CI 없으니 manual `bun test spikes/`로 실행.

### Claude's Discretion

다음은 Claude가 plan 단계에서 결정할 영역으로 둠:
- spike별 정확한 파일 분할 (1 spike = 1 file vs 1 spike = 1 디렉토리)
- spike 실행 순서 (위 ROADMAP.md 우선순위 1→5 그대로 따를지, 의존성 별로 재정렬할지)
- `services.yaml` 초안 생성 스크립트의 정확한 출력 형태 (services.yaml schema 자체는 Phase 1 KB-01 범위)
- `.env.example` 작성 여부 (D-05의 `.env` 검증과는 별개로, .env.example template 제공이 dogfood meta에 도움될지)

### Folded Todos

(없음 — `.todos/backlog.json` 미사용)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### 프로젝트 정의 (반드시 우선 확인)

- `DESIGN.md` — 원본 설계 문서 (autoplan review를 거친 final 버전, 5개 critical correction 포함)
- `.planning/PROJECT.md` — Core Value, Constraints, Key Decisions, Out of Scope. 모든 phase의 SSOT.
- `.planning/REQUIREMENTS.md` — v1 39개 요구사항 + Traceability matrix. Phase 0은 BOOT-01~05, DOG-01 커버.
- `.planning/ROADMAP.md` — Phase 0 Spike List (우선순위 1-5) + Critical Research Corrections (5건)

### Phase 0 직접 인풋

- `.planning/research/STACK.md` — 패키지 버전 lock + 설치 커맨드. Spike 코드 작성 시 dependency 표.
- `.planning/research/ARCHITECTURE.md` — 시스템 구조 다이어그램. `state/`, `tools/`, `kb/` 디렉토리 레이아웃.
- `.planning/research/PITFALLS.md` — Critical pitfalls 목록 (특히 Spike 1의 `DOCKER_CONTEXT per-call drift`, Spike 4의 `git fast-forward enforcement`).
- `.planning/research/SUMMARY.md` — 5개 critical correction 표 + Phase 매핑. 모든 spike의 통과 기준 origin.
- `.planning/research/FEATURES.md` — Phase 0 feature scope 명시.

### 라이브 환경 검증 (Spike 1)

- `~/.claude/CLAUDE.md` "운영 서버 (192.168.0.5)" 섹션 — `dserver` Docker context 정의, `ssh gon@192.168.0.5` 액세스 정보. Spike 1이 이 context를 resolve하는지 확인.

### 외부 공식 문서 (Spike별)

- Bun shell `Bun.$` docs — Spike 1 + 4 (`https://bun.sh/docs/runtime/shell`)
- Hono streaming `streamSSE` docs — Spike 3 (`https://hono.dev/helpers/streaming`)
- htmx-ext-sse 2.2.4 README — Spike 3 (`https://github.com/bigskysoftware/htmx-extensions/tree/main/src/sse`)
- Voyage AI Python/TS SDK docs — Spike 2 (`https://docs.voyageai.com/`)
- Zod v4 `z.toJSONSchema()` docs — Spike 5 (`https://zod.dev/?id=tojsonschema`)
- Anthropic SDK `messages.stream()` docs — Spike 3 (간접) (`https://docs.anthropic.com/en/api/messages-streaming`)

### Dogfood 메타 (DOG-01, DOG-02)

- `~/.claude/plans/gstack-gsd-melodic-raven.md` — gstack/gsd 통합 설계. Phase 0의 마찰 메모 입력처.
- `CLAUDE.md` (프로젝트 루트) — 본 프로젝트의 gstack+gsd 라우팅 규칙.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **없음 (greenfield).** 현재 repo에는 `DESIGN.md`, `LICENSE`, `README.md`, `CLAUDE.md`만 있고 `package.json`도 없다. Phase 0의 첫 코드 작업이 `bun init -y` + dependency 설치다.

### Established Patterns

- **GSD `.planning/` 컨벤션** — 모든 phase 산출물은 `.planning/phases/NN-slug/`에 들어간다. Phase 0의 plan/research 결과물도 동일 위치.
- **GSD commit convention** — `docs(NN): <메시지>` (gsd-sdk를 쓰지 못해 manual commit 시에도 동일 컨벤션 유지). 코드 commit은 `feat(NN-spike-X): ...` 형태로 별도.
- **Korean response rule** — `~/.claude/rules/korean-response.md`. 모든 사용자 대면 출력은 한국어. 코드/주석은 한국어 주석 + 영문 식별자.

### Integration Points

- **`docker --context dserver`** — Spike 1과 Phase 1 모두의 진입점. `dlocal` (192.168.0.8 로컬), `dserver` (192.168.0.5 원격) 둘 다 이미 설정되어 있다 (사용자 환경 기성).
- **SSH `gon@192.168.0.5`** — Spike 4의 git commit은 로컬 (192.168.0.8) 메인 repo의 `state/`. 원격 SSH는 `readCompose` (Phase 1 READ-03)에서만 필요. Phase 0 범위 밖.
- **Bun runtime** — Bun 1.2+ 가 설치되어 있다고 가정 (검증은 spike 0 수준의 사전 확인). `bun --version`으로 확인.

</code_context>

<specifics>
## Specific Ideas

### 사용자가 명시적으로 강조한 결정들 (PROJECT.md / DESIGN.md / ROADMAP.md에서 lock됨)

- **`voyage-4-lite`**, NOT `voyage-3-lite`나 `voyage-3.5` (DESIGN.md correction #1, STACK.md, ROADMAP.md). Spike 2는 정확히 `voyage-4-lite` 사용 검증.
- **`Bun.$` shell + `--context dserver`**, NOT `dockerode` (DESIGN.md correction #2). dockerode는 named context 미지원이라는 사실이 직접 명시됨.
- **`z.toJSONSchema()`** Zod v4 내장, NOT `zod-to-json-schema` 패키지 (DESIGN.md correction #3, autoplan에서 명시 검증됨).
- **`htmx-ext-sse@2.2.4`** 별도 로드, htmx 2.x core 아님 (DESIGN.md correction #4).
- **5-key approval gate `y/n/e/d/a`** — Phase 0 범위는 아니지만 Phase 0 services.yaml 초안 review에 동일한 5-key UX를 *사용해보는* 것이 dogfood가 될 수 있음 (옵션, plan에서 결정).

### 사용자 기존 환경 (Phase 0이 활용)

- **Docker contexts (`dlocal`, `dserver`)** — 이미 설정 완료. Spike 1은 `docker context ls`에서 둘 다 보이는지 사전 확인.
- **Claude API key, Voyage API key** — 사용자가 이미 발급. `.env`에 채우는 것은 Phase 0 task.
- **`gon@192.168.0.5` SSH** — 키 기반 인증 완료. `ssh gon@192.168.0.5 docker ps`가 동작하는지 사전 확인 가능.

### 시간 예산 강조

ROADMAP.md에 명시: **Phase 0 ≤2h.** 초과 시 명시적 논의 필요. 이는 spike별로 약 20-30분씩 + services.yaml 초안 review 30분 정도의 timeline. plan-phase에서 task별 시간 추정을 명시하고, 합산이 2h 초과면 D-06/D-07 같은 scope-narrowing 결정이 더 필요.

</specifics>

<deferred>
## Deferred Ideas

다음은 Phase 0 논의 중 떠오른 아이디어이지만 Phase 0 boundary 밖이므로 후속 phase로 이월:

### Phase 1로 이월

- **services.yaml schema 정의 (Zod)** — Phase 0은 services.yaml `초안 텍스트`를 만든다. Schema 검증과 type 정의는 Phase 1 KB-01에서 처리.
- **services.yaml staleness detection** — Phase 0에서 초안만 만들고 drift 감지 로직(`docker ps` vs yaml diff)은 Phase 1 KB-03.
- **로그 sanitization (SECRET/KEY/PASSWORD 라인 제거)** — Phase 0에서는 services.yaml 초안 생성에 로그를 indexing 하지 않으므로 미적용. Phase 1 KB-04.
- **5개 tool wrapper의 나머지 4개 Zod schema** — Spike 5는 1개 대표만 검증 (D-06). 나머지는 Phase 1 LOOP-* 작업 시 함께 정의.

### Phase 2로 이월

- **state/ git pre-commit hook (fast-forward only)** — Phase 0은 `state/` 디렉토리 init과 첫 commit만. Hook은 APPLY-07.
- **2PC commit ordering 검증 (docker exec → git commit)** — Phase 2 APPLY-04.
- **5-key UI inline legend** — Phase 2 APPLY-02 (Phase 0 services.yaml review에 임시로 5-key를 흉내 낼 수는 있으나 plan에서 결정).

### Future milestones (v2)

- **NOTIFY-01 Discord webhook** — applyPatch 실패 알림. v2.
- **OSS-01 별도 repo 분리** — services.yaml + LLM provider 추상화. v2.

### Reviewed Todos (not folded)

(없음 — `.todos/backlog.json` 미사용)

</deferred>

---

## Auto-mode Decision Log

다음은 `--auto` 모드에서 Claude가 자동 선택한 결정의 추적 (audit용):

```
[--auto] Phase 0이 greenfield + 풍부한 prior context (PROJECT/REQUIREMENTS/ROADMAP/research) 보유 → 결정 자동화에 충분.

[--auto] Selected all gray areas: [Spike 격리 위치, 부분 통과 정책, services.yaml 자동/수동, state/ 위치, .env 검증 시점, Spike 5 범위, Spike 3 범위, Test framework]

[--auto] [Spike 격리 위치] — Q: "Spike 코드를 메인 src/와 분리할 것인가?" → Selected: "spikes/ 임시 디렉토리에 격리" (recommended — 메인 코드 오염 방지)
[--auto] [부분 통과 정책] — Q: "5개 spike 중 일부만 green일 때 Phase 1 진행 가능?" → Selected: "No partial pass — 5/5 green 강제" (recommended — Phase 0 존재 이유)
[--auto] [services.yaml 작성] — Q: "초안을 AI 자동 생성? 인간 수동?" → Selected: "AI 자동 + 인간 review" (recommended — 시간/품질 sweet spot)
[--auto] [state/ 위치] — Q: "별도 submodule? 메인 repo?" → Selected: "메인 repo 서브디렉토리" (PROJECT.md Key Decision lock)
[--auto] [.env 검증 시점] — Q: "Phase 0에서? Phase 1에서?" → Selected: "Phase 0 (BOOT-04/BOOT-05 요구사항)" (recommended — 디버깅 시간 절약)
[--auto] [Spike 5 범위] — Q: "1개 스키마? 5개 tool 모두?" → Selected: "1개 대표 스키마만" (recommended — spike boundary)
[--auto] [Spike 3 범위] — Q: "더미 endpoint? 실제 agent loop?" → Selected: "최소 Hono + 더미 SSE endpoint" (recommended — spike boundary)
[--auto] [Test framework] — Q: "bun:test? Vitest?" → Selected: "bun:test" (STACK.md lock)

[--auto] Single-pass cap respected. CONTEXT.md written. Auto-advancing to gsd-plan-phase 0.
```

---

*Phase: 0-Bootstrap & Spikes*
*Context gathered: 2026-05-06*
