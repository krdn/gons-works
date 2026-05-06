// kb/stale-check.ts — KB-03 (drift detection) + D-13.4 (boot+per-query 30s TTL).
//
// Public API:
//   staleCheck(env)            — default factory 인스턴스 (Bun.$ + state/services.yaml 사용)
//   makeStaleCheck(deps)       — 팩토리 (테스트 + 미래 사용처에서 deps 주입 가능)
//   getStalenessCache()        — cache reset helper (테스트 isolation 전용)
//   StalenessReport            — { unknown, stale, drifted, checkedAt }
//
// 알고리즘 (ARCHITECTURE.md "Staleness detection algorithm"):
//   1. docker --context $DOCKER_CONTEXT ps -a --format json (NDJSON)
//   2. 각 row → classifyStack(Names) → stack key 도출
//   3. yaml stacks 키 Set 과 docker stack hits Set 의 양방향 차집합:
//      - unknown: docker에 있지만 stack 매칭 안 되는 컨테이너 (running 만)
//      - stale: yaml에는 있지만 running 인스턴스 0인 stack
//      - drifted: Phase 1 빈 배열 (image/ports field-level diff은 v2 deferred)
//
// 캐싱 (D-13.4):
//   - 30s TTL Map. cache key = `${DOCKER_CONTEXT}:${yamlLength}` (yaml 변경 감지에 충분)
//   - boot 시 1회, per-query 1회 호출되어도 TTL 내에서는 docker 호출 회피
//   - listContainers 와 동일한 30s window 공유 (운영자 입장에서 "현재" 의미 일관성)
//
// PITFALL #8 (DOCKER_CONTEXT leak): env.DOCKER_CONTEXT 명시 필수. process.env.DOCKER_CONTEXT 직접 호출 금지.
// PITFALL #11 (services.yaml drift): semantic diff (mtime/hash 아님).

import { $ } from "bun"
import { load } from "js-yaml"
import { ServicesYamlSchema } from "./schema"
import { classifyStack } from "./classify"
import type { Env } from "../src/env"

export interface StalenessReport {
  unknown: string[] // docker에 있는데 5 stack 매칭 안 되는 컨테이너 이름들 (running 만)
  stale: string[] // yaml에는 있는데 라이브 인스턴스 0인 stack 키
  drifted: string[] // Phase 1: 항상 빈 배열 (v2: image/ports field-level diff)
  checkedAt: string // ISO8601 timestamp
}

interface CacheEntry {
  report: StalenessReport
  ts: number
}

const CACHE_TTL_MS = 30_000
const cache = new Map<string, CacheEntry>()

/**
 * 캐시 직접 접근 — 테스트 isolation 용도.
 * Production code는 cache.clear() 직접 호출 금지 (D-13.4 staleness 신호 손실).
 */
export function getStalenessCache(): Map<string, CacheEntry> {
  return cache
}

interface StaleCheckDeps {
  // docker --context $ctx ps -a --format json 결과를 NDJSON 문자열로 반환.
  execDocker: (dockerContext: string) => Promise<string>
  // services.yaml 내용을 문자열로 반환.
  readYaml: () => Promise<string>
}

interface DockerPsRow {
  Names: string
  State: string
}

/**
 * 팩토리 — deps를 주입하여 staleCheck 함수를 만든다.
 * 기본 구현은 모듈 하단의 staleCheck export. 테스트는 stub deps로 호출.
 */
export function makeStaleCheck(deps: StaleCheckDeps): (env: Env) => Promise<StalenessReport> {
  return async function staleCheck(env: Env): Promise<StalenessReport> {
    const yaml = await deps.readYaml()
    const cacheKey = `${env.DOCKER_CONTEXT}:${yaml.length}`
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.report
    }

    const raw = await deps.execDocker(env.DOCKER_CONTEXT)
    const containers: DockerPsRow[] = (raw ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as DockerPsRow)

    const parsed = ServicesYamlSchema.parse(load(yaml))

    const yamlStacks = new Set(Object.keys(parsed.stacks))
    const dockerStackHits = new Set<string>()
    const unknownContainers: string[] = []

    for (const c of containers) {
      const stack = classifyStack(c.Names)
      if (stack && yamlStacks.has(stack)) {
        // 5 stack 매칭 — running만 카운트 (stale 판단의 "라이브 인스턴스" 정의).
        if (c.State === "running") dockerStackHits.add(stack)
      } else if (!stack && c.State === "running") {
        // 5 stack 미매칭 + running → unknown.
        unknownContainers.push(c.Names)
      }
    }

    const staleStackKeys = [...yamlStacks].filter((k) => !dockerStackHits.has(k))

    const report: StalenessReport = {
      unknown: unknownContainers,
      stale: staleStackKeys,
      drifted: [], // Phase 1 lock — v2 (image/ports field-level diff) 이전까지 빈 배열
      checkedAt: new Date().toISOString(),
    }
    cache.set(cacheKey, { report, ts: Date.now() })
    return report
  }
}

// 기본 deps — production 코드 path. PITFALL #8: env.DOCKER_CONTEXT 명시.
const defaultDeps: StaleCheckDeps = {
  async execDocker(dockerContext: string): Promise<string> {
    return await $`docker --context ${dockerContext} ps -a --format json`.text()
  },
  async readYaml(): Promise<string> {
    return await Bun.file("state/services.yaml").text()
  },
}

/**
 * Default staleCheck — server.ts boot 진입점 + agent/loop.ts per-query 진입점.
 * 30s TTL 캐시로 listContainers와 동일 window 공유.
 */
export const staleCheck = makeStaleCheck(defaultDeps)
