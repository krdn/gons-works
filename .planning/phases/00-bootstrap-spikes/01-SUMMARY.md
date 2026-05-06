---
plan_id: "00-01"
phase: 0
title: "Bun 프로젝트 초기화 + .env 검증 + bun:test 설정"
status: complete
completed: 2026-05-06
duration_minutes: 25
requirements: ["BOOT-04", "BOOT-05", "DOG-01"]
covers_decisions: ["D-05", "D-08", "D-09", "D-10", "D-11"]
---

# 00-01 SUMMARY

## What was built

Bun 1.3.6 기반 프로젝트 부트스트랩 완료. 전체 후속 spike의 토대.

### key-files.created
- `package.json` (gons-works, scripts: dev/test/spike)
- `tsconfig.json` (strict, bundler resolution, src+spikes include)
- `bunfig.toml` (exact lock)
- `.gitignore` (Bun/Env/Build/IDE/Test 섹션 추가)
- `.env.example` (6 필수 + 2 optional fallback 키, 인라인 가이드)
- `src/env.ts` (Zod schema + loadEnv startup guard + hasFallback)
- `src/env.test.ts` (9 tests, 15 expect, all PASS)
- `src/docker-context-check.ts` (BOOT-04 ensureDockerContext)

### dependencies installed (lock)
- hono@^4.0.0 → 4.12.17
- @anthropic-ai/sdk@0.93.0 (lock)
- voyageai@0.2.1 (lock)
- zod@^4.0.0 → 4.4.3
- diff@9.0.0 (lock)
- htmx-ext-sse@2.2.4 (lock)
- @types/diff (devDep)

## Verification

- `bunx tsc --noEmit` → 종료 코드 0
- `bun test src/env.test.ts` → 9 pass, 0 fail, 15 expect() calls
- `git check-ignore .env` → .gitignore 매치 확인됨

## Deviations / Friction

1. **`bunfig.toml` `preload = []` 거부**: Bun 1.3.6에서 빈 array preload가 "Expected preload to be an array"로 거부됨. 라인 제거로 해결. 향후 preload 항목이 생기면 추가.
2. **`DOCKER_CONTEXT` 기본값**: plan은 `dserver`를 가정했으나 실제 192.168.0.8에 등록된 context는 `home-server`. `.env.example`에서 `DOCKER_CONTEXT=home-server`로 변경. schema default는 `dserver` 유지(하위 호환). 사용자 결정으로 plan을 환경에 맞춤. → FRICTION.md 기록 예정 (00-08).
3. **사전 user gate**: gsd-sdk 없음/autonomous:false plan 다수/dserver 이름 mismatch 등 차단 사항을 시작 전 사용자 확인 후 `--interactive` 모드로 진행.

## Self-Check: PASSED

| Acceptance | Status |
|---|---|
| 6 deps installed with lock versions | ✓ |
| tsconfig strict + bundler | ✓ |
| .env.example 6 required + 2 optional | ✓ |
| src/env.ts Zod schema + loadEnv guard | ✓ |
| docker-context-check ensureDockerContext | ✓ |
| `bunx tsc --noEmit` exit 0 | ✓ |
| `bun test src/env.test.ts` 9 pass | ✓ |

## Enables next plans

- **00-02**: state/ git commit (병행 가능, Wave 1)
- **00-03..00-06, 00-09**: spikes (Wave 2 — 모든 spike가 Bun 환경 + zod 사용)
- **00-07**: services.yaml 초안 (Wave 3 — `DOCKER_CONTEXT` env-var 사용)
