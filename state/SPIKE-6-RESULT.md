# Spike 6 결과 — Anthropic SDK + cli-proxy-api roundtrip

**Date:** 2026-05-06
**Status:** PASS
**baseURL:** http://192.168.0.5:8317 (cli-proxy-api)
**Models tested:**
  - readonly: claude-sonnet-4-6 (proxy 가용)
  - propose:  claude-opus-4-6 (D-10)

## 4 검증 결과

| # | 검증 항목 | 결과 | 메모 |
|---|----------|------|------|
| 1 | SDK chat (non-streaming) | PASS | model echo=claude-sonnet-4-6, text="ok" |
| 2 | SDK tool-use roundtrip | PASS | stop_reason=tool_use, tool=list_containers |
| 3 | SDK streaming (messages.stream) | PASS | 2 text_delta events, final stop=end_turn |
| 4 | claude-opus-4-6 (D-10) | PASS | model echo=claude-opus-4-6, text="ready" |

## 출력 발췌

```
[Spike 6] baseURL=http://192.168.0.5:8317
[Spike 6] readonly model=claude-sonnet-4-6
[Spike 6] propose model=claude-opus-4-6

[Spike 6] ✓ 1. SDK chat — model echo=claude-sonnet-4-6, text="ok"
[Spike 6] ✓ 2. SDK tool-use — stop=tool_use, tool=list_containers
[Spike 6] ✓ 3. SDK streaming — 2 text_delta events, final stop=end_turn, text="1, 2, 3! 🎉..."
[Spike 6] ✓ 4. claude-opus-4-6 (D-10) — model echo=claude-opus-4-6, text="ready"

[Spike 6] 4/4 통과
[Spike 6 PASS] D-09 + D-10 SDK 레이어 검증 완료
```

## D-09/D-10/D-11 lock-in 결정

PASS:
- **D-09 채택 확정** — Phase 1 `agent/loop.ts`에서 동일 패턴 사용 (`new Anthropic({ apiKey, baseURL })`)
- **D-10 (`claude-opus-4-6`) 확정** — Phase 2 propose/apply 모델로 사용
- **D-11 schema는 정의됨** + 단위 테스트 5개 PASS (06-proxy-fallback.test.ts). 실제 fallback 통신 검증은 Phase 1 LLM 모듈 단계로 deferred (proxy 다운 시뮬레이션 필요).

## 발견된 friction (DOG-02 입력)

1. **셸 환경 변수가 .env를 silently 덮어쓴다**:
   - 환경에 `ANTHROPIC_API_KEY=` (빈 값)이 export되어 있어서 Bun의 `.env` 자동 로드보다 우선됨.
   - `loadEnv()`는 `Bun.env.ANTHROPIC_API_KEY = ""`을 받아 BOOT-05 검증 실패로 종료.
   - 해결: `unset ANTHROPIC_API_KEY` 후 재실행 → 4/4 PASS.
   - 시스템적 해결책: Phase 1 startup script에서 빈 환경 변수를 감지하고 .env 로드 우선 옵션을 명시적으로 처리할 필요. 또는 `dotenv` 명시 호출.
   - FRICTION.md (00-08)에 기록 예정.

2. **`bun run -e` vs `bun -e`**: `bun run -e ...`는 usage 출력. `bun -e ...`만 동작. CLI 표면 일관성 이슈, dogfood 마찰로 기록.
