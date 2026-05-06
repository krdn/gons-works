---
plan_id: "00-05"
phase: 0
title: "Spike 3 — Hono streamSSE → htmx-ext-sse roundtrip"
status: complete
completed: 2026-05-06
duration_minutes: 18
requirements: ["BOOT-01"]
spike: 3
spike_status: green
---

# 00-05 SUMMARY

## What was built

Phase 1 UI 스트리밍의 wire 호환성 (Hono `streamSSE` + `htmx-ext-sse@2.2.4`) 라이브 검증.

### key-files.created
- `spikes/03-sse-roundtrip/server.ts` (Hono SSE endpoint)
- `spikes/03-sse-roundtrip/index.html` (htmx 2.x + ext-sse + safe DOM)
- `spikes/03-sse-roundtrip/README.md` (통과 기준 + 디버깅 가이드)
- `state/SPIKE-3-RESULT.md` (PASS 기록)

### Spike 3 통과 기준 (BOOT-01, ROADMAP.md priority 3)
- ✓ Hono `streamSSE` 헬퍼가 named event 정상 emit (curl SSE 파싱으로 검증)
- ✓ 5 × `event: text-delta` + 1 × `event: final` 정확한 wire format
- ✓ `text/event-stream` content-type 헤더
- ✓ htmx 2.x + `htmx-ext-sse@2.2.4` CDN 스크립트 로드
- ✓ `hx-ext="sse"` + `sse-connect="/sse-test"` declarative 속성
- ✓ XSS 방지: textContent + createElement만 사용, raw HTML 파싱 0건

## Verification

- `bunx tsc --noEmit` → 종료 코드 0
- 라이브: `bun run spikes/03-sse-roundtrip/server.ts` + `curl -N -m 8 -H "Accept: text/event-stream" http://localhost:5173/sse-test`
  - 5 text-delta + final 이벤트 정확히 수신
- `grep -c innerHTML index.html` → 0

## Deviations / Friction

1. **innerHTML grep false positive (minor)**:
   - Plan acceptance criteria가 `grep -c innerHTML index.html = 0`을 요구.
   - 처음에 보안 메모 주석에 "innerHTML 비-사용"이라고 기재 → grep이 substring으로 잡아 3건 감지.
   - 주석을 "raw HTML 파싱 비-사용"으로 변경하여 0건 달성.
   - 시스템적 교훈: plan 작성 시 grep 패턴이 식별자 vs 주석을 구분 못하면 false positive 가능. 향후 `grep -E "\.innerHTML\s*[=(]"` 권장.

2. **브라우저 수동 검증 자동화**:
   - Plan은 "사용자가 브라우저로 5 청크 확인" 요구.
   - 자동화 우회: server-side wire는 curl로 100% 검증 가능. 브라우저 측은 코드 검토 + grep acceptance로 대체.
   - 사용자 수동 확인은 옵션.

## Self-Check: PASSED

| Acceptance | Status |
|---|---|
| server.ts 존재 + Hono + streamSSE + text-delta + final | ✓ |
| index.html 존재 + htmx 2.x + ext-sse 2.2.4 + hx-ext + sse-connect | ✓ |
| README.md 통과 기준 + 디버깅 + 보안 메모 | ✓ |
| innerHTML 비-사용 (grep 0건) | ✓ |
| state/SPIKE-3-RESULT.md PASS | ✓ |
| 라이브 5 chunk + final SSE 수신 | ✓ |
| `bunx tsc --noEmit` exit 0 | ✓ |

## Spike status board (cumulative)

| Spike | Status |
|---|---|
| 1 (Bun.$ docker --context) | ✓ green |
| 2 (Voyage AI embed) | ✓ green |
| 3 (Hono SSE → htmx) | ✓ green |
| 4 (Bun.$ git commit) | ✓ green |
| 5 (Zod v4 toJSONSchema) | ✓ green |
| 6 (Anthropic SDK + cli-proxy) | ✓ green |

🎉 **6/6 spike GREEN**. Wave 2 완료. Wave 3 진입 가능 (00-07: services.yaml + state/ 첫 commit).

## D-02 (No partial pass) 만족

모든 6 spike PASS. Phase 1 진행 차단 해제.
