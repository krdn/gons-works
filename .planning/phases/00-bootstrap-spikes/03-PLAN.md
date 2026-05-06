---
plan_id: "00-03"
phase: 0
title: "Spike 1 — Bun.$ docker --context dserver ps roundtrip"
wave: 2
depends_on: ["00-01"]
files_modified:
  - "spikes/01-docker-context.test.ts"
  - "spikes/01-docker-context.smoke.ts"
requirements: ["BOOT-01"]
autonomous: false
estimated_minutes: 20
---

# 00-03: Spike 1 — Bun.$ docker --context dserver ps roundtrip

<objective>
ROADMAP.md 우선순위 1 spike. 가장 위험도 높은 가정 검증: **`Bun.$ \`docker --context dserver ps --format json\``가 192.168.0.5의 컨테이너 목록을 파싱 가능한 JSON 배열로 반환하는가?**

이게 실패하면 Phase 1의 모든 read-only tool (`listContainers`, `readLogs`, `readCompose`)이 동작 못 함 → 즉시 SSH/context 설정 점검 fallback path.

`autonomous: false` — 이 spike는 192.168.0.5 라이브 서버에 의존한다. AI가 단독 실행 못 하고 사용자가 docker context 상태를 확인해야 한다.

**must_haves.truths:**
- D-01 (CONTEXT.md): Spike 코드는 `spikes/` 디렉토리에 격리
- D-02 (CONTEXT.md): No partial pass — 이 spike 실패 시 Phase 1 진행 차단
- DESIGN.md correction #2: `dockerode` 비-사용, `Bun.$` + `--context dserver` shell-out 사용
- ROADMAP.md Spike 1 통과 기준: 컨테이너 배열로 JSON 파싱 성공
</objective>

<must_haves>
## Truths

- D-01: `spikes/01-docker-context.*` 형태로 격리.
- DESIGN.md correction #2: dockerode가 named context를 미지원이므로 `Bun.$` shell-out이 유일한 path.
- BOOT-01 Spike 1: `docker --context dserver ps --format json` 출력이 파싱 가능한 컨테이너 배열로 반환됨.
- Failure path (ROADMAP.md): `원격 tool use 전체 차단 → SSH/context 설정 점검 필요`. 이 plan에서 실패 메시지가 명확히 어떤 점검을 요구하는지 출력해야 한다.

## Verification anchors

- `spikes/01-docker-context.smoke.ts` 존재 + `Bun.$` 사용 + `--context dserver` 사용 + `--format json` 사용
- `bun run spikes/01-docker-context.smoke.ts` 종료 코드 0 (라이브 환경)
- 출력에 `Spike 1 PASS` 또는 명확한 fallback 안내
- `spikes/01-docker-context.test.ts`는 mock된 단위 테스트 (라이브 환경 없이도 자동 검증 가능한 부분)
</must_haves>

<task id="00-03-t01" type="execute">
<title>spikes/01-docker-context.smoke.ts — 라이브 환경 통합 spike</title>
<read_first>
- `.planning/research/STACK.md` (Bun.$ shell 섹션)
- `.planning/research/PITFALLS.md` (DOCKER_CONTEXT per-call drift 섹션)
- `.planning/ROADMAP.md` Phase 0 Spike List 1번
- 방금 만든 `src/docker-context-check.ts`
</read_first>
<action>
`spikes/01-docker-context.smoke.ts` 생성. 이 파일은 라이브 192.168.0.5 환경에서 수동 실행:

```typescript
#!/usr/bin/env bun
import { $ } from "bun"
import { ensureDockerContext } from "../src/docker-context-check"
import { loadEnv } from "../src/env"

// Spike 1 — Bun.$ docker --context dserver ps roundtrip.
// 라이브 환경 (192.168.0.5)에 의존. autonomous: false.
//
// 통과 기준 (ROADMAP.md):
//   docker --context dserver ps --format json 출력이 파싱 가능한 컨테이너 배열로 반환됨.
// 실패 경로:
//   원격 tool use 전체 차단 → SSH/context 설정 점검 필요.

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
    console.error("  - docker context ls 출력에 dserver가 있는가?")
    console.error("  - ssh gon@192.168.0.5 'docker ps' 명령이 직접 동작하는가?")
    console.error("  - ~/.docker/config.json의 currentContext가 default인가? (dserver는 명시적 --context로 호출)")
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
    console.warn("[Spike 1] ⚠ 컨테이너가 0개. dserver에 컨테이너가 없거나 모두 stopped 상태?")
    console.warn("  docker --context dserver ps -a 로 확인 필요.")
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

  console.log("\n[Spike 1 PASS] ✓ Bun.$ docker --context dserver ps --format json roundtrip OK")
}

main().catch((e) => {
  console.error("[Spike 1 FAIL] 예외:", e)
  process.exit(1)
})
```
</action>
<acceptance_criteria>
- `spikes/01-docker-context.smoke.ts` 존재
- 파일에 `Bun.$` 사용 (`import { $ } from "bun"` grep 가능)
- 파일에 `--context ${ctx}` 사용 (template interpolation)
- 파일에 `--format json` 문자열 grep 가능
- 파일에 `Spike 1 PASS` 메시지 grep 가능
- 파일에 fallback 안내 메시지 (`SSH/context 설정 점검`) grep 가능
- 라이브 환경에서: `bun run spikes/01-docker-context.smoke.ts` 종료 코드 0 + 출력에 `Spike 1 PASS` 표시
- 라이브 환경 없을 때: 파일 syntax는 통과 — `bunx tsc --noEmit`이 에러 없이 종료
</acceptance_criteria>
</task>

<task id="00-03-t02" type="execute">
<title>spikes/01-docker-context.test.ts — 단위 테스트 (mock 기반)</title>
<read_first>
- 방금 만든 `spikes/01-docker-context.smoke.ts`
- 방금 만든 `src/docker-context-check.ts`
</read_first>
<action>
`spikes/01-docker-context.test.ts` 생성. NDJSON 파싱 + ensureDockerContext 함수 단위 테스트만 (라이브 docker 없이):

```typescript
import { describe, expect, test } from "bun:test"
import { ensureDockerContext } from "../src/docker-context-check"

interface DockerPsRow {
  ID: string
  Names: string
  Image: string
  State: string
  Status: string
}

// docker --format json 출력 NDJSON 파싱 로직만 격리해서 테스트.
function parseNdjson(raw: string): DockerPsRow[] {
  const lines = raw.trim().split("\n").filter((l) => l.length > 0)
  return lines.map((l) => JSON.parse(l) as DockerPsRow)
}

describe("Spike 1 단위 테스트 (BOOT-01)", () => {
  test("NDJSON 빈 출력은 빈 배열로 파싱", () => {
    expect(parseNdjson("")).toEqual([])
    expect(parseNdjson("\n\n  \n")).toEqual([])
  })

  test("NDJSON 한 줄당 한 객체 파싱", () => {
    const raw = `{"ID":"abc","Names":"news-prod-api","Image":"news:latest","State":"running","Status":"Up 3 days"}
{"ID":"def","Names":"ais-prod-web","Image":"ais:latest","State":"running","Status":"Up 1 hour"}`
    const rows = parseNdjson(raw)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.Names).toBe("news-prod-api")
    expect(rows[1]?.State).toBe("running")
  })

  test("ensureDockerContext: 존재하지 않는 context는 ok=false 반환 (mock 없이 실제 docker 명령 호출)", async () => {
    // 거의 확실히 존재하지 않을 임의 이름.
    const result = await ensureDockerContext("__gons_nonexistent_context_xyz__")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem.problem).toContain("__gons_nonexistent_context_xyz__")
      expect(result.problem.fix).toBeTruthy()
    }
  })
})
```

이 테스트는 docker 실행 자체를 검증하지 않고 (그건 smoke test 몫):
- NDJSON 파싱 로직 격리 검증
- `ensureDockerContext` 가 존재하지 않는 context에 대해 명확한 envelope 반환
</action>
<acceptance_criteria>
- `spikes/01-docker-context.test.ts` 존재
- `bun test spikes/01-docker-context.test.ts` 종료 코드 0
- 출력에 `3 pass` (또는 `3 passed`) grep 가능
- 라이브 192.168.0.5 환경 없이도 통과 (NDJSON 파싱은 순수 함수, ensureDockerContext는 nonexistent context를 시도하므로 항상 fail path 반환)
- `bunx tsc --noEmit` 종료 코드 0
</acceptance_criteria>
</task>

<task id="00-03-t03" type="execute">
<title>Spike 1 라이브 검증 실행 + 결과 기록</title>
<read_first>
- `.planning/STATE.md` "Blockers/Concerns" 섹션 (Spike 1 dserver context 사전 확인 항목)
- `~/.claude/CLAUDE.md` "운영 서버 (192.168.0.5)" 섹션 (Docker Context = home-server 정의 — `dserver` alias가 ssh로 매핑되어 있는지 확인 필요)
</read_first>
<action>
**사용자 승인 필요 (autonomous: false).** 다음 명령을 사용자가 직접 실행하거나 승인 후 실행:

```bash
# 0. .env가 있어야 한다. 없으면 .env.example 복사하고 실제 키 채우기.
test -f .env || cp .env.example .env
# (사용자: .env 의 ANTHROPIC_API_KEY, VOYAGE_API_KEY 실제 값으로 변경)

# 1. docker context 사전 확인
docker context ls

# 2. 라이브 spike 실행
bun run spikes/01-docker-context.smoke.ts
```

**예상 시나리오:**

A. **`dserver` context 존재 + 192.168.0.5 도달 가능 + 컨테이너 enumeration 성공**: 출력에 `[Spike 1 PASS]` 표시. `state/SPIKE-1-RESULT.md`에 통과 기록 작성:

```markdown
# Spike 1 결과 — Bun.$ docker --context dserver ps

**Date:** YYYY-MM-DD
**Status:** PASS
**Container count:** N
**Containers detected (5 핵심 stack):** [news, ais, ...]

## 출력 발췌

(spike 실행 출력 첫 30줄)
```

B. **`dserver` context 미존재**: 사용자에게 `~/.claude/CLAUDE.md`의 "Docker Context" 섹션이 `home-server`로 되어 있고 `dserver`는 alias라는 사실을 알리고, 다음 중 하나로 fix:
   - 옵션 A: `docker context create dserver --docker host=ssh://gon@192.168.0.5` 로 새 context 등록
   - 옵션 B: `.env` 의 `DOCKER_CONTEXT=home-server`로 변경 (기존 context 재사용)
   - 옵션 C: alias가 이미 설정되어 있다면 alias resolve 후 spike 재실행

C. **`dserver` 도달 가능하지만 컨테이너 0개**: 의미 있는 경고. dserver 서버에서 `docker ps -a`로 확인.

D. **Bun.$ 자체 실패** (e.g., `docker` 명령 부재): Bun이 `$PATH` 의 docker를 찾지 못함. `which docker` 확인.

각 시나리오에서 `state/SPIKE-1-RESULT.md`에 결과를 기록 (failure도 명시적으로). 이 파일은 `state/`의 첫 commit 후보 중 하나가 된다 (BOOT-03은 services.yaml이 첫 commit이지만, 결과 기록은 별도 commit으로 누적 가능).
</action>
<acceptance_criteria>
- 사용자가 `bun run spikes/01-docker-context.smoke.ts` 실행 결과 보고
- `state/SPIKE-1-RESULT.md` 파일 존재 + `Status: PASS` 또는 `Status: FAIL — <reason>` 명시
- PASS 시: 출력에 5 핵심 stack 중 최소 3개 grep 가능
- FAIL 시: `~/.claude/plans/gstack-gsd-melodic-raven.md` 마찰 노트로 기록 (DOG-02)
</acceptance_criteria>
</task>

<verification>
## 검증

```bash
test -f spikes/01-docker-context.smoke.ts
test -f spikes/01-docker-context.test.ts
grep -q '$ } from "bun"' spikes/01-docker-context.smoke.ts
grep -q "context \${ctx}" spikes/01-docker-context.smoke.ts || grep -q "context.*ctx" spikes/01-docker-context.smoke.ts
grep -q "format json" spikes/01-docker-context.smoke.ts
grep -q "Spike 1 PASS" spikes/01-docker-context.smoke.ts
grep -q "SSH/context" spikes/01-docker-context.smoke.ts
bun test spikes/01-docker-context.test.ts
test -f state/SPIKE-1-RESULT.md
grep -E "Status: (PASS|FAIL)" state/SPIKE-1-RESULT.md
```

이 plan 통과 시: Spike 1 결과가 명시적 (PASS or FAIL with reason). PASS면 BOOT-01의 1/5 spike 통과.
</verification>
