# Phase 2: Propose/Apply with Approval Gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 2-propose-apply-approval-gate
**Mode:** default (interactive)
**Areas discussed:** Pre-execute Gate, Patch 적용 대상 파일 범위, applyPatch docker command 범위, APPLY-05 crash window 메커니즘, APPLY-06 commit message template, Docker compose 호출 방법 (post-advisor)

---

## Pre-execute Gate (게이팅)

| Option | Description | Selected |
|--------|-------------|----------|
| 지금 진행 (smoke는 별개 트랙) | Phase 2 context/plan 지금, smoke는 plan/execute 직전 사용자가 수동 처리 | |
| smoke 끝낸 뒤 진행 (Strict) | discussion 종료 → smoke 5단계 + VOYAGE 회전 → VERIFICATION 라이브 재기록 → /gsd-discuss-phase 2 재실행 | |
| 지금 진행 + smoke를 CONTEXT.md에 carry-forward (Recommended) | context 지금, deferred에 명시 + plan 첫 task로 wrapping | ✓ |

**User's choice:** 지금 진행 + smoke를 CONTEXT.md에 carry-forward (Recommended)
**Notes:** D-E1로 lock — Phase 2 plan 첫 task = Phase 1 live runtime smoke 5단계 + VOYAGE_API_KEY 회전. discussion 진행으로 시간 절약, gate는 plan 단계로 미룸.

---

## Patch 적용 대상 파일 범위

### Q1: proposePatch 대상 파일 범위?

| Option | Description | Selected |
|--------|-------------|----------|
| state/services.yaml만 | Phase 1 D-12 패턴 재사용. ROADMAP SC#2 적용 불가 | |
| state/compose/{stack}.yml 미러 + state/services.yaml (Recommended) | 원격 compose 파일들을 state/compose/{stack}.yml로 미러. AI intent vs Docker reality 분리 유지 | ✓ |
| 원격 docker-compose.yml 직접 (SSH SCP) | 실제 운영 파일이 진실. state/ git이 audit trail이지 source of truth가 아닌 구조 | |
| You decide | plan-phase 결정 | |

**User's choice:** state/compose/{stack}.yml 미러 + state/services.yaml (Recommended)
**Notes:** D-A1 lock. PROJECT.md "state/ = AI intent log" 철학 보존.

### Q2: 미러 sync 시점/메커니즘?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 2 첫 plan 일회성 복사 (Recommended) | scripts/init-state-compose.ts SSH cat × 5 → 1회 commit. 이후 applyPatch만 | ✓ |
| 매 query SSH read + diff 자동 탐지 | 최신성 보장하지만 매 요청 SSH 5회 | |
| init + on-drift 자동 PR | 자동 sync proposal | |
| You decide | | |

**User's choice:** Phase 2 첫 plan 일회성 복사 (Recommended)
**Notes:** D-A2 lock. PITFALL #11 OOB drift는 별도 sync 흐름.

### Q3: verify 환경?

| Option | Description | Selected |
|--------|-------------|----------|
| 192.168.0.8 로컬 test compose stack (Recommended) | tests/fixtures/test-compose.yml 신설 (alpine 더미 2개). DOCKER_CONTEXT=default 일시 전환 | ✓ |
| Mock-only + 수동 staging 1회 | Bun.$ stub + 운영자 의도적 정지 가능 stack에 1회 실행 | |
| Phase 2 verify는 unit/integration만, live deferred | Phase 1 패턴 동일 | |
| You decide | | |

**User's choice:** 192.168.0.8 로컬 test compose stack (Recommended)
**Notes:** D-A3 lock. PROJECT.md "PROD 절대 조작 금지" 정확한 구현.

### Q4: drift 감지 확장?

| Option | Description | Selected |
|--------|-------------|----------|
| services.yaml drift만 유지, mirror는 applyPatch 진입 시 1회 (Recommended) | Phase 1 stale-check.ts 그대로. mirror는 SSH SHA256 비교만 | ✓ |
| stale-check.ts 확장하여 둘 다 boot/per-query | services.yaml + 5 mirror 모두 boot/per-query 검사 | |
| applyPatch 전 1회만, 평소 무관 | mirror staleness만 applyPatch 직전 | |
| You decide | | |

**User's choice:** services.yaml drift만 유지, mirror는 applyPatch 진입 시 1회 (Recommended)
**Notes:** D-A4 lock. KB-03 30s cache + Phase 1 SLO 보호.

---

## applyPatch docker command 범위

### Q1: docker command 집합 제한?

| Option | Description | Selected |
|--------|-------------|----------|
| 닫힌 집합 7개 (Recommended) | compose up -d / down / restart / start / stop / logs --tail / ps. Zod union literal | ✓ |
| AI 자유 + 테르미넬 deny-list | rm -rf / sh -c / exec sh 등 공격 패턴만 reject | |
| diff에서 자동 도출 | 파일 변경 내용에서 command 추론 | |
| You decide | | |

**User's choice:** 닫힌 집합 7개 (Recommended)
**Notes:** D-B1 lock. prompt injection / jailbreak 원천 차단.

### Q2: proposePatch tool schema (fileEdit + command 결합)?

| Option | Description | Selected |
|--------|-------------|----------|
| 단일 proposePatch tool { stack, command, fileEdit? } (Recommended) | fileEdit 있으면 jsdiff createPatch + UI, 없으면 'no-file-change' 배너 | ✓ |
| 별도 tool 2개 (proposeFileEdit + proposeCommand) | 5-key 승인 2회 + LLM 멀티스텝 어려움 | |
| command만 tool, file edit은 레거시 mv 경로 | Phase 1 D-12.3 흐름 재사용 | |
| You decide | | |

**User's choice:** 단일 proposePatch tool { stack, command, fileEdit? } (Recommended)
**Notes:** D-B2 lock. dogfood UX 매끈함, 'image bump + restart' 한번에 제안 가능.

### Q3: docker exec 성공 후 git commit 실패 시?

| Option | Description | Selected |
|--------|-------------|----------|
| 역 docker rollback 시도 + 알림 (Recommended) | up↔down, start↔stop, restart→restart. 실패 envelope에 수동 명령 명시 | ✓ |
| pending marker + 경고만, docker 상태 그대로 | APPLY-05 marker 같은 흐름. production 변경 존중 | |
| git commit 재시도 (3회) 후 실패 시 위 (1) | transient git fail 회복 시도 | |
| You decide | | |

**User's choice:** 역 docker rollback 시도 + 알림 (Recommended)
**Notes:** D-B3 lock. APPLY-04 텍스트 보강 — "docker 성공 + git fail" 케이스의 envelope 정의.

---

## APPLY-05 crash window 메커니즘

### Q1: marker 작성/삭제 시점?

| Option | Description | Selected |
|--------|-------------|----------|
| docker exec 직전 write, git commit 성공 직후 delete (Recommended) | 가장 보수적, 모든 crash window cover | ✓ |
| git commit 직전 write, git commit 성공 직후 delete | docker 진행 중 crash 감지 못 함 | |
| marker 없이 git stash/reflog로만 | 추가 파일 없음, 디버깅 어려움 + APPLY-05 spec 위반 | |
| You decide | | |

**User's choice:** docker exec 직전 write, git commit 성공 직후 delete (Recommended)
**Notes:** D-C1 lock. APPLY-05 spec의 정확한 시점 보강.

### Q2: boot에서 marker 발견 시 동작?

| Option | Description | Selected |
|--------|-------------|----------|
| 자동 복구 안 함, SSE drift event + 수동 복구 명령 안내 (Recommended) | listContainers + git log 비교 후 a)/b)/c) 안내 | ✓ |
| 자동 git commit 시도 | docker 결과 미확신 상태에서 audit lie 위험 | |
| 세션 입력 차단 (read-only) | POST /chat 차단 + read-only 허용 | |
| You decide | | |

**User's choice:** 자동 복구 안 함, SSE drift event + 수동 복구 명령 안내 (Recommended)
**Notes:** D-C2 lock. APPLY-05 spec 보강.

### Q3: docker 시작 전/진행 중/완료 후 구별?

| Option | Description | Selected |
|--------|-------------|----------|
| marker 점진 업데이트 (docker_started_at, docker_finished_at, exit_code) (Recommended) | 단일 파일 atomic update, 3-state 구별 | ✓ |
| created_at만 + listContainers/git log 추론 | 추론 코드 복잡 | |
| 디렉토리 기반 step files | step1.txt step2.txt 분리, 운영자 직관 어수선 | |
| You decide | | |

**User's choice:** marker 점진 업데이트 (Recommended)
**Notes:** D-C3 lock. boot detect 시 정확한 사용자 안내 가능.

### Q4: marker 존재 상태에서 새 applyPatch?

| Option | Description | Selected |
|--------|-------------|----------|
| reject + 503 envelope (Recommended) | 동시성 보호 + APPLY-07 일부. 단일 사용자에 적합 | ✓ |
| marker rotate (multi-pending) | 동시 2개 이상 — 1인 도구 과다 | |
| .lock 파일 + retry | bun multi-process 미지원 | |
| You decide | | |

**User's choice:** reject + 503 envelope (Recommended)
**Notes:** D-C4 lock. APPLY-07 동시 쓰기 보호의 일부.

---

## APPLY-06 commit message template

### Q1: commit message 골격?

| Option | Description | Selected |
|--------|-------------|----------|
| Subject 한 줄 + body 구문화 필드 (Recommended) | apply(<stack>): <command> [<file-edit-summary>] + body fields | ✓ |
| Free-form body, subject만 구문화 | LLM 자유 + 가독성 + grep 약함 | |
| JSON 메타 + 1-line summary | 기계 파싱 쉽지만 사람 가독성 약함 | |
| You decide | | |

**User's choice:** Subject 한 줄 + body 구문화 필드 (Recommended)
**Notes:** D-D1 lock. AUDIT-02 grep 일관성.

### Q2: AI-Reasoning 추출 source?

| Option | Description | Selected |
|--------|-------------|----------|
| proposePatch tool input의 reasoning 필드 (Recommended) | Zod schema 필수 + system prompt lock. 결정적, 구조화 | ✓ |
| tool call 직전 text-delta의 요약 | 추출 로직 복잡, 안내문/사담 혼합 위험 | |
| 둘 다 기록 (reasoning + text excerpt) | 500자 cap 압박 | |
| You decide | | |

**User's choice:** proposePatch tool input의 reasoning 필드 (Recommended)
**Notes:** D-D2 lock. AUDIT-02 'AI reasoning' 정확한 source.

### Q3: sanitization 시퀀스와 500자 cap 적용?

| Option | Description | Selected |
|--------|-------------|----------|
| 필드별 cap, 세관마우스 분리자 명시 (Recommended) | User-Prompt 200자 / AI-Reasoning 500자 / Diff-Summary 100자. spawn -F 임시 파일 + -- 분리자 | ✓ |
| 전체 body 500자 cap, 세트팀의 필드별 비율 할당 | 비율 일관성 약함 | |
| Cap 없음, sanitization만 | 500자 cap spec 위반 | |
| You decide | | |

**User's choice:** 필드별 cap + spawn -F 임시 파일 (Recommended)
**Notes:** D-D3 lock. spike 4 패턴 보강.

### Q4: 액션 종류별 commit 생성 규칙?

| Option | Description | Selected |
|--------|-------------|----------|
| applied / rolled-back만 commit, 나머지는 SQLite audit만 (Recommended) | git log = production state 변경. AUDIT-02 의도 부합 | ✓ |
| 모든 이벤트를 commit (rejected도 .audit/ 디렉토리) | 완전 audit, git log noise 폭발 | |
| applied만 commit + rolled-back은 metadata (cherry-pick mark) | state/와 audit 단순화 — 단서 불일치 | |
| You decide | | |

**User's choice:** applied / rolled-back만 commit, 나머지는 SQLite audit만 (Recommended)
**Notes:** D-D4 lock. AUDIT-02 'git log만으로 경제 추적' 정확한 의도.

---

## Done check

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context (Recommended) | 4 area 14 결정 + 1 게이팅 — 충분 | ✓ |
| Explore more gray areas | 5-key 'e' UX / test compose 구성 / git log audit 패턴 등 | |

---

## Docker compose 호출 방법 (post-advisor 보강)

advisor가 CONTEXT.md draft 검토 중 발견: `docker --context home-server compose -f /원격경로/...`는 로컬 CLI가 원격 파일을 못 읽으므로 물리적으로 잘못된 패턴.

| Option | Description | Selected |
|--------|-------------|----------|
| SSH 경유 (Recommended) | Bun.spawn(['ssh', 'gon@192.168.0.5', 'cd /원격경로/{stack} && docker compose <command>']). Phase 1 readCompose 패턴 검증됨. 원격 전적 실행 → relative volume 정상 | ✓ |
| docker --context home-server + -f 원격 절대경로 | -f 파싱이 로컬에서 일어나 원격 absolute path를 못 읽음. relative volume 깨짐 | |
| docker --context home-server + 원격 absolute 계층결합 | 모든 volume이 absolute일 때만 가능 — 기존 compose는 relative 가능성 높음 | |
| You decide (plan-phase) | | |

**User's choice:** SSH 경유 (Recommended)
**Notes:** D-A5 lock. CONTEXT.md `<decisions> Patch 적용 대상 파일 범위`에 D-A5 추가. fileEdit 있을 때 SSH `cat >` 또는 `scp`로 원격 파일도 동시 동기화 후 docker compose 명령 실행.

**User's choice:** I'm ready for context (Recommended)
**Notes:** 잔여 항목들은 plan-phase에서 Claude 재량 또는 plan task에 포함.

---

## Claude's Discretion (plan-phase에서 결정)

- 8h 예산 내부 wave/plan split (10 REQ-ID)
- 5-key 'e'(edit) UX 정확한 flow (브라우저 textarea? AI 재요청? `$EDITOR`?)
- system prompt 본문 (D-B1 + D-B2 + D-D1 모두 lock 시점)
- AUDIT-02 추가 grep 패턴
- test compose stack 정확한 image / port / depends_on
- Phase 2 FRICTION carry-over 위치 (`.planning/phases/02-*/FRICTION.md` 추천)
- LOOP에서 proposePatch tool dispatch 시 interrupt + resume 메커니즘

## Deferred Ideas

### Phase 2 execute 직전 게이트 (D-E1)

- Phase 1 live runtime smoke 5단계 (STATE.md "Outstanding operator actions")
- VOYAGE_API_KEY 회전 (HIGH 보안)

### Future milestones (v2)

- 원격 docker-compose.yml 직접 SCP 쓰기
- AI 자유 docker exec 명령
- 다중 세션 동시 applyPatch (marker rotate)
- Auto-sync `services.yaml` 보강 흐름
- multi-host / kb auto-sync / NOTIFY-01 / OSS-01

### Reviewed Todos (not folded)

(없음 — `.todos/backlog.json` 미사용)
