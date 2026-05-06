// kb/chunker.ts — D-13.1 (필드 단위 청크) + D-13.2 (자연어 stack 매그네틱 텍스트).
//
// 입력: state/services.yaml 파싱 결과 (kb/schema.ts ServicesYaml)
// 출력: ~25 Chunk (5 stack × 5 field) — voyage-4-lite 임베딩 입력
//
// 핵심 결정:
//   - 필드 단위 청크: stack 단위 큰 청크는 cosine similarity가 noise로 dilute됨 (D-13.1, PITFALL #15)
//   - 자연어 한 문장 + stack 식별자 prefix: 한국어 query 매칭이 KV 원본보다 강함 (D-13.2)
//   - 빈 슬롯 fallback: AI 초안이 비워둔 경우에도 chunk는 생성 (운영자 review 시점에 채워짐 가정)
//
// Spike 2 baseline: top-1 sim=0.6308 (state/SPIKE-2-RESULT.md). 이 자연어 패턴이 그 baseline의 ground truth.
//
// containers 배열은 별도 chunk 아님 — purpose chunk에 stack의 핵심 컨테이너만 자연스럽게 포함되도록
// services.yaml 작성 시점에 보장 (KB-01 review-checklist).

import type { Stack, ServicesYaml } from "./schema"

export interface Chunk {
  id: string
  text: string
  metadata: {
    stack: string
    field: "purpose" | "depends_on" | "volumes" | "normal_log_pattern" | "key_log_locations"
  }
}

type FieldName = Chunk["metadata"]["field"]
type FieldTemplate = (stackName: string, val: unknown) => string

/**
 * D-13.2 자연어 템플릿. 각 필드를 한국어 한 문장으로 변환.
 * 빈 값(빈 array / 빈 string)은 "정의 없음"으로 표시 — chunk는 생성하되 noise 표시.
 *
 * 5 필드 모두 export — 테스트 + 디버깅에서 직접 호출 가능.
 */
export const FIELD_TEMPLATES: Record<FieldName, FieldTemplate> = {
  purpose: (s, v) => {
    const purpose = (v as string) || ""
    if (!purpose) return `${s} stack: 정의 없음.`
    return `${s} stack: ${purpose}.`
  },

  depends_on: (s, v) => {
    const arr = (v as string[]) ?? []
    if (arr.length === 0) return `${s} stack의 의존성: 정의 없음.`
    return `${s} stack은 ${arr.join(", ")}에 의존한다.`
  },

  volumes: (s, v) => {
    const arr = (v as string[]) ?? []
    if (arr.length === 0) return `${s} stack의 볼륨: 정의 없음.`
    return `${s} stack의 볼륨: ${arr.join(", ")}.`
  },

  normal_log_pattern: (s, v) => {
    const pattern = (v as string) ?? ""
    if (!pattern) return `${s} stack의 normal_log_pattern: 정의 없음.`
    return `${s} stack의 normal_log_pattern: "${pattern}". 이 패턴이 안 보이면 worker 멈춤이나 에러 의심.`
  },

  key_log_locations: (s, v) => {
    const arr = (v as string[]) ?? []
    if (arr.length === 0) return `${s} 디버깅 시 확인할 컨테이너: 정의 없음.`
    return `${s} 디버깅 시 확인할 컨테이너: ${arr.join(", ")}.`
  },
}

/**
 * 단일 stack을 5 chunk로 변환 (필드 단위, D-13.1).
 *
 * @param stackName  stack 키 (예: "news")
 * @param stack      ServicesYaml.stacks[stackName] 값
 * @returns 5 Chunk — 필드 순서는 FIELD_TEMPLATES 정의 순서를 따름
 */
export function chunkStack(stackName: string, stack: Stack): Chunk[] {
  const fields = Object.keys(FIELD_TEMPLATES) as FieldName[]
  return fields.map((field) => ({
    id: `${stackName}:${field}`,
    text: FIELD_TEMPLATES[field](stackName, stack[field as keyof Stack]),
    metadata: { stack: stackName, field },
  }))
}

/**
 * 전체 services.yaml을 chunk 배열로 변환 (5 stack × 5 field = ~25 chunk, D-13.1).
 *
 * @param yaml  ServicesYamlSchema.parse 결과
 * @returns Chunk 배열 (kb/index.ts ensureIndexed가 voyage embed 입력으로 사용)
 */
export function chunkServicesYaml(yaml: ServicesYaml): Chunk[] {
  return Object.entries(yaml.stacks).flatMap(([stackName, stack]) =>
    chunkStack(stackName, stack as Stack),
  )
}
