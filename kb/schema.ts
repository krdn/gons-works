import { z } from "zod"

// services.yaml의 strict Zod schema (D-12.4).
// PATTERNS.md `kb/schema.ts` 섹션 + src/env.ts의 Zod v4 (z.object + .default + safeParse) 패턴 차용.
// 이 schema는 Plan 05 KB-02/KB-03 RAG indexing의 입력 타입.
//
// 핵심 결정:
// - stacks는 Record<string, StackSchema> — 키를 강제하지 않음 (자유 stack 추가 허용)
// - unmatched_containers는 optional — D-12.4: RAG 인덱싱은 stacks.* 만, unmatched는 v2
// - 4 슬롯(depends_on/volumes/normal_log_pattern/key_log_locations)은 default를 가지므로
//   AI 초안이 비워둔 경우에도 parse 통과 (단, 운영자 review-checklist가 이를 채울 책임)

export const ContainerRefSchema = z.object({
  name: z.string(),
  image: z.string(),
  state: z.string(),
  // status는 unmatched_containers entry에는 없을 수 있음 → optional.
  status: z.string().optional(),
})

export const StackSchema = z.object({
  purpose: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
  volumes: z.array(z.string()).default([]),
  normal_log_pattern: z.string().default(""),
  key_log_locations: z.array(z.string()).default([]),
  containers: z.array(ContainerRefSchema).default([]),
  // 운영자가 의도해서 stop 상태로 둔 stack — drift detection의 stale 분류에서 제외 (PITFALL #11 노이즈 감소).
  paused: z.boolean().default(false),
})

export const ServicesYamlSchema = z.object({
  generated_at: z.string(),
  generated_from: z.string(),
  stacks: z.record(z.string(), StackSchema),
  unmatched_containers: z.array(ContainerRefSchema).optional(),
})

export type ContainerRef = z.infer<typeof ContainerRefSchema>
export type Stack = z.infer<typeof StackSchema>
export type ServicesYaml = z.infer<typeof ServicesYamlSchema>
