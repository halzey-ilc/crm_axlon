import { cache } from "react"
import { z } from "zod"

import type { ApiAuth } from "@/lib/api/auth-session"
import { apiRequest } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { getRenderAuth } from "@/lib/auth/token-store"

/**
 * ИИ через backend CRM (`/ai/…`): браузер не знает ни адреса модели, ни ключей. Работа
 * асинхронная: `POST` ставит задачу (202, или 200 с прежним результатом, если данные не
 * менялись), `GET` читает последнюю; 404 — разбора ещё не просили. Результат проверяет backend.
 */

const statusSchema = z.object({ enabled: z.boolean(), canRequest: z.boolean() })

/**
 * Показывать ли блоки ИИ: подключена ли модель на сервере (`AI_PLATFORM_ENABLED`), есть ли ИИ
 * в тарифе и право у роли. Блоки необязательные: при отказе их просто нет на экране.
 */
export const fetchAiAvailable = cache(async (): Promise<boolean> => {
  try {
    const status = await apiRequest("/api/v1/ai/status/", { auth: await getRenderAuth(), schema: statusSchema })
    return status.enabled && status.canRequest
  } catch (error) {
    if (error instanceof ApiError) return false
    throw error
  }
})

const jobFields = {
  id: z.string(),
  status: z.enum(["pending", "submitted", "succeeded", "failed"]),
  isMock: z.boolean(),
  errorCode: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
}

const groundedSchema = z.object({ text: z.string(), evidenceQuote: z.string() })

/** `call_summary.output.v2` (и v1 без `insufficient_data`): цитаты проверены, `summary` — нет */
const callSummarySchema = z.object({
  ...jobFields,
  result: z
    .object({
      summary: z.string(),
      keyPoints: z.array(groundedSchema),
      nextStep: groundedSchema.nullable(),
      insufficientData: z.boolean().default(false),
    })
    .nullable(),
})

const pointSchema = z.object({ text: z.string() })

/** `deal_coach.output.v1` */
const dealBriefSchema = z.object({
  ...jobFields,
  result: z
    .object({
      situation: z.array(pointSchema),
      risks: z.array(pointSchema),
      questions: z.array(pointSchema),
      nextStep: pointSchema.nullable(),
      insufficientData: z.boolean(),
    })
    .nullable(),
})

export type CallSummary = z.infer<typeof callSummarySchema>
export type DealBrief = z.infer<typeof dealBriefSchema>

const callPath = (callId: string) => `/api/v1/ai/calls/${encodeURIComponent(callId)}/summary/`
const dealPath = (dealId: string) => `/api/v1/ai/deals/${encodeURIComponent(dealId)}/brief/`

/** Последний результат; null — его ещё не просили */
async function latest<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") return null
    throw error
  }
}

export function fetchCallSummary(auth: ApiAuth, callId: string): Promise<CallSummary | null> {
  return latest(() => apiRequest(callPath(callId), { auth, schema: callSummarySchema }))
}

export function requestCallSummary(auth: ApiAuth, callId: string): Promise<CallSummary> {
  return apiRequest(callPath(callId), { method: "POST", auth, schema: callSummarySchema })
}

export function fetchDealBrief(auth: ApiAuth, dealId: string): Promise<DealBrief | null> {
  return latest(() => apiRequest(dealPath(dealId), { auth, schema: dealBriefSchema }))
}

export function requestDealBrief(auth: ApiAuth, dealId: string): Promise<DealBrief> {
  return apiRequest(dealPath(dealId), { method: "POST", auth, body: {}, schema: dealBriefSchema })
}

const textSchema = z.object({ text: z.string() })

export const replySuggestionSchema = z.object({
  ...jobFields,
  result: z
    .object({
      draftReply: z.string().nullable(),
      needsHuman: z.boolean(),
      urgency: z.enum(["low", "normal", "high"]),
    })
    .nullable(),
})

/** Отчёты ИИ: разные поля у разных видов, для показа достаточно заголовка и пунктов */
export const aiReportSchema = z.object({
  ...jobFields,
  result: z
    .object({
      headline: z.string(),
      items: z.array(textSchema).default([]),
      observations: z.array(textSchema).default([]),
      recommendations: z.array(textSchema).default([]),
      checks: z.array(textSchema).default([]),
      insufficientData: z.boolean(),
    })
    .nullable(),
})

export type ReplySuggestion = z.infer<typeof replySuggestionSchema>
export type AiReport = z.infer<typeof aiReportSchema>
export type AiReportKind = "kpi" | "risk" | "digest"

const REPORT_PATHS: Record<AiReportKind, string> = {
  kpi: "/api/v1/ai/analytics/kpi-explanation/",
  risk: "/api/v1/ai/risk/review/",
  digest: "/api/v1/ai/operations/digest/",
}

const replyPath = (conversationId: string) => `/api/v1/ai/conversations/${encodeURIComponent(conversationId)}/reply/`

export function fetchReplySuggestion(auth: ApiAuth, conversationId: string): Promise<ReplySuggestion | null> {
  return latest(() => apiRequest(replyPath(conversationId), { auth, schema: replySuggestionSchema }))
}

export function requestReplySuggestion(auth: ApiAuth, conversationId: string): Promise<ReplySuggestion> {
  return apiRequest(replyPath(conversationId), { method: "POST", auth, body: {}, schema: replySuggestionSchema })
}

export function fetchAiReport(auth: ApiAuth, kind: AiReportKind): Promise<AiReport | null> {
  return latest(() => apiRequest(REPORT_PATHS[kind], { auth, schema: aiReportSchema }))
}

export function requestAiReport(auth: ApiAuth, kind: AiReportKind): Promise<AiReport> {
  return apiRequest(REPORT_PATHS[kind], { method: "POST", auth, body: {}, schema: aiReportSchema })
}

const verdictSchema = z.object({
  code: z.string(),
  title: z.string(),
  status: z.enum(["met", "partial", "missed", "not_applicable"]),
  evidence: z.object({ segmentId: z.string(), quote: z.string() }).nullable(),
  comment: z.string(),
})

/** Разбор записанного звонка: расшифровка, оценка по чек-листу и балл (балл считает CRM) */
export const callAnalysisSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "transcribing", "reviewing", "succeeded", "failed"]),
  language: z.enum(["ru", "ky"]),
  segments: z.array(z.object({ id: z.string(), speaker: z.enum(["manager", "customer", "unknown"]), text: z.string() })),
  review: z
    .object({ criteria: z.array(verdictSchema), strengths: z.array(z.string()), improvements: z.array(z.string()), insufficientData: z.boolean() })
    .nullable(),
  score: z.number().int().nullable(),
  isMock: z.boolean(),
  errorCode: z.string().nullable(),
  draft: z.boolean(),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
})

export type CallAnalysis = z.infer<typeof callAnalysisSchema>

const analysisPath = (callId: string) => `/api/v1/ai/calls/${encodeURIComponent(callId)}/analysis/`

export function fetchCallAnalysis(auth: ApiAuth, callId: string): Promise<CallAnalysis | null> {
  return latest(() => apiRequest(analysisPath(callId), { auth, schema: callAnalysisSchema }))
}

export function requestCallAnalysis(auth: ApiAuth, callId: string, language: "ru" | "ky"): Promise<CallAnalysis> {
  return apiRequest(analysisPath(callId), { method: "POST", auth, body: { language }, schema: callAnalysisSchema })
}
