// tools/_index.ts
// Phase 1의 3 read tool input schema 정의 + Anthropic tool-use API에 전달할 TOOL_SCHEMAS 배열.
// Plan 06 agent/loop.ts가 이 파일을 import해서 messages.create({ tools: TOOL_SCHEMAS }) 호출.
//
// DESIGN.md correction #3: Zod v4 내장 z.toJSONSchema() 사용 (대문자 JSON).
// 외부 zod→jsonschema 패키지는 절대 사용 금지 — Zod v4 입력에 대해 빈 {} 반환 (spike 5에서 검증).
//
// PITFALLS.md #6 prevention: readLogs 출력 sanitization (SECRET/KEY/PASSWORD 라인 제거)은
// 본 파일이 아니라 Plan 04의 tools/readLogs.ts에서 구현.

import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

// listContainers — READ-01
// 192.168.0.5 home-server 컨텍스트의 docker 컨테이너 목록.
export const ListContainersInput = z.object({
  filter: z
    .object({
      state: z.enum(["running", "stopped", "all"]).default("running"),
      namePattern: z.string().optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

// readLogs — READ-02
// 지정된 컨테이너의 최근 로그 (lines 최대 1000, T-01-02-02 DoS mitigation).
export const ReadLogsInput = z.object({
  containerName: z.string().min(1),
  lines: z.number().int().min(1).max(1000).default(200),
  since: z.string().optional(), // ISO datetime
  until: z.string().optional(),
})

// readCompose — READ-03
// 192.168.0.5의 docker-compose 파일을 SSH cat으로 읽기 (remote absolute path).
export const ReadComposeInput = z.object({
  composePath: z.string().min(1),
})

// Anthropic.Tool[] — Plan 06 agent/loop.ts의 messages.create({ tools }) 인자.
// z.toJSONSchema (대문자 JSON) — Zod v4 내장. 외부 zod→jsonschema 패키지 사용 금지.
export const TOOL_SCHEMAS: Anthropic.Tool[] = [
  {
    name: "listContainers",
    description:
      "192.168.0.5 home-server 컨텍스트의 docker 컨테이너 목록을 가져온다. 5 핵심 stack(news/ais/n8n/open-webui/krdn-fx)의 라이브 상태 확인용.",
    input_schema: z.toJSONSchema(ListContainersInput) as Anthropic.Tool["input_schema"],
  },
  {
    name: "readLogs",
    description:
      "지정된 컨테이너의 최근 로그를 가져온다 (sanitized — SECRET/KEY/PASSWORD 라인 제거). lines 기본 200, 최대 1000. since/until로 시간 범위 지정 가능.",
    input_schema: z.toJSONSchema(ReadLogsInput) as Anthropic.Tool["input_schema"],
  },
  {
    name: "readCompose",
    description:
      "192.168.0.5의 docker-compose 파일 내용을 ssh로 읽어온다. composePath는 운영 서버의 절대 경로.",
    input_schema: z.toJSONSchema(ReadComposeInput) as Anthropic.Tool["input_schema"],
  },
]

// handler에서 사용할 입력 타입 — Plan 04의 listContainers.ts/readLogs.ts/readCompose.ts가 import.
export type ListContainersArgs = z.infer<typeof ListContainersInput>
export type ReadLogsArgs = z.infer<typeof ReadLogsInput>
export type ReadComposeArgs = z.infer<typeof ReadComposeInput>
