#!/usr/bin/env bun
import { mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"

// scripts/init-state-compose.ts — Phase 2 D-A2 lock
//
// 192.168.0.5 운영 서버의 docker-compose.yml 4개를 SSH cat으로 일회성 복사하여
// state/compose/{stack}.yml 미러를 만든다. 평소 sync는 안 함 (D-A2). 이후 갱신은
// 02-06 applyPatch 흐름으로만 일어난다.
//
// Option A scope (hotfix 2026-05-07): 4 stack — open-webui 제외.
// 192.168.0.5의 open-webui는 plain `docker run`으로 실행되어 compose 미관리.
// v2 backlog: open-webui compose 전환 후 5-stack 복관.
//
// D-04 lock: state/는 메인 repo subdir이며 별도 git repo가 아니다.
// 따라서 git 명령은 메인 repo에서 실행되며 pathspec으로 `state/compose/`만
// staging한다. NEVER `cd state && git init`.
//
// SSH 옵션은 tools/readCompose.ts:43-59 carry-forward (PITFALL #12 mitigated):
//   ConnectTimeout=10 / ServerAliveInterval=5 / ServerAliveCountMax=2 /
//   BatchMode=yes / StrictHostKeyChecking=accept-new

interface RemoteComposeMap {
  readonly [stack: string]: string
}

// 4 stack 원격 compose 절대경로. 각 경로는 dispatcher가 `ssh test -f`로 실제 존재
// 검증 완료 (2026-05-07). open-webui는 docker run이라 제외 (v2 backlog).
const REMOTE_COMPOSE_PATHS: RemoteComposeMap = {
  news:      "/home/gon/deploy/news-sentiment-prod/docker-compose.yml",
  ais:       "/home/gon/actions-runner/_work/ai-signalcraft/ai-signalcraft/docker/docker-compose.prod.yml",
  n8n:       "/home/gon/docker-n8n/docker-compose.yml",
  "krdn-fx": "/home/gon/projects/krdn-fx/docker-compose.yml",
}

const SSH_HOST = "gon@192.168.0.5"
const COMPOSE_DIR = "state/compose"

async function sshCat(remotePath: string): Promise<string> {
  const proc = Bun.spawn(
    [
      "ssh",
      "-o", "ConnectTimeout=10",
      "-o", "ServerAliveInterval=5",
      "-o", "ServerAliveCountMax=2",
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      SSH_HOST,
      "cat", remotePath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const exit = await proc.exited
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`SSH cat 실패 ${remotePath}: ${err.slice(0, 200)}`)
  }
  return await new Response(proc.stdout).text()
}

async function gitMain(args: readonly string[]): Promise<string> {
  // cwd: 메인 repo 루트(현재 디렉토리). state/ 안에서 호출해도 git이
  // 상위로 거슬러 .git을 찾으므로 결과는 동일하나, 의도를 명확히 하기 위해
  // 루트에서 호출하고 pathspec으로 state/를 지정한다 (D-04 lock).
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" })
  const exit = await proc.exited
  const out = await new Response(proc.stdout).text()
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`git ${args.join(" ")} 실패: ${err.slice(0, 200)}`)
  }
  return out
}

async function main(): Promise<void> {
  if (!existsSync(COMPOSE_DIR)) {
    mkdirSync(COMPOSE_DIR, { recursive: true })
    console.log(`[init] mkdir -p ${COMPOSE_DIR}`)
  }

  const stacks = Object.entries(REMOTE_COMPOSE_PATHS)
  for (const [stack, remotePath] of stacks) {
    console.log(`[init] ${stack} ← ${remotePath}`)
    const content = await sshCat(remotePath)
    await Bun.write(join(COMPOSE_DIR, `${stack}.yml`), content)
  }

  // 변경 있을 때만 commit (idempotent — 두 번 실행해도 commit이 누적되지 않음).
  const status = await gitMain(["status", "--porcelain", "--", "state/compose/"])
  if (status.trim().length === 0) {
    console.log("[init] state/compose/ 변경 없음 — commit skip")
    return
  }

  await gitMain(["add", "--", "state/compose/"])
  await gitMain([
    "commit",
    "-m",
    "feat(02): bootstrap state/compose mirror (4 stacks via SSH cat)",
    "--",
    "state/compose/",
  ])
  const head = await gitMain(["log", "-1", "--oneline", "--", "state/compose/"])
  console.log(`[init] OK — 4 mirrors committed: ${head.trim()}`)
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[init] 실패: ${msg}`)
  process.exit(1)
})
