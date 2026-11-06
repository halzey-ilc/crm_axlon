import { z } from "zod"

import type { ApiAuth } from "@/lib/api/auth-session"
import { apiRequest } from "@/lib/api/client"

/**
 * ИИ-помощник (`/ai/agent/runs/`) — модуль backend другого разработчика, здесь только клиент.
 * Помощник предлагает действия; ничего не выполняется, пока пользователь не подтвердит
 * каждое. Запуск виден только тому, кто его сделал.
 */

export const actionSchema = z.object({
  index: z.int().nonnegative(),
  tool: z.string(),
  subjectRef: z.string().nullable().optional(),
  args: z.record(z.string(), z.unknown()).nullable().optional(),
  reason: z.string().nullable().optional(),
  status: z.enum(["proposed", "executed", "failed", "rejected"]),
  resultRef: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  decidedAt: z.iso.datetime({ offset: true }).nullable().optional(),
})

export const choiceSchema = z.object({ dealId: z.string(), title: z.string() })

export const runSchema = z.object({
  id: z.string(),
  request: z.string(),
  status: z.enum(["pending", "submitted", "succeeded", "failed"]),
  summary: z.string().nullable(),
  actions: z.array(actionSchema),
  /** Несколько подходящих сделок: пользователь выбирает, помощник не угадывает */
  choices: z.array(choiceSchema).default([]),
  /** Строки ответа, посчитанного CRM; ref — запись, на которую ведёт строка */
  items: z.array(z.object({ title: z.string(), ref: z.string().nullable() })).default([]),
  isMock: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
})

export type AssistantRun = z.infer<typeof runSchema>
export type AssistantAction = z.infer<typeof actionSchema>
export type AssistantChoice = z.infer<typeof choiceSchema>

/** Что уточняет запрос: выбранная сделка и предыдущий запуск, который он продолжает */
export type RunContext = { dealId?: string; previousRunId?: string }

/** Ответ CRM без модели: уточнение или посчитанные системой данные */
export const LOCAL_PROVIDER = "crm"

const runPath = (runId: string) => `/api/v1/ai/agent/runs/${encodeURIComponent(runId)}/`

export function startRun(auth: ApiAuth, request: string, context: RunContext = {}): Promise<AssistantRun> {
  return apiRequest("/api/v1/ai/agent/runs/", { method: "POST", auth, body: { request, ...context }, schema: runSchema })
}

export function getRun(auth: ApiAuth, runId: string): Promise<AssistantRun> {
  return apiRequest(runPath(runId), { auth, schema: runSchema })
}

export function decideAction(auth: ApiAuth, runId: string, index: number, decision: "confirm" | "reject"): Promise<AssistantAction> {
  return apiRequest(`${runPath(runId)}actions/${index}/${decision}/`, { method: "POST", auth, schema: actionSchema })
}
