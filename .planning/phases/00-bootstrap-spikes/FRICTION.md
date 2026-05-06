# Phase 0 Dogfood Friction Memo (DOG-02)

이 문서는 통합 파이프라인 (`/office-hours` → `/autoplan` → `/gsd-new-project --auto` → `/gsd-discuss-phase --auto` → `/gsd-plan-phase --auto` → `/gsd-execute-phase`)의 첫 dogfood 검증에서 발견된 마찰을 정리한다.

다음 `~/.claude/plans/gstack-gsd-melodic-raven.md` 개정판의 입력으로 사용한다.

## 발견된 마찰

### 1. `gsd-sdk` CLI 부재 (HIGH)

**증상:** `/gsd-new-project --auto`, `/gsd-discuss-phase`, `/gsd-plan-phase`, `/gsd-execute-phase` 워크플로우의 거의 모든 step이 `gsd-sdk query <command>` 호출로 시작하는데, 시스템에 `gsd-sdk` 바이너리가 없다 (`zsh: command not found: gsd-sdk`).

**워크어라운드:** Claude가 직접 파일을 읽고/쓰고/grep하여 init JSON을 시뮬레이션. 워크플로우 스텝 그대로 따라가지만 SDK 의존 부분만 우회.

**영향:**
- `init.execute-phase` JSON output 직접 만들 수 없어 매 step에서 파일 시스템 검사 + 추론
- `state.begin-phase`/`commit`/`roadmap.update-plan-progress` 등 부수 효과는 직접 git 명령 + Edit 도구로 대체
- 일관성 risk: SDK가 보장하는 invariant(시간 측정, 상태 동기화 등)가 누락
- 매 plan마다 +5분 시간 비용

**제안:**
- (a) `gsd-sdk` 바이너리 설치 가이드를 setup 단계에 명시
- (b) SDK 의존을 줄이고 워크플로우가 직접 파일 시스템 명령으로 동작하게 재작성
- (c) `gsd-sdk` 미설치 감지 시 graceful degradation path를 워크플로우에 추가 (이미 일부 워크플로우에 `2>/dev/null || echo "..."` 패턴 있음 — 일관 적용 필요)

### 2. Phase 0 = research 자체 (standard 파이프라인 mismatch) (HIGH)

**증상:** 표준 plan-phase 워크플로우는 `research → plan → verify` 인데, Phase 0의 본질이 5-6개 go/no-go spike — 즉 research가 spike 자체다. 별도 RESEARCH.md를 만드는 건 같은 내용을 다른 양식으로 재포장.

**워크어라운드:** advisor 도구로 검증 후 RESEARCH.md/PATTERNS.md 모두 skip.

**제안:** ROADMAP.md에 phase type marker (`type: bootstrap | feature | refactor | spike-only`)를 두고, `bootstrap`/`spike-only` phase는 research를 자동으로 skip.

### 3. Pattern-mapper greenfield idle (LOW)

**증상:** `/gsd-plan-phase`는 항상 `gsd-pattern-mapper`를 spawn하지만, 그린필드(`ls`가 `CLAUDE.md / DESIGN.md / LICENSE / README.md`)에서는 매핑할 패턴이 0개. 워크플로우의 "Skip if no CONTEXT.md and no RESEARCH.md" 조건은 그린필드를 직접 다루지 않는다.

**제안:** `gsd-pattern-mapper`에 "greenfield-aware" 모드 — `find . -name '*.ts' -not -path './node_modules/*' | wc -l` 가 0이면 즉시 NO_PATTERNS_FOUND 반환.

### 4. Sonnet 병렬 spawn rate limit (balanced profile) (MEDIUM)

**증상:** `/gsd-new-project --auto`가 4개 `gsd-project-researcher`를 sonnet 모델로 background에서 동시 spawn했더니 rate limit 도달 → 4개 모두 실패 (어제 메모리 16:49 기록).

**워크어라운드:** 한 시간 후 재시도 후 성공.

**제안:**
- balanced profile에서 동시 sonnet spawn 개수 cap (e.g., max 2)
- 또는 default를 haiku로 두고, sonnet 필요 시 명시적 opt-in
- rate limit retry-with-backoff를 SDK 레벨에 내장

### 5. Codex CLI 전역 deny (CLAUDE.md 규칙) (MEDIUM)

**증상:** `/gsd-plan-phase` 등이 cross-AI peer review로 `codex` 호출을 옵션으로 제공하지만, 사용자 글로벌 CLAUDE.md "Codex CLI 사용 금지" 규칙으로 모두 deny.

**워크어라운드:** Haiku subagent (`Agent(code-reviewer, model=haiku)`)로 대체.

**제안:** 워크플로우에서 codex 호출 전에 CLAUDE.md deny 패턴을 감지하고 자동으로 Haiku subagent로 라우팅.

### 6. Boundary mismatch — Phase 0 시간 예산 초과 (LOW)

**증상:** ROADMAP.md는 Phase 0을 ≤2h(120분)로 잡았는데, plan-phase 산출물 9개 plan의 estimated 합산이 190분 (+70분 초과). 실제 wall-clock도 약 137분 + 마무리 — 약간 초과.

**관찰:** plan을 잘게 쪼개면 추정치가 누적되어 boundary 초과처럼 보이지만, 일부는 병렬 가능 (Wave 2의 spike들이 Wave 1 후 동시 진행 가능). 다만 interactive 모드에서는 순차이므로 cumulative ≈ wall-clock.

**제안:** ROADMAP.md의 phase time budget이 wall-clock 인지 cumulative effort 인지 명시 필요. interactive 모드일 때는 병렬 가정이 깨짐을 명시.

### 7. Discuss-phase `--auto` 모드 vs spec-locked phase (LOW)

**증상:** Phase 0이 이미 ROADMAP.md + REQUIREMENTS.md + DESIGN.md correction에 의해 거의 모든 결정이 lock된 상태인데, `discuss-phase --auto`가 여전히 8개 gray area를 만들고 추천 옵션을 선택.

**관찰:** 8개 중 4-5개는 진짜 ambiguity, 나머지는 lock된 결정의 재확인.

**제안:** discuss-phase가 `<prior_decisions>` 스캔 시 PROJECT.md Key Decisions / DESIGN.md correction 까지 명시적으로 참조하고, lock된 항목은 gray area에서 자동 제외.

### 8. 셸 환경 변수가 .env를 silently 덮어씀 (HIGH, 새 발견)

**증상:** 셸에 `ANTHROPIC_API_KEY=` (빈 값)이 export되어 있어서 Bun의 `.env` 자동 로드를 silently 덮어씀. `loadEnv()`가 BOOT-05 검증 실패로 종료. 사용자가 `.env`를 정확히 채워뒀음에도.

**워크어라운드:** 실행 전 `unset ANTHROPIC_API_KEY` 필요. Spike 6 → Spike 1 → Spike 2 → SSE → services.yaml 모든 라이브 실행에서 매번 unset 필요.

**디버깅 비용:** ~10분 (Bun.env가 빈 문자열 반환을 본 후에야 환경 변수 우선순위 의심).

**제안:**
- Phase 1 startup script에서 빈 환경 변수 감지하고 명시적 `dotenv` 로드 우선 옵션 처리 (또는 `bun --env-file=.env` 강제)
- gons-works README에 "ANTHROPIC_API_KEY가 셸에 export되어 있으면 unset 필요" 경고
- src/env.ts loadEnv()에 디버깅 모드 추가: `Bun.env.ANTHROPIC_API_KEY === ""` 케이스에 더 친절한 에러 메시지 ("환경에 빈 값이 있다 → unset 필요")

### 9. Plan acceptance criteria의 grep false positive (LOW, 새 발견)

**증상:** Plan 00-05 acceptance가 `grep -c innerHTML index.html = 0` 요구. 코드 보안 메모 주석 안에 "innerHTML 비-사용"이라고 기재한 결과 grep이 substring으로 잡아 3건 감지. 실제 코드에서는 0건.

**워크어라운드:** 주석을 "raw HTML 파싱 비-사용"으로 변경.

**제안:** plan 작성 시 grep 패턴이 식별자 vs 주석을 구분 못하면 false positive 가능. 향후 `grep -E "\.innerHTML\s*[=(]"` 같은 식별자 패턴 사용 권장.

### 10. Docker context 이름 plan-time 가정 mismatch (HIGH, 새 발견)

**증상:** Plan은 `dserver` context를 가정 (CLAUDE.md "Alias dserver, dcserver" 표기 때문). 실제 라이브 환경에는 `home-server`로 등록. `~/.claude/CLAUDE.md`의 `dserver` alias는 셸 alias이지 docker context 이름이 아니었음.

**디버깅 비용:** Wave 2 진입 사용자 게이트에서 발견 → ~5분.

**워크어라운드:** `.env` `DOCKER_CONTEXT=home-server`로 override.

**제안:**
- Phase plan 작성 전 라이브 환경 사실 확인 단계가 `/gsd-discuss-phase`에 명시되어야 함 (현재는 STATE.md "Blockers/Concerns"에만 기록)
- `gsd-discuss-phase --auto`가 phase 첫 spike의 prerequisite를 라이브로 ping하는 step 추가 (e.g., docker context 이름이 .env와 일치하는지)

## 통합 파이프라인 검증 (DOG-01)

| 단계 | 결과 | 메모 |
|------|------|------|
| `/office-hours` | (사전 진행) | DESIGN.md 산출 |
| `/autoplan` | (사전 진행) | 5개 critical correction 도출 |
| `/gsd-new-project --auto @DESIGN.md` | △ 부분 성공 | 1차 sonnet 병렬 fail → 재시도 시 성공 (마찰 #4) |
| `/gsd-discuss-phase 0 --auto` | ✓ 성공 | 8 gray areas 자동 결정 |
| `/gsd-plan-phase 0 --auto` | △ adapted | gsd-sdk 부재로 워크플로우 step 우회 (마찰 #1) |
| `/gsd-execute-phase 0 --interactive` | ✓ 성공 | 9 plans, 6 spike GREEN, 34 단위 tests pass |

**전체 결론:** 통합 파이프라인은 기능적으로 동작. 마찰은 "차단" 수준이 아닌 "효율 저하" 수준. dogfood가 의도대로 통합 검증의 첫 사례로 기능했다.

## 다음 개정판 우선순위

| 우선순위 | 마찰 | 제안 핵심 |
|---------|------|----------|
| HIGH | #1 gsd-sdk CLI 부재 | 설치 가이드 또는 워크플로우 SDK 의존 제거 |
| HIGH | #2 bootstrap phase research mismatch | phase type marker `bootstrap` |
| HIGH | #8 셸 env가 .env 덮어씀 | startup guard 친절한 에러 + README 경고 |
| HIGH | #10 Docker context 이름 mismatch | discuss-phase에 라이브 환경 ping step |
| MEDIUM | #4 sonnet 병렬 rate limit | 동시 spawn cap 또는 haiku default |
| MEDIUM | #5 codex deny 자동 라우팅 | CLAUDE.md deny 감지 |
| LOW | #3 pattern-mapper greenfield | NO_PATTERNS_FOUND 가드 |
| LOW | #6 time budget 시맨틱 | wall-clock vs cumulative 명시 |
| LOW | #7 spec-locked discuss | prior_decisions 자동 제외 |
| LOW | #9 grep false positive | acceptance grep 식별자 패턴 |

## 메타 관찰

이 phase 자체가 통합 파이프라인의 첫 검증 사례이므로, 위 마찰 10개의 발견 자체가 DOG-02 deliverable. 다음 개정판은 마찰 #1, #2, #8, #10 (HIGH)부터 우선 처리하는 것을 권장.
