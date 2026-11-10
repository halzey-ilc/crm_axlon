"use server"

import { revalidatePath } from "next/cache"

import { isMockDataSource } from "@/config/env"
import { saveCallChecklist, saveSipuniSettings, type ChecklistPoint, type SipuniInput, type SipuniSettings } from "@/features/company-settings/api/telephony"
import { COMPANY_SETTINGS_ROUTE } from "@/features/company-settings/lib/routes"
import { ApiError, apiErrorMessage } from "@/lib/api/errors"
import { getActionAuth } from "@/lib/auth/token-store"

export type TelephonyResult<T> = { ok: true; data: T } | { ok: false; message: string }

async function run<T>(operation: () => Promise<T>): Promise<TelephonyResult<T>> {
  if (isMockDataSource) return { ok: false, message: "В демо-режиме настройки телефонии на сервер не сохраняются." }
  try {
    const data = await operation()
    revalidatePath(COMPANY_SETTINGS_ROUTE)
    return { ok: true, data }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (error.kind === "forbidden") return { ok: false, message: "Телефонию подключает директор." }
    if (error.kind === "validation") return { ok: false, message: `Проверьте поля: ${apiErrorMessage(error)}` }
    return { ok: false, message: apiErrorMessage(error) }
  }
}

/** Подключить Sipuni или изменить подключение; адрес для событий приходит только при подключении */
export async function saveSipuniAction(input: SipuniInput): Promise<TelephonyResult<SipuniSettings>> {
  if (!/^\d{3,12}$/.test(input.account.trim())) return { ok: false, message: "Номер кабинета Sipuni — только цифры." }
  return run(async () => saveSipuniSettings(await getActionAuth(), { ...input, account: input.account.trim() }))
}

export async function saveChecklistAction(criteria: ChecklistPoint[]): Promise<TelephonyResult<ChecklistPoint[]>> {
  const cleaned = criteria.filter((point) => point.title.trim())
  if (cleaned.length === 0 || cleaned.length > 15) return { ok: false, message: "В чек-листе от 1 до 15 пунктов." }
  return run(async () => saveCallChecklist(await getActionAuth(), cleaned))
}
