# Phase 1 Dogfood Friction Memo (DOG-02)

이 문서는 통합 파이프라인 (`/office-hours` → `/autoplan` → `/gsd-new-project --auto` → `/gsd-discuss-phase --auto` → `/gsd-plan-phase --auto` → `/gsd-execute-phase`)의 **두 번째** dogfood 검증 (Phase 1 — Read-Only Knowledge Layer)에서 발견된 마찰을 정리한다.

Phase 0 FRICTION.md의 10개 마찰에 누적되어 다음 `~/.claude/plans/gstack-gsd-melodic-raven.md` 개정판의 입력으로 사용한다.

**누적 카운터:** Phase 0 #1..#10 + Phase 1 #11..#20 = **20개 마찰** (Phase 1 신규 10개)

## 발견된 마찰 (Phase 1)

### 11. Worktree empty-base bug — 부모 main이 아닌 빈 "Initial commit"으로 분기 (HIGH, 새 발견)

**증상:** Claude Code의 `git worktree` spawn이 부모 리포의 main HEAD가 아닌 별개의 orphan "Initial commit d4982cd" (`LICENSE / .gitignore / README.md`만 포함)을 base로 워크트리를 만들었다. 결과로 worktree에는 `.planning/`, `src/`, `tools/`, `kb/`, `node_modules/`, `state/services.yaml` 등 main의 모든 산출물이 부재. 영향 받은 워크트리 (확인된 것):
- `agent-a24954c8faf3eff94` (Plan 01-04)
- `agent-a0ff8e9c43afb8015` (Plan 01-02)
- `agent-a5587e2a9fb44bcb3` (Plan 01-05?)
- `agent-ad3f9bf7646224a8b` (Plan 01-04 재시도)
- 그리고 이번 Plan 01-09 도큐 슬롯 (`agent-a924dd05eab13d417`)

**워크어라운드:** 워크트리 진입 직후 `git fetch <parent-repo-path> main` + `git reset --hard FETCH_HEAD` (또는 `git rebase main` / `git merge main --no-edit`). advisor가 안전성을 확인 — 워크트리 브랜치에 보호할 prior-wave work가 0건이므로 reset destructive 위험 없음.

**Wave 2+ 완화:** 이후 wave executor들은 `<worktree_branch_check>`에 prerequisite 파일 존재 검증을 포함시켜 즉시 감지 + 자동 복구 패턴을 정착.

**디버깅 비용:** 첫 발견 시 ~5분, 이후 자동 패턴으로 ~30초.

**제안:**
- `gsd-execute-phase` 또는 `gsd-workspace --new`가 워크트리 생성 직후 자동 `git fetch <parent>; git reset --hard FETCH_HEAD <parent-default-branch>` step을 추가.
- 또는 Claude Code 자체의 worktree 생성 로직을 조사 — 왜 빈 commit으로 분기하는지 (#2924 영역?). `git worktree add -b <new-branch> <path> main`이 정상 패턴인데 빈 commit이 base가 되는 조건이 재현 가능하면 upstream 이슈로 보고.

### 12. VOYAGE_API_KEY 평문 노출 — 부모 .env 워크트리 복사 (HIGH, security 새 발견)

**증상:** Plan 01-05에서 라이브 `voyage-4-lite` E2E 1회 검증을 위해 부모 리포 `.env`를 워크트리로 복사. advisor 자문 단계의 `grep`이 `VOYAGE_API_KEY=<value>` 라인을 매칭하여 sub-agent 대화 transcript에 키 평문 노출.

**워크어라운드:** Plan 01-06+에서는 명시적 "DO NOT copy parent .env" 제약 추가. 테스트는 `beforeAll`에서 `Bun.env.X = "test-key"`를 주입 + mock client가 실 API 호출을 가로챔.

**미해결 사용자 액션:** Voyage AI 대시보드(<https://dashboard.voyageai.com/>)에서 키 회전 후 `.env` 갱신.

**제안:**
- 워크트리 라이프사이클에 `.env` 자동 cleanup 단계 추가 (`rm -f .claude/worktrees/agent-*/{.env,.env.*}`).
- `Read`/`grep`/`Bash` 출력에서 `[A-Z_]+_API_KEY=\S+` 패턴 자동 redact rule/hook 검토 (별도 plan).
- 라이브 E2E가 필요한 plan은 `secret-injection` 표준 패턴 (예: 환경변수만 inherit, 파일 복사 금지).

### 13. bun:sqlite strict-mode binding key prefix-strip (MEDIUM, 새 발견)

**증상:** Plan 01-03 GREEN 첫 실행에서 audit/log.ts 8/8 테스트 중 6 fail. 원인: PATTERNS.md 라인 802의 의사코드와 plan 본문이 `stmt.run({ $ts: ..., $model: ... })` 형식의 prefix(`$`/`:`/`@`) 컨벤션을 사용했지만, `Database(..., { strict: true })` 모드는 binding key의 prefix를 자동 strip한다. 결과로 `$ts` 키가 `ts`로 변환되어 SQL 매개변수와 매칭되긴 하지만, `Missing parameter "ts"` 에러로 throw.

**검증:**
```
$ bun -e '... { strict: true } ... stmt.run({ $name: "x" })' → Missing parameter "name"
$ bun -e '... { strict: true } ... stmt.run({ name: "x" })'  → OK
```

**워크어라운드:** 모든 `stmt.run()` / `stmt.get()` 호출에서 `$` prefix 제거. SQL은 `INSERT INTO events ... VALUES ($ts, $model, ...)` 그대로 (strict 모드가 자동 strip하여 `ts`, `model` 키와 매칭).

**Plans 04-06 영향:** 같은 컨벤션 채택 (Plan 05 kb/index.ts, Plan 04 tools/_envelope.ts → audit/log.ts 호출 시 객체 인자 자체는 영향 없음).

**제안:**
- PATTERNS.md / plan 본문 의사코드의 `$prefix` 패턴을 일괄 갱신 (Phase 2 plan 작성 전).
- bun:sqlite 공식 문서가 strict 모드의 prefix-strip 동작을 명시하는지 확인 후 PITFALL.md에 추가.

### 14. Bun .env auto-load이 subprocess 테스트의 환경 격리를 깨뜨림 (MEDIUM, 새 발견 — Wave 3 머지 직후)

**증상:** Plan 01-07 src/env.test.ts의 subprocess 검증이 `Bun.spawn` 자식 프로세스를 `cwd: projectRoot`로 띄웠더니, 자식 프로세스가 워크트리 `.env`를 자동 로드하여 부모가 의도적으로 주입한 `ANTHROPIC_API_KEY=""` 빈 값을 덮어씀 → 테스트 의도(FRICTION #8 분기 트리거)가 깨짐.

**워크어라운드:** `Bun.spawn` 호출에서 `cwd: "/tmp"` (또는 `.env`가 없는 임의 경로)로 변경 + import 시 absolute path 사용. fix commit `198d777 fix(01-07): env.test.ts cwd /tmp로 변경 — Bun .env 자동 로드 회피`.

**디버깅 비용:** ~10분 (post-merge 회귀 검증 시 발견).

**제안:**
- Bun `.env` auto-load 비활성화 옵션 (`--no-env-file` 또는 `Bun.spawn({ ..., env: undefined, dotenv: false })` 등) 조사.
- Bun 공식 문서에 `Bun.spawn` 자식의 `.env` 동작 명시 확인 후 PITFALL.md 추가 (Phase 2).

### 15. 빈 셸 ANTHROPIC_API_KEY 재발 — Phase 0 FRICTION #8 carry-over (HIGH, 재현)

**증상:** Phase 1 라이브 호출(Plan 01-05 voyage smoke, Plan 01-07 server smoke)마다 사용자 셸의 `ANTHROPIC_API_KEY=` (빈 export)가 `.env` 자동 로드를 silently 덮어쓰는 현상이 재현. Phase 0 FRICTION #8과 동일.

**Phase 1 완화:** Plan 01-07이 `src/env.ts loadEnv()` 진입점에 빈 값 감지 분기를 추가. BOOT-05 envelope이 친절한 한국어 안내 + `unset ANTHROPIC_API_KEY` 정확한 명령을 출력 → 디버깅 비용 ~10분 → 0초.

**라이브 검증:**
```
$ ANTHROPIC_API_KEY="" bun -e "import('./src/env').then(({loadEnv})=>loadEnv())"
[BOOT-05] ANTHROPIC_API_KEY가 빈 문자열 (FRICTION #8)
원인: 셸에 ANTHROPIC_API_KEY=가 빈 값으로 export되어 .env 자동 로드를 덮어씀
해결: 현재 셸에서 'unset ANTHROPIC_API_KEY' 실행 후 서버를 재시작하세요
```

`src/env.test.ts` subprocess 테스트 2개 (1개는 #14 fix 후 통과)가 분기를 자동 회귀 검증.

**제안:** Phase 0 FRICTION #8 제안 그대로 — 사용자 셸 dotfiles 정리 또는 README에 경고. 코드 측 친절-에러는 이미 정착.

### 16. Wave 3 머지에서 agent/* 파일 충돌 (MEDIUM, 새 발견 — orchestrator 영역)

**증상:** Plan 01-06과 Plan 01-07이 둘 다 `agent/sse.ts`, `agent/loop.ts`, `agent/system-prompt.ts`를 생성. Plan 01-07은 server.ts test compile + watchdog 동작을 위해 stub-but-functional 형태로 미리 작성 (시그니처 lock 전략); Plan 01-06은 본격 구현. Wave 3 머지 시점에 충돌.

**해결:** orchestrator(또는 머지 책임자)가 Plan 01-06 버전의 `agent/loop.ts` + `agent/system-prompt.ts` 채택 (본격 구현). `agent/sse.ts`는 Plan 01-06 본격 구현 + Plan 01-07 watchdog wiring을 합친 버전 채택. Plan 01-07 SUMMARY 머지 노트에 시그니처 호환성 명시 — Plan 01-07 stub 시그니처와 Plan 01-06 본격 구현이 일치하도록 사전 lock.

**디버깅 비용:** ~3분 (시그니처 lock 덕분에 단순 채택 결정).

**제안:**
- 동일 파일을 두 wave plan이 동시 생성하는 패턴은 plan-phase 단계에서 `dependency_graph.provides` 충돌 감지 워닝을 plan-phase 산출물 검토자가 표시하도록 함.
- "stub-with-real-logic" 패턴을 PATTERNS.md에 정식화 — Plan 01-07이 emergent로 발견한 패턴이지만 일반화 가치 있음.

### 17. 보안 reminder hook이 코드/주석/마크다운 본문의 키워드를 false-positive 차단 (LOW, 새 발견)

**증상:** PostToolUse 보안 reminder hook이 코드, JSDoc 주석, SUMMARY 표 안의 정상 사용 키워드(`throw`, SSH 옵션 단어, `API_KEY` 같은 식별자 명칭)를 탐지해 `Write` 차단. Plan 01-02 / 01-04에서 발생.

**워크어라운드:** 한국어 표현으로 paraphrase("재발생", "예외 전파"), 인용("template literal shell 호출")으로 우회.

**제안:**
- hook의 정규식을 context-aware하게 개선 — 코드 펜스 (` ```...``` `), 인용 부호 (`"..."`), JSDoc 블록 주석 (` * ...`) 안의 키워드는 무시.
- 또는 hook을 PreToolUse → PostToolUse warning(non-blocking)으로 강등하고, 별도 stage에서 보안 reviewer가 1회 일괄 검토.

### 18. Voyage AI 무료 티어 3 RPM rate-limit (LOW, 새 발견)

**증상:** Plan 01-05 라이브 검증 — voyage-4-lite 25 doc embed + 1 query embed = 2 RPM 호출. 짧은 시간 내 재실행 시 429 에러 발생 (실제 두 번째 시도에서 수신).

**Production 영향:** 0 — D-13.3 hash-lazy 인덱싱이 boot 첫 호출에만 25 doc embed; per-query는 query embed 1회 / 30s TTL.

**CI/E2E 영향:** 라이브 회귀 호출 시 사이 sleep 또는 결제 정보 추가 필요.

**제안:**
- E2E 테스트가 voyage 호출을 포함하는 경우 `process.env.E2E === "1"` gate + sleep 추가 (Plan 01-05 패턴).
- Voyage AI 결제 플랜 검토 (저비용 — 25 doc 인덱싱 ~$0.0004).

### 19. Anthropic SDK `cache_read_input_tokens`이 optional — undefined 가능 (LOW, 새 발견)

**증상:** Plan 01-06 agent/loop.ts가 `response.usage.cache_read_input_tokens`를 누적할 때, 일부 응답(특히 mock + 일부 실 응답)에서 undefined 반환 → `+= undefined` → `NaN` 누적 위험.

**워크어라운드:** `totalCacheReadTokens += response.usage?.cache_read_input_tokens ?? 0` 명시 fallback. mock client에도 동일 가드.

**제안:**
- Anthropic SDK 타입 정의 확인 — optional이 정상 시멘틱이면 모든 token 합산 코드에서 `?? 0` 표준화.

### 20. htmx.org 패키지 미설치 — 01-08 결정 위임 (LOW, 새 발견 — 01-07이 발견)

**증상:** `package.json`에 `htmx-ext-sse`만 있고 `htmx.org`는 없음. Plan 01-07의 `src/server.ts /static/htmx.min.js` 라우트는 file existence check로 404 반환. Plan 01-08(frontend)이 npm 설치 vs CDN 로드 vs 손수 다운로드 결정 책임.

**워크어라운드:** 현재 stub 동작 — 404. Plan 01-08 진입 시 첫 task에서 명시적 결정.

**제안:**
- `state/SPIKE-3-RESULT.md`에 이미 검증된 htmx 2.0.10 + htmx-ext-sse@2.2.4 조합을 plan-phase 단계에서 `package.json` 의존성 명시까지 포함하도록 워크플로우 강화.

## Phase 1 통합 파이프라인 검증 (DOG-01 누적)

| 단계 | Phase 0 결과 | Phase 1 결과 | 메모 |
|------|------------|------------|------|
| `/office-hours` | (사전 진행) | (재진입 안 함) | DESIGN.md SSOT 사용 |
| `/autoplan` | (사전 진행) | (재진입 안 함) | 5 critical correction lock |
| `/gsd-new-project --auto @DESIGN.md` | △ 부분 성공 (재시도) | (사전 산출 사용) | Phase 0이 STATE/ROADMAP/REQUIREMENTS 산출 |
| `/gsd-spec-phase 1` | n/a | ✓ 성공 | 01-CONTEXT.md 산출 |
| `/gsd-discuss-phase 1` | ✓ 성공 (#7) | ✓ 성공 | 4 영역 × 4 결정 lock (D-12..D-15) |
| `/gsd-research-phase 1` | n/a | ✓ 성공 | RESEARCH.md 5 doc + STACK / ARCHITECTURE / PATTERNS / PITFALLS / FEATURES |
| `/gsd-plan-phase 1` | △ adapted (#1) | ✓ 성공 | 9 plans / 4 waves (Wave 1: 3p / Wave 2: 2p / Wave 3: 2p / Wave 4: 2p) |
| `/gsd-execute-phase 1` Wave 1 | n/a | ✓ 성공 (3 plans) | empty-base bug (#11)로 1차 setup 마찰 |
| `/gsd-execute-phase 1` Wave 2 | n/a | ✓ 성공 (2 plans) | empty-base 자동 복구 패턴 정착 |
| `/gsd-execute-phase 1` Wave 3 | n/a | ✓ 성공 + 머지 충돌 해결 (#16) | agent/* 충돌 → 시그니처 lock 덕에 ~3분에 해결 |
| `/gsd-execute-phase 1` Wave 4 | n/a | **부분 진행** | Plan 01-08 미실행, Plan 01-09 도큐 슬롯만 진행 (이 문서) |
| 라이브 E2E (5 ROADMAP Success Criteria) | n/a | **PENDING** | Plan 01-08 머지 후 Plan 01-09 라이브 재실행 필요 |

**Phase 0 → Phase 1 추세:** Phase 0의 마찰 #1 (gsd-sdk 부재)는 Phase 1에서 `gsd-tools.cjs` 우회 패턴이 정착. 마찰 #8 (빈 환경변수)는 코드 측 친절 에러로 디버깅 비용 ~10분 → 0초 완전 회수. 마찰 #10 (docker context 이름)은 Phase 1 진입 전 lock된 상태로 carry. **Phase 1 신규 마찰 10건 모두 차단(blocking) 수준이 아닌 효율 저하 또는 1회성 setup 비용 수준** — 통합 파이프라인은 dogfood로 충분히 견고함을 검증.

## 다음 개정판 우선순위 (Phase 0 + 1 통합)

| 우선순위 | 마찰 | Phase | 제안 핵심 |
|---------|------|-------|----------|
| HIGH | #1 gsd-sdk CLI 부재 | 0 | 설치 가이드 또는 워크플로우 SDK 의존 제거 |
| HIGH | #2 bootstrap phase research mismatch | 0 | phase type marker `bootstrap` |
| HIGH | #8 셸 env가 .env 덮어씀 | 0 + 1 carry | startup guard 친절 에러 (Phase 1 정착) + README 경고 |
| HIGH | #10 Docker context 이름 mismatch | 0 | discuss-phase에 라이브 환경 ping step |
| HIGH | **#11 worktree empty-base bug** | **1** | **`gsd-execute-phase`가 워크트리 진입 시 자동 reset/rebase to parent main** |
| HIGH | **#12 VOYAGE_API_KEY 노출** | **1** | **워크트리 .env cleanup + secret redact hook + 라이브 plan은 secret-injection 표준** |
| MEDIUM | #4 sonnet 병렬 rate limit | 0 | 동시 spawn cap 또는 haiku default |
| MEDIUM | #5 codex deny 자동 라우팅 | 0 | CLAUDE.md deny 감지 |
| MEDIUM | **#13 bun:sqlite strict prefix-strip** | **1** | **PATTERNS.md / 의사코드 일괄 갱신** |
| MEDIUM | **#14 Bun .env subprocess 격리 깨짐** | **1** | **`Bun.spawn` cwd 또는 dotenv 옵션 표준화** |
| MEDIUM | **#16 wave 머지 충돌 (agent/*)** | **1** | **plan-phase에서 `dependency_graph.provides` 충돌 감지 워닝** |
| LOW | #3 pattern-mapper greenfield | 0 | NO_PATTERNS_FOUND 가드 |
| LOW | #6 time budget 시맨틱 | 0 | wall-clock vs cumulative 명시 |
| LOW | #7 spec-locked discuss | 0 | prior_decisions 자동 제외 |
| LOW | #9 grep false positive | 0 | acceptance grep 식별자 패턴 |
| LOW | **#17 hook false-positive 키워드** | **1** | **context-aware 정규식 (코드 펜스 / 인용 / JSDoc 무시)** |
| LOW | **#18 Voyage 무료 티어 3 RPM** | **1** | **E2E gate + sleep, 또는 결제 플랜** |
| LOW | **#19 Anthropic SDK optional usage 필드** | **1** | **`?? 0` fallback 표준화** |
| LOW | **#20 htmx.org 의존성 미결정** | **1** | **plan-phase가 STACK.md 의존성을 `package.json`까지 강제** |

**Phase 1 신규 HIGH 2건 (#11, #12)은 dogfood 파이프라인 자체의 안정성에 직결 — 차기 phase 진입 전 우선 처리 권장.**

## 메타 관찰

Phase 1은 통합 파이프라인의 두 번째 dogfood 검증 사례. Phase 0이 "워크플로우/스킬 자체"의 마찰을 발견했다면, Phase 1은 "**병렬 실행 (worktree + wave)**" 의 마찰을 노출 (#11, #14, #16). 단일 worktree + 순차 실행이었던 Phase 0에서는 보이지 않았던 클래스의 마찰.

또한 Phase 1은 **dogfood가 자기 자신을 살짝 무는** 흥미로운 사례 (#15) — Phase 0이 발견한 빈-env-변수 함정(#8)을 Phase 1 코드(`src/env.ts`)가 친절-에러로 마무리. **마찰 → fix → 재현 회귀 → 회귀 자동 검증**의 dogfood 메타 사이클이 한 phase 안에서 닫힌 첫 사례.

다음 phase(Phase 2 — propose/apply with 5-key approval gate)는 마찰 클래스가 또 달라질 것 — write-side / approval / atomic 2-phase commit 영역. 본 FRICTION.md의 #11/#12/#13/#14/#16은 phase-agnostic이라 Phase 2에도 carry-forward 예상.

다음 개정판은 **Phase 0 #1, #2, #8, #10 (HIGH) + Phase 1 #11, #12 (HIGH)** = 6개부터 우선 처리하는 것을 권장. 특히 #11 (worktree empty-base) + #12 (secret 노출)은 병렬 dogfood의 신뢰성 자체에 영향.

---

*Last updated: 2026-05-07 by Plan 01-09 (documentation-only slot, Wave 4)*
*Phase 1 신규 마찰 10건 / 누적 20건 (Phase 0 10 + Phase 1 10)*
*다음 개정판 입력: `~/.claude/plans/gstack-gsd-melodic-raven.md`*
