import { z } from "zod"

import type { ApiAuth } from "@/lib/api/auth-session"
import { apiRequest } from "@/lib/api/client"
import { paginatedSchema } from "@/lib/api/pagination"

export const CHANNELS = ["whatsapp", "telegram", "instagram", "email"] as const
export const channelSchema = z.enum(CHANNELS)
export type Channel = z.infer<typeof channelSchema>

export const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  instagram: "Instagram",
  email: "E-mail",
}

export const templateSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdBy: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export type MessageTemplate = z.infer<typeof templateSchema>

/** Ограничения backend (домен MessageTemplate) */
export const TEMPLATE_TITLE_MAX = 120
export const TEMPLATE_BODY_MAX = 4000

export type TemplateInput = { title: string; body: string }

/** `GET /communications/templates/` — шаблоны компании, видны всем сотрудникам с доступом к перепискам */
export async function fetchTemplates(auth: ApiAuth): Promise<MessageTemplate[]> {
  return (await apiRequest("/api/v1/communications/templates/", { auth, schema: paginatedSchema(templateSchema) })).results
}

/** Создают, меняют и удаляют шаблоны директор и РОП (backend: staff.manage) */
export function createTemplate(auth: ApiAuth, input: TemplateInput): Promise<MessageTemplate> {
  return apiRequest("/api/v1/communications/templates/", { method: "POST", auth, body: input, schema: templateSchema })
}

export function updateTemplate(auth: ApiAuth, id: string, input: TemplateInput): Promise<MessageTemplate> {
  return apiRequest(`/api/v1/communications/templates/${encodeURIComponent(id)}/`, { method: "PATCH", auth, body: input, schema: templateSchema })
}

export async function deleteTemplate(auth: ApiAuth, id: string): Promise<void> {
  await apiRequest(`/api/v1/communications/templates/${encodeURIComponent(id)}/`, { method: "DELETE", auth, schema: z.unknown() })
}

const channelStateSchema = z.object({ channel: channelSchema, canSend: z.boolean(), reason: z.string().nullable() })

export type ChannelState = z.infer<typeof channelStateSchema>

/** `GET /communications/channels/` — можно ли отправлять через канал. Без провайдера — нельзя */
export async function fetchChannels(auth: ApiAuth): Promise<ChannelState[]> {
  return (await apiRequest("/api/v1/communications/channels/", { auth, schema: z.object({ results: z.array(channelStateSchema) }) })).results
}

const conversationSchema = z.object({
  id: z.string(),
  channel: channelSchema,
  externalContactId: z.string(),
  contactName: z.string().nullable(),
  status: z.enum(["open", "closed"]),
  customerId: z.string().nullable(),
  leadId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  unreadCount: z.int(),
  lastMessageAt: z.iso.datetime({ offset: true }).nullable(),
})

export type Conversation = z.infer<typeof conversationSchema>

const messageSchema = z.object({
  id: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  text: z.string(),
  status: z.enum(["received", "pending", "sent", "failed"]),
  senderUserId: z.string().nullable(),
  failureCode: z.string().nullable(),
  attachment: z
    .object({ kind: z.enum(["image", "video", "audio", "document"]), contentType: z.string(), fileName: z.string(), size: z.int() })
    .nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})

export type Message = z.infer<typeof messageSchema>

/** Сколько переписок клиента и сообщений в каждой показываем в карточке */
const CONVERSATIONS_LIMIT = 10
const MESSAGES_LIMIT = 200

/** `GET /communications/conversations/?customer_id` — переписки клиента в области пользователя */
export async function fetchCustomerConversations(auth: ApiAuth, customerId: string): Promise<{ total: number; items: Conversation[] }> {
  const page = await apiRequest("/api/v1/communications/conversations/", {
    auth,
    query: { customerId, limit: String(CONVERSATIONS_LIMIT) },
    schema: paginatedSchema(conversationSchema),
  })
  return { total: page.count, items: page.results }
}

/** Сколько чатов показываем в боковой панели */
const CHATS_LIMIT = 50

/** Чаты WhatsApp в области пользователя, свежие сверху; неразобранные видны всем — их можно забрать */
export async function fetchWhatsappChats(auth: ApiAuth): Promise<Conversation[]> {
  const page = await apiRequest("/api/v1/communications/conversations/", {
    auth,
    query: { channel: "whatsapp", limit: String(CHATS_LIMIT) },
    schema: paginatedSchema(conversationSchema),
  })
  return page.results
}

/** Сообщения переписки, от старых к новым */
export async function fetchMessages(auth: ApiAuth, conversationId: string): Promise<Message[]> {
  const page = await apiRequest(`/api/v1/communications/conversations/${encodeURIComponent(conversationId)}/messages/`, {
    auth,
    query: { limit: String(MESSAGES_LIMIT) },
    schema: z.object({ results: z.array(messageSchema) }),
  })
  return page.results
}

/** Лимит WhatsApp и backend на одно сообщение */
export const MESSAGE_TEXT_MAX = 4096

/** Сколько страниц сообщений читаем в окне чата; backend отдаёт от старых к новым */
const THREAD_PAGES = 5

/** Сообщения чата с начала. `truncated` — чат длиннее, самые новые не вошли */
export async function fetchThreadMessages(auth: ApiAuth, conversationId: string): Promise<{ messages: Message[]; truncated: boolean }> {
  const messages: Message[] = []
  for (let page = 0; page < THREAD_PAGES; page += 1) {
    const { results } = await apiRequest(`/api/v1/communications/conversations/${encodeURIComponent(conversationId)}/messages/`, {
      auth,
      query: { limit: String(MESSAGES_LIMIT), offset: String(messages.length) },
      schema: z.object({ results: z.array(messageSchema) }),
    })
    messages.push(...results)
    if (results.length < MESSAGES_LIMIT) return { messages, truncated: false }
  }
  return { messages, truncated: true }
}

export function fetchConversation(auth: ApiAuth, id: string): Promise<Conversation> {
  return apiRequest(`/api/v1/communications/conversations/${encodeURIComponent(id)}/`, { auth, schema: conversationSchema })
}

export function sendMessage(auth: ApiAuth, conversationId: string, text: string): Promise<Message> {
  return apiRequest(`/api/v1/communications/conversations/${encodeURIComponent(conversationId)}/messages/`, {
    method: "POST",
    auth,
    body: { text },
    schema: messageSchema,
  })
}

export type ConversationCommand = "assign" | "read" | "close" | "reopen"

/** Команды чата: `assign` берёт его себе, остальные меняют состояние; права проверяет backend */
export function runConversationCommand(auth: ApiAuth, id: string, command: ConversationCommand): Promise<Conversation> {
  return apiRequest(`/api/v1/communications/conversations/${encodeURIComponent(id)}/${command}/`, { method: "POST", auth, schema: conversationSchema })
}

const whatsappConnectionSchema = z.object({ configured: z.boolean(), connected: z.boolean(), state: z.string() })

export type WhatsappConnection = z.infer<typeof whatsappConnectionSchema>

/** `GET /communications/whatsapp/status/` — спрашивает провайдера, поэтому не для частого опроса */
export function fetchWhatsappConnection(auth: ApiAuth): Promise<WhatsappConnection> {
  return apiRequest("/api/v1/communications/whatsapp/status/", { auth, schema: whatsappConnectionSchema })
}

const whatsappQrSchema = z.object({ status: z.enum(["qr", "connected", "unavailable"]), image: z.string().nullable() })

export type WhatsappQr = z.infer<typeof whatsappQrSchema>

/** `GET /communications/whatsapp/qr/` — кто отсканирует код, тот подключит номер; доступ решает backend */
export function fetchWhatsappQr(auth: ApiAuth): Promise<WhatsappQr> {
  return apiRequest("/api/v1/communications/whatsapp/qr/", { auth, schema: whatsappQrSchema })
}

/** Файл или голосовое в чат (multipart); проверки размера и прав — на backend */
export function sendFile(auth: ApiAuth, conversationId: string, form: FormData): Promise<Message> {
  return apiRequest(`/api/v1/communications/conversations/${encodeURIComponent(conversationId)}/messages/`, {
    method: "POST",
    auth,
    body: form,
    schema: messageSchema,
  })
}

/** Передать чат и его лид сотруднику: РОП внутри отдела, директор любому */
export function transferConversation(auth: ApiAuth, id: string, ownerUserId: string): Promise<Conversation> {
  return apiRequest(`/api/v1/communications/conversations/${encodeURIComponent(id)}/transfer/`, {
    method: "POST",
    auth,
    body: { ownerUserId },
    schema: conversationSchema,
  })
}
