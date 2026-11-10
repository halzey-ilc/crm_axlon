import { z } from "zod"

import type { ApiAuth } from "@/lib/api/auth-session"
import { apiRequest } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"

/**
 * Телефония компании (`/telephony/sipuni/`): свой аккаунт Sipuni у каждой компании. Ключ
 * интеграции уходит на backend и обратно не возвращается; адрес для событий — один раз, при
 * подключении или смене адреса.
 */

export const sipuniSettingsSchema = z.object({
  account: z.string(),
  hasSecret: z.boolean(),
  companyNumber: z.string(),
  extensions: z.record(z.string(), z.string()),
  countryCode: z.string(),
  callLanguage: z.enum(["ru", "ky"]),
  recordChannels: z.enum(["mono", "manager_left", "manager_right"]),
  analyzeCalls: z.boolean(),
  enabled: z.boolean(),
  eventsUrl: z.string().optional(),
})

export type SipuniSettings = z.infer<typeof sipuniSettingsSchema>

export type SipuniInput = Omit<SipuniSettings, "hasSecret" | "eventsUrl"> & { secret: string; rotateToken: boolean }

const checklistSchema = z.object({
  criteria: z.array(z.object({ code: z.string(), title: z.string(), description: z.string().optional() })),
})

export type ChecklistPoint = z.infer<typeof checklistSchema>["criteria"][number]

/** null — Sipuni не подключён; "forbidden" — подключает только директор */
export async function fetchSipuniSettings(auth: ApiAuth): Promise<SipuniSettings | null | "forbidden"> {
  try {
    return await apiRequest("/api/v1/telephony/sipuni/", { auth, schema: sipuniSettingsSchema })
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") return null
    if (error instanceof ApiError && error.kind === "forbidden") return "forbidden"
    throw error
  }
}

export function saveSipuniSettings(auth: ApiAuth, input: SipuniInput): Promise<SipuniSettings> {
  return apiRequest("/api/v1/telephony/sipuni/", { method: "PUT", auth, body: input, schema: sipuniSettingsSchema })
}

export async function fetchCallChecklist(auth: ApiAuth): Promise<ChecklistPoint[]> {
  return (await apiRequest("/api/v1/ai/calls/checklist/", { auth, schema: checklistSchema })).criteria
}

export async function saveCallChecklist(auth: ApiAuth, criteria: ChecklistPoint[]): Promise<ChecklistPoint[]> {
  return (await apiRequest("/api/v1/ai/calls/checklist/", { method: "PUT", auth, body: { criteria }, schema: checklistSchema })).criteria
}
