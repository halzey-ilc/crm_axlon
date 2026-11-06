"use server"

import { isMockDataSource } from "@/config/env"
import { decideAction, getRun, startRun, type AssistantAction, type AssistantRun, type RunContext } from "@/features/assistant/api/assistant-repository"
import { ApiError, apiErrorMessage } from "@/lib/api/errors"
import { getActionAuth } from "@/lib/auth/token-store"

export type AssistantResult<T> = { ok: true; data: T } | { ok: false; message: string; requestId: string | null }

const DEMO_ONLY = { ok: false as const, message: "В демо-режиме ИИ-помощник не подключён: вопросы обрабатывает сервер.", requestId: null }

function failure(error: unknown): AssistantResult<never> {
  if (!(error instanceof ApiError)) throw error
  const requestId = error.requestId ?? null
  if (error.code === "ai_disabled") {
    return { ok: false, message: "ИИ-помощник не включён на сервере: для ответов нужно подключение к AI Platform. Обратитесь к администратору платформы.", requestId }
  }
  if (error.kind === "not_found") return { ok: false, message: "Запрос не найден: он виден только тому, кто его отправил.", requestId }
  if (error.kind === "forbidden" && !error.code) return { ok: false, message: "У вашей роли нет доступа к ИИ-помощнику.", requestId }
  if (error.kind === "conflict") return { ok: false, message: "Действие уже выполнено или отклонено — обновите страницу.", requestId }
  return { ok: false, message: apiErrorMessage(error), requestId }
}

async function run<T>(operation: () => Promise<T>): Promise<AssistantResult<T>> {
  if (isMockDataSource) return DEMO_ONLY
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    return failure(error)
  }
}

export async function askAssistantAction(question: string, context: RunContext = {}): Promise<AssistantResult<AssistantRun>> {
  const request = question.trim()
  if (request.length < 3) return { ok: false, message: "Опишите, что нужно сделать — хотя бы несколько слов.", requestId: null }
  if (request.length > 1000) return { ok: false, message: "Не длиннее 1000 символов.", requestId: null }
  return run(async () => startRun(await getActionAuth(), request, context))
}

export async function getAssistantRunAction(runId: string): Promise<AssistantResult<AssistantRun>> {
  return run(async () => getRun(await getActionAuth(), runId))
}

/** Подтвердить (выполнить с правами пользователя) или отклонить одно предложенное действие */
export async function decideAssistantAction(runId: string, index: number, decision: "confirm" | "reject"): Promise<AssistantResult<AssistantAction>> {
  return run(async () => decideAction(await getActionAuth(), runId, index, decision))
}
