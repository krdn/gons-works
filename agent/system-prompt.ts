// agent/system-prompt.ts — Phase 1 system prompt + RAG fence helper.
//
// **STUB STATUS (Plan 01-07 / Wave 3):** 본격 구현은 Plan 01-06 (병렬 진행).
// 시그니처(SYSTEM_PROMPT export, formatRagContext export)만 lock된 형태로 미리
// 작성한다. server.ts import + frontend integration 검증 통과를 위함.
//
// 머지 시 01-06 버전이 이 파일을 대체한다 — server.ts는 수정 불요.

import type { KbHit } from "../kb/index"

// 최소 시그니처 lock — 01-06 머지 시 D-15.1 envelope 인용 + PITFALL #6 fence + 5 stack 규칙으로 확장.
export const SYSTEM_PROMPT = `당신은 192.168.0.5 home-server의 운영 코파일럿이다. 운영자(1명)의 한국어 자연어 질의에 services.yaml 도메인 지식과 라이브 docker 상태를 결합해 한국어로 답한다.

**STUB:** 이 system prompt는 Plan 01-06 머지 시 D-15.1 envelope 인용 규칙 + PITFALL #6 RAG/log fence + 5 stack(news/ais/n8n/open-webui/krdn-fx) 정책 + 도구 목록(listContainers/readLogs/readCompose)으로 확장된다.`

/**
 * RAG hits를 user message에 prepend할 컨텍스트 텍스트로 변환.
 * services.yaml chunks는 trusted (사용자 review 거침). <rag_context> 태그로 fence.
 *
 * **STUB STATUS:** Plan 01-06이 완전 구현. 시그니처만 lock.
 */
export function formatRagContext(hits: KbHit[]): string {
  if (hits.length === 0) return ""
  const lines = hits.map(
    (h, i) =>
      `[${i + 1}] (${h.stack}.${h.field}, sim=${h.similarity.toFixed(3)}) ${h.text}`,
  )
  return `<rag_context source="services.yaml">\n${lines.join("\n")}\n</rag_context>\n\n`
}
