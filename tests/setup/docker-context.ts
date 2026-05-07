// tests/setup/docker-context.ts — Phase 2 D-A3 helper
//
// PROD 절대 조작 금지 원칙 (CRITICAL):
//   - 모든 docker 명령은 `--context default`를 explicit positional 인자로 전달.
//     `process.env.DOCKER_CONTEXT = "default"` 만으로는 Bun.spawn된 자식 docker
//     CLI에 환경변수가 안정적으로 전파되지 않을 수 있어 active context
//     (home-server = PROD 192.168.0.5)로 fallback할 위험이 있다.
//     belt-and-suspenders로 env 변경 + explicit `--context default` 둘 다 적용.
//   - 환경변수도 동시에 설정 — test가 다른 docker 호출 코드를 트리거할 수 있어
//     안전망 layered.
//
// 동작:
//   - switchToLocalContext: 현재 DOCKER_CONTEXT 저장 + "default"로 설정 +
//     docker --context default compose -f tests/fixtures/test-compose.yml up -d.
//   - restoreContext: docker --context default compose ... down --volumes +
//     DOCKER_CONTEXT 원복(원래 unset이었으면 다시 unset).
//   - docker compose up/down은 idempotent — 이미 up이면 no-op, 이미 down이면 no-op.

const TEST_COMPOSE_PATH = "tests/fixtures/test-compose.yml"
const LOCAL_CONTEXT = "default"

export interface SavedDockerContext {
  /** 원래 DOCKER_CONTEXT 값. 미설정이었으면 빈 문자열. */
  originalContext: string
  /** restoreContext가 down을 실행해야 하는지 여부 (이미 up이었으면 false 가능). */
  testStackUp: boolean
}

interface SpawnResult {
  exit: number
  stdout: string
  stderr: string
}

async function runCommand(args: readonly string[]): Promise<SpawnResult> {
  const proc = Bun.spawn(args as string[], { stdout: "pipe", stderr: "pipe" })
  const exit = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { exit, stdout, stderr }
}

export async function switchToLocalContext(): Promise<SavedDockerContext> {
  const originalContext = process.env.DOCKER_CONTEXT ?? ""
  process.env.DOCKER_CONTEXT = LOCAL_CONTEXT

  // CRITICAL: --context default explicit positional. env 전파에 의존하지 않는다.
  // docker compose up -d는 idempotent — 이미 up이면 그대로 두고 부재한 컨테이너만 만든다.
  const result = await runCommand([
    "docker",
    "--context", LOCAL_CONTEXT,
    "compose",
    "-f", TEST_COMPOSE_PATH,
    "up",
    "-d",
  ])
  if (result.exit !== 0) {
    // 실패 시 DOCKER_CONTEXT 원복 후 throw — caller가 cleanup 호출 안 해도 안전.
    if (originalContext === "") {
      delete process.env.DOCKER_CONTEXT
    } else {
      process.env.DOCKER_CONTEXT = originalContext
    }
    throw new Error(
      `docker compose up 실패 (exit=${result.exit}): ${result.stderr.slice(0, 200)}`,
    )
  }

  return { originalContext, testStackUp: true }
}

export async function restoreContext(saved: SavedDockerContext): Promise<void> {
  if (saved.testStackUp) {
    // CRITICAL: --context default explicit. env에 의존 안 함.
    // cleanup은 best-effort — exit 비-0이어도 DOCKER_CONTEXT 복원은 무조건 수행.
    await runCommand([
      "docker",
      "--context", LOCAL_CONTEXT,
      "compose",
      "-f", TEST_COMPOSE_PATH,
      "down",
      "--volumes",
    ])
  }

  if (saved.originalContext === "") {
    delete process.env.DOCKER_CONTEXT
  } else {
    process.env.DOCKER_CONTEXT = saved.originalContext
  }
}
