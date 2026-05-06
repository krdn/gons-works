// tools/listContainers.ts — READ-01 + PITFALL #8 prevention
//
// Public API:
//   DockerContainer  — { name, image, state, status } shape (UI/agent에 안전한 4 필드)
//   listContainers   — Bun.$ docker --context ${env.DOCKER_CONTEXT} ps [-a] --format json
//                      → NDJSON 파싱 → filter (state, namePattern) + limit 적용
//
// 핵심 보호:
//   PITFALL #8 — DOCKER_CONTEXT leak. process.env 직접 접근 금지. 항상 env.DOCKER_CONTEXT.
//   LOOP-04   — _envelope.run()이 catch 경로에서 throw 안 함 → orphan tool_use 차단.
//   LOOP-06   — 30s AbortController timeout (envelope의 default).
//
// docker ps --format json은 NDJSON (라인당 1 JSON 객체)을 반환한다.
// scripts/draft-services-yaml.ts:39-52 패턴 그대로 재사용.

import { $ } from "bun"
import { loadEnv } from "../src/env"
import { run, type ToolError } from "./_envelope"
import type { ListContainersArgs } from "./_index"

// docker ps --format json 의 raw row shape (필요한 필드만 선언, 나머지는 무시).
interface DockerPsRow {
  Names: string
  Image: string
  State: string
  Status: string
}

// agent/UI에 노출할 정규화된 컨테이너 shape.
export interface DockerContainer {
  name: string
  image: string
  state: string
  status: string
}

/**
 * 192.168.0.5 home-server 컨텍스트의 docker 컨테이너 목록.
 *
 * - state="running"(default) → State === "running" 만 반환
 * - state="stopped" → State !== "running" 만 반환
 * - state="all" → 전부 반환 (-a 플래그)
 * - namePattern → Names.includes(pattern) 부분 일치
 * - limit (default 20) → 결과 slice
 *
 * @param args ListContainersArgs (default: { limit: 20 })
 * @returns DockerContainer[] 또는 ToolError envelope
 */
export async function listContainers(
  args: ListContainersArgs = { limit: 20 },
): Promise<DockerContainer[] | ToolError> {
  const env = loadEnv()
  const ctx = env.DOCKER_CONTEXT
  const stateFilter = args.filter?.state ?? "running"
  const namePattern = args.filter?.namePattern
  const limit = args.limit ?? 20

  return await run("listContainers", async (_signal) => {
    // PITFALL #8: ctx는 env.DOCKER_CONTEXT만 사용 (process.env 직접 접근 금지).
    // docker ps --format json은 NDJSON (line-delimited JSON) 반환.
    // -a 플래그를 모든 호출에서 사용하고 application layer에서 필터 — running-only 시도
    // 도중 stopped 컨테이너가 namePattern과 매칭되면 결과 누락 위험.
    const raw = (await $`docker --context ${ctx} ps -a --format json`.text()) ?? ""

    const rows: DockerPsRow[] = raw
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as DockerPsRow)

    // 필터 순서: namePattern → state → limit
    let filtered = rows
    if (namePattern) {
      filtered = filtered.filter((r) => r.Names.includes(namePattern))
    }
    if (stateFilter === "running") {
      filtered = filtered.filter((r) => r.State === "running")
    } else if (stateFilter === "stopped") {
      filtered = filtered.filter((r) => r.State !== "running")
    }
    // stateFilter === "all" 일 때는 추가 필터 없음.

    return filtered.slice(0, limit).map<DockerContainer>((r) => ({
      name: r.Names,
      image: r.Image,
      state: r.State,
      status: r.Status,
    }))
  })
}
