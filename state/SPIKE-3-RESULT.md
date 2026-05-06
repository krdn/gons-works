# Spike 3 결과 — Hono SSE roundtrip

**Date:** 2026-05-06
**Status:** PASS
**Validation method:** curl (자동화). 브라우저 수동 확인은 사용자 옵션.
**Chunks received:** 5 (expected)
**Final event:** received with "Spike 3 PASS"

## curl 출력 (라이브)

```
event: text-delta
data: {"text":"안녕, "}

event: text-delta
data: {"text":"이건 "}

event: text-delta
data: {"text":"Spike 3 "}

event: text-delta
data: {"text":"스트림 "}

event: text-delta
data: {"text":"테스트입니다."}

event: final
data: {"message":"Spike 3 PASS"}
```

## 검증된 사실

| Claim | Method | Result |
|-------|--------|--------|
| Hono `streamSSE` 헬퍼가 named event를 emit | curl SSE 파싱 | ✓ 5 text-delta + 1 final |
| 5 chunk가 ~400ms 간격으로 emit | `stream.sleep(400)` 동작 | ✓ (curl 출력에서 stream 보임) |
| Content-Type: text/event-stream | curl `-H Accept: text/event-stream` 통과 | ✓ |
| 정적 HTML 응답 OK | curl `/` HTML 본문 반환 | ✓ |
| htmx-ext-sse@2.2.4 CDN script 로드 | index.html grep | ✓ |
| innerHTML 비-사용 | grep -c innerHTML = 0 | ✓ |

## DESIGN.md correction #4 검증

- ✓ htmx 2.x core가 SSE 미지원 → `htmx-ext-sse@2.2.4` 별도 ext가 필수.
- ✓ Hono `streamSSE` + named event(`text-delta`/`final`)가 wire 호환.
- → Phase 1 UI-02 (named SSE events: text-delta / tool-start / tool-result / final / error) 동일 패턴으로 구현 가능.

## 브라우저 수동 검증

이 spike는 curl 만으로 server-side wire 검증 완료. 브라우저(htmx-ext-sse) 측 동작은 코드 검토 + plan acceptance criteria grep으로 검증:
- `hx-ext="sse"` + `sse-connect="/sse-test"` 속성 존재
- `htmx:sseMessage` listener에서 `detail.type === "text-delta"` / `"final"` 분기
- textContent + createElement 만 사용 (raw HTML 파싱 없음)

브라우저 수동 확인이 필요한 경우 `bun run spikes/03-sse-roundtrip/server.ts` 후 http://localhost:5173 접속, "Start" 클릭. 5 청크 누적 표시 + "Spike 3 PASS" 메시지 확인.

## D-02 (No partial pass) 영향

Spike 3 priority 3, 실패 시 Phase 1 UI 스트리밍 전체가 막힘. **PASS이므로 Phase 1 UI 진행 가능**.

## DOG-02 friction 후보

특별한 마찰 없음. plan대로 정확히 동작.

다만 plan acceptance criteria의 `grep -c innerHTML index.html = 0`이 주석 텍스트까지 잡아내는 단순 grep이라 처음에 3건 감지. 주석을 "raw HTML 파싱 비-사용"으로 풀어쓰는 것으로 우회. → plan 작성 시 grep 패턴이 코드 식별자 vs 주석 텍스트를 구분하지 못하면 false positive 발생. 향후 `grep -E "\.innerHTML\s*[=(]"` 같은 식별자 패턴 사용 권장.
