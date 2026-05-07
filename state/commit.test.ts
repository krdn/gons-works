import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildMessage,
  sanitize,
  commitWithMessage,
  type ApplyResult,
} from "./commit"

// state/commit.test.ts — APPLY-06 / D-D1 / D-D3 lock 검증
//
// dispatcher 메시지 + must_haves line 30에 따라 commitWithMessage는
// `cwd: '.'` (메인 repo 루트) + pathspec `'state/'`로 한정한다.
// state/는 메인 repo 서브디렉토리이며 별도 git repo가 아니다 (D-04 lock).
//
// 테스트 setup도 동일하게: 임시 git repo 안에 `state/` 서브디렉토리를 만들고
// 그 아래 파일을 stage하여 production 패턴과 1:1 매칭시킨다.

describe("state/commit", () => {
  describe("sanitize", () => {
    test("newline (LF/CR) 제거 → ' / ' 치환", () => {
      expect(sanitize("a\nb\rc", 100)).toBe("a / b / c")
    })

    test("backtick / dollar / null 제거", () => {
      expect(sanitize("`a$b\0c", 100)).toBe("abc")
    })

    test("cap 적용 (한국어 50자 + cap 20 → 20자)", () => {
      const result = sanitize("가".repeat(50), 20)
      expect(result.length).toBe(20)
    })

    test("cap=0이면 빈 문자열", () => {
      expect(sanitize("anything", 0)).toBe("")
    })

    test("빈 문자열 입력 → 빈 문자열", () => {
      expect(sanitize("", 100)).toBe("")
    })
  })

  describe("buildMessage", () => {
    const base: ApplyResult = {
      stack: "news",
      command: "compose restart",
      service: "news-prod-app",
      userPrompt: "재시작",
      reasoning: "테스트 사유",
      nonce: "abc1234",
    }

    test("Subject grep — no fileEditSummary", () => {
      const msg = buildMessage(base)
      expect(msg).toMatch(/^apply\(news\): compose restart news-prod-app/)
    })

    test("Subject grep — with fileEditSummary", () => {
      const msg = buildMessage({ ...base, fileEditSummary: "image bump 1.2->1.3" })
      expect(msg).toMatch(
        /^apply\(news\): compose restart news-prod-app \[image bump 1\.2->1\.3\]/,
      )
    })

    test("body 4 필드 (User-Prompt / AI-Reasoning / Diff-Summary / Nonce)", () => {
      const msg = buildMessage(base)
      expect(msg).toContain("\nUser-Prompt: 재시작")
      expect(msg).toContain("\nAI-Reasoning: 테스트 사유")
      expect(msg).toContain("\nDiff-Summary: no-file-change")
      expect(msg).toContain("\nNonce: abc1234")
    })

    test("Diff-Summary fallback 우선순위 (fileEditSummary > diffSummaryRaw > no-file-change)", () => {
      const withFileEdit = buildMessage({ ...base, fileEditSummary: "image bump" })
      expect(withFileEdit).toContain("Diff-Summary: image bump")

      const withDiffSummaryRaw = buildMessage({ ...base, diffSummaryRaw: "hunks=2 files=1" })
      expect(withDiffSummaryRaw).toContain("Diff-Summary: hunks=2 files=1")

      const neither = buildMessage(base)
      expect(neither).toContain("Diff-Summary: no-file-change")
    })

    test("cap 적용 — userPrompt 300자 → User-Prompt 라인 200자 cap", () => {
      const longPrompt = "a".repeat(300)
      const msg = buildMessage({ ...base, userPrompt: longPrompt })
      const promptLine = msg.split("\n").find((l) => l.startsWith("User-Prompt: "))!
      expect(promptLine.length).toBe("User-Prompt: ".length + 200)
    })

    test("cap 적용 — reasoning 700자 → AI-Reasoning 라인 500자 cap", () => {
      const longReasoning = "b".repeat(700)
      const msg = buildMessage({ ...base, reasoning: longReasoning })
      const reasoningLine = msg
        .split("\n")
        .find((l) => l.startsWith("AI-Reasoning: "))!
      expect(reasoningLine.length).toBe("AI-Reasoning: ".length + 500)
    })

    test("Subject sanitize — fileEditSummary multi-line 차단", () => {
      const msg = buildMessage({ ...base, fileEditSummary: "line1\nline2" })
      // newline은 ' / '로 치환되어 Subject 한 줄 유지
      const subject = msg.split("\n")[0]
      expect(subject).toBe(
        "apply(news): compose restart news-prod-app [line1 / line2]",
      )
    })

    test("service 빈 문자열 — Subject에 service 토큰 생략 (compose ps 케이스)", () => {
      const msg = buildMessage({ ...base, service: "", command: "compose ps" })
      expect(msg).toMatch(/^apply\(news\): compose ps\n/)
    })
  })

  describe("commitWithMessage roundtrip", () => {
    let tmp: string

    beforeEach(async () => {
      tmp = mkdtempSync(join(tmpdir(), "gons-state-"))
      // state/ 서브디렉토리 생성 — production 패턴 1:1 매칭
      mkdirSync(join(tmp, "state"), { recursive: true })
      mkdirSync(join(tmp, "data/.tmp"), { recursive: true })
      writeFileSync(join(tmp, "state/marker.json"), '{"x":1}')

      const init = Bun.spawn(["git", "init", "-q"], { cwd: tmp })
      await init.exited
      const cfgEmail = Bun.spawn(["git", "config", "user.email", "t@t"], { cwd: tmp })
      await cfgEmail.exited
      const cfgName = Bun.spawn(["git", "config", "user.name", "t"], { cwd: tmp })
      await cfgName.exited
      const cfgGpg = Bun.spawn(["git", "config", "commit.gpgsign", "false"], {
        cwd: tmp,
      })
      await cfgGpg.exited
      const add = Bun.spawn(["git", "add", "state/"], { cwd: tmp })
      await add.exited
    })

    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true })
    })

    test("multi-line 한국어 + shell metachar body roundtrip — sanitize 적용 후 git log 일치", async () => {
      const action: ApplyResult = {
        stack: "news",
        command: "compose restart",
        service: "news-prod-app",
        userPrompt: "한국어\n줄바꿈",
        reasoning: "test `dangerous` $injection",
        nonce: crypto.randomUUID(),
      }
      const msg = buildMessage(action)
      await commitWithMessage(msg, action.nonce, tmp)

      const logProc = Bun.spawn(["git", "log", "-1", "--format=%B"], {
        cwd: tmp,
        stdout: "pipe",
      })
      await logProc.exited
      const out = await new Response(logProc.stdout).text()

      expect(out.trim()).toBe(msg.trim())
      // sanitize 결과 확인: backtick / dollar 제거, newline → " / "
      expect(msg).toContain("User-Prompt: 한국어 / 줄바꿈")
      expect(msg).toContain("AI-Reasoning: test dangerous injection")
    })

    test("commit이 state/ pathspec 한정 — state/ 외 staged 파일은 commit에 포함 안 됨", async () => {
      // tmp repo에 state/ 외 파일도 stage
      writeFileSync(join(tmp, "outside.txt"), "should-not-be-committed")
      const addOutside = Bun.spawn(["git", "add", "outside.txt"], { cwd: tmp })
      await addOutside.exited

      const action: ApplyResult = {
        stack: "ais",
        command: "logs",
        service: "ais-prod-web",
        userPrompt: "logs check",
        reasoning: "테스트",
        nonce: crypto.randomUUID(),
      }
      const msg = buildMessage(action)
      await commitWithMessage(msg, action.nonce, tmp)

      // commit에 포함된 파일 확인
      const showProc = Bun.spawn(
        ["git", "show", "--name-only", "--format=", "HEAD"],
        { cwd: tmp, stdout: "pipe" },
      )
      await showProc.exited
      const filesText = await new Response(showProc.stdout).text()

      expect(filesText).toContain("state/marker.json")
      expect(filesText).not.toContain("outside.txt")
    })

    test("exit ≠ 0 시 throw + 임시파일 unlink (결정적 실패: nothing to commit)", async () => {
      // staged 상태를 비워서 commit이 결정적으로 실패하도록 만든다.
      const reset = Bun.spawn(["git", "reset"], { cwd: tmp })
      await reset.exited

      const failNonce = "fail-nonce-deterministic"
      await expect(
        commitWithMessage("subject only\n\nbody", failNonce, tmp),
      ).rejects.toThrow(/git commit 실패/)

      // 임시파일 unlink 확인 (cwd 기준 절대 경로)
      const tmpFile = join(tmp, "data/.tmp", `state-msg-${failNonce}.txt`)
      expect(existsSync(tmpFile)).toBe(false)
    })

    test("성공 시 임시파일 unlink", async () => {
      const action: ApplyResult = {
        stack: "n8n",
        command: "compose ps",
        service: "",
        userPrompt: "ps",
        reasoning: "확인",
        nonce: crypto.randomUUID(),
      }
      const msg = buildMessage(action)
      await commitWithMessage(msg, action.nonce, tmp)

      const tmpFile = join(tmp, "data/.tmp", `state-msg-${action.nonce}.txt`)
      expect(existsSync(tmpFile)).toBe(false)
    })
  })
})
