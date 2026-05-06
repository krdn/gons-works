#!/usr/bin/env bun
import { $ } from "bun"
import { ensureDockerContext } from "../src/docker-context-check"
import { loadEnv } from "../src/env"

// Spike 1 — Bun.$ docker --context <ctx> ps roundtrip.
// 라이브 환경 (192.168.0.5)에 의존. autonomous: false.
//
// 통과 기준 (ROADMAP.md):
//   docker --context <ctx> ps --format json 출력이 파싱 가능한 컨테이너 배열로 반환됨.
// 실패 경로:
//   원격 tool use 전체 차단 → SSH/context 설정 점검 필요.
//
// NOTE: plan은 'dserver'를 가정했으나 실제 등록된 context 이름은 'home-server'.
// .env의 DOCKER_CONTEXT 값을 사용 (사용자 결정으로 home-server 채택).

interface DockerPsRow {
  ID: string
  Names: string
  Image: string
  State: string
  Status: string
}

async function main(): Promise<void> {
  const env = loadEnv()
  const ctx = env.DOCKER_CONTEXT

  console.log(`[Spike 1] docker context = "${ctx}"`)

  // 1. context inspect 검증 (BOOT-04)
  const check = await ensureDockerContext(ctx)
  if (!check.ok) {
    console.error("[Spike 1 FAIL] docker context inspect 실패")
    console.error(`  problem: ${check.problem.problem}`)
    console.error(`  cause: ${check.problem.cause}`)
    console.error(`  fix: ${check.problem.fix}`)
    console.error("\nFallback path: SSH/context 설정 점검 필요. 다음을 확인하세요:")
    console.error(`  - docker context ls 출력에 ${ctx}가 있는가?`)
    console.error("  - ssh gon@192.168.0.5 'docker ps' 명령이 직접 동작하는가?")
    console.error("  - ~/.docker/config.json의 currentContext가 default인가? (home-server는 명시적 --context로 호출)")
    process.exit(1)
  }
  console.log("[Spike 1] ✓ docker context inspect OK")

  // 2. ps --format json 호출
  let rawOutput: string
  try {
    rawOutput = await $`docker --context ${ctx} ps --format json`.text()
  } catch (e) {
    console.error("[Spike 1 FAIL] docker ps 실행 실패:", e)
    console.error("\nFallback path: SSH/context 설정 점검 필요.")
    process.exit(1)
  }

  // docker --format json은 한 줄에 JSON object 하나씩 출력 (NDJSON).
  const lines = rawOutput.trim().split("\n").filter((line) => line.length > 0)
  if (lines.length === 0) {
    console.warn(`[Spike 1] ⚠ 컨테이너가 0개. ${ctx}에 컨테이너가 없거나 모두 stopped 상태?`)
    console.warn(`  docker --context ${ctx} ps -a 로 확인 필요.`)
    // green pass — empty array도 파싱 성공으로 간주.
    console.log("[Spike 1 PASS] (with warning: 0 containers)")
    return
  }

  let containers: DockerPsRow[]
  try {
    containers = lines.map((line) => JSON.parse(line) as DockerPsRow)
  } catch (e) {
    console.error("[Spike 1 FAIL] JSON 파싱 실패:", e)
    console.error("Raw output (first 500 chars):", rawOutput.slice(0, 500))
    process.exit(1)
  }

  console.log(`[Spike 1] ✓ ${containers.length} 컨테이너 파싱 성공`)
  console.log("샘플 (최대 5개):")
  for (const c of containers.slice(0, 5)) {
    console.log(`  - ${c.Names} (${c.Image}) — ${c.State} ${c.Status}`)
  }

  // 3. 5 핵심 stack 키워드 sanity check
  const fiveCore = ["news", "ais", "n8n", "open-webui", "krdn-fx"]
  const found = fiveCore.filter((stack) =>
    containers.some((c) => c.Names.toLowerCase().includes(stack))
  )
  console.log(`[Spike 1] 5 핵심 stack 중 발견: ${found.join(", ") || "(없음)"} (${found.length}/5)`)
  if (found.length < 3) {
    console.warn("[Spike 1] ⚠ 5 핵심 stack 중 3개 미만 발견. services.yaml 초안 생성 시 누락 주의.")
  }

  console.log(`\n[Spike 1 PASS] ✓ Bun.$ docker --context ${ctx} ps --format json roundtrip OK`)
}

main().catch((e) => {
  console.error("[Spike 1 FAIL] 예외:", e)
  process.exit(1)
})
