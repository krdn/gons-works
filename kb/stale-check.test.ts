// kb/stale-check.test.ts — KB-03 + D-13.4 검증.
//
// 검증 대상:
//   makeStaleCheck(deps) 팩토리 — execDocker / readYaml DI로 mock-friendly
//   StalenessReport.unknown — docker-only 컨테이너 (5 stack 미매칭)
//   StalenessReport.stale   — yaml-only stack (라이브 인스턴스 0)
//   StalenessReport.drifted — Phase 1 항상 빈 배열 (v2 deferred)
//   30s TTL cache — 동일 input 재호출 → docker 호출 안 함
//   cache key 분리 — DOCKER_CONTEXT 변경 시 캐시 분리
//
// 격리:
//   - getStalenessCache().clear()로 매 테스트 독립
//   - execDocker / readYaml은 stub function으로 주입 (Bun.$ template literal mock 회피)

import { test, expect, describe, beforeEach } from "bun:test"
import { makeStaleCheck, getStalenessCache } from "./stale-check"
import type { Env } from "../src/env"

const sampleEnv: Env = {
  ANTHROPIC_BASE_URL: "http://localhost:8317",
  ANTHROPIC_API_KEY: "test-key",
  VOYAGE_API_KEY: "test-voyage",
  COPILOT_MODEL_READONLY: "claude-sonnet-4-6",
  COPILOT_MODEL_PROPOSE: "claude-opus-4-6",
  DOCKER_CONTEXT: "home-server",
}

const fixtureYaml = `generated_at: "2026-05-06T11:04:05.868Z"
generated_from: "docker --context home-server ps -a --format json"
stacks:
  news:
    purpose: "RSS"
    depends_on: []
    volumes: []
    normal_log_pattern: ""
    key_log_locations: []
    containers: []
  ais:
    purpose: "AI"
    depends_on: []
    volumes: []
    normal_log_pattern: ""
    key_log_locations: []
    containers: []
  n8n:
    purpose: "auto"
    depends_on: []
    volumes: []
    normal_log_pattern: ""
    key_log_locations: []
    containers: []
  open-webui:
    purpose: "ui"
    depends_on: []
    volumes: []
    normal_log_pattern: ""
    key_log_locations: []
    containers: []
  krdn-fx:
    purpose: "fx"
    depends_on: []
    volumes: []
    normal_log_pattern: ""
    key_log_locations: []
    containers: []
`

interface DockerRow {
  Names: string
  State: string
}

function mkExecDocker(rows: DockerRow[]): {
  fn: (ctx: string) => Promise<string>
  callCount: number
  lastContext: string | null
} {
  const stub = {
    callCount: 0,
    lastContext: null as string | null,
    async fn(ctx: string): Promise<string> {
      stub.callCount++
      stub.lastContext = ctx
      return rows.map((r) => JSON.stringify(r)).join("\n")
    },
  }
  return stub
}

beforeEach(() => {
  getStalenessCache().clear()
})

describe("staleCheck — KB-03 docker vs yaml semantic diff", () => {
  test("1. yaml에 5 stack, docker에 4 stack running → stale에 누락 stack 포함", async () => {
    const rows: DockerRow[] = [
      { Names: "news-prod-redis", State: "running" },
      { Names: "ais-prod-web", State: "running" },
      { Names: "n8n", State: "running" },
      { Names: "open-webui", State: "running" },
      // krdn-fx 누락
    ]
    const exec = mkExecDocker(rows)
    const staleCheck = makeStaleCheck({
      execDocker: exec.fn,
      readYaml: async () => fixtureYaml,
    })
    const report = await staleCheck(sampleEnv)
    expect(report.stale).toContain("krdn-fx")
    expect(report.stale).not.toContain("news")
    expect(report.unknown).toEqual([])
    expect(report.drifted).toEqual([])
    expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test("2. classifyStack=null + running → unknown 배열에 포함", async () => {
    const rows: DockerRow[] = [
      { Names: "news-prod-redis", State: "running" },
      { Names: "ais-prod-web", State: "running" },
      { Names: "n8n", State: "running" },
      { Names: "open-webui", State: "running" },
      { Names: "krdn-fx-dashboard", State: "running" },
      // 2026-05-07: vscode/cli-proxy-api/ai-afterschool은 stack으로 승격되어 unknown 아님.
      // 진짜 unknown 후보들 (5 핵심 + 운영자 도구 어디에도 매칭 안 됨):
      { Names: "gonsai2-frontend", State: "running" },
      { Names: "nitter", State: "running" },
    ]
    const exec = mkExecDocker(rows)
    const staleCheck = makeStaleCheck({
      execDocker: exec.fn,
      readYaml: async () => fixtureYaml,
    })
    const report = await staleCheck(sampleEnv)
    expect(report.unknown).toContain("gonsai2-frontend")
    expect(report.unknown).toContain("nitter")
    expect(report.stale).toEqual([])
  })

  test("3. krdn-fx 모든 컨테이너 exited → stale에 'krdn-fx' 포함", async () => {
    const rows: DockerRow[] = [
      { Names: "news-prod-redis", State: "running" },
      { Names: "ais-prod-web", State: "running" },
      { Names: "n8n", State: "running" },
      { Names: "open-webui", State: "running" },
      { Names: "krdn-fx-dashboard", State: "exited" },
      { Names: "krdn-fx-backend", State: "exited" },
    ]
    const exec = mkExecDocker(rows)
    const staleCheck = makeStaleCheck({
      execDocker: exec.fn,
      readYaml: async () => fixtureYaml,
    })
    const report = await staleCheck(sampleEnv)
    expect(report.stale).toContain("krdn-fx")
  })

  test("3b. paused: true 마커가 있으면 stale 분류에서 제외 (운영자 의도된 stop 노이즈 차단)", async () => {
    // krdn-fx에 paused: true 추가한 yaml.
    const pausedYaml = fixtureYaml.replace(
      `  krdn-fx:
    purpose: "fx"`,
      `  krdn-fx:
    purpose: "fx"
    paused: true`,
    )
    const rows: DockerRow[] = [
      { Names: "news-prod-redis", State: "running" },
      { Names: "ais-prod-web", State: "running" },
      { Names: "n8n", State: "running" },
      { Names: "open-webui", State: "running" },
      // krdn-fx 컨테이너 모두 exited — 평소면 stale.
      { Names: "krdn-fx-dashboard", State: "exited" },
      { Names: "krdn-fx-backend", State: "exited" },
    ]
    const exec = mkExecDocker(rows)
    const staleCheck = makeStaleCheck({
      execDocker: exec.fn,
      readYaml: async () => pausedYaml,
    })
    const report = await staleCheck(sampleEnv)
    expect(report.stale).not.toContain("krdn-fx")
    expect(report.stale).toEqual([])
  })

  test("4. 30s TTL cache — 같은 input 두 번 호출 시 docker 호출 1회만", async () => {
    const rows: DockerRow[] = [
      { Names: "news-prod-redis", State: "running" },
      { Names: "ais-prod-web", State: "running" },
      { Names: "n8n", State: "running" },
      { Names: "open-webui", State: "running" },
      { Names: "krdn-fx-dashboard", State: "running" },
    ]
    const exec = mkExecDocker(rows)
    const staleCheck = makeStaleCheck({
      execDocker: exec.fn,
      readYaml: async () => fixtureYaml,
    })
    const r1 = await staleCheck(sampleEnv)
    const r2 = await staleCheck(sampleEnv)
    expect(exec.callCount).toBe(1)
    expect(r1).toEqual(r2)
  })

  test("5. cache key 분리 — DOCKER_CONTEXT 다른 환경은 캐시 분리", async () => {
    const rows: DockerRow[] = [
      { Names: "news-prod-redis", State: "running" },
      { Names: "ais-prod-web", State: "running" },
      { Names: "n8n", State: "running" },
      { Names: "open-webui", State: "running" },
      { Names: "krdn-fx-dashboard", State: "running" },
    ]
    const exec = mkExecDocker(rows)
    const staleCheck = makeStaleCheck({
      execDocker: exec.fn,
      readYaml: async () => fixtureYaml,
    })
    await staleCheck(sampleEnv)
    await staleCheck({ ...sampleEnv, DOCKER_CONTEXT: "default" })
    expect(exec.callCount).toBe(2)
    expect(exec.lastContext).toBe("default")
  })

  test("6. drifted는 항상 빈 배열 (Phase 1 lock)", async () => {
    const rows: DockerRow[] = [{ Names: "news-prod-redis", State: "running" }]
    const exec = mkExecDocker(rows)
    const staleCheck = makeStaleCheck({
      execDocker: exec.fn,
      readYaml: async () => fixtureYaml,
    })
    const report = await staleCheck(sampleEnv)
    expect(report.drifted).toEqual([])
  })

  test("7. exec context 인자 → env.DOCKER_CONTEXT 명시 (PITFALL #8)", async () => {
    const rows: DockerRow[] = [{ Names: "vscode", State: "running" }]
    const exec = mkExecDocker(rows)
    const staleCheck = makeStaleCheck({
      execDocker: exec.fn,
      readYaml: async () => fixtureYaml,
    })
    await staleCheck(sampleEnv)
    expect(exec.lastContext).toBe("home-server")
  })
})
