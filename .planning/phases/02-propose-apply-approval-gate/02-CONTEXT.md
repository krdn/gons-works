# Phase 2: Propose/Apply with Approval Gate - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning
**Mode:** default (interactive, 4 areas × 3-4 questions + 1 gate question)

<domain>
## Phase Boundary

AI가 192.168.0.5 운영 서버의 Docker Compose 변경을 unified diff로 제안 → 운영자가 5-key 게이트(`y/n/e/d/a`)로 승인 → 원자적 2PC(docker exec → state/ git commit)로 적용 → AI reasoning 포함 git commit으로 audit trail 생성. Phase 2는 Phase 1 read-only 코파일럿에 **쓰기 능력 + 승인 게이트 + git-versioned audit**를 추가.

**구성 요소 (D-A1..D-A4 lock):**
1. `state/compose/{stack}.yml` 미러 5개 (news / ais / n8n / open-webui / krdn-fx) — Phase 2 첫 plan에서 SSH로 일회성 복사
2. `tools/proposePatch.ts` 단일 tool: `{ stack, command(7-union), fileEdit?: {path, newContent}, reasoning }` (D-B1..D-B2)
3. `approval/store.ts` in-memory `Map<sessionId, PendingApproval>` (PITFALL #3 prevention 코드 사용 — nonce + 2분 expiresAt + consumed flag)
4. `tools/applyPatch.ts` 2PC orchestrator (docker exec → git commit, APPLY-04 lock + 게이트 안전망 D-B3 보강)
5. `state/.pending/{nonce}.json` crash window marker (D-C1..D-C4 — 점진 update + boot detect + drift event + reject 동시성)
6. `state/commit.ts` — `applied` / `rolled-back` git commit (D-D1..D-D4 — Subject + body 구문화 필드, applied/rolled-back만 commit, 나머지 SQLite events만)
7. `state/.git/hooks/pre-commit` fast-forward only enforce (APPLY-07 lock, PITFALL #11 + Pitfall 8 prevention)
8. `public/index.html` 5-key approval form 확장 (Phase 1 6 SSE handler에 `event:approval-required`/`event:applied`/`event:rolled-back` 3개 추가)
9. `tools/applyPatch.ts` LLM = `claude-opus-4-6` (`COPILOT_MODEL_PROPOSE`, D-10 정정 lock — 4.7은 외부 API 미공개)
10. `tests/fixtures/test-compose.yml` 192.168.0.8 로컬 더미 stack (D-A3) — `DOCKER_CONTEXT=default`로 일시 전환 후 2PC E2E 검증

**스코프 밖 (v2 또는 다른 phase):**
- 원격 192.168.0.5 docker-compose.yml 직접 SCP 쓰기 — v2 (state/ 미러 단방향만 Phase 2)
- AI 자유 docker exec 명령 (compose 7-union 외) — v2
- 다중 세션 동시 applyPatch (marker rotate) — v2
- Auto-sync `services.yaml` 보강 흐름 — Phase 2.5
- multi-host / kb auto-sync / Discord webhook (NOTIFY-01) / OSS-01 — v2

**시간 예산:** ≤8h (overage 시 명시적 사용자 논의 필요).
Phase 0(~2.3h) + Phase 1(~2h 44m) 사용. 18h 총 예산 중 약 13h 남음.

</domain>

<decisions>
## Implementation Decisions

### Patch 적용 대상 파일 범위 (D-A)

- **D-A1:** **`state/compose/{stack}.yml` 미러 + `state/services.yaml` 둘 다 proposePatch 대상.** 192.168.0.5 원격 docker-compose.yml은 직접 수정하지 않음(v2 deferred). state/는 PROJECT.md 정의대로 'AI intent log'로 보존, applyPatch가 `docker compose --context home-server -f /원격경로/compose.yml <command>`로 적용.
  - **Why:** state/ git이 audit trail의 SSOT라는 PROJECT.md 철학 유지 + ROADMAP SC#2(2PC 적용)와 SC#1(unified diff 표시) 둘 다 만족하는 유일한 형태. 원격 파일 직접 SCP 쓰기는 PROJECT.md "state/ 시작은 단순화" 원칙 위반.
  - **How to apply:** proposePatch tool이 `state/compose/{stack}.yml` 또는 `state/services.yaml` 경로만 fileEdit.path로 받도록 Zod schema strict.

- **D-A2:** **Phase 2 첫 plan에서 일회성 SSH 복사 후 git commit, 이후 applyPatch만 단일 흐름.** `scripts/init-state-compose.ts`: `ssh gon@192.168.0.5 cat /home/gon/.../{stack}/docker-compose.yml` × 5 → `state/compose/{stack}.yml` write → `git -C state add . && git commit -m "feat(02): bootstrap state/compose mirror"`. 평소 sync는 안 함.
  - **Why:** 매 query SSH read는 KB-03 30s cache와 충돌 + 8h 예산 초과 위험. PITFALL #11 OOB drift는 별도 sync proposal 흐름으로 처리(아래 D-A4).
  - **How to apply:** `scripts/init-state-compose.ts`를 Phase 2 첫 plan(02-01)에서 Bun.$ + ssh로 작성. Plan execute 시 1회 수행 후 commit.

- **D-A3:** **검증 환경 = 192.168.0.8 로컬 test docker-compose stack 신설.** `tests/fixtures/test-compose.yml`에 2개 더미 alpine 컨테이너(`test-svc-a`, `test-svc-b`). `DOCKER_CONTEXT=default`(로컬)로 일시 전환하여 applyPatch 2PC E2E 검증 후 `home-server`로 복원. PROJECT.md Constraint "PROD 절대 조작 금지" 정확한 구현.
  - **Why:** Phase 1 4 ROADMAP SC live smoke가 미완 + Phase 2의 docker exec를 PROD에 돌리면 회복 불가능. 로컬 더미는 `docker compose down --volumes`로 cleanup, 모든 2PC 시나리오(success / docker fail rollback / git commit fail rollback / crash window) 재현 가능.
  - **How to apply:** Phase 2 plan 중 test fixture 작성 + DOCKER_CONTEXT 전환 helper(`tests/setup/docker-context.ts`) + cleanup hook. CI 미존재이므로 manual `bun test --bail tests/fixtures/`.

- **D-A4:** **`kb/stale-check.ts`는 Phase 1 그대로 유지(`services.yaml` 키 set diff만), `state/compose/{stack}.yml` mirror staleness는 applyPatch 진입 시 1회 SSH read + SHA256 비교만.**
  - **Why:** boot/per-query SSH 5회 추가 read는 30s cache 충돌 + Phase 1 SLO(첫 chunk 2s) 위반. applyPatch는 이미 SSH 호출이 있는 흐름이라 추가 cost 없음. PITFALL #11(operator OOB edit) 감지 시 사용자에게 'sync proposal' 별도 흐름 제시.
  - **How to apply:** `tools/applyPatch.ts` 진입점에 `await mirrorStaleCheck(stack)` 1회 호출. drift 시 ToolError envelope `{ problem: 'state/compose mirror outdated', cause: '운영자가 직접 수정한 듯', fix: 'sync proposal 먼저 실행 후 재시도', retryable: false }`.

- **D-A5:** **applyPatch 원격 docker compose 호출 = SSH 경유.** `Bun.spawn(['ssh', 'gon@192.168.0.5', \`cd /원격경로/{stack} && docker compose <command>\`])`. `docker --context home-server -f`는 `-f` 파일 파싱이 로컬 CLI에서 일어나 원격 절대경로를 못 읽고 relative volume도 로컬 기준으로 잘못 해석되므로 사용 안 함. fileEdit 적용 시에는 (1) `state/compose/{stack}.yml` write (audit 미러), (2) SSH로 `cat > /원격경로/{stack}/docker-compose.yml` (또는 `scp`) 원격 파일 갱신, (3) SSH `docker compose <command>`. 원격이 source of truth, state/는 audit 미러.
  - **Why:** Phase 1 `readCompose`에서 SSH 패턴 검증 끝남 (PITFALL #12 mitigated, ConnectTimeout=10/ServerAliveInterval=5/BatchMode=yes). compose 명령이 원격에서 통째 실행되어 relative volume 경로 정상. state/compose/{stack}.yml 미러는 audit/diff 표시 용도, applyPatch가 원격에 동시 동기화.
  - **How to apply:** `tools/applyPatch.ts` 흐름: (i) marker write (D-C1) (ii) state/compose/{stack}.yml write + state/services.yaml write 가 fileEdit에 따라 (iii) SSH `cat > /원격경로/{stack}/docker-compose.yml` 동기화 (fileEdit 있을 때만) (iv) SSH `cd /원격경로/{stack} && docker compose <command>` (v) git commit state/ (vi) marker delete. 원격 파일 동기화 실패 시 git commit 안 함 (APPLY-04 docker→git 순서 유지). 원격 파일 동기화는 'docker exec' 단계에 포함되어 한 묶음.

### applyPatch docker command 범위 (D-B)

- **D-B1:** **닫힌 집합 7개 docker compose subcommand만 허용.** Zod schema union literal: `'compose up -d <svc>' | 'compose down <svc>' | 'compose restart <svc>' | 'compose start <svc>' | 'compose stop <svc>' | 'compose logs <svc> --tail=200' | 'compose ps'`. AI의 `docker exec sh -c rm -rf /` 같은 공격경로 원천 차단. AUDIT-02 git log grep 패턴 단순화.
  - **Why:** AI 자유 + deny-list는 prompt injection이나 jailbreak로 우회 가능 — 1인 도구라도 production에 적용되는 명령은 화이트리스트가 안전. ROADMAP SC#1("krdn-fx 중지") + Phase 2 일반 운영 시나리오 모두 7개로 cover.
  - **How to apply:** `tools/applyPatch.ts`의 Zod schema에 `command` 필드 union literal 명시. `tools/_index.ts`의 JSON schema export로 LLM에 전달.

- **D-B2:** **단일 proposePatch tool, `fileEdit`는 optional.** Tool input schema:
  ```ts
  {
    stack: 'news' | 'ais' | 'n8n' | 'open-webui' | 'krdn-fx',
    command: union(D-B1 7-list),
    fileEdit?: { path: string, newContent: string },  // path strict: state/compose/{stack}.yml | state/services.yaml
    reasoning: string  // max 500자, sanitization 후 git commit body로 (D-D2 lock)
  }
  ```
  fileEdit 있으면 jsdiff `createPatch(path, currentContent, newContent)`로 unified diff 생성 + UI 표시. 없으면 `event:approval-required`에 `diff: '(no file change — command only: compose ${command})'` 배너.
  - **Why:** 별도 tool 2개(proposeFileEdit + proposeCommand)는 5-key 승인 2회 + LLM 멀티스텝 계획 어려움. 단일 tool은 'image bump 1.2→1.3 + restart' 한번에 제안 가능. dogfood UX 매끈함.
  - **How to apply:** `tools/proposePatch.ts` Zod schema. system prompt에 "fileEdit이 None이면 command만으로 충분한 케이스(중지/재시작 등)" 명시.

- **D-B3:** **docker exec 성공 후 git commit 실패 시 역 docker command rollback 시도 + envelope alert.** APPLY-04 텍스트는 'docker fail시 git 시도 안 함, git fail시 git revert 롤백'만 정의. **새 case: docker 성공 + git commit 실패 (디스크/FF 충돌/hook reject).**
  - 역 매핑: `up -d` ↔ `down`, `start` ↔ `stop`, `restart` → `restart`(idempotent), `down` → `up -d`(원복), `stop` → `start`. `logs/ps`는 read-only이므로 docker change 없음 → 역 rollback 불필요.
  - 에러 envelope `{ problem: 'CRITICAL: docker change applied but state/ commit failed', cause: '<git error>', fix: 'rollback docker (역 command 자동 시도): <result>. 실패 시 수동: docker --context home-server compose <역command> <svc>', retryable: false }`.
  - **Why:** APPLY-04는 docker fail 사례만 다룸. 실제 운영에서 git commit 실패 빈도(state/ 동시 lock, pre-commit hook reject)가 더 높을 수 있어 커버리지 필요.
  - **How to apply:** `tools/applyPatch.ts`의 try-catch (2 layer): outer = git commit fail → 역 docker 시도 + envelope, inner = git revert + envelope (APPLY-04 원본). 두 path 모두 SQLite events에 기록(D-D4).

### APPLY-05 crash window 메커니즘 (D-C)

- **D-C1:** **applyPatch lifecycle:** (a) `state/.pending/{nonce}.json` write (docker exec 직전) → (b) `Bun.spawn` docker compose 명령 → (c) `state/{compose mirror, services.yaml}` write + `git -C state commit` → (d) `state/.pending/{nonce}.json` delete. Crash가 (a)와 (b) 사이, (b)와 (d) 사이 어디서 일어나도 부트에서 marker 발견.
  - **Why:** docker exec 직전 write가 가장 보수적 — docker 시작 전 crash도 marker로 식별. PITFALL #2 prevention 코드는 이 시점을 명시 안 함, APPLY-05도 "marker 작성"만 명시 — D-C1이 정확한 시퀀스 정의.
  - **How to apply:** `state/.pending/` 디렉토리 init 시 `mkdir -p` + `.gitignore`에 추가(또는 `state/.gitignore`로 격리). `bun:fs` sync write로 fsync 보장.

- **D-C2:** **Boot 감지 시 자동 복구 안 함, SSE drift event + 수동 복구 명령 안내.** 서버 startup이 `ls state/.pending/*.json` → 발견 시 listContainers + git log 비교 후 `event:drift` 발신 (Phase 1 SSE event 재사용):
  ```
  ⚠ unfinished applyPatch detected
  nonce: {nonce}, command: {command}, started_at: {ts}
  현재 상태: docker_started_at={..} docker_finished_at={..} exit_code={..}
  비교: listContainers는 '{state}', git log HEAD는 '{sha}'
  다음 중 하나 실행:
   a) 수동 git commit: cd state && git add -A && git commit -F /tmp/manual-msg
   b) 수동 docker rollback: docker --context home-server compose <역command> <svc>
   c) marker 삭제 (production 그대로 두고 audit 포기): rm state/.pending/{nonce}.json
  ```
  - **Why:** 자동 git commit은 docker 실제 결과 미확인 상태에서 audit lie 위험. read-only mode 차단은 과다 — 운영자가 직접 다른 stack도 점검해야 할 수 있음. 사용자 의사결정 + 명령 안내가 안전망 sweet spot.
  - **How to apply:** `src/server.ts` startup 직후 `recoverPendingMarkers()` 호출. SSE drift event는 첫 `/chat-stream` 연결 직후 emit.

- **D-C3:** **Marker schema — 단일 파일 점진 업데이트.**
  ```json
  {
    "nonce": "uuid",
    "stack": "news",
    "command": "compose restart news",
    "fileEdit": { "path": "state/compose/news.yml", "newContent": "..." },
    "reasoning": "사용자 prompt에 따라 image 1.2→1.3 적용 후 재시작",
    "user_prompt": "news stack 재시작 (image 업데이트)",
    "sha_before": "abc1234",
    "ts_created": "2026-05-08T10:00:00+09:00",
    "docker_started_at": null,
    "docker_finished_at": null,
    "exit_code": null
  }
  ```
  업데이트 단계:
  - (i) docker spawn 직전 `docker_started_at` 추가 + write
  - (ii) `Bun.spawn` exit 직후 `docker_finished_at` + `exit_code` 추가 + write
  - (iii) git commit 완료 시 marker 삭제
  - **Why:** Boot 감지 시 3-state 구별 필수: `docker_started_at == null` → docker 시작 전 (안전, fileEdit만 롤백) / `docker_started_at != null && exit_code == null` → 진행 중 (불확실) / `exit_code == 0 && git uncommitted` → docker 성공 + audit 미커밋 (수동 git commit 안내).
  - **How to apply:** `state/commit.ts`에 `markerWrite/markerUpdate/markerDelete` 함수. 각 update는 fsync sync write로 안전.

- **D-C4:** **Marker 존재 시 새 applyPatch 거절 + 503 envelope.** ToolError `{ problem: 'unfinished applyPatch (nonce={X}, started_at=...)', cause: '이전 세션 복구 미완료', fix: 'boot drift event의 a)/b)/c) 중 1을 따라 복구 후 재시도', retryable: false }`. 동시성 보호 + APPLY-07 'fast-forward only + 동시 쓰기 보호' 일부.
  - **Why:** Multi-pending는 1인 도구에 과다 + git fast-forward 충돌 위험 증가. lock 파일은 bun multi-process 미지원으로 실용성 떨어짐. Reject가 가장 단순 + 안전.
  - **How to apply:** `tools/applyPatch.ts` 진입점에 `if (await fs.glob('state/.pending/*.json').count() > 0) return ToolError`.

### APPLY-06 commit message template (D-D)

- **D-D1:** **Subject 한 줄 + body 구문화 필드.**
  ```
  apply(<stack>): <command> [<file-edit-summary>]

  User-Prompt: <원본 1줄, 200자 cap>
  AI-Reasoning: <proposePatch.reasoning, 500자 cap>
  Diff-Summary: <hunks={N} files={N}> 또는 'no-file-change'
  Nonce: <X>
  ```
  Subject 예시: `apply(krdn-fx): compose down`, `apply(news): compose up -d (image bump 1.2->1.3)`. AUDIT-02 grep audit 친숙: `git log state/ --grep "^apply(news):"` 또는 `git log -G "Nonce: abc"`.
  - **Why:** 자유 form은 AI가 다른 양식으로 적을 위험 → grep 일관성 깨짐. JSON metadata block은 git log 가독성 떨어짐. 구문화 필드 + Subject 한 줄이 sweet spot.
  - **How to apply:** `state/commit.ts buildMessage(action: ApplyResult): string`. unit test로 5개 action type별 Subject/body 정확한 grep 가능 검증.

- **D-D2:** **AI-Reasoning은 `proposePatch` tool input의 `reasoning` 필드에서 추출.** Zod schema에서 `reasoning: z.string().max(500)` 필수. system prompt: "모든 proposePatch는 'reasoning' 필드 필수 (무엇을 왜 변경하는지 1-2문장 한국어)."
  - **Why:** text-delta 추출은 LLM이 안내문/사담을 섞을 위험 + 추출 로직 복잡. tool input은 LLM이 명시적 의도로 작성 — AUDIT-02 'AI reasoning'의 정확한 source. 결정적, 구조화.
  - **How to apply:** `tools/proposePatch.ts` Zod schema. system prompt few-shot 1개로 형식 lock.

- **D-D3:** **필드별 cap + sanitization 시퀀스 명시.**
  - User-Prompt: 200자 cap, AI-Reasoning: 500자 cap, Diff-Summary: 100자 cap (jsdiff hunks 카운트 + 파일 수)
  - Sanitization 순서: (1) `\n` / `\r` → `' / '` 변환 (newline strip) (2) `\``, `$`, `\0` (null) 문자 제거 (3) 필드별 cap (4) git commit 호출은 `Bun.spawn(['git', 'commit', '-F', '/tmp/state-msg-{nonce}.txt', '--'])` 사용 — 임시 파일 경유로 셸 통과 회피, `--` 분리자로 path 인자 혼동 방지.
  - **Why:** Spike 4가 `Bun.$ \`git commit -m\`` body roundtrip을 검증했지만 Phase 2의 multi-line + 한국어 텍스트는 spawn + `-F` 가 더 안전. 필드별 cap은 길이 일관성 + AUDIT-02 git log 가독성 보장.
  - **How to apply:** `state/commit.ts sanitize(text, fieldCap)` 단일 함수. `tools/applyPatch.ts`가 git commit 호출 시 임시 파일 write → spawn `-F` → 임시 파일 unlink. 임시 파일 경로는 `data/.tmp/state-msg-{nonce}.txt` (data/는 .gitignore).

- **D-D4:** **`applied` / `rolled-back`만 `state/` git commit, 나머지(rejected / aborted / expired-nonce / no-fileEdit-without-command-effect)는 SQLite events만 기록.** rollback 완료 시 git revert 추가 commit으로 이전 SHA 복원 (APPLY-04 lock 따라).
  - **Why:** AUDIT-02 "git log만으로 경제 추적" 의도는 'production state 변경'에 한정. reject/abort는 의도된 user action으로 production change 없음 → audit cost 없음. SQLite events는 cost monitoring + 디버깅용 (Phase 1 D-14). git log noise 폭발 회피.
  - **How to apply:** `tools/applyPatch.ts`가 결과 분기 처리: `applied` → state/commit + audit/log endTurn, `rolled-back` → state/git revert + audit/log endTurn(error_envelope 포함), `rejected/aborted/expired` → audit/log endTurn(error_envelope)만, git 호출 없음.

### Pre-execute Gate (D-E, carry-forward)

- **D-E1:** **Phase 2 plan 첫 task: Phase 1 live runtime smoke 5단계 + VOYAGE_API_KEY 회전 검증.** STATE.md "Outstanding operator actions"가 미완. plan 첫 task에서 wrapping (운영자 manual run, 결과 commit으로 lock).
  - **Why:** ROADMAP "Phase 2 Depends on Phase 1"의 strict 해석 + Phase 1 4 SC가 unit-PASS만이므로 라이브 검증 안 끝난 상태로 Phase 2 execute 시작 시 PITFALL 잠재 폭발. discussion 단계에서 결정 lock하여 plan에 wrap.
  - **How to apply:** `02-01-PLAN.md` (또는 plan-phase가 정하는 첫 wave) 첫 task는 비-구현 verification: ① `unset ANTHROPIC_API_KEY && bun run src/server.ts` ② 브라우저 2 NL 쿼리 + drift mutation ③ `sqlite3 data/audit.db "SELECT ..."` ④ VOYAGE 키 회전 ⑤ Phase 1 VERIFICATION 라이브 재기록. 5/5 PASS 후 02-02 진입.

### Claude's Discretion (plan-phase에서 결정)

- **8h 예산 내부 wave/plan split** — APPLY-01..08 + AUDIT-02 + DOG-03 = 10 REQ-ID. plan-phase에서 wave 분해.
- **5-key 'e'(edit) UX 정확한 flow** — 브라우저 textarea? AI에게 counter-proposal 재요청? `$EDITOR` 외부 에디터? — plan-phase에서 결정 (D-B2 단일 tool 구조 위에서). 기본 후보: textarea로 fileEdit.newContent 수정 → `e` 다시 누르면 재제안 흐름으로 LLM 호출.
- **system prompt 본문** — D-B1 7-command 화이트리스트, D-B2 reasoning 필수, D-D1 commit message 양식 — 모두 system prompt에 lock 시점은 plan-phase 또는 02 LOOP-* plan.
- **AUDIT-02 검증 NL 쿼리** — ROADMAP SC#5 "/ship으로 PR 생성"은 lock. 추가 grep 패턴(`git log state/ --since=last-week --pretty=full`)은 plan-phase 또는 verify-phase에서 사용자 직접 입력.
- **test compose stack 구성 세부** — D-A3에서 alpine 더미 2개로 lock. 정확한 image / port / depends_on은 plan-phase 결정.
- **Phase 2 FRICTION carry-over 위치** — `.planning/phases/02-*/FRICTION.md` 신설 (Phase 0/1 패턴 따라).

### Folded Todos

(없음 — `.todos/backlog.json` 미사용)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### 프로젝트 정의 (반드시 우선 확인)

- `.planning/PROJECT.md` — Core Value, Constraints, Key Decisions (D-09/D-10 lock), Out of Scope. Phase 2 SSOT.
- `.planning/REQUIREMENTS.md` — Phase 2는 APPLY-01..08, AUDIT-02, DOG-03 (총 10개) 커버. **APPLY-04는 docker→git 순서 lock**, **APPLY-08은 D-10에 의해 Opus 4.6으로 정정**.
- `.planning/ROADMAP.md` Phase 2 섹션 — Goal + Success Criteria 5개 + Critical Research Corrections #5 (5-key 인라인 legend).
- `.planning/STATE.md` "Blockers/Concerns" — Phase 1 live smoke 5단계 + VOYAGE_API_KEY 회전 (Phase 2 plan 첫 task에서 wrap, D-E1 lock).
- `DESIGN.md` — 원본 설계 (autoplan review final, correction #5 = 5-key 인라인 legend 필수).

### Phase 0/1 carry-forward (재논의 금지)

- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` — D-01..D-11 모두 carry-forward (특히 D-09 cli-proxy-api endpoint, **D-10 Opus 4.6**, D-11 fallback).
- `.planning/phases/01-read-only-knowledge-layer/01-CONTEXT.md` — D-12..D-15 모두 carry-forward (특히 D-14.1 SQLite hybrid schema, D-15.4 envelope JSON.stringify, D-13.4 staleness).
- `.planning/phases/01-read-only-knowledge-layer/01-VERIFICATION.md` — Phase 1 22 REQ-IDs / 5 SC 상태 + outstanding operator actions.
- `.planning/phases/00-bootstrap-spikes/FRICTION.md` — Phase 0 10개 마찰 (특히 #8 환경변수, #10 docker context = `home-server`).
- `.planning/phases/01-read-only-knowledge-layer/FRICTION.md` — Phase 1 마찰 (#11..#20).

### Phase 2 직접 인풋 (research output)

- `.planning/research/STACK.md` — `diff@9` (jsdiff createPatch), `crypto.randomUUID` (nonce), bun:sqlite. Phase 2 재인 dependency 0.
- `.planning/research/ARCHITECTURE.md` — Phase 2 build flow 다이어그램 (proposePatch → approval → applyPatch 2PC). **단, Pattern 4 prose는 git→docker로 적혀 있으나 REQUIREMENTS APPLY-04 + ROADMAP SC#2가 docker→git으로 lock — 텍스트 오류, 권위 = REQUIREMENTS.** PITFALLS Pitfall 2 prevention 코드 예시도 docker→git이므로 일치.
- `.planning/research/PITFALLS.md` — Phase 2 critical pitfalls #2 (applyPatch non-atomicity), #3 (approval-gate race + nonce), #8 (state/ git rebase 금지), #11 (operator OOB drift). 각 prevention 코드는 D-A1..D-D4 결정 위에서 plan task로 wrap.
- `.planning/research/FEATURES.md` — Phase 2 feature 우선순위.
- `.planning/research/SUMMARY.md` — 5 critical correction 표 + Phase 매핑.

### 기존 코드 통합 포인트 (Phase 1 산출)

- `src/env.ts` — `COPILOT_MODEL_PROPOSE` (D-10 = `claude-opus-4-6`) 검증 이미 lock. Phase 2 applyPatch 시 LLM 모델 swap만.
- `src/server.ts` — Phase 1 `/chat-stream` + 4 startup probe. Phase 2는 `recoverPendingMarkers()` 추가 + `/approval/:id` route 추가.
- `tools/_envelope.ts` — `ToolError` shape + `run<T>(name, fn, timeoutMs?, auditParentId?, auditInput?)`. Phase 2 proposePatch / applyPatch도 동일 wrapper 사용.
- `tools/_index.ts` — Zod schema → JSON schema barrel. Phase 2가 proposePatch / applyPatch 추가만.
- `agent/loop.ts` — `iterate()` HTTP-agnostic + tool dispatch. Phase 2는 proposePatch tool 호출 시 `event:approval-required` 발신 후 SSE 일시 중지(approval/store.ts의 promise resolve 대기) → 승인 후 재개. Plan-phase에서 정확한 인터럽트 메커니즘 결정.
- `agent/sse.ts` — 6 SSE event union + `createChunkWatchdog`. Phase 2는 `approval-required` / `applied` / `rolled-back` 3개 union 추가.
- `audit/log.ts` — `beginTurn / logTool / endTurn`. Phase 2 commit fail/rollback도 `endTurn(error_envelope)`로 기록.
- `kb/stale-check.ts` — Phase 1 그대로 (services.yaml만, D-A4).
- `state/services.yaml` — 5 stack 5 필드 보강 완료. Phase 2 mirror 추가 시점에 services.yaml 수정 흐름은 D-B2 단일 tool로 통합.
- `public/index.html` — Phase 1 6 SSE handler. Phase 2는 `<form id="approval-form">` + 5-key keyboard handler + nonce hidden field + 인라인 legend(`y=apply n=reject e=edit d=diff a=abort`) 항상 표시.

### 라이브 환경 / 인프라

- `~/.claude/CLAUDE.md` "운영 서버 (192.168.0.5)" — `home-server` Docker context, `ssh gon@192.168.0.5` 액세스, cli-proxy-api(192.168.0.5:8317).
- `state/services.yaml` 5 stack — Phase 2 init scripts/init-state-compose.ts 입력 (각 stack의 compose path).
- `state/SPIKE-4-RESULT.md` — `Bun.$ git commit body roundtrip` 검증. D-D3 sanitization은 임시 파일 + spawn `-F`로 보강.
- `state/SPIKE-6-RESULT.md` — cli-proxy-api opus-4-6 검증 (D-10).

### 외부 공식 문서

- jsdiff `createPatch` / `applyPatch`: `https://www.npmjs.com/package/diff` (Phase 2 proposePatch 핵심)
- Anthropic streaming + tool_use docs: `https://docs.anthropic.com/en/api/messages-streaming`, `https://docs.anthropic.com/en/agents-and-tools/tool-use`
- htmx-ext-sse: `https://htmx.org/extensions/sse/` (Phase 2 5-key form + sse-swap)
- Bun shell `Bun.$`: `https://bun.sh/docs/runtime/shell`
- bun:sqlite: `https://bun.com/docs/runtime/sqlite`
- git pre-commit hook + fast-forward only: `https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks`

### Dogfood 메타 (DOG-02, DOG-03)

- `~/.claude/plans/gstack-gsd-melodic-raven.md` — gstack/gsd 통합 설계. Phase 2 마찰 메모 입력처.
- `CLAUDE.md` (프로젝트 루트) — gstack+gsd 라우팅 규칙. Phase 2 종료 시 `/ship` 흐름이 DOG-03 검증.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (Phase 0/1 산출)

- **`src/env.ts`** — Zod v4 schema + `loadEnv()`. `COPILOT_MODEL_PROPOSE=claude-opus-4-6` 검증 이미 통과. Phase 2 applyPatch entry에서 `env.COPILOT_MODEL_PROPOSE` 사용.
- **`src/server.ts`** — Phase 1 `/chat-stream` + 4 startup probe. Phase 2 추가: `/approval/:id` POST handler, `recoverPendingMarkers()` startup probe (5번째).
- **`tools/_envelope.ts`** — D-15 envelope shape + run() wrapper. Phase 2 proposePatch / applyPatch도 그대로 사용.
- **`tools/_index.ts`** — Zod → JSON schema export. Phase 2 새 tool 2개만 추가.
- **`tools/listContainers.ts`** — Phase 2 D-C3 boot detect 시 docker_finished_at 결정에 사용 + D-B3 역 docker rollback 시도 후 결과 검증에 사용.
- **`agent/loop.ts iterate()`** — Phase 2는 proposePatch tool dispatch 시 별도 lifecycle (interrupt + resume on approval). Plan-phase에서 정확한 메커니즘 결정. 후보: tool result를 approval/store.ts의 Promise resolve로 대기 → 승인 후 applyPatch 호출 → 결과 tool_result로 LLM에 반환.
- **`agent/sse.ts SseEvent` union** — Phase 2 + 3 events: `approval-required` / `applied` / `rolled-back`.
- **`audit/log.ts`** — beginTurn/logTool/endTurn. Phase 2도 동일 schema 재사용 (D-14.1 hybrid).
- **`kb/stale-check.ts`** — Phase 1 그대로 (D-A4).
- **`spikes/04-git-commit.test.ts`** — Bun.$ git commit body roundtrip 검증. D-D3에서 spawn + `-F` 임시 파일 경유로 보강된 패턴.
- **`spikes/06-proxy-fallback.smoke.ts`** — D-09 cli-proxy-api + D-11 fallback. applyPatch LLM 호출도 동일 패턴.
- **`state/services.yaml`** — 5 stack 5 필드 보강 완료 (Phase 1). Phase 2 D-B2 fileEdit.path 후보 중 하나.

### Established Patterns

- **GSD `.planning/` 컨벤션** — Phase 2 산출물도 `.planning/phases/02-propose-apply-approval-gate/`.
- **GSD commit convention** — `docs(02): <메시지>` (manual git commit, gsd-tools.cjs 부재 carry-forward, FRICTION #1).
- **Korean response rule** — 사용자 대면 출력은 한국어. 코드 식별자 영문, 주석 한국어.
- **D-15.4 tool_result content = JSON.stringify(envelope)** — Phase 2 proposePatch/applyPatch도 동일.
- **D-12.3 diff 표시 + 수동 mv 패턴 (Phase 1 services.yaml 보강)** — Phase 2 D-B2 fileEdit는 5-key UI로 dogfood 진화.
- **D-14.4 모든 tool 호출 audit row** — proposePatch / applyPatch도 _envelope.run() 거쳐 자동 audit.

### Integration Points

- **`src/env.ts loadEnv()`** — Phase 2 추가 env 변수: 없음 (Phase 0이 모두 lock). 다만 `recoverPendingMarkers()` 호출이 startup probe로 5번째 추가.
- **SSH `gon@192.168.0.5` `cd /원격경로/{stack} && docker compose <D-B1 7-list>`** — applyPatch의 핵심 entrypoint (D-A5 lock). Phase 1 readCompose의 SSH 패턴(ConnectTimeout=10, BatchMode=yes) 재사용.
- **SSH `gon@192.168.0.5` `cat > /원격경로/{stack}/docker-compose.yml`** (또는 `scp`) — applyPatch fileEdit 있을 때 원격 파일 갱신. state/compose/{stack}.yml mirror write + 원격 파일 갱신이 한 묶음. 원격 갱신 실패 시 git commit 안 함 (APPLY-04 docker→git 순서 보호).
- **D-B1 7-command** — `compose up -d <svc> | down <svc> | restart <svc> | start <svc> | stop <svc> | logs <svc> --tail | ps`. AI Zod schema 화이트리스트.
- **`Bun.spawn(['ssh', 'gon@192.168.0.5', \`cd /원격경로/{stack} && docker compose ${command}\`])`** — applyPatch가 실행하는 정확한 명령 (D-A5 lock). 명령 전체가 원격 192.168.0.5에서 실행되어 compose 파일 파싱과 relative volume 경로 모두 원격 기준으로 정상. `docker --context home-server compose -f` 패턴은 사용하지 않음 (로컬 CLI가 원격 절대경로를 못 읽고 relative volume도 로컬 기준으로 해석되어 깨짐). state/compose/{stack}.yml 미러는 audit/diff 표시 용도, applyPatch가 fileEdit 있으면 SSH `cat >` 또는 `scp`로 원격 파일도 동시 동기화 후 docker compose 명령 실행.
- **`Bun.spawn(['git', 'commit', '-F', tmpFile, '--'], { cwd: 'state' })`** — D-D3 sanitization 시퀀스. 임시 파일 + `-F` + `--` 분리자 + `Bun.spawn`(`Bun.$`아님 — 셸 통과 회피).
- **state/.git/hooks/pre-commit** — APPLY-07 fast-forward only enforce. Phase 2 첫 plan에 hook 작성 task 포함.
- **`approval/store.ts`** — 신규 모듈. `Map<sessionId, PendingApproval>` + nonce + 2분 expiresAt + consumed flag (PITFALL #3 prevention 코드 그대로).

</code_context>

<specifics>
## Specific Ideas

### 사용자가 명시적으로 강조한 결정 (carry-forward)

- **2PC 순서**: docker exec 먼저 → state/ git commit 나중 (APPLY-04 + ROADMAP SC#2 lock). ARCHITECTURE.md Pattern 4 prose는 오래된 텍스트 — REQUIREMENTS가 권위.
- **5-key UX**: `y/n/e/d/a` + 인라인 legend 항상 표시 (DESIGN.md correction #5 lock). Plan-phase에서 정확한 'e' UX flow 결정.
- **2분 nonce + atomic consumed** (PITFALL #3 prevention 코드 lock).
- **fast-forward only state/ pre-commit hook** (APPLY-07 lock).
- **Phase 2 LLM = `claude-opus-4-6`** (D-10 정정, COPILOT_MODEL_PROPOSE — APPLY-08 텍스트의 4.7은 외부 API 미공개).
- **PROD 절대 조작 금지** — D-A3 192.168.0.8 로컬 test compose stack 신설.
- **state/는 'AI intent log'** (PROJECT.md). 원격 파일 직접 SCP 쓰기는 v2 deferred (D-A1).

### 검증 시나리오 (ROADMAP SC + D-A3 환경)

ROADMAP Phase 2 Success Criteria 5개:
1. proposePatch unified diff + 5-key 인라인 legend → 검증: D-A3 test compose에서 LLM이 fileEdit + command 제안 시 UI 5-key 표시
2. y → docker exec → git commit (2PC 순서) → 검증: test compose에 alpine restart, `git log state/`에 commit, `docker ps`에 재시작 확인 가능
3. docker fail → git commit 안 됨 → 검증: 의도적 fail (잘못된 service name) → marker 없는 상태 + git log 변화 없음
4. `git log state/` body에 user prompt + AI reasoning → 검증: D-D1 grep `^apply(` + body parse 200자/500자 cap 확인
5. `/ship`으로 PR 생성 → 검증: gstack 라우팅 / DOG-03 / 종료 시 dogfood 마찰 누적

추가 사용자 주관 시나리오 (plan-phase 또는 verify-phase):
- crash window 시뮬레이션: docker exec 직후 `kill -9 $(pgrep bun)` → 재기동 → marker 발견 + drift event 표시 확인 (D-C2)
- git commit fail 시뮬레이션: pre-commit hook 일시 fail로 만들고 applyPatch → 역 docker rollback 시도 envelope 확인 (D-B3)

### 시간 예산 강조

ROADMAP: **Phase 2 ≤8h.** Phase 0(~2.3h) + Phase 1(~2h 44m) = ~5h 사용. 18h 총 예산 중 약 13h 남음. plan-phase에서 8h 내부 wave 분해 시 D-E1 pre-execute gate(Phase 1 smoke 5단계, ~30min)가 첫 task로 포함.

### dogfood 메타 강조

Phase 2는 통합 파이프라인의 세 번째 검증 사례. Phase 0/1 FRICTION 20개에 더해 Phase 2 신규 마찰을 누적. 특히:
- 5-key UI dogfood (services.yaml 보강에서 mv + git commit으로 시뮬레이션했던 흐름이 정식 5-key 게이트로 진화)
- gsd-tools.cjs 부재 carry-forward (manual git commit 패턴이 Phase 2 산출물 commit에도 적용)
- `/ship` 흐름이 DOG-03 검증 (Phase 2 종료 시 PR 생성 매끄러움)

</specifics>

<deferred>
## Deferred Ideas

### Phase 2 plan-phase에서 결정 (Claude's Discretion)

- 8h 예산 내부 wave/plan split (10 REQ-ID)
- 5-key 'e'(edit) UX 정확한 flow (브라우저 textarea? AI 재요청? `$EDITOR`?)
- system prompt 본문 (D-B1 7-command + D-B2 reasoning 필수 + D-D1 commit message 양식)
- AUDIT-02 추가 grep 패턴
- test compose stack 정확한 image / port / depends_on
- Phase 2 FRICTION carry-over 위치 (`.planning/phases/02-*/FRICTION.md` 추천)
- LOOP에서 proposePatch tool dispatch 시 interrupt + resume 메커니즘 (Promise resolve 대기 패턴 후보)

### Phase 2 execute 직전 게이트 (D-E1)

- Phase 1 live runtime smoke 5단계 (STATE.md "Outstanding operator actions"):
  1. `unset ANTHROPIC_API_KEY && bun run src/server.ts`
  2. 브라우저 "ais-prod redis 어디 쓰여?" → SSE + RAG + tool call (Criteria #1)
  3. "지난밤 새벽 1-3시 voice 에러 패턴" → readLogs 호출 + 답변 (Criteria #2)
  4. services.yaml drift mutation → banner 확인 (Criteria #3)
  5. `sqlite3 data/audit.db "SELECT name, ok, duration_ms FROM events"` (Criteria #4)
- VOYAGE_API_KEY 회전 (HIGH 보안, Phase 1 carry-forward outstanding)

### Future milestones (v2)

- 원격 192.168.0.5 docker-compose.yml 직접 SCP 쓰기 (Phase 2는 state/ 미러 단방향만)
- AI 자유 docker exec 명령 (compose 7-union 외 — exec/inspect/network 등)
- 다중 세션 동시 applyPatch (marker rotate)
- Auto-sync `services.yaml` 보강 흐름 (PITFALL #11 detection이 자동 proposal)
- multi-host (MULTI-01) / kb auto-sync (KB-AUTO-01) / NOTIFY-01 Discord webhook / OSS-01 — REQUIREMENTS v2

### Reviewed Todos (not folded)

(없음 — `.todos/backlog.json` 미사용)

</deferred>

<research_artifact_corrections>
## Research artifact corrections (planner / executor에게 알림)

다음은 `.planning/research/` 산출물에서 발견된 모순 — Phase 2 planning/execution에서 신뢰해야 할 권위:

1. **2PC 순서 (CRITICAL)**: ARCHITECTURE.md "Pattern 4: 2-Phase Commit for applyPatch"의 prose 설명("commits to state/ first, then runs docker exec")은 **오래된 텍스트**. 실제 권위:
   - REQUIREMENTS APPLY-04: "(1) docker exec on remote → (2) state/ git commit"
   - ROADMAP Phase 2 Success Criteria #2: "docker exec이 먼저 실행되고 성공 후에만 state/ git commit"
   - PITFALLS Pitfall 2 prevention 코드 예제: `runDockerCommand(cmd)` BEFORE `git commit`
   - PROJECT.md 본 결정: D-09/D-10/D-11에서 docker→git 명시
   - **결론: Planner와 Executor는 docker exec → git commit 순서를 따른다.** ARCHITECTURE.md Pattern 4 prose 첫 문장은 무시.

2. **APPLY-08 모델명 (이미 정정됨)**: REQUIREMENTS APPLY-08은 "Opus 4.7"로 적혀 있으나 PROJECT.md Key Decision D-10이 정정: 외부 API 미공개로 `claude-opus-4-6` 사용. `.env` `COPILOT_MODEL_PROPOSE=claude-opus-4-6`. 4.7 출시 시 .env 한 줄 변경.

3. **APPLY-04 텍스트 보강 (D-B3)**: APPLY-04는 "docker fail → git 시도 안 함, git fail → git revert"만 명시. 새 case "docker 성공 + git commit 실패"는 D-B3에서 보강(역 docker rollback 시도 + envelope alert).

4. **APPLY-05 marker 시점 명시 (D-C1)**: APPLY-05는 "marker 작성 + boot detect"만 명시. 정확한 시점/내용/삭제는 D-C1..D-C4에서 lock.

</research_artifact_corrections>

---

*Phase: 2-Propose/Apply with Approval Gate*
*Context gathered: 2026-05-07*
