#!/usr/bin/env bun
import { $ } from "bun"
import { createPatch } from "diff"
import { load } from "js-yaml"
import { writeFileSync } from "node:fs"
import { ServicesYamlSchema } from "../kb/schema"
import { loadEnv } from "../src/env"

// services.yaml 초안 생성 스크립트.
// docker ps 출력을 5 핵심 stack(news/ais/n8n/open-webui/krdn-fx)으로 그룹핑하고
// 사용자가 손으로 채워야 하는 빈 슬롯(volumes, normal_log_pattern, depends_on)을
// TODO 주석으로 남기는 자유 형식 YAML 초안을 만든다.
//
// 이 스크립트는 사람의 review를 전제로 한다 (D-03). 출력 파일을 그대로 commit하지 말고
// state/services.yaml.review-checklist.md를 따라 손으로 보강 후 commit하라.

interface DockerPsRow {
  ID: string
  Names: string
  Image: string
  State: string
  Status: string
  Ports?: string
  Labels?: string
}

const FIVE_CORE_STACKS = [
  { key: "news", match: /^news[-_]/, purpose: "RSS 수집 + 요약 워커" },
  { key: "ais", match: /^ais[-_]/, purpose: "AI 방과후 서비스 (web + worker + collector + whisper)" },
  { key: "n8n", match: /^n8n([-_]|$)/, purpose: "자동화 플랫폼" },
  { key: "open-webui", match: /^open[-_]webui([-_]|$)/, purpose: "AI UI 프런트" },
  { key: "krdn-fx", match: /^krdn[-_]fx[-_]/, purpose: "FX 시계열 대시보드" },
]

function classifyStack(name: string): string | null {
  for (const s of FIVE_CORE_STACKS) {
    if (s.match.test(name)) return s.key
  }
  return null
}

async function main(): Promise<void> {
  const env = loadEnv()
  const ctx = env.DOCKER_CONTEXT

  console.log(`[draft-services] context=${ctx}`)

  let raw: string
  try {
    raw = await $`docker --context ${ctx} ps -a --format json`.text()
  } catch (e) {
    console.error("[draft-services] docker ps 실패:", e)
    console.error("Spike 1이 통과했는지, .env DOCKER_CONTEXT가 올바른지 확인 필요.")
    process.exit(1)
  }

  const rows: DockerPsRow[] = raw
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as DockerPsRow)

  console.log(`[draft-services] ${rows.length} 컨테이너 enumeration 완료`)

  // 5 핵심 stack으로 분류
  const grouped = new Map<string, DockerPsRow[]>()
  for (const s of FIVE_CORE_STACKS) grouped.set(s.key, [])
  const unmatched: DockerPsRow[] = []
  for (const r of rows) {
    const key = classifyStack(r.Names)
    if (key) grouped.get(key)!.push(r)
    else unmatched.push(r)
  }

  // YAML 초안 생성 (라이브 docker ps 결과 + 미리 정의된 purpose + 손으로 채울 TODO 슬롯)
  const lines: string[] = []
  lines.push("# services.yaml — gons-works 도메인 지식 (Phase 0 초안)")
  lines.push("# 이 파일은 AI가 docker ps 결과 + 미리 정의된 5 핵심 stack 정보로 초안을 만든다.")
  lines.push("# 사용자가 state/services.yaml.review-checklist.md를 따라 보강 후 commit하라.")
  lines.push("# Phase 1 KB-01에서 Zod schema로 정식 검증된다.")
  lines.push("")
  lines.push(`generated_at: "${new Date().toISOString()}"`)
  lines.push(`generated_from: "docker --context ${ctx} ps -a --format json"`)
  lines.push("")
  lines.push("stacks:")

  for (const s of FIVE_CORE_STACKS) {
    const containers = grouped.get(s.key) ?? []
    lines.push(`  ${s.key}:`)
    lines.push(`    purpose: "${s.purpose}"`)
    lines.push(`    # TODO: depends_on, volumes, normal_log_pattern, key_log_locations 손으로 채우기`)
    lines.push(`    depends_on: [] # TODO`)
    lines.push(`    volumes: [] # TODO: 명시된 named volume 또는 bind mount 경로`)
    lines.push(`    normal_log_pattern: "" # TODO: 정상 동작 시 자주 보이는 로그 한 줄 예시`)
    lines.push(`    key_log_locations: [] # TODO: 디버깅 시 봐야 하는 컨테이너 이름들`)
    if (containers.length === 0) {
      lines.push(`    containers: [] # ⚠ docker ps에서 발견 안 됨. stack 미실행 또는 이름 패턴 mismatch.`)
    } else {
      lines.push(`    containers:`)
      for (const c of containers) {
        lines.push(`      - name: "${c.Names}"`)
        lines.push(`        image: "${c.Image}"`)
        lines.push(`        state: "${c.State}"`)
        lines.push(`        status: "${c.Status.replace(/"/g, '\\"')}"`)
      }
    }
    lines.push("")
  }

  if (unmatched.length > 0) {
    lines.push("# 5 핵심 stack에 매핑되지 않은 컨테이너 (참고용, 후속 phase에 추가 가능)")
    lines.push("unmatched_containers:")
    for (const c of unmatched) {
      lines.push(`  - name: "${c.Names}"`)
      lines.push(`    image: "${c.Image}"`)
      lines.push(`    state: "${c.State}"`)
    }
  }

  const output = lines.join("\n") + "\n"

  // state/services.yaml에 직접 쓰지 않고 stdout 출력 + state/services.yaml.draft에 저장.
  // 사용자가 review 후 mv state/services.yaml.draft state/services.yaml 로 confirm.
  const draftPath = "state/services.yaml.draft"
  writeFileSync(draftPath, output)
  console.log(`[draft-services] ✓ ${draftPath} 작성 (${rows.length} 컨테이너 → ${grouped.size} stack)`)

  // D-12.4: Zod strict 검증 (parse 실패는 경고만, draft 자체는 유지).
  // AI 초안이 4 슬롯을 비워둘 수 있으나 default가 적용되어 parse 통과.
  // depends_on에 number 같은 타입 위반은 issues로 노출.
  try {
    const parsed = ServicesYamlSchema.safeParse(load(output))
    if (!parsed.success) {
      console.warn("[draft-services] ⚠ 스키마 검증 경고:")
      for (const issue of parsed.error.issues) {
        console.warn(`  - ${issue.path.join(".")}: ${issue.message}`)
      }
    } else {
      console.log("[draft-services] ✓ ServicesYamlSchema strict 검증 통과")
    }
  } catch (e) {
    console.warn("[draft-services] ⚠ YAML parse 실패:", e)
  }

  // D-12.3: 현재 services.yaml과 unified diff 출력 (운영자가 시각적으로 review).
  try {
    const current = await Bun.file("state/services.yaml").text()
    const patch = createPatch("services.yaml", current, output, "current", "draft")
    console.log("\n=== Unified Diff (current → draft) ===")
    console.log(patch)
  } catch {
    console.log("[draft-services] 현재 services.yaml 없음 — diff 생략")
  }

  console.log(`\n다음 단계:`)
  console.log(`  1. cat ${draftPath} 으로 초안 확인`)
  console.log(`  2. state/services.yaml.review-checklist.md 항목별로 보강`)
  console.log(`  3. Review then: mv ${draftPath} state/services.yaml`)
  console.log(`  4. git add state/services.yaml + commit (BOOT-03 / KB-01)`)
}

main().catch((e) => {
  console.error("[draft-services] 예외:", e)
  process.exit(1)
})
