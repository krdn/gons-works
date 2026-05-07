// kb/classify.ts — 컨테이너 이름 → 핵심 stack 식별자 매핑.
//
// 사용처:
//   - kb/stale-check.ts: docker ps 결과의 컨테이너 이름을 stack 키로 분류
//   - 미래 plan에서 readLogs 등에서 stack-aware filtering
//
// 핵심 stack:
//   - 운영 서비스: news / ais / ai-afterschool / n8n / open-webui / krdn-fx (paused)
//   - 운영자 도구: vscode / cli-proxy-api
// (PROJECT.md + state/services.yaml lock).
//
// krdn-fx는 dashboard/backend/timescaledb 3-tier — krdn-timescaledb도 같은 stack으로 묶는다.
// open-webui는 hyphen 없는 'openwebui'도 허용 (관용 매칭).
// ai-afterschool은 ai-afterschool-* 만 — ais- 패턴과 충돌 방지.

const STACK_PATTERNS: Record<string, RegExp> = {
  news: /^news[-_]/,
  // ais- 가 ai-afterschool- 보다 먼저 평가되면 안 되지만, 두 패턴 prefix가 겹치지 않으므로 안전.
  ais: /^ais[-_]/,
  "ai-afterschool": /^ai[-_]afterschool[-_]/,
  n8n: /^n8n([-_]|$)/,
  "open-webui": /^open[-_]?webui/,
  // krdn-fx 3-tier: krdn-fx-dashboard, krdn-fx-backend, krdn-timescaledb (paused stack).
  "krdn-fx": /^(krdn[-_]?fx|krdn[-_]?timescaledb)/,
  vscode: /^vscode/,
  "cli-proxy-api": /^cli[-_]proxy[-_]api/,
}

/**
 * 컨테이너 이름을 핵심 stack 키 중 하나로 분류한다.
 *
 * @param containerName  docker ps의 Names 필드 (예: "news-prod-redis")
 * @returns stack key 또는 null
 */
export function classifyStack(containerName: string): string | null {
  for (const [stack, pattern] of Object.entries(STACK_PATTERNS)) {
    if (pattern.test(containerName)) return stack
  }
  return null
}
