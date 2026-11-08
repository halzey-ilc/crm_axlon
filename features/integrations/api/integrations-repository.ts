import { z } from "zod"

import type { ApiAuth } from "@/lib/api/auth-session"
import { apiRequest } from "@/lib/api/client"

export const INTEGRATION_PROVIDERS = ["whatsapp", "green_api", "telegram", "instagram", "telephony"] as const
export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS)
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>

const integrationSchema = z.object({
  provider: integrationProviderSchema,
  title: z.string(),
  /** Секрет подписи задан на сервере — входящие события принимаются */
  inboundConfigured: z.boolean(),
  /** Адрес для настройки у провайдера (без домена) */
  webhookPath: z.string(),
  /** Может ли CRM отправлять через канал; в этой установке адаптеров отправки нет */
  outboundConnected: z.boolean(),
  receivedTotal: z.int(),
  receivedLast24h: z.int(),
  failedTotal: z.int(),
  lastReceivedAt: z.iso.datetime({ offset: true }).nullable(),
  recentErrors: z.array(z.object({ receivedAt: z.iso.datetime({ offset: true }), status: z.string(), error: z.string() })),
})

export type Integration = z.infer<typeof integrationSchema>

const checkSchema = z.object({
  provider: integrationProviderSchema,
  ok: z.boolean(),
  items: z.array(z.object({ name: z.string(), ok: z.boolean(), message: z.string() })),
})

export type IntegrationCheck = z.infer<typeof checkSchema>

/** `GET /integrations/` — состояние каналов компании (директор) */
export async function fetchIntegrations(auth: ApiAuth): Promise<Integration[]> {
  return (await apiRequest("/api/v1/integrations/", { auth, schema: z.object({ results: z.array(integrationSchema) }) })).results
}

/** `POST /integrations/{provider}/check/` — проверки, которые можно выполнить из CRM */
export function checkIntegration(auth: ApiAuth, provider: IntegrationProvider): Promise<IntegrationCheck> {
  return apiRequest(`/api/v1/integrations/${provider}/check/`, { method: "POST", auth, schema: checkSchema })
}
