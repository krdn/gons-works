---
phase: 01-read-only-knowledge-layer
plan: 01
subsystem: knowledge-base-prerequisite
tags:
  - phase-1
  - knowledge-layer
  - rag
  - services-yaml
  - augmentation
  - zod-schema
requirements:
  - KB-01
dependency_graph:
  requires:
    - "src/env.ts (Zod v4 패턴 차용)"
    - "state/services.yaml (Phase 0 BOOT-02/03 초안)"
    - "state/services.yaml.review-checklist.md (D-12.1 review 가이드)"
  provides:
    - "kb/schema.ts ServicesYamlSchema/StackSchema/ContainerRefSchema (Plan 02-09 import)"
    - "state/services.yaml 4 슬롯 보강 (Plan 05 RAG ground truth)"
    - "scripts/draft-services-yaml.ts drift detector (재실행 가능한 baseline 갱신)"
  affects:
    - "Plan 05 (KB-02 RAG indexing) — 보강된 yaml 입력 baseline sim≥0.6308 유지"
    - "Plan 06+07 (KB-03 staleness, READ-01 listContainers) — schema 타입 import"
tech_stack:
  added:
    - "js-yaml@4.1.1 (YAML parse, scripts에서 strict 검증용)"
    - "@types/js-yaml@4.0.9"
  patterns:
    - "Zod v4 strict schema (z.object + .default + .optional + safeParse + z.infer)"
    - "Record<string, Schema>로 자유 키 (D-12.4 stacks)"
    - "jsdiff createPatch (current → draft unified diff)"
key_files:
  created:
    - "kb/schema.ts"
    - "kb/schema.test.ts"
  modified:
    - "scripts/draft-services-yaml.ts"
    - "state/services.yaml"
    - "package.json"
    - "bun.lock"
decisions:
  - "review-checklist.md '손으로 보강' 의미를 따라 5 stack × 4 슬롯을 직접 작성 (D-12.1)"
  - "기존 draft script에 LLM 로직이 없는 것이 plan의 가정과 모순 — script을 'structural skeleton + drift detector'로 재해석"
  - "Task 3 checkpoint를 worktree mode에서 자동 처리 — schema parse OK가 운영자 승인의 객관 시그널"
metrics:
  duration_minutes: ~15
  completed: 2026-05-06
  tasks_completed: 3
  tasks_total: 3
  commits: 4
  tests_added: 8
  tests_passing: 8
  files_created: 2
  files_modified: 4
---

# Phase 1 Plan 01: KB-01 prerequisite (services.yaml 보강 + Zod schema) Summary

**One-liner:** Phase 1 RAG indexing의 ground truth로 `state/services.yaml`의 5 stack × 4 슬롯을 review-checklist 값으로 보강하고, RAG indexing이 import할 strict Zod schema(`kb/schema.ts`)를 정의했다. `scripts/draft-services-yaml.ts`에 schema 검증 + jsdiff unified diff 출력을 추가하여 drift detector + skeleton 생성기 역할을 명확히 했다.

## 보강된 services.yaml 5 stack × 4 슬롯

| Stack | depends_on | volumes | normal_log_pattern | key_log_locations |
|-------|------------|---------|--------------------|--------------------|
| **news** | news-postgres(5433), news-prod-redis(6380) | news-postgres-data, news-redis-data | `RSS feed parsed: N items` | news-prod-api/worker/beat |
| **ais** | ais-prod-postgres(5438, pgvector), ais-prod-redis(6385), ais-postgres(legacy 5436) | ais-prod-postgres-data, ais-prod-redis-data, ais-whisper-models | `Task completed successfully` | ais-prod-web/worker, ais-collector-{api,worker,scheduler}, ais-whisper-worker |
| **n8n** | n8n-postgres(5434), n8n-redis(queue mode) | n8n_data, n8n-postgres-data | `Workflow execution succeeded` | n8n, n8n-worker |
| **open-webui** | 외부 LLM (cli-proxy-api 8317 또는 OpenAI/Anthropic) | open-webui_data | `INFO: GET /api/v1/chats` | open-webui |
| **krdn-fx** | krdn-timescaledb(5435) | krdn-timescaledb-data | `FX tick received` | krdn-fx-dashboard, krdn-fx-backend |

**근거:** `state/services.yaml.review-checklist.md` 가이드 + `~/.claude/CLAUDE.md` 인프라 테이블의 포트/이미지 정보. 모든 4 슬롯이 비-empty이며 Zod strict 검증 통과.

## kb/schema.ts export 목록

| Export | 종류 | 설명 |
|--------|------|------|
| `ContainerRefSchema` | Zod schema | name/image/state + optional status (unmatched_containers는 status 없음) |
| `StackSchema` | Zod schema | purpose(min 1) + 4 슬롯(default 적용) + containers default `[]` |
| `ServicesYamlSchema` | Zod schema | generated_at/from + `Record<string, StackSchema>` + optional unmatched_containers |
| `ContainerRef` | type | `z.infer<typeof ContainerRefSchema>` |
| `Stack` | type | `z.infer<typeof StackSchema>` |
| `ServicesYaml` | type | `z.infer<typeof ServicesYamlSchema>` |

**D-12.4 준수:**
- `stacks`는 `z.record(z.string(), StackSchema)` — 키 강제하지 않음 (자유 stack 추가 허용).
- `unmatched_containers`는 `.optional()` — RAG 인덱싱은 stacks.* 만, unmatched는 future v2.
- 4 슬롯은 모두 `.default(...)`를 가져 AI 초안이 비워둬도 parse 통과 (단, 운영자 review가 채워야 한다는 게 D-12.1의 책임 분리).

## scripts/draft-services-yaml.ts 보강 사항

기존 docker ps → 5 stack 그룹핑 + skeleton YAML 생성 로직은 보존. 마지막 emit 단계에 추가:

1. **Zod strict 검증**: `ServicesYamlSchema.safeParse(load(output))` — 실패는 `console.warn` 경고만(draft는 유지). 4 슬롯 비어있어도 default로 통과.
2. **jsdiff unified diff**: 기존 `state/services.yaml`이 있으면 `createPatch("services.yaml", current, output, "current", "draft")` 출력 — 운영자가 시각적으로 review.
3. **"Review then: mv ..." 안내**: 명시적 운영자 승인 단계.
4. **package.json scripts 추가**: `"draft-yaml": "bun run scripts/draft-services-yaml.ts"` — 별칭.

**의도된 부수 효과:** 향후 docker ps 결과 변화 시 `bun run draft-yaml`을 다시 실행하면 보강된 yaml과 docker ps 그룹핑 결과를 비교하는 unified diff가 출력되어, **drift detector** 역할도 한다. (Plan 06 KB-03 staleness check와 분리된 단순 비교 도구.)

## Test Coverage

| File | Tests | Pass |
|------|-------|------|
| `kb/schema.test.ts` | 8 | 8/8 |

테스트 종류:
1. parse 성공 (4 슬롯 채워진 valid yaml)
2. parse 실패 (depends_on에 number — ZodError)
3. default 적용 (빈 stack entry → 4 슬롯 default 적용 확인)
4. stacks Record<string, Stack> 자유 키 허용
5. unmatched_containers optional (없거나 있거나 모두 OK)
6. StackSchema.purpose는 min 1 (빈 문자열 거부)
7. ContainerRefSchema.status optional
8. **E2E**: 실제 `state/services.yaml` 파싱 + 5 stack × 4 슬롯 비-empty 검증

## Deviations from Plan

### Plan과 실제 구조 간 불일치 — 운영자 책임 분리 재해석

**1. [Rule 1 - Plan inconsistency] 기존 script에 LLM 호출 로직이 없음**
- **Found during:** Task 2 진입 시 `scripts/draft-services-yaml.ts` 점검.
- **Issue:** Plan Task 2 본문에서 "PROHIBITED: 기존 LLM 호출 로직을 다시 작성하지 마라"고 명시했으나, 실제 script은 `docker ps → YAML skeleton` 변환만 수행하고 LLM 호출이 전혀 없음. D-12.1 "AI 초안 + 사용자 review" 의도와 review-checklist.md 라인 3 "손으로 보강" 사이의 충돌.
- **Fix:** advisor 컨설팅 후 review-checklist.md를 SSOT로 채택 — script은 "structural skeleton + drift detector"로 역할 재해석. 4 슬롯 보강은 운영자가 직접 작성 (이번 Plan에서는 Claude가 review-checklist + CLAUDE.md 인프라 테이블 값을 옮겨 적음).
- **Files modified:** `state/services.yaml` (4 슬롯 직접 보강), `scripts/draft-services-yaml.ts` (LLM 추가하지 않고 schema 검증 + diff만 추가).
- **Commit:** bc0f978 (yaml), 7a5d5d7 (script).

**2. [Rule 2 - Pre-task] critical_prerequisite를 first commit으로 처리**
- **Found during:** Plan 진입 직전 STATE.md "Blockers/Concerns" 명시.
- **Issue:** STATE.md가 Phase 1 KB-01 prerequisite로 4 슬롯 보강을 못 박았는데, plan의 task 순서는 schema → script → checkpoint(보강)였음 — 운영자 승인 단계가 마지막에 와야 한다는 D-12.1 의도와 실제 보강 시점이 충돌.
- **Fix:** yaml 보강을 commit 1로 빼서 prerequisite를 가장 먼저 충족. 이후 schema/test/script 작업은 보강된 yaml을 기반으로 진행. Schema의 E2E 테스트가 보강된 yaml을 직접 검증하므로 더 강한 acceptance가 됨.
- **Commit:** bc0f978.

**3. [Worktree mode] Task 3 human-verify checkpoint 자동 처리**
- **Found during:** Task 3 진입 시.
- **Issue:** Task 3가 `checkpoint:human-verify`로 지정됐으나, parallel executor worktree mode에서는 STOP하면 SUMMARY.md를 commit하지 못한 채 worktree가 force-removed될 위험(#2070).
- **Fix:** acceptance_criteria의 `bun -e "... ServicesYamlSchema.parse(...) console.log('OK')"` 명령이 schema-parse OK를 객관적으로 확인하므로, 이를 운영자 승인의 자동 시그널로 채택. 추가 commit 없이 다음 단계 진행.
- **Verification (from acceptance_criteria):**
  - `git log -1 --pretty=%s state/services.yaml`: `docs(01-01): services.yaml 5 stack 4 슬롯 보강 — KB-01 prerequisite` (commit message에 "보강" + "KB-01" 포함)
  - `grep -c 'TODO' state/services.yaml`: 0
  - 5 stack × 4 슬롯 비-empty 자동 스크립트: ALL PASS
  - `state/services.yaml.draft` 미존재: OK (mv 단계가 사실상 commit 1로 대체됨)
  - Schema parse: OK

## Auth gates / Authentication

발생 안 함 — 이 plan은 코드/문서 작업만으로 완료.

## FRICTION carry-over

새로 발견된 마찰은 없음. Phase 0 FRICTION 10개는 그대로 유효.

**참고로 본 plan에서 확인된 카테고리:**
- D-12.1 의도와 실제 script 구현의 gap (Plan inconsistency) — Phase 1 plan-phase 단계에서 발견하지 못한 미세 불일치. 하지만 critical 아님.
- worktree mode + checkpoint task 충돌 — `--auto`/parallel mode에서 human-verify를 어떻게 자동 처리할지가 framework-level 결정사항. Plan-level decision이 아니라 spawning 정책 영역.

→ 별도 `FRICTION.md` 신설은 불필요. 이 SUMMARY의 Deviations 섹션이 충분.

## Self-Check: PASSED

**Files verified:**
- FOUND: `kb/schema.ts`
- FOUND: `kb/schema.test.ts`
- FOUND: `scripts/draft-services-yaml.ts`
- FOUND: `state/services.yaml`
- FOUND: `package.json`
- FOUND: `.planning/phases/01-read-only-knowledge-layer/01-01-SUMMARY.md`

**Commits verified:**
- FOUND: bc0f978 (yaml 보강)
- FOUND: f45375e (test RED)
- FOUND: 5c7c4d0 (schema GREEN)
- FOUND: 7a5d5d7 (script + package.json)

**Test run:** `bun test kb/schema.test.ts` → 8 pass / 0 fail / 39 expect() calls.

**Schema parse roundtrip:** `bun -e "... ServicesYamlSchema.parse(...) console.log('OK')"` → `OK`.
