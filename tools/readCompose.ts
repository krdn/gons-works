// tools/readCompose.ts — READ-03 + PITFALL #12 prevention (SSH timeout)
//
// Public API:
//   readCompose(args)  — ssh gon@192.168.0.5 cat <composePath>
//                        SSH-level keepalive + ConnectTimeout으로 hang 차단.
//                        _envelope.run()이 추가로 30s AbortController로 자식 프로세스 kill.
//
// 핵심 보호:
//   PITFALL #12 — SSH 연결 hang. 운영서버 부하 시 SSH가 syscall 단계에서 멎는다.
//                 ConnectTimeout=10 + ServerAliveInterval=5 + ServerAliveCountMax=2 + BatchMode=yes로
//                 dead 연결을 빠르게 감지. _envelope.run()의 30s timeout과 협력.
//   Bun.spawn args 배열 사용 — shell 문자열 interpolation 부재. composePath에 `; rm -rf /` 같은
//                 metachar가 들어와도 shell parsing 거치지 않음 (cat의 단일 인자로 그대로 전달).
//
// Threat model (T-01-04-06): composePath path traversal은 accept.
//   - 192.168.0.5는 신뢰된 단일 호스트, SSH cat은 read-only.
//   - 실패한 path는 cat이 exit code != 0으로 반환 → ToolError envelope.

import type { ReadComposeArgs } from "./_index"
import { run, type ToolError } from "./_envelope"

const SSH_HOST = "gon@192.168.0.5"

/**
 * 192.168.0.5의 docker-compose 파일을 SSH cat으로 읽어 string 반환.
 *
 * SSH 옵션 lock (PITFALL #12):
 *   ConnectTimeout=10       — TCP 핸드셰이크 10s 미달성 시 abort
 *   ServerAliveInterval=5   — 5s마다 keepalive 패킷
 *   ServerAliveCountMax=2   — 응답 없는 keepalive 2번 누적 시 abort
 *   BatchMode=yes           — interactive 비활성 (password prompt 차단, key auth만)
 *
 * @param args ReadComposeArgs — { composePath: string (절대 경로) }
 * @returns 파일 내용 string 또는 ToolError envelope
 */
export async function readCompose(args: ReadComposeArgs): Promise<string | ToolError> {
  return await run(
    "readCompose",
    async (signal) => {
      // PITFALL #12: SSH-level keepalive + ConnectTimeout. _envelope.run()의 30s
      // AbortController는 추가 안전망 — signal은 spawn options에 전달되어 abort 시
      // 자식 프로세스 kill됨.
      const proc = Bun.spawn(
        [
          "ssh",
          "-o",
          "ConnectTimeout=10",
          "-o",
          "ServerAliveInterval=5",
          "-o",
          "ServerAliveCountMax=2",
          "-o",
          "BatchMode=yes",
          SSH_HOST,
          "cat",
          args.composePath,
        ],
        { stdout: "pipe", stderr: "pipe", signal },
      )

      const exitCode = await proc.exited
      if (exitCode !== 0) {
        const errText = await new Response(proc.stderr).text()
        // _envelope.run()이 catch해서 ToolError envelope으로 변환.
        throw new Error(`SSH 실패 (exit ${exitCode}): ${errText.slice(0, 200)}`)
      }
      return await new Response(proc.stdout).text()
    },
    30_000,
  )
}
