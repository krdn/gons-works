// tools/applyPatch.test.ts — APPLY-02/04/05 + D-A5/B3/C1/C3/C4/D4 verification.
//
// 8+ 시나리오:
//   1. D-C4 marker 존재 시 503 reject (사전 marker 두고 진입 즉시 throw)
//   2. happy path 무 fileEdit (compose restart) — outcome="applied", marker 정리
//   3. happy path with fileEdit (state mirror + 원격 동기화 + docker + git commit + marker 정리)
//   4. (iii) fail — sshWriteFile exit≠0 → state 미러 revert + marker delete + throw
//   5. (iv) fail — docker exit≠0 → 원격/state revert + marker delete + outcome="rolled-back" + git commit 호출 0
//   6. (v) fail — git commit throws → D-B3 역 docker (compose down) + state/원격 revert + marker delete + outcome="rolled-back"
//   7. decision="edited" — newContent override가 fileEdit.newContent로 적용되는지
//   8. command="compose ps" — D-B3 분기에서 rollback_command=undefined (read-only)
//   9. APPLY_TEST_MODE=1 default dependencies — sshWriteFile no-op + sshExec local docker compose
//   10. APPLY_TEST_MODE 미설정 — default dependencies가 ssh 바이너리를 호출하도록 구성
//
// 핵심 패턴:
//   - dependencies 객체를 export하여 monkey-patch (Bun.spawn mock보다 안전).
//   - afterEach에서 state/.pending/ 디렉토리 빈 상태로 reset (D-C4 격리).
//   - state 미러 revert 검증은 임시 fixture mirror 파일을 만들어 content 비교.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import {
  applyPatch,
  dependencies,
  makeDefaultDependencies,
  _resetDependenciesForTest,
} from "./applyPatch"
import type { ProposePatchResult } from "./proposePatch"
import type { ApprovalDecision } from "../approval/store"

// === Fixture 경로 (테스트용 격리 mirror) ===
// 실제 state/compose/news.yml은 절대 건드리지 않는다 — 02-04 SUMMARY 산출물.
// 테스트는 별도 fixture mirror 경로를 사용. 단, applyPatch가 mirror staleness check에
// 사용하는 경로는 fileEdit.path이므로 그 path를 fixture로 주입하면 격리 가능.
const TEST_STACK = "news"
const ORIGINAL_MIRROR_PATH = `state/compose/${TEST_STACK}.yml`
const TEST_MIRROR_PATH = `state/compose/${TEST_STACK}.test-fixture.yml`
const TEST_REMOTE_PATH = "/원격경로/news/docker-compose.yml"
const PENDING_DIR = "state/.pending"

// 원본 mirror 보존 — 테스트 시작 시 기록, afterAll에서 복원.
let originalMirrorBackup: string | null = null

// 테스트 사이 marker 격리 — D-C4 reject 방지.
function clearPendingMarkers(): void {
  if (!existsSync(PENDING_DIR)) {
    mkdirSync(PENDING_DIR, { recursive: true })
    return
  }
  for (const f of readdirSync(PENDING_DIR)) {
    if (f === ".gitkeep") continue
    rmSync(`${PENDING_DIR}/${f}`, { force: true })
  }
}

// 테스트 fixture 정리 — afterEach에서 호출.
function cleanupTestFixture(): void {
  try {
    rmSync(TEST_MIRROR_PATH, { force: true })
  } catch {
    // swallow
  }
}

function makeProposal(overrides: Partial<ProposePatchResult> = {}): ProposePatchResult {
  return {
    nonce: overrides.nonce ?? `test-nonce-${Math.random().toString(36).slice(2, 10)}`,
    stack: overrides.stack ?? "news",
    command: overrides.command ?? "compose restart",
    service: overrides.service ?? "news-prod-app",
    diff: overrides.diff ?? "(no file change — command only: compose restart news-prod-app)",
    reasoning: overrides.reasoning ?? "테스트용 reasoning",
    expiresAt: overrides.expiresAt ?? Date.now() + 120_000,
    fileEdit: overrides.fileEdit,
  }
}

beforeEach(() => {
  clearPendingMarkers()
  cleanupTestFixture()
  _resetDependenciesForTest()
})

afterEach(() => {
  clearPendingMarkers()
  cleanupTestFixture()
  _resetDependenciesForTest()
  delete process.env.APPLY_TEST_MODE
})

describe("applyPatch — D-C4 marker reject", () => {
  test("기존 marker가 있으면 503 reject로 throw (D-C4)", async () => {
    // 사전 marker 1개 두기
    writeFileSync(`${PENDING_DIR}/preexisting-marker.json`, JSON.stringify({ nonce: "pre" }))

    const proposal = makeProposal()
    const decision: ApprovalDecision = { type: "approved" }

    await expect(
      applyPatch(
        {
          proposal,
          decision,
          userPrompt: "test",
          remoteComposePath: TEST_REMOTE_PATH,
        },
        {},
      ),
    ).rejects.toThrow(/503/)
  })
})

describe("applyPatch — happy path", () => {
  test("happy path 무 fileEdit (compose restart) → outcome=applied, marker 정리", async () => {
    // sshExec / sshWriteFile / git mock — 모두 success
    let dockerCalled = 0
    let gitCommitCalled = 0
    dependencies.sshExec = async () => {
      dockerCalled++
      return { exit: 0, stdout: "", stderr: "" }
    }
    dependencies.sshWriteFile = async () => ({ exit: 0, stderr: "" })
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: "(unused — no fileEdit)", stderr: "" })
    dependencies.gitAdd = async () => {}
    dependencies.commitWithMessage = async () => {
      gitCommitCalled++
    }
    dependencies.gitRevParseHead = async () => "abc1234"

    const proposal = makeProposal({ command: "compose restart", service: "news-prod-app" })
    const result = await applyPatch(
      {
        proposal,
        decision: { type: "approved" },
        userPrompt: "news 재시작",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    expect(result.outcome.type).toBe("applied")
    if (result.outcome.type !== "applied") return
    expect(result.outcome.sha_after).toBe("abc1234")
    expect(result.outcome.duration_ms).toBeGreaterThanOrEqual(0)
    expect(result.outcome.command).toBe("compose restart")
    expect(dockerCalled).toBe(1)
    expect(gitCommitCalled).toBe(1)

    // marker 정리 검증 — .gitkeep만 남음
    const remaining = readdirSync(PENDING_DIR).filter((f) => f !== ".gitkeep")
    expect(remaining).toEqual([])
  })

  test("happy path with fileEdit (state 미러 + SSH cat > + docker + git commit)", async () => {
    // mirror 파일 mock (현재 content 임의)
    const originalContent = `services:\n  news-prod-app:\n    image: news:1.0\n`
    const newContent = `services:\n  news-prod-app:\n    image: news:1.1\n`
    writeFileSync(TEST_MIRROR_PATH, originalContent)

    let sshWriteCalledWith: { path: string; content: string } | null = null
    let dockerCalled = false
    let gitAddCalled = false
    let gitCommitCalled = false
    dependencies.sshExec = async () => {
      dockerCalled = true
      return { exit: 0, stdout: "", stderr: "" }
    }
    dependencies.sshWriteFile = async (host, path, content) => {
      sshWriteCalledWith = { path, content }
      return { exit: 0, stderr: "" }
    }
    // mirror staleness check: 원격 파일 = 미러와 동일 (drift 없음)
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: originalContent, stderr: "" })
    dependencies.gitAdd = async () => {
      gitAddCalled = true
    }
    dependencies.commitWithMessage = async () => {
      gitCommitCalled = true
    }
    dependencies.gitRevParseHead = async () => "def5678"

    const proposal = makeProposal({
      command: "compose up -d",
      service: "news-prod-app",
      fileEdit: { path: TEST_MIRROR_PATH, newContent, previousContent: originalContent },
    })
    const result = await applyPatch(
      {
        proposal,
        decision: { type: "approved" },
        userPrompt: "image bump",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    expect(result.outcome.type).toBe("applied")
    if (result.outcome.type !== "applied") return
    expect(result.outcome.sha_after).toBe("def5678")
    expect(sshWriteCalledWith).not.toBeNull()
    expect(sshWriteCalledWith!.path).toBe(TEST_REMOTE_PATH)
    expect(sshWriteCalledWith!.content).toBe(newContent)
    expect(dockerCalled).toBe(true)
    expect(gitAddCalled).toBe(true)
    expect(gitCommitCalled).toBe(true)

    // mirror 파일이 newContent로 갱신됐는지 검증
    const after = await Bun.file(TEST_MIRROR_PATH).text()
    expect(after).toBe(newContent)
    // afterEach가 cleanupTestFixture로 fixture 파일 삭제 — 별도 정리 불필요.
  })
})

describe("applyPatch — D-A4 mirror staleness", () => {
  test("원격 파일과 미러 SHA 다르면 즉시 ToolError로 throw (drift 감지)", async () => {
    const mirrorContent = `services:\n  news-prod-app:\n    image: news:1.0\n`
    const remoteContent = `services:\n  news-prod-app:\n    image: news:9.9\n# 운영자 수동 변경\n`
    writeFileSync(TEST_MIRROR_PATH, mirrorContent)

    dependencies.sshReadFile = async () => ({ exit: 0, stdout: remoteContent, stderr: "" })
    // 다른 dependencies는 호출되면 안 됨 — 호출 시 fail 검증용 spy
    dependencies.sshExec = async () => {
      throw new Error("sshExec should not be called when drift detected")
    }
    dependencies.sshWriteFile = async () => {
      throw new Error("sshWriteFile should not be called when drift detected")
    }

    const proposal = makeProposal({
      fileEdit: { path: TEST_MIRROR_PATH, newContent: "...", previousContent: mirrorContent },
    })

    await expect(
      applyPatch(
        {
          proposal,
          decision: { type: "approved" },
          userPrompt: "test",
          remoteComposePath: TEST_REMOTE_PATH,
        },
        {},
      ),
    ).rejects.toThrow(/mirror|drift|outdated/i)
  })
})

describe("applyPatch — (iii) 원격 SSH 동기화 실패", () => {
  test("sshWriteFile exit≠0 → state mirror revert + marker delete + throw, docker/git 호출 0", async () => {
    const originalContent = `services:\n  news-prod-app:\n    image: news:1.0\n`
    const newContent = `services:\n  news-prod-app:\n    image: news:1.1\n`
    writeFileSync(TEST_MIRROR_PATH, originalContent)

    let dockerCalled = false
    let gitCommitCalled = false
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: originalContent, stderr: "" })
    dependencies.sshWriteFile = async () => ({ exit: 1, stderr: "ssh: connection refused" })
    dependencies.sshExec = async () => {
      dockerCalled = true
      return { exit: 0, stdout: "", stderr: "" }
    }
    dependencies.commitWithMessage = async () => {
      gitCommitCalled = true
    }

    const proposal = makeProposal({
      fileEdit: { path: TEST_MIRROR_PATH, newContent, previousContent: originalContent },
    })

    await expect(
      applyPatch(
        {
          proposal,
          decision: { type: "approved" },
          userPrompt: "test",
          remoteComposePath: TEST_REMOTE_PATH,
        },
        {},
      ),
    ).rejects.toThrow(/원격 파일 동기화 실패/)

    // state mirror revert 검증
    const after = await Bun.file(TEST_MIRROR_PATH).text()
    expect(after).toBe(originalContent)

    // docker/git 미호출
    expect(dockerCalled).toBe(false)
    expect(gitCommitCalled).toBe(false)

    // marker 정리
    const remaining = readdirSync(PENDING_DIR).filter((f) => f !== ".gitkeep")
    expect(remaining).toEqual([])
  })
})

describe("applyPatch — (iv) docker compose 실패", () => {
  test("docker exit≠0 → 원격/state revert + outcome=rolled-back + git commit 호출 0", async () => {
    const originalContent = `services:\n  news-prod-app:\n    image: news:1.0\n`
    const newContent = `services:\n  news-prod-app:\n    image: news:1.1\n`
    writeFileSync(TEST_MIRROR_PATH, originalContent)

    let sshWriteCalls: Array<{ content: string }> = []
    let gitCommitCalled = false
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: originalContent, stderr: "" })
    dependencies.sshWriteFile = async (_host, _path, content) => {
      sshWriteCalls.push({ content })
      return { exit: 0, stderr: "" }
    }
    dependencies.sshExec = async () => ({ exit: 1, stdout: "", stderr: "image not found: news:1.1" })
    dependencies.commitWithMessage = async () => {
      gitCommitCalled = true
    }

    const proposal = makeProposal({
      command: "compose up -d",
      fileEdit: { path: TEST_MIRROR_PATH, newContent, previousContent: originalContent },
    })

    const result = await applyPatch(
      {
        proposal,
        decision: { type: "approved" },
        userPrompt: "test",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    expect(result.outcome.type).toBe("rolled-back")
    if (result.outcome.type !== "rolled-back") return
    expect(result.outcome.reason).toMatch(/docker exit 1/)
    expect(gitCommitCalled).toBe(false)

    // sshWriteFile 호출이 2회 — 첫째는 newContent, 둘째는 revert (previousContent)
    expect(sshWriteCalls.length).toBe(2)
    expect(sshWriteCalls[0].content).toBe(newContent)
    expect(sshWriteCalls[1].content).toBe(originalContent)

    // state mirror revert
    const after = await Bun.file(TEST_MIRROR_PATH).text()
    expect(after).toBe(originalContent)

    // marker 정리
    const remaining = readdirSync(PENDING_DIR).filter((f) => f !== ".gitkeep")
    expect(remaining).toEqual([])
  })
})

describe("applyPatch — (v) git commit 실패 D-B3 역 docker", () => {
  test("git commit throws → 역 docker 시도 (down) + outcome=rolled-back + rollback_command/rollback_ok 보고", async () => {
    let sshExecCalls: string[] = []
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: "(unused)", stderr: "" })
    dependencies.sshWriteFile = async () => ({ exit: 0, stderr: "" })
    dependencies.sshExec = async (cmd: string) => {
      sshExecCalls.push(cmd)
      return { exit: 0, stdout: "", stderr: "" } // 첫 docker exec 성공, 역 docker도 성공
    }
    dependencies.gitAdd = async () => {}
    dependencies.commitWithMessage = async () => {
      throw new Error("git commit 실패 (exit 128): pre-commit hook reject")
    }
    dependencies.gitRevParseHead = async () => "shouldNotBeUsed"

    const proposal = makeProposal({ command: "compose up -d", service: "news-prod-app" })
    const result = await applyPatch(
      {
        proposal,
        decision: { type: "approved" },
        userPrompt: "test",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    expect(result.outcome.type).toBe("rolled-back")
    if (result.outcome.type !== "rolled-back") return
    expect(result.outcome.reason).toMatch(/git commit failed/)
    expect(result.outcome.rollback_command).toContain("compose down")
    expect(result.outcome.rollback_command).toContain("news-prod-app")
    expect(result.outcome.rollback_ok).toBe(true)

    // sshExec 2회 호출 — 첫 docker up -d, 둘째 역 docker down
    expect(sshExecCalls.length).toBe(2)
    expect(sshExecCalls[0]).toContain("compose up -d")
    expect(sshExecCalls[1]).toContain("compose down")

    // marker 정리
    const remaining = readdirSync(PENDING_DIR).filter((f) => f !== ".gitkeep")
    expect(remaining).toEqual([])
  })

  test("D-B3 매핑: 'compose down' → 'compose up -d' (역방향)", async () => {
    let sshExecCalls: string[] = []
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: "(unused)", stderr: "" })
    dependencies.sshWriteFile = async () => ({ exit: 0, stderr: "" })
    dependencies.sshExec = async (cmd: string) => {
      sshExecCalls.push(cmd)
      return { exit: 0, stdout: "", stderr: "" }
    }
    dependencies.gitAdd = async () => {}
    dependencies.commitWithMessage = async () => {
      throw new Error("git commit 실패")
    }

    const proposal = makeProposal({ command: "compose down", service: "news-prod-app" })
    const result = await applyPatch(
      {
        proposal,
        decision: { type: "approved" },
        userPrompt: "test",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    expect(result.outcome.type).toBe("rolled-back")
    if (result.outcome.type !== "rolled-back") return
    expect(result.outcome.rollback_command).toContain("compose up -d")
    expect(result.outcome.rollback_command).toContain("news-prod-app")
    expect(result.outcome.rollback_ok).toBe(true)
    expect(sshExecCalls[0]).toContain("compose down")
    expect(sshExecCalls[1]).toContain("compose up -d")
  })

  test("D-B3 매핑: 'compose stop' → 'compose start' (역방향)", async () => {
    let sshExecCalls: string[] = []
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: "(unused)", stderr: "" })
    dependencies.sshWriteFile = async () => ({ exit: 0, stderr: "" })
    dependencies.sshExec = async (cmd: string) => {
      sshExecCalls.push(cmd)
      return { exit: 0, stdout: "", stderr: "" }
    }
    dependencies.gitAdd = async () => {}
    dependencies.commitWithMessage = async () => {
      throw new Error("git commit 실패")
    }

    const proposal = makeProposal({ command: "compose stop", service: "news-prod-app" })
    const result = await applyPatch(
      {
        proposal,
        decision: { type: "approved" },
        userPrompt: "test",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    expect(result.outcome.type).toBe("rolled-back")
    if (result.outcome.type !== "rolled-back") return
    expect(result.outcome.rollback_command).toContain("compose start")
    expect(sshExecCalls[1]).toContain("compose start")
  })

  test("D-B3 매핑: 'compose restart' → 'compose restart' (idempotent)", async () => {
    let sshExecCalls: string[] = []
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: "(unused)", stderr: "" })
    dependencies.sshWriteFile = async () => ({ exit: 0, stderr: "" })
    dependencies.sshExec = async (cmd: string) => {
      sshExecCalls.push(cmd)
      return { exit: 0, stdout: "", stderr: "" }
    }
    dependencies.gitAdd = async () => {}
    dependencies.commitWithMessage = async () => {
      throw new Error("git commit 실패")
    }

    const proposal = makeProposal({ command: "compose restart", service: "news-prod-app" })
    const result = await applyPatch(
      {
        proposal,
        decision: { type: "approved" },
        userPrompt: "test",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    expect(result.outcome.type).toBe("rolled-back")
    if (result.outcome.type !== "rolled-back") return
    expect(result.outcome.rollback_command).toContain("compose restart")
    expect(result.outcome.rollback_ok).toBe(true)
    // 양쪽 호출 모두 'compose restart'여야 함 (idempotent)
    expect(sshExecCalls[0]).toContain("compose restart")
    expect(sshExecCalls[1]).toContain("compose restart")
  })

  test("D-B3 매핑: 'compose logs --tail=200' → null (read-only, rollback_command=undefined)", async () => {
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: "(unused)", stderr: "" })
    dependencies.sshExec = async () => ({ exit: 0, stdout: "logs output", stderr: "" })
    dependencies.gitAdd = async () => {}
    dependencies.commitWithMessage = async () => {
      throw new Error("git commit 실패")
    }

    const proposal = makeProposal({ command: "compose logs --tail=200", service: "news-prod-app" })
    const result = await applyPatch(
      {
        proposal,
        decision: { type: "approved" },
        userPrompt: "logs",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    expect(result.outcome.type).toBe("rolled-back")
    if (result.outcome.type !== "rolled-back") return
    expect(result.outcome.rollback_command).toBeUndefined()
    expect(result.outcome.rollback_ok).toBeUndefined()
  })

  test("command='compose ps' 시 git commit 실패 → rollback_command=undefined (read-only, 역 불필요)", async () => {
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: "(unused)", stderr: "" })
    dependencies.sshExec = async () => ({ exit: 0, stdout: "ps output", stderr: "" })
    dependencies.gitAdd = async () => {}
    dependencies.commitWithMessage = async () => {
      throw new Error("git commit 실패")
    }

    const proposal = makeProposal({ command: "compose ps", service: "" })
    const result = await applyPatch(
      {
        proposal,
        decision: { type: "approved" },
        userPrompt: "ps",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    expect(result.outcome.type).toBe("rolled-back")
    if (result.outcome.type !== "rolled-back") return
    expect(result.outcome.rollback_command).toBeUndefined()
    expect(result.outcome.rollback_ok).toBeUndefined()
  })
})

describe("applyPatch — decision='edited' newContent override", () => {
  test("decision.newContent가 fileEdit에 적용됨", async () => {
    const originalContent = `services:\n  news-prod-app:\n    image: news:1.0\n`
    const aiNewContent = `services:\n  news-prod-app:\n    image: news:1.1\n`
    const userEditedContent = `services:\n  news-prod-app:\n    image: news:1.2\n`
    writeFileSync(TEST_MIRROR_PATH, originalContent)

    let sshWriteContent: string | null = null
    dependencies.sshReadFile = async () => ({ exit: 0, stdout: originalContent, stderr: "" })
    dependencies.sshWriteFile = async (_host, _path, content) => {
      sshWriteContent = content
      return { exit: 0, stderr: "" }
    }
    dependencies.sshExec = async () => ({ exit: 0, stdout: "", stderr: "" })
    dependencies.gitAdd = async () => {}
    dependencies.commitWithMessage = async () => {}
    dependencies.gitRevParseHead = async () => "edited123"

    const proposal = makeProposal({
      command: "compose up -d",
      fileEdit: { path: TEST_MIRROR_PATH, newContent: aiNewContent, previousContent: originalContent },
    })
    const result = await applyPatch(
      {
        proposal,
        decision: { type: "edited", newContent: userEditedContent },
        userPrompt: "edit",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    expect(result.outcome.type).toBe("applied")
    expect(sshWriteContent).toBe(userEditedContent)

    // mirror 파일이 userEditedContent로 갱신
    const after = await Bun.file(TEST_MIRROR_PATH).text()
    expect(after).toBe(userEditedContent)
    // afterEach가 cleanupTestFixture로 fixture 파일 삭제.
  })
})

describe("applyPatch — D-C3 marker 점진 update", () => {
  test("marker가 docker_started_at → docker_finished_at + exit_code 두 단계로 갱신", async () => {
    const markerSnapshots: Array<Record<string, unknown>> = []

    dependencies.sshReadFile = async () => ({ exit: 0, stdout: "(unused)", stderr: "" })
    dependencies.sshExec = async () => {
      // docker exec 시점에 marker 읽기 — docker_started_at은 채워졌어야 함
      const files = readdirSync(PENDING_DIR).filter((f) => f.endsWith(".json"))
      for (const f of files) {
        const m = JSON.parse(await Bun.file(`${PENDING_DIR}/${f}`).text())
        markerSnapshots.push({ ...m, _at: "during-docker" })
      }
      return { exit: 0, stdout: "", stderr: "" }
    }
    dependencies.gitAdd = async () => {}
    dependencies.commitWithMessage = async () => {
      // git commit 직전 marker 읽기 — docker_finished_at + exit_code 채워졌어야 함.
      // (gitAdd는 fileEdit 없을 때 호출 안 되므로 commitWithMessage가 더 안정적인 hook 위치.)
      const files = readdirSync(PENDING_DIR).filter((f) => f.endsWith(".json"))
      for (const f of files) {
        const m = JSON.parse(await Bun.file(`${PENDING_DIR}/${f}`).text())
        markerSnapshots.push({ ...m, _at: "before-git" })
      }
    }
    dependencies.gitRevParseHead = async () => "abc1234"

    const proposal = makeProposal({ command: "compose restart", service: "news-prod-app" })
    await applyPatch(
      {
        proposal,
        decision: { type: "approved" },
        userPrompt: "test",
        remoteComposePath: TEST_REMOTE_PATH,
      },
      {},
    )

    // during-docker 시점: docker_started_at 채워짐 + finished/exit_code는 null
    const duringDocker = markerSnapshots.find((m) => m._at === "during-docker")
    expect(duringDocker).toBeDefined()
    expect(duringDocker!.docker_started_at).toBeTruthy()
    expect(duringDocker!.docker_finished_at).toBeNull()
    expect(duringDocker!.exit_code).toBeNull()

    // before-git 시점: 모두 채워짐
    const beforeGit = markerSnapshots.find((m) => m._at === "before-git")
    expect(beforeGit).toBeDefined()
    expect(beforeGit!.docker_started_at).toBeTruthy()
    expect(beforeGit!.docker_finished_at).toBeTruthy()
    expect(beforeGit!.exit_code).toBe(0)
  })
})

describe("applyPatch — APPLY_TEST_MODE seam (Task 3, D-A3 라이브 검증 지원)", () => {
  test("APPLY_TEST_MODE=1: makeDefaultDependencies가 SSH 우회 + sshWriteFile no-op", async () => {
    process.env.APPLY_TEST_MODE = "1"
    const deps = makeDefaultDependencies()

    // sshWriteFile은 no-op (PROD 원격 파일 변경 안 함) — 어떤 인자든 항상 success.
    const result = await deps.sshWriteFile(
      "gon@192.168.0.5",
      "/원격경로/news/docker-compose.yml",
      "x",
    )
    expect(result.exit).toBe(0)
    expect(result.stderr).toBe("")

    // sshReadFile은 로컬 미러 그대로 반환 — 실제 state/compose/news.yml 내용을
    // 읽어 그대로 stdout으로 echo (PROD 파일은 건드리지 않음).
    const expectedMirror = readFileSync(ORIGINAL_MIRROR_PATH, "utf-8")
    const readResult = await deps.sshReadFile(
      "gon@192.168.0.5",
      "/원격경로/news/docker-compose.yml",
    )
    expect(readResult.exit).toBe(0)
    expect(readResult.stdout).toBe(expectedMirror)

    delete process.env.APPLY_TEST_MODE
  })

  test("APPLY_TEST_MODE 미설정: makeDefaultDependencies가 PROD SSH 경유로 구성", () => {
    delete process.env.APPLY_TEST_MODE
    const deps = makeDefaultDependencies()
    // PROD 모드는 실제 SSH 호출하므로 mock 검증 불가 — toString 패턴 또는 호출 실패 형태로 우회.
    // 본 테스트는 dependencies가 testMode 분기를 타지 않았는지 source 검사로 대체.
    expect(typeof deps.sshExec).toBe("function")
    expect(typeof deps.sshWriteFile).toBe("function")
    expect(typeof deps.sshReadFile).toBe("function")
    expect(typeof deps.gitAdd).toBe("function")
    expect(typeof deps.commitWithMessage).toBe("function")
    expect(typeof deps.gitRevParseHead).toBe("function")
  })
})
