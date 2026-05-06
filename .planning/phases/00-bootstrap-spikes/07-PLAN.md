---
plan_id: "00-07"
phase: 0
title: "services.yaml 초안 생성 + state/ 첫 git commit"
wave: 3
depends_on: ["00-02", "00-03"]
files_modified:
  - "scripts/draft-services-yaml.ts"
  - "state/services.yaml"
  - "state/services.yaml.review-checklist.md"
requirements: ["BOOT-02", "BOOT-03"]
autonomous: false
estimated_minutes: 30
---

# 00-07: services.yaml 초안 생성 + state/ 첫 git commit

<objective>
Phase 1 RAG의 입력 자료가 될 `services.yaml` 초안을 AI가 자동 생성한다 (D-03). 5 핵심 stack(news / ais / n8n / open-webui / krdn-fx)에 대해 라이브 `docker --context dserver ps --format json` 출력을 파싱해 초안을 만들고, **사용자가 수동 review/edit** 후 `state/services.yaml`로 저장. `state/` 디렉토리 첫 git commit으로 기록 (BOOT-03).

Spike 1(00-03)이 PASS인 경우에만 실행 가능. Spike 1 FAIL 시 이 plan은 manual fallback으로 (사용자가 `ssh gon@192.168.0.5 "docker ps"` 출력을 복사-붙여넣기 후 손으로 작성).

**must_haves.truths:**
- D-03 (CONTEXT.md): AI 자동 생성 + 인간 review/edit. 100% 손작업도 100% 자동도 아님.
- D-04 (CONTEXT.md): `state/services.yaml`로 저장 (메인 repo 서브디렉토리).
- BOOT-02: 5 핵심 stack에 대한 services.yaml 초안 생성.
- BOOT-03: services.yaml 초안이 `state/` 디렉토리 첫 git commit으로 기록됨.
</objective>

<must_haves>
## Truths

- D-03: 두 단계 분리 — (a) AI 초안 생성 스크립트, (b) 사용자 review checklist + commit.
- BOOT-02 5 핵심 stack: `news` / `ais` / `n8n` / `open-webui` / `krdn-fx`. 그 외 stack(voice, ai-afterschool 등)은 v2 또는 후속 phase.
- services.yaml schema는 Phase 1 KB-01에서 Zod로 정식 정의. Phase 0은 자유 형식 YAML로 충분.
- 첫 commit message는 `state/`의 시맨틱한 첫 항목이므로 audit trail의 기준점이 된다.

## Verification anchors

- `scripts/draft-services-yaml.ts` 존재 + Bun.$ docker context 호출 + YAML 출력
- `state/services.yaml` 존재 + 5 핵심 stack(news/ais/n8n/open-webui/krdn-fx) 모두 grep 가능
- `state/services.yaml.review-checklist.md` 존재 (사용자가 채워넣을 review 항목)
- `git log state/services.yaml` 출력에 첫 commit 표시 (BOOT-03)
</must_haves>

<task id="00-07-t01" type="execute">
<title>scripts/draft-services-yaml.ts — docker ps 출력 → YAML 초안</title>
<read_first>
- 방금 통과한 Spike 1 결과 (`state/SPIKE-1-RESULT.md`)
- `.planning/phases/00-bootstrap-spikes/00-CONTEXT.md` D-03
- `.planning/REQUIREMENTS.md` BOOT-02 (5 핵심 stack)
- `~/.claude/CLAUDE.md` "주요 서비스 (Docker 컨테이너)" 표 (이미 시멘틱 정보 포함된 표가 있음 — 초안에 반영)
</read_first>
<action>
`scripts/draft-services-yaml.ts` 생성:

```typescript
#!/usr/bin/env bun
import { $ } from "bun"
import { writeFileSync } from "node:fs"
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

function indent(s: string, n: number): string {
  const pad = " ".repeat(n)
  return s
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n")
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
  console.log(`\n다음 단계:`)
  console.log(`  1. cat ${draftPath} 으로 초안 확인`)
  console.log(`  2. state/services.yaml.review-checklist.md 항목별로 보강`)
  console.log(`  3. mv ${draftPath} state/services.yaml`)
  console.log(`  4. git add state/services.yaml + commit (BOOT-03)`)
}

main().catch((e) => {
  console.error("[draft-services] 예외:", e)
  process.exit(1)
})
```
</action>
<acceptance_criteria>
- `scripts/draft-services-yaml.ts` 존재
- 파일에 `import { $ } from "bun"` grep 가능
- 파일에 5 핵심 stack 키워드 모두 grep 가능: `news`, `ais`, `n8n`, `open-webui`, `krdn-fx`
- 파일에 `state/services.yaml.draft` 출력 경로 grep 가능
- `bunx tsc --noEmit` 종료 코드 0
- (라이브, Spike 1 PASS 후) `bun run scripts/draft-services-yaml.ts` 가 종료 코드 0 + `state/services.yaml.draft` 파일 생성
</acceptance_criteria>
</task>

<task id="00-07-t02" type="execute">
<title>state/services.yaml.review-checklist.md — 사용자 review 가이드</title>
<read_first>
- 방금 만든 `scripts/draft-services-yaml.ts` (TODO 슬롯 목록)
- `~/.claude/CLAUDE.md` "주요 서비스" 표 (운영자 본인이 이미 알고 있는 시맨틱 정보)
</read_first>
<action>
`state/services.yaml.review-checklist.md` 생성:

```markdown
# services.yaml 초안 Review Checklist

`state/services.yaml.draft` 를 손으로 보강한 후 `state/services.yaml`로 mv하고 commit하라.
이 checklist는 D-03 (AI 자동 생성 + 인간 review)의 "인간 review" 단계의 가이드다.

## 5 핵심 stack 각각에 대해

### news (RSS 수집 + 요약 워커)
- [ ] `purpose` 정확한가?
- [ ] `depends_on`: news-postgres (5433), news-prod-redis (6380)
- [ ] `volumes`: pgdata, redis-data 등 named volume 명시
- [ ] `normal_log_pattern`: 예) "RSS feed parsed: 12 items"
- [ ] `key_log_locations`: news-prod-api / news-prod-worker / news-prod-beat
- [ ] 실제 `docker ps` 표시되지 않은 컨테이너가 있다면 unmatched_containers에서 옮겨오기

### ais (AI 방과후)
- [ ] `purpose`: web + worker + collector + whisper
- [ ] `depends_on`: ais-prod-postgres (5438), ais-prod-redis (6385)
- [ ] `volumes`: ais-postgres-data, whisper 모델 캐시 등
- [ ] `normal_log_pattern`
- [ ] `key_log_locations`: ais-prod-web / ais-prod-worker / ais-collector-* / ais-whisper-worker

### n8n
- [ ] `depends_on`: n8n-postgres (5434), n8n-redis
- [ ] `volumes`: n8n_data
- [ ] `normal_log_pattern`
- [ ] `key_log_locations`: n8n / n8n-worker

### open-webui
- [ ] `depends_on`: 외부 LLM endpoint
- [ ] `volumes`: open-webui_data
- [ ] `normal_log_pattern`
- [ ] `key_log_locations`: open-webui

### krdn-fx
- [ ] `depends_on`: krdn-timescaledb (5435)
- [ ] `volumes`: timescale_data
- [ ] `normal_log_pattern`
- [ ] `key_log_locations`: krdn-fx-dashboard / krdn-fx-backend

## 보강 후 commit

```bash
mv state/services.yaml.draft state/services.yaml
git add state/services.yaml state/.gitkeep state/README.md state/services.yaml.review-checklist.md
git commit -m "feat(00): services.yaml 초안 (Phase 0 BOOT-02/BOOT-03)

5 핵심 stack(news/ais/n8n/open-webui/krdn-fx) 도메인 지식 초안.
docker --context dserver ps -a --format json 결과를 AI가 분류한 후
사용자가 review-checklist에 따라 depends_on, volumes, normal_log_pattern,
key_log_locations 슬롯을 보강.

Phase 1 KB-01에서 Zod schema로 검증, Voyage AI voyage-4-lite로 임베딩될 예정."
```

이 commit이 `state/`의 첫 의미 있는 commit이며 audit trail의 기준점이 된다 (BOOT-03).
```
</action>
<acceptance_criteria>
- `state/services.yaml.review-checklist.md` 존재
- 파일에 5 핵심 stack 모두 별도 섹션으로 grep 가능
- 파일에 `mv state/services.yaml.draft state/services.yaml` grep 가능
- 파일에 `git commit` 명령 예시 + BOOT-02/BOOT-03 언급 grep 가능
</acceptance_criteria>
</task>

<task id="00-07-t03" type="execute">
<title>라이브 실행 + 사용자 review + 첫 git commit (BOOT-03)</title>
<read_first>
- 방금 만든 `scripts/draft-services-yaml.ts`
- 방금 만든 `state/services.yaml.review-checklist.md`
- `state/SPIKE-1-RESULT.md` (Spike 1이 PASS인지 사전 확인)
</read_first>
<action>
**사용자 승인 필요 (autonomous: false).** 다음 순서로 실행:

```bash
# 0. Spike 1이 PASS인지 확인
grep -q "Status: PASS" state/SPIKE-1-RESULT.md || {
  echo "⚠ Spike 1이 PASS가 아니다. services.yaml 초안 생성을 manual fallback으로 진행하거나 Spike 1을 먼저 fix하라."
  exit 1
}

# 1. 초안 생성
bun run scripts/draft-services-yaml.ts

# 2. 초안 확인 (사용자)
cat state/services.yaml.draft

# 3. 사용자가 review-checklist 따라 보강 (편집기로 직접)
${EDITOR:-vim} state/services.yaml.draft

# 4. confirm
mv state/services.yaml.draft state/services.yaml

# 5. 첫 git commit (BOOT-03 만족)
git add state/.gitkeep state/README.md state/services.yaml state/services.yaml.review-checklist.md state/SPIKE-1-RESULT.md state/SPIKE-2-RESULT.md state/SPIKE-3-RESULT.md
# (Spike 4, 5는 결과 기록 의무 없음 — pure unit test이므로)
git commit -m "feat(00): services.yaml 초안 + state/ 디렉토리 init

5 핵심 stack(news/ais/n8n/open-webui/krdn-fx) 도메인 지식 초안.
docker --context dserver ps 결과를 AI가 분류한 후
사용자가 review-checklist에 따라 보강.

Phase 0 spike 결과(SPIKE-1/2/3-RESULT.md)도 함께 commit.
이게 state/ 의 첫 의미 있는 commit이며 audit trail의 기준점이다.

BOOT-02 ✓ services.yaml 초안 생성
BOOT-03 ✓ state/ 첫 git commit"
```

**Spike 1 FAIL 시 fallback:**

`docker --context dserver` 동작 안 하면 manual fallback으로 SSH 사용:

```bash
ssh gon@192.168.0.5 "docker ps -a --format json" | bun run scripts/draft-services-yaml-from-stdin.ts
```

(이 fallback path는 본 plan에서 별도 스크립트로 만들지 않음. Phase 0 시간 예산 ≤2h 보호. Spike 1 자체를 fix하는 게 더 우선.)
</action>
<acceptance_criteria>
- `state/services.yaml` 존재 (review 완료 후)
- `grep -E "^\s+(news|ais|n8n|open-webui|krdn-fx):" state/services.yaml` 가 5 매치
- `git log state/services.yaml` 출력에 최소 1개 commit 표시
- 첫 commit 메시지에 `BOOT-02` 또는 `BOOT-03` 또는 `services.yaml` 참조 grep 가능
- `state/services.yaml.draft`는 mv 후 존재하지 않아야 함
</acceptance_criteria>
</task>

<verification>
## 검증 (BOOT-02 + BOOT-03 만족)

```bash
test -f scripts/draft-services-yaml.ts
test -f state/services.yaml.review-checklist.md
test -f state/services.yaml
grep -q "$ } from \"bun\"" scripts/draft-services-yaml.ts
grep -E "^\s+(news|ais|n8n|open-webui|krdn-fx):" state/services.yaml | wc -l
# 위 결과가 5 (5 핵심 stack 모두 그룹 헤더로 존재)
test ! -f state/services.yaml.draft
git log --oneline state/services.yaml | head -1
# 위 출력이 비어있지 않아야 함 (commit 1개 이상)
```

이 plan 통과 시:
- BOOT-02 ✓ services.yaml 초안 5 핵심 stack 포함
- BOOT-03 ✓ state/ 디렉토리 첫 git commit 기록
- Phase 1 KB-01의 입력 자료 준비 완료
</verification>
