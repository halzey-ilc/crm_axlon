"use server"

import {
  fetchAiReport,
  fetchCallAnalysis,
  fetchCallSummary,
  fetchDealBrief,
  fetchReplySuggestion,
  requestAiReport,
  requestCallAnalysis,
  requestCallSummary,
  requestDealBrief,
  requestReplySuggestion,
  type AiReport,
  type AiReportKind,
  type CallAnalysis,
  type CallSummary,
  type DealBrief,
  type ReplySuggestion,
} from "@/features/ai-insights/api/ai-insights"
import { ApiError, apiErrorMessage } from "@/lib/api/errors"
import { getActionAuth } from "@/lib/auth/token-store"

export type AiActionResult<T> = { ok: true; data: T } | { ok: false; message: string }

async function run<T>(operation: () => Promise<T>): Promise<AiActionResult<T>> {
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (error.code === "ai_disabled") return { ok: false, message: "ИИ сейчас отключён на сервере. Обратитесь к администратору платформы." }
    if (error.kind === "forbidden" && !error.code) return { ok: false, message: "У вашей роли нет доступа к разбору ИИ." }
    if (error.kind === "validation") return { ok: false, message: "Здесь пока нечего разбирать: добавьте заметку или историю." }
    return { ok: false, message: apiErrorMessage(error) }
  }
}

export async function requestCallSummaryAction(callId: string): Promise<AiActionResult<CallSummary>> {
  return run(async () => requestCallSummary(await getActionAuth(), callId))
}

export async function getCallSummaryAction(callId: string): Promise<AiActionResult<CallSummary | null>> {
  return run(async () => fetchCallSummary(await getActionAuth(), callId))
}

export async function requestDealBriefAction(dealId: string): Promise<AiActionResult<DealBrief>> {
  return run(async () => requestDealBrief(await getActionAuth(), dealId))
}

export async function getDealBriefAction(dealId: string): Promise<AiActionResult<DealBrief | null>> {
  return run(async () => fetchDealBrief(await getActionAuth(), dealId))
}

export async function requestReplySuggestionAction(conversationId: string): Promise<AiActionResult<ReplySuggestion>> {
  return run(async () => requestReplySuggestion(await getActionAuth(), conversationId))
}

export async function getReplySuggestionAction(conversationId: string): Promise<AiActionResult<ReplySuggestion | null>> {
  return run(async () => fetchReplySuggestion(await getActionAuth(), conversationId))
}

export async function requestAiReportAction(kind: AiReportKind): Promise<AiActionResult<AiReport>> {
  return run(async () => requestAiReport(await getActionAuth(), kind))
}

export async function getAiReportAction(kind: AiReportKind): Promise<AiActionResult<AiReport | null>> {
  return run(async () => fetchAiReport(await getActionAuth(), kind))
}

export async function getCallAnalysisAction(callId: string): Promise<AiActionResult<CallAnalysis | null>> {
  return run(async () => fetchCallAnalysis(await getActionAuth(), callId))
}

/** Разобрать звонок заново, например на кыргызском; нужна запись звонка из АТС */
export async function requestCallAnalysisAction(callId: string, language: "ru" | "ky"): Promise<AiActionResult<CallAnalysis>> {
  return run(async () => requestCallAnalysis(await getActionAuth(), callId, language))
}
