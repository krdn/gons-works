import {
  writeFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from "node:fs"
import { join } from "node:path"

// state/commit.ts — APPLY-06 / D-D1 / D-D3 lock
//
// D-04 lock: state/는 메인 repo의 서브디렉토리이며 별도 git repo가 아니다
// (00-CONTEXT.md line 54-56). 따라서 git commit은 메인 repo 루트에서 실행하되
// pathspec `state/`로 한정하여 state/ 외 staged 파일이 끼어들지 못하게 막는다.
//
// D-D3 lock: shell escape 위험을 차단하기 위해 Bun.$ (shell-mode)는 사용하지
// 않는다. Bun.spawn(['git', 'commit', '-F', tmpFile, '--', 'state/'])로
// 임시파일을 통해 message를 전달하고, '--' 분리자로 args/pathspec을 구분한다.
//
// 임시파일은 cwd 기준 `data/.tmp/state-msg-{nonce}.txt`에 작성하며 finally
// 블록에서 unlink (실패 시 swallow). data/는 .gitignore 적용됨.

export type Stack = "news" | "ais" | "n8n" | "open-webui" | "krdn-fx"

export interface ApplyResult {
  stack: Stack
  command: string // D-B1 7-union의 raw 문자열 ("compose restart" 등)
  service: string // <svc>; 'compose ps'일 때 빈 문자열 OK
  fileEditSummary?: string // "image bump 1.2->1.3" 또는 hunks={N} files={N} 자동 생성
  userPrompt: string // 사용자 NL 입력 원본 (200자 cap 전)
  reasoning: string // proposePatch.reasoning (500자 cap 전)
  nonce: string // crypto.randomUUID
  diffSummaryRaw?: string // jsdiff hunks 카운트 등 — 자동 생성
}

// D-D3 sanitize 시퀀스:
// 1) /[\n\r]+/g → " / "  (multi-line → 한 줄, 단일 separator로 압축)
// 2) /[`$\0]/g → ""      (shell metachar / null byte 제거)
// 3) .slice(0, cap)
export function sanitize(text: string, cap: number): string {
  return String(text)
    .replace(/[\n\r]+/g, " / ")
    .replace(/[`$\0]/g, "")
    .slice(0, cap)
}

// D-D1 lock — Subject 한 줄 + body 4 필드.
// Subject: apply(<stack>): <command>[ <service>][ [<file-edit-summary>]]
// Body: User-Prompt / AI-Reasoning / Diff-Summary / Nonce
export function buildMessage(action: ApplyResult): string {
  const subjectExtra = action.fileEditSummary
    ? ` [${sanitize(action.fileEditSummary, 80)}]`
    : ""
  const servicePart = action.service ? ` ${action.service}` : ""
  const subject = `apply(${action.stack}): ${action.command}${servicePart}${subjectExtra}`

  const diffSummary = sanitize(
    action.fileEditSummary ?? action.diffSummaryRaw ?? "no-file-change",
    100,
  )

  const body = [
    `User-Prompt: ${sanitize(action.userPrompt, 200)}`,
    `AI-Reasoning: ${sanitize(action.reasoning, 500)}`,
    `Diff-Summary: ${diffSummary}`,
    `Nonce: ${action.nonce}`,
  ].join("\n")

  return `${subject}\n\n${body}`
}

// D-D3 / D-04 lock — Bun.spawn -F 임시파일 + cwd 메인 repo 루트.
// 호출자는 production 코드에서 cwd default `.` (메인 repo 루트)을 사용한다.
// test에서는 임시 git repo 경로로 cwd를 override하여 격리 검증한다.
//
// allowEmpty (v1.1 hotfix 2026-05-07, F-9 fix):
//   D-B1 7-command 중 lifecycle-only 5개 (compose restart/start/stop/up -d/down/logs/ps)는
//   fileEdit 없이 docker 명령만 실행 → state/ 변경 0 → `git commit` 단독은 staged 변경 없어 exit 1.
//   D-D4 lock(applied/rolled-back만 commit)을 만족시키려면 audit log commit이 필요한데
//   staged 0건이면 `--allow-empty` 없이는 불가능. caller가 명시적으로 lifecycle-only 흐름임을 알 때
//   `allowEmpty: true`로 호출. fileEdit 있는 흐름은 false(default) 유지하여 의도치 않은 빈 commit 차단.
//
// pathspecs (v1.2 hotfix 2026-05-07, F-14 fix):
//   기존 v1.1은 spawn argv에 pathspec `'state/'` (디렉토리 전체)를 사용 → unstaged working-tree 변경
//   까지 캡처되는 audit integrity 위반 (라이브 사고 add0eb4). v1.2는 caller(applyPatch)가 정확한
//   addPaths를 전달하면 그 list만 pathspec으로 사용. 빈 array(lifecycle-only)면 pathspec 없이
//   `--allow-empty`만 — staged 변경이 없는 한 빈 commit, 다른 영역 working-tree 변경은 캡처 안 함.
export async function commitWithMessage(
  message: string,
  nonce: string,
  cwd: string = ".",
  allowEmpty: boolean = false,
  pathspecs: readonly string[] = ["state/"],
): Promise<void> {
  const tmpDir = join(cwd, "data/.tmp")
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true })
  }
  const tmpFile = join(tmpDir, `state-msg-${nonce}.txt`)
  writeFileSync(tmpFile, message, { encoding: "utf-8" })

  try {
    // 임시파일 경로는 cwd 기준 상대로 전달 (Bun.spawn에 cwd 적용 후 동일 위치 해석).
    const relTmpFile = join("data/.tmp", `state-msg-${nonce}.txt`)
    const argv = ["git", "commit"]
    if (allowEmpty) argv.push("--allow-empty")
    argv.push("-F", relTmpFile)
    // pathspecs가 비어있으면 (lifecycle-only allow-empty 흐름) pathspec 없이 commit.
    // 비어있지 않으면 명시 pathspec으로 한정 — unstaged working-tree pollution 차단 (F-14).
    if (pathspecs.length > 0) {
      argv.push("--", ...pathspecs)
    }
    const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" })
    const exit = await proc.exited
    if (exit !== 0) {
      const stderrText = await new Response(proc.stderr).text()
      throw new Error(
        `git commit 실패 (exit ${exit}): ${stderrText.slice(0, 200)}`,
      )
    }
  } finally {
    try {
      unlinkSync(tmpFile)
    } catch {
      // unlink 실패는 swallow — 임시파일이 이미 정리됐거나 권한 이슈일 수 있음.
      // commit 결과에 영향 없음.
    }
  }
}
