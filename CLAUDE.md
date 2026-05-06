## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore

## gstack + gsd + superpowers 통합 라우팅

세 시스템이 영역을 나눠 갖는다. 단일 책임 원칙을 따른다:
- **gstack**: 진입(아이디어→설계) + 종료(PR/배포)
- **gsd**: phase 골격(spec/plan/execute/summary), `.planning/` 디렉토리가 SSOT
- **superpowers**: gsd-execute-phase 내부 실행 규율(TDD/검증/디버깅)만

키워드/상황별 명령:
- 신규 아이디어/기능 → `/office-hours` → `/autoplan` (gstack)
- 설계 잠금 후 phase 분해 → `/gsd-new-project --auto @DESIGN.md` 또는 `/gsd-new-milestone`
- Phase 진행 → `/gsd-spec-phase N` → `/gsd-discuss-phase N` → `/gsd-plan-phase N` → `/gsd-execute-phase N --tdd`
- 자동 phase 처리("나머지 자동으로", "쭉 진행") → `/gsd-autonomous --from N`
- 검토/QA → `/gsd-code-review`, `/gsd-validate-phase`, `/gsd-verify-work`
- 배포/PR → `/ship` → `/land-and-deploy` (`gsd-ship` 대신 gstack `/ship` 사용)

**호출 안 하는 superpowers 스킬** (gstack/gsd가 대체하므로 중복 작업 방지):
- `superpowers:brainstorming` → gstack `/office-hours` + `/autoplan`이 대체
- `superpowers:writing-plans` → gsd `/gsd-plan-phase`가 대체
- `superpowers:executing-plans` → gsd `/gsd-execute-phase`가 대체
- `superpowers:requesting-code-review` / `receiving-code-review` → gsd `/gsd-code-review`가 대체
- `superpowers:finishing-a-development-branch` → gstack `/ship` + `/land-and-deploy`가 대체
- `superpowers:using-git-worktrees` → gsd `/gsd-workspace --new`가 대체

**호출하는 superpowers 스킬** (gsd-execute-phase 내부 또는 task 실행 중에만):
- `superpowers:test-driven-development` — `--tdd` 플래그 시 RED→GREEN→REFACTOR 강제
- `superpowers:verification-before-completion` — 모든 완료 주장 전, 명령 실행 후 출력 확인
- `superpowers:systematic-debugging` — 테스트 실패/막힘 시 4-phase 근본 원인 추적
- `superpowers:dispatching-parallel-agents` — wave 내 독립 plan 병렬화
- `superpowers:subagent-driven-development` — 큰 task(>200 LoC 등) 분할 + 2단계 자동 검토

산출물 SSOT: `DESIGN.md`/`ARCHITECTURE.md`(루트), `.planning/phases/NN-*/`(phase 산출물). `docs/superpowers/specs/`, `docs/superpowers/plans/`는 사용 안 함.

상세 설계는 `~/.claude/plans/gstack-gsd-melodic-raven.md` 참조.
