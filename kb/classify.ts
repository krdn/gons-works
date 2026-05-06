// kb/classify.ts — 컨테이너 이름 → 5 핵심 stack 식별자 매핑.
//
// 사용처:
//   - kb/stale-check.ts: docker ps 결과의 컨테이너 이름을 stack 키로 분류
//   - 미래 plan에서 readLogs 등에서 stack-aware filtering
//
// 5 핵심 stack: news / ais / n8n / open-webui / krdn-fx (PROJECT.md + state/services.yaml lock).
// 정규식 패턴은 scripts/draft-services-yaml.ts FIVE_CORE_STACKS와 동일 컨벤션 — 단,
// 여기는 더 관용적으로 매칭 (open-webui는 hyphen 없는 'openwebui'도 허용,
// krdn-fx는 'krdnfx'도 허용 — 사용자가 컨테이너 이름을 다양하게 지을 수 있음).

const STACK_PATTERNS: Record<string, RegExp> = {
  news: /^news[-_]/,
  ais: /^ais[-_]/,
  n8n: /^n8n([-_]|$)/,
  "open-webui": /^open[-_]?webui/,
  "krdn-fx": /^krdn[-_]?fx/,
}

/**
 * 컨테이너 이름을 5 핵심 stack 키 중 하나로 분류한다.
 *
 * @param containerName  docker ps의 Names 필드 (예: "news-prod-redis")
 * @returns "news" | "ais" | "n8n" | "open-webui" | "krdn-fx" | null
 */
export function classifyStack(containerName: string): string | null {
  for (const [stack, pattern] of Object.entries(STACK_PATTERNS)) {
    if (pattern.test(containerName)) return stack
  }
  return null
}
