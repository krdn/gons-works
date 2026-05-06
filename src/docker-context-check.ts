import type { EnvProblem } from "./env"

// BOOT-04: docker context inspect <DOCKER_CONTEXT> 검증.
// Bun.spawn으로 동기 실행. 실패 시 envelope 반환.
// 실제 호출은 Spike 1에서 검증되며, 여기서는 검증 함수만 export.
export async function ensureDockerContext(name: string): Promise<{ ok: true } | { ok: false; problem: EnvProblem }> {
  const proc = Bun.spawn(["docker", "context", "inspect", name], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  if (exitCode === 0) return { ok: true }
  const stderr = await new Response(proc.stderr).text()
  return {
    ok: false,
    problem: {
      problem: `Docker context "${name}" not found or unreachable`,
      cause: stderr.trim() || `docker context inspect ${name} 종료 코드 ${exitCode}`,
      fix: `docker context create ${name} --docker host=ssh://gon@192.168.0.5 명령으로 등록하거나, .env의 DOCKER_CONTEXT 값을 다른 이름으로 변경하세요.`,
    },
  }
}
