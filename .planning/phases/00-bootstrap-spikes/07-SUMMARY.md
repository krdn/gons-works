---
plan_id: "00-07"
phase: 0
title: "services.yaml 초안 생성 + state/ 첫 git commit"
status: complete
completed: 2026-05-06
duration_minutes: 22
requirements: ["BOOT-02", "BOOT-03"]
---

# 00-07 SUMMARY

## What was built

Phase 1 RAG의 입력 자료가 될 `services.yaml` 초안 + state/ 첫 의미 있는 commit (BOOT-03 audit trail 기준점).

### key-files.created
- `scripts/draft-services-yaml.ts` (docker ps → YAML 분류 스크립트)
- `state/services.yaml` (42 컨테이너 → 5 stack + 19 unmatched)
- `state/services.yaml.review-checklist.md` (사용자 보강 가이드)
- `state/SPIKE-{1,2,3,6}-RESULT.md` (4개 라이브 spike 결과 함께 commit)

### BOOT-02 + BOOT-03 만족
- ✓ services.yaml 초안에 5 핵심 stack 모두 포함 (news/ais/n8n/open-webui/krdn-fx)
- ✓ `state/services.yaml`의 첫 git commit 기록 (commit 2e1a09c)
- ✓ `git log state/services.yaml` 출력에 commit 1개

### docker ps 분류 결과
- 42 컨테이너 enumeration (running + exited 모두)
- 5 핵심 stack에 23 컨테이너 매핑:
  - news: 6 (worker/beat/api/app/postgres/redis)
  - ais: 10 (web/worker/collector×3/whisper/postgres×2/redis/migrate)
  - n8n: 4 (n8n/worker/postgres/redis)
  - open-webui: 1
  - krdn-fx: 2 (dashboard/backend, 둘 다 stopped)
- unmatched: 19 (vscode/timescaledb/voice/cli-proxy/nitter/gonsai2/etc.)

## Verification

- `test -f state/services.yaml` ✓
- `grep -E "^\s+(news|ais|n8n|open-webui|krdn-fx):" state/services.yaml` → 5 매치 ✓
- `git log --oneline state/services.yaml` → commit 1개 표시 ✓
- `bunx tsc --noEmit` → 종료 코드 0 ✓
- 라이브 `bun run scripts/draft-services-yaml.ts` → 42 컨테이너 enumeration + draft 생성 ✓

## Deviations / Friction

1. **TODO 슬롯 미보강 상태로 commit**:
   - Plan은 사용자가 review-checklist를 손으로 채워 commit하는 D-03 (AI + human review) 흐름.
   - 사용자 결정으로 초안 상태(TODO 그대로) commit. depends_on/volumes/normal_log_pattern은 Phase 1 KB-01에서 점진 보강 예정.
   - acceptance criteria는 "5 stack 그룹 헤더 grep" + "첫 commit"이므로 만족.
   - 시스템적 영향 없음. Phase 1에서 review-checklist를 Phase 1 KB-01 작업의 일부로 처리.

2. **`krdn-timescaledb`가 unmatched로 분류**:
   - krdn-fx stack의 의존 DB이지만 이름 패턴이 `krdn-timescaledb` (krdn-fx-* 아님).
   - review-checklist를 손으로 채울 때 krdn-fx의 depends_on에 추가하면 됨.

3. **42 vs 24 컨테이너 (Spike 1과 차이)**:
   - Spike 1은 `ps` (running만), draft 스크립트는 `ps -a` (stopped 포함).
   - 의도된 차이. services.yaml은 stopped도 알아야 RAG에서 "voice 왜 멈췄어?" 같은 질의에 답할 수 있음.

## Self-Check: PASSED

| Acceptance | Status |
|---|---|
| scripts/draft-services-yaml.ts 존재 + Bun.$ + 5 stack 키워드 | ✓ |
| state/services.yaml 존재 + 5 stack 그룹 헤더 | ✓ |
| state/services.yaml.review-checklist.md 존재 + commit 명령 예시 | ✓ |
| state/services.yaml.draft 미존재 (mv 완료) | ✓ |
| `git log state/services.yaml` 1+ commit | ✓ |
| 첫 commit 메시지에 BOOT-02/BOOT-03 참조 | ✓ |
| `bunx tsc --noEmit` exit 0 | ✓ |

## Phase 0 progress

8/9 plans complete. 1 plan 남음:
- **00-08** (Wave 4): Phase 0 verification + DOG-01/DOG-02 dogfood 마찰 정리

6/6 spike GREEN. BOOT-01..BOOT-05 모두 만족.
DOG-01/DOG-02는 00-08에서 처리.
