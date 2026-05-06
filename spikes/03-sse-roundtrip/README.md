# Spike 3 — Hono streamSSE → htmx-ext-sse roundtrip

## 실행

```bash
bun run spikes/03-sse-roundtrip/server.ts
```

브라우저 http://localhost:5173 접속 → "Start" 클릭 → 5개 chunk가 순차 표시되면 PASS.

## 통과 기준

- 5개 청크("안녕, ", "이건 ", "Spike 3 ", "스트림 ", "테스트입니다.")가 ~400ms 간격으로 누적 표시
- "Spike 3 PASS" final 메시지 표시
- DevTools Network → EventStream 탭에서 `event: text-delta` × 5 + `event: final` × 1 확인 가능

## 실패 시 디버깅

1. 아무것도 표시 안 됨:
   - Network 탭 → EventStream 응답 확인. `text/event-stream` content-type인가?
   - htmx-ext-sse 버전이 정확히 2.2.4인가? (1.x는 다른 API)
   - `hx-ext="sse"` 속성이 div에 붙어 있는가?

2. JSON.stringify 결과가 raw로 표시:
   - `htmx:sseMessage` listener에서 parse + textContent 패턴이 동작하는지 확인.

3. final 이벤트 미동작:
   - parseHandler 가 `detail.type === "final"` 분기를 타는지 console.log로 확인.

## Phase 1과의 차이

이 spike는 wire 검증만. Phase 1에서는:
- agent loop 연결 (Claude tool-use → text-delta + tool-start + tool-result + final)
- error 이벤트 + reconnect idempotency token (LOOP-07)
- htmx UI 한 줄 입력 form + SSE response area (UI-01..UI-04)

## 보안 메모

이 spike는 외부 SSE 페이로드를 textContent + createElement로만 DOM에 삽입한다. innerHTML 비-사용. Phase 1 UI도 같은 패턴 유지 (Phase 2에서 sanitization 강화).
