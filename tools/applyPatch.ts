// tools/applyPatch.ts — APPLY-02/04/05 + D-A5/B3/C1/C3/C4/D4 lock.
//
// Public API:
//   applyPatch()                — 2PC orchestrator. proposePatch가 만든
//                                 PendingApproval이 사용자 승인되면 LOOP가 호출.
//   dependencies                — sshExec / sshWriteFile / sshReadFile / git helpers.
//                                 monkey-patch 가능 (test isolation 패턴).
//   makeDefaultDependencies()   — APPLY_TEST_MODE 분기. testMode이면 SSH 우회 +
//                                 로컬 docker compose -f tests/fixtures/test-compose.yml.
//   _resetDependenciesForTest() — 테스트 helper. dependencies를 default로 복구.
//
// 핵심 결정 (.planning/phases/02-propose-apply-approval-gate/02-CONTEXT.md):
//   D-A5 6-step 시퀀스 (i)~(vi):
//     (i)   marker write (state/.pending/{nonce}.json fsync)
//     (ii)  state mirror + state/services.yaml fileEdit write
//     (iii) 원격 SSH `cat > /원격경로/{stack}/docker-compose.yml` (fileEdit only)
//     (iv)  원격 SSH `cd /원격경로/{stack} && docker compose <cmd> [<svc>]`
//           — marker 점진 update: docker_started_at → docker_finished_at + exit_code
//     (v)   git commit state/ — buildMessage + commitWithMessage
//     (vi)  marker delete + outcome="applied"
//   D-A4 mirror staleness — 진입 시 1회 SSH cat + SHA256 비교, drift 시 ToolError.
//   D-B3 신규 (v) git commit fail 분기 — 역 docker 자동 시도 (up↔down 등) + envelope CRITICAL.
//   D-C1 marker fsync sync write.
//   D-C3 점진 update — boot detect 시 3-state 구별.
//   D-C4 marker 존재 시 503 reject (동시성 차단).
//   D-D4 applied / rolled-back만 git commit, rejected/aborted/expired는 caller가 처리.
//
//   ⚠ CRITICAL PROD SAFETY (02-04 carry-forward, 2026-05-07):
//   APPLY_TEST_MODE=1 시 모든 docker 명령에 `--context default` explicit
//   positional 인자 포함 필수. env-only DOCKER_CONTEXT는 자식 docker CLI에
//   안정 전파 안 됨 (실측 PROD 누수 사고 발생). belt-and-suspenders 패턴 적용.
//
// 패턴 analog (Phase 1 + 02-04/05):
//   - SSH 옵션 lock: tools/readCompose.ts:43-59 (ConnectTimeout=10/ServerAliveInterval=5/BatchMode=yes)
//   - dependencies object monkey-patch: agent/loop.ts:53 inFlight Map (LOOP-07)
//   - _resetForTest 패턴: agent/loop.ts:82-86 (test isolation)
//   - explicit --context positional: tests/setup/docker-context.ts:43-91 (PROD safety belt)

import { createHash } from "node:crypto"
import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { buildMessage, commitWithMessage } from "../state/commit"
import type { ApprovalDecision } from "../approval/store"
import type { ProposePatchResult } from "./proposePatch"

// === Types ===

export interface ApplyPatchArgs {
  proposal: ProposePatchResult
  decision: ApprovalDecision
  userPrompt: string
  remoteComposePath: string // loop가 stack→remote dir 매핑하여 주입
}

export type ApplyPatchOutcome =
  | {
      type: "applied"
      sha_after: string
      duration_ms: number
      nonce: string
      stack: string
      command: string
      service: string
    }
  | {
      type: "rolled-back"
      reason: string
      rollback_command?: string
      rollback_ok?: boolean
      nonce: string
      stack: string
    }

export interface ApplyPatchResult {
  outcome: ApplyPatchOutcome
}

// D-C1/D-C3 lock — marker schema 점진 update.
interface PendingMarker {
  nonce: string
  stack: string
  command: string
  service: string
  fileEdit?: { path: string; newContent: string; previousContent: string }
  reasoning: string
  user_prompt: string
  sha_before: string
  ts_created: string
  docker_started_at: string | null
  docker_finished_at: string | null
  exit_code: number | null
}

interface SshExecResult {
  exit: number
  stdout: string
  stderr: string
}

interface SshWriteResult {
  exit: number
  stderr: string
}

// === Dependencies (test injection seam) ===

export interface ApplyDependencies {
  sshExec(remoteCmd: string, signal?: AbortSignal): Promise<SshExecResult>
  sshWriteFile(
    host: string,
    remotePath: string,
    content: string,
    signal?: AbortSignal,
  ): Promise<SshWriteResult>
  sshReadFile(
    host: string,
    remotePath: string,
    signal?: AbortSignal,
  ): Promise<SshExecResult>
  gitAdd(paths: string[], cwd?: string): Promise<void>
  commitWithMessage(message: string, nonce: string, cwd?: string): Promise<void>
  gitRevParseHead(cwd?: string): Promise<string>
}

const REMOTE_HOST = "gon@192.168.0.5"
const SSH_OPTS = [
  "-o",
  "ConnectTimeout=10",
  "-o",
  "ServerAliveInterval=5",
  "-o",
  "ServerAliveCountMax=2",
  "-o",
  "BatchMode=yes",
]

// === Default helper builders (PROD mode) ===

function makeDefaultSshExec(): ApplyDependencies["sshExec"] {
  return async (remoteCmd, signal) => {
    const proc = Bun.spawn(["ssh", ...SSH_OPTS, REMOTE_HOST, remoteCmd], {
      stdout: "pipe",
      stderr: "pipe",
      signal,
    })
    const exit = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    return { exit, stdout, stderr }
  }
}

function makeDefaultSshWriteFile(): ApplyDependencies["sshWriteFile"] {
  return async (host, remotePath, content, signal) => {
    const proc = Bun.spawn(
      ["ssh", ...SSH_OPTS, host, `cat > ${remotePath}`],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe", signal },
    )
    proc.stdin.write(content)
    proc.stdin.end()
    const exit = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    return { exit, stderr }
  }
}

function makeDefaultSshReadFile(): ApplyDependencies["sshReadFile"] {
  return async (host, remotePath, signal) => {
    const proc = Bun.spawn(
      ["ssh", ...SSH_OPTS, host, `cat ${remotePath}`],
      { stdout: "pipe", stderr: "pipe", signal },
    )
    const exit = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    return { exit, stdout, stderr }
  }
}

// D-04 lock 준수 — state/는 메인 repo subdir, cwd는 메인 repo 루트(default ".") + 명시 pathspec.
function makeDefaultGitAdd(): ApplyDependencies["gitAdd"] {
  return async (paths, cwd = ".") => {
    if (paths.length === 0) return
    const proc = Bun.spawn(["git", "add", "--", ...paths], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const exit = await proc.exited
    if (exit !== 0) {
      const stderrText = await new Response(proc.stderr).text()
      throw new Error(`git add 실패 (exit ${exit}): ${stderrText.slice(0, 200)}`)
    }
  }
}

function makeDefaultGitRevParseHead(): ApplyDependencies["gitRevParseHead"] {
  return async (cwd = ".") => {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
    const stdout = await new Response(proc.stdout).text()
    return stdout.trim()
  }
}

// APPLY_TEST_MODE testMode helpers (Task 3 — D-A3 라이브 검증 지원)
//
// testMode 동작:
//   - sshWriteFile: no-op (PROD 원격 파일 절대 변경 안 함, D-A3 lock)
//   - sshReadFile: 로컬 state/compose 미러를 그대로 반환 (drift 0 강제 — staleness 무력화)
//   - sshExec: SSH 호출 대신 로컬 docker compose -f tests/fixtures/test-compose.yml.
//              ⚠ `docker --context default` explicit positional 인자 필수
//              (02-04 PROD 누수 사고 carry-forward).

const TEST_COMPOSE_FILE = "tests/fixtures/test-compose.yml"
const TEST_DOCKER_CONTEXT = "default"

function makeTestModeSshExec(): ApplyDependencies["sshExec"] {
  return async (remoteCmd, signal) => {
    // remoteCmd 예: "cd /원격경로/news && docker compose restart news-prod-app"
    // testMode는 로컬에서 docker compose -f tests/fixtures/test-compose.yml로 우회.
    const match = remoteCmd.match(/docker\s+compose\s+(.+)$/)
    if (!match) {
      return {
        exit: 1,
        stdout: "",
        stderr: `testMode: docker compose 패턴 매치 실패 — remoteCmd=${remoteCmd}`,
      }
    }
    const subcmdAndSvc = match[1].trim().split(/\s+/)
    const argv: string[] = [
      "docker",
      "--context",
      TEST_DOCKER_CONTEXT, // ⚠ explicit positional — env 신뢰 금지 (02-04 carry-forward)
      "compose",
      "-f",
      TEST_COMPOSE_FILE,
      ...subcmdAndSvc,
    ]
    const proc = Bun.spawn(argv, {
      env: { ...process.env, DOCKER_CONTEXT: TEST_DOCKER_CONTEXT }, // belt-and-suspenders
      stdout: "pipe",
      stderr: "pipe",
      signal,
    })
    const exit = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    return { exit, stdout, stderr }
  }
}

function makeTestModeSshWriteFile(): ApplyDependencies["sshWriteFile"] {
  // PROD 원격 파일 동기화 no-op — state mirror write는 호출자(applyPatch 본체) 책임으로 유지.
  return async (_host, _remotePath, _content, _signal) => {
    return { exit: 0, stderr: "" }
  }
}

function makeTestModeSshReadFile(): ApplyDependencies["sshReadFile"] {
  // mirror staleness check (D-A4)도 testMode에서는 로컬 미러 그대로 신뢰 → drift 0 강제.
  return async (_host, remotePath, _signal) => {
    // remotePath 예: "/원격경로/news/docker-compose.yml" → 마지막 구간을 stack으로 추정,
    // 단순화를 위해 경로 어디서든 마지막 디렉토리명을 stack으로 사용.
    const segments = remotePath.split("/").filter(Boolean)
    // segments 예: ["원격경로", "news", "docker-compose.yml"]
    const stack = segments.length >= 2 ? segments[segments.length - 2] : "news"
    const localMirror = `state/compose/${stack}.yml`
    try {
      const content = readFileSync(localMirror, "utf-8")
      return { exit: 0, stdout: content, stderr: "" }
    } catch (err) {
      return {
        exit: 1,
        stdout: "",
        stderr: `testMode: 로컬 미러 read 실패 (${localMirror}): ${
          (err as Error).message
        }`,
      }
    }
  }
}

/**
 * APPLY_TEST_MODE 환경변수 분기 — D-A3 라이브 검증 모드 vs PROD 모드.
 *
 * APPLY_TEST_MODE=1 시:
 *   - SSH 호출 우회 (sshWriteFile no-op, sshReadFile 로컬 미러, sshExec 로컬 docker compose)
 *   - tests/fixtures/test-compose.yml 위에서 모든 2PC 시나리오 재현
 *   - PROD 호출 절대 금지 (D-A3 lock)
 *
 * 미설정 시: PROD 모드 — 모든 SSH는 gon@192.168.0.5 경유.
 */
export function makeDefaultDependencies(): ApplyDependencies {
  const testMode = process.env.APPLY_TEST_MODE === "1"
  if (testMode) {
    return {
      sshExec: makeTestModeSshExec(),
      sshWriteFile: makeTestModeSshWriteFile(),
      sshReadFile: makeTestModeSshReadFile(),
      gitAdd: makeDefaultGitAdd(),
      commitWithMessage: (msg, nonce, cwd) => commitWithMessage(msg, nonce, cwd),
      gitRevParseHead: makeDefaultGitRevParseHead(),
    }
  }
  return {
    sshExec: makeDefaultSshExec(),
    sshWriteFile: makeDefaultSshWriteFile(),
    sshReadFile: makeDefaultSshReadFile(),
    gitAdd: makeDefaultGitAdd(),
    commitWithMessage: (msg, nonce, cwd) => commitWithMessage(msg, nonce, cwd),
    gitRevParseHead: makeDefaultGitRevParseHead(),
  }
}

/**
 * Module-level dependencies — applyPatch가 모든 helper 호출을 dependencies.* 형태로
 * 라우팅. 테스트는 dependencies object를 monkey-patch하여 SSH/docker/git 우회.
 *
 * Production 코드는 makeDefaultDependencies()로 초기화 (lazy init via _resetDependenciesForTest).
 */
export const dependencies: ApplyDependencies = makeDefaultDependencies()

/**
 * 테스트 helper — dependencies를 default로 복구.
 * Production code 호출 금지. afterEach에서만 사용.
 */
export function _resetDependenciesForTest(): void {
  const fresh = makeDefaultDependencies()
  Object.assign(dependencies, fresh)
}

// === Marker helpers ===

const PENDING_DIR = "state/.pending"

function markerPath(nonce: string): string {
  return `${PENDING_DIR}/${nonce}.json`
}

function writeMarker(marker: PendingMarker): void {
  // D-C1 fsync sync write — boot detect 시 발견 가능해야 함.
  writeFileSync(markerPath(marker.nonce), JSON.stringify(marker, null, 2), {
    encoding: "utf-8",
  })
}

function updateMarker(nonce: string, patch: Partial<PendingMarker>): void {
  // immutable spread — read → spread → write.
  const path = markerPath(nonce)
  const current = JSON.parse(readFileSync(path, "utf-8")) as PendingMarker
  const updated: PendingMarker = { ...current, ...patch }
  writeFileSync(path, JSON.stringify(updated, null, 2), { encoding: "utf-8" })
}

function deleteMarker(nonce: string): void {
  // best-effort — 이미 삭제된 경우 silent.
  try {
    unlinkSync(markerPath(nonce))
  } catch {
    // swallow
  }
}

function existingMarkers(): string[] {
  if (!existsSync(PENDING_DIR)) return []
  return readdirSync(PENDING_DIR).filter((f) => f.endsWith(".json"))
}

// === Reverse docker mapping (D-B3) ===

const REVERSE_DOCKER: Record<string, string | null> = {
  "compose up -d": "compose down",
  "compose down": "compose up -d",
  "compose start": "compose stop",
  "compose stop": "compose start",
  "compose restart": "compose restart", // idempotent
  "compose logs --tail=200": null, // read-only
  "compose ps": null, // read-only
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex")
}

// === Service ===

/**
 * applyPatch — 2PC orchestrator (D-A5 6-step).
 *
 * 호출 흐름 (LOOP-side):
 *   1. proposePatch 결과 + ApprovalDecision (approved 또는 edited)을 받음.
 *      decision.type === "rejected"/"aborted"/"expired"는 호출 전 LOOP가 ToolError로 변환.
 *   2. (i-pre) D-A4 mirror staleness check — fileEdit 있을 때만.
 *   3. (i) marker write → (ii) state mirror write → (iii) 원격 SSH cat > → (iv) docker compose →
 *      (v) git commit → (vi) marker delete.
 *   4. fail 분기는 reason별로 outcome="rolled-back" 또는 throw.
 *
 * @param args ApplyPatchArgs
 * @param ctx  AbortController signal (LOOP가 chunk timeout 등에 abort 발화)
 * @returns ApplyPatchResult — outcome: applied | rolled-back
 * @throws Error — 503 marker reject / 원격 동기화 실패 / mirror staleness drift
 */
export async function applyPatch(
  args: ApplyPatchArgs,
  ctx: { signal?: AbortSignal },
): Promise<ApplyPatchResult> {
  const { proposal, decision, userPrompt, remoteComposePath } = args
  const { nonce, stack, command, service } = proposal

  // edited 결정 시 newContent override — fileEdit이 있으면 newContent 교체.
  let effectiveFileEdit: PendingMarker["fileEdit"] | undefined
  if (decision.type === "edited") {
    if (proposal.fileEdit) {
      effectiveFileEdit = {
        path: proposal.fileEdit.path,
        newContent: decision.newContent,
        previousContent: proposal.fileEdit.previousContent,
      }
    } else {
      // proposal에 fileEdit 없는데 edited 결정이 온 경우 — 비정상 흐름이지만
      // path를 추정 (stack 기반)하여 처리. 보통 LOOP가 차단해야 함.
      effectiveFileEdit = {
        path: `state/compose/${stack}.yml`,
        newContent: decision.newContent,
        previousContent: existsSync(`state/compose/${stack}.yml`)
          ? readFileSync(`state/compose/${stack}.yml`, "utf-8")
          : "",
      }
    }
  } else if (proposal.fileEdit) {
    effectiveFileEdit = {
      path: proposal.fileEdit.path,
      newContent: proposal.fileEdit.newContent,
      previousContent: proposal.fileEdit.previousContent,
    }
  }

  // D-C4 marker existence reject — 다른 applyPatch가 진행 중이면 즉시 503.
  if (existingMarkers().length > 0) {
    throw new Error(
      "503: unfinished applyPatch detected (marker exists). Boot drift event 절차에 따라 복구 후 재시도.",
    )
  }

  // D-A4 mirror staleness check — fileEdit 있을 때만 1회 SHA 비교.
  if (effectiveFileEdit) {
    const mirrorContent = existsSync(effectiveFileEdit.path)
      ? readFileSync(effectiveFileEdit.path, "utf-8")
      : ""
    const remoteRead = await dependencies.sshReadFile(
      REMOTE_HOST,
      remoteComposePath,
      ctx.signal,
    )
    if (remoteRead.exit !== 0) {
      throw new Error(
        `원격 파일 read 실패 (mirror staleness check): exit ${remoteRead.exit}: ${remoteRead.stderr.slice(
          0,
          200,
        )}`,
      )
    }
    if (sha256(remoteRead.stdout) !== sha256(mirrorContent)) {
      throw new Error(
        `state/compose mirror outdated (drift detected). 운영자가 직접 수정한 듯. sync proposal 먼저 실행 후 재시도. (retryable=false)`,
      )
    }
  }

  const t0 = Date.now()
  const sha_before = await dependencies.gitRevParseHead(".")

  const marker: PendingMarker = {
    nonce,
    stack,
    command,
    service,
    fileEdit: effectiveFileEdit,
    reasoning: proposal.reasoning,
    user_prompt: userPrompt,
    sha_before,
    ts_created: new Date().toISOString(),
    docker_started_at: null,
    docker_finished_at: null,
    exit_code: null,
  }

  // (i) marker write — fsync sync.
  writeMarker(marker)

  try {
    // (ii) state mirror write — fileEdit 있을 때만.
    if (effectiveFileEdit) {
      await Bun.write(effectiveFileEdit.path, effectiveFileEdit.newContent)
    }

    // (iii) 원격 SSH `cat > /원격경로/{stack}/docker-compose.yml` — fileEdit 있을 때만.
    if (effectiveFileEdit) {
      const writeResult = await dependencies.sshWriteFile(
        REMOTE_HOST,
        remoteComposePath,
        effectiveFileEdit.newContent,
        ctx.signal,
      )
      if (writeResult.exit !== 0) {
        // state mirror revert
        await Bun.write(effectiveFileEdit.path, effectiveFileEdit.previousContent)
        deleteMarker(nonce)
        throw new Error(
          `원격 파일 동기화 실패 (exit ${writeResult.exit}): ${writeResult.stderr.slice(
            0,
            200,
          )}`,
        )
      }
    }

    // (iv) 원격 SSH `cd <remoteDir> && docker compose <cmd> [<svc>]`.
    // remoteDir = remoteComposePath의 상위 디렉토리 (마지막 파일명 제거)
    const remoteDir = remoteComposePath.replace(/\/[^/]+$/, "")
    const dockerCmdSuffix = command === "compose ps"
      ? "compose ps"
      : `${command}${service ? ` ${service}` : ""}`
    const dockerRemoteCmd = `cd ${remoteDir} && docker ${dockerCmdSuffix}`

    updateMarker(nonce, { docker_started_at: new Date().toISOString() })
    const dockerResult = await dependencies.sshExec(dockerRemoteCmd, ctx.signal)
    updateMarker(nonce, {
      docker_finished_at: new Date().toISOString(),
      exit_code: dockerResult.exit,
    })

    if (dockerResult.exit !== 0) {
      // (iv) fail — Open Q 3 옵션 A: 원격 파일 + state 미러 revert, git commit 안 함.
      if (effectiveFileEdit) {
        await dependencies.sshWriteFile(
          REMOTE_HOST,
          remoteComposePath,
          effectiveFileEdit.previousContent,
          ctx.signal,
        )
        await Bun.write(effectiveFileEdit.path, effectiveFileEdit.previousContent)
      }
      deleteMarker(nonce)
      return {
        outcome: {
          type: "rolled-back",
          reason: `docker exit ${dockerResult.exit}: ${dockerResult.stderr.slice(0, 200)}`,
          nonce,
          stack,
        },
      }
    }

    // (v) git commit state/ — buildMessage + commitWithMessage.
    const fileEditSummary = effectiveFileEdit
      ? `hunks=${(proposal.diff.match(/^@@/gm) ?? []).length} files=1`
      : undefined
    const message = buildMessage({
      stack: stack as Parameters<typeof buildMessage>[0]["stack"],
      command,
      service,
      fileEditSummary,
      userPrompt,
      reasoning: proposal.reasoning,
      nonce,
    })

    try {
      // git add: 명시적 pathspec — D-04 lock 준수 (cwd=".", state/ pathspec).
      // 변경 가능한 파일: state mirror (effectiveFileEdit.path) + 추후 state/services.yaml.
      // 현재는 effectiveFileEdit이 state/compose/{stack}.yml 또는 state/services.yaml 둘 중 하나.
      const addPaths: string[] = []
      if (effectiveFileEdit) addPaths.push(effectiveFileEdit.path)
      if (addPaths.length > 0) {
        await dependencies.gitAdd(addPaths, ".")
      }

      await dependencies.commitWithMessage(message, nonce, ".")

      // (vi) marker delete + outcome=applied.
      deleteMarker(nonce)
      const sha_after = await dependencies.gitRevParseHead(".")
      return {
        outcome: {
          type: "applied",
          sha_after,
          duration_ms: Date.now() - t0,
          nonce,
          stack,
          command,
          service,
        },
      }
    } catch (gitErr) {
      // (v) fail — D-B3 신규 분기. 역 docker 자동 시도.
      const reverseSubcmd = REVERSE_DOCKER[command] ?? null
      let rollbackOk = false
      let rollbackCommand: string | undefined
      if (reverseSubcmd !== null) {
        const reverseSuffix = command === "compose ps"
          ? "compose ps"
          : `${reverseSubcmd}${service ? ` ${service}` : ""}`
        rollbackCommand = reverseSuffix
        const reverseRemoteCmd = `cd ${remoteDir} && docker ${reverseSuffix}`
        const rb = await dependencies.sshExec(reverseRemoteCmd, ctx.signal)
        rollbackOk = rb.exit === 0
      }
      // 원격 + state 파일 revert (역 docker 후).
      if (effectiveFileEdit) {
        await dependencies.sshWriteFile(
          REMOTE_HOST,
          remoteComposePath,
          effectiveFileEdit.previousContent,
          ctx.signal,
        )
        await Bun.write(effectiveFileEdit.path, effectiveFileEdit.previousContent)
      }
      deleteMarker(nonce)
      return {
        outcome: {
          type: "rolled-back",
          reason: `git commit failed: ${(gitErr as Error).message.slice(0, 200)}`,
          rollback_command: rollbackCommand,
          rollback_ok: reverseSubcmd !== null ? rollbackOk : undefined,
          nonce,
          stack,
        },
      }
    }
  } catch (e) {
    // 예외가 (i)~(iii) 흐름 내에서 발생 시 marker delete (이미 deleted면 silent).
    deleteMarker(nonce)
    throw e
  }
}
