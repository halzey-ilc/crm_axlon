import { prospectRoute, routes } from "@/config/routes"
import type { Conversation, Message, WhatsappConnection } from "@/features/communications/api/communications-repository"
import { API_ERROR_MESSAGES, apiErrorMessage, type ApiError } from "@/lib/api/errors"
import { formatDayMonth, formatFullDate, formatTime } from "@/lib/format"

/** Строка панели: подпись времени считает сервер — в браузере «сегодня» могло бы разойтись с разметкой */
export type ChatRow = Conversation & { timeLabel: string | null }

export type ChatList = { chats: readonly ChatRow[]; problem: string | null }

export type ChatPanelState = ChatList & {
  /** `null` — неизвестно: состояние номера не загрузилось, кнопку подключения не показываем */
  connection: WhatsappConnection | null
}

/** Клиент скрыл номер: вместо него приходит служебный идентификатор `…@lid` */
export function chatContact(chat: Conversation): string {
  return chat.externalContactId.endsWith("@lid") ? "Номер скрыт" : chat.externalContactId
}

export function chatTitle(chat: Conversation): string {
  return chat.contactName || chatContact(chat)
}

const RESTRICTED_STATES = new Set(["blocked", "suspended"])

/** Что сказать о номере: `offerConnect` — можно показать QR-код, `warning` — номер ограничен */
export function connectionView(connection: WhatsappConnection | null, canConnect: boolean) {
  const restricted = connection !== null && RESTRICTED_STATES.has(connection.state)
  const waitingForQr = connection !== null && connection.configured && !connection.connected && !restricted
  const empty = (() => {
    if (connection === null || connection.connected) return { title: "Чатов пока нет", description: "Новые обращения из WhatsApp появятся здесь." }
    if (!connection.configured) return { title: "WhatsApp ещё не настроен на сервере", description: "Когда сервер настроят, здесь появится подключение номера." }
    if (restricted) return { title: "WhatsApp не подключён", description: "Номер ограничен. Проверьте его в приложении WhatsApp." }
    return {
      title: "WhatsApp не подключён",
      description: canConnect ? "Отсканируйте QR-код с телефона — новые обращения будут появляться здесь." : "Подключить его может директор или РОП. Новые обращения появятся здесь.",
    }
  })()
  return {
    offerConnect: canConnect && waitingForQr,
    warning: restricted ? "WhatsApp ограничил номер. Остановите отправку и проверьте номер в приложении." : null,
    empty,
  }
}

/** Сегодняшнее сообщение — время, более раннее — дата */
export function chatTimeLabel(lastMessageAt: string | null, now: Date): string | null {
  if (!lastMessageAt) return null
  const isToday = formatFullDate(lastMessageAt) === formatFullDate(now.toISOString())
  return isToday ? formatTime(lastMessageAt) : formatDayMonth(lastMessageAt)
}

export function filterChats<T extends Conversation>(chats: readonly T[], query: string): readonly T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return chats
  return chats.filter((chat) => chatTitle(chat).toLowerCase().includes(needle))
}

/** Новый чат приходит с входящим лидом (`/prospects`; `/leads` — это карточка сделки) */
export function chatHref(chat: Conversation): string | null {
  if (chat.leadId) return prospectRoute(chat.leadId)
  return chat.customerId ? `${routes.clientBase}?client=${encodeURIComponent(chat.customerId)}` : null
}

export type ChatThread = { conversation: Conversation; messages: readonly Message[]; truncated: boolean }

/** Больше сервер не примет: файлы лежат в базе компании */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

/** Коды провайдера; 131047 — у Meta закрылось окно 24 часов после сообщения клиента */
const FAILURE_MESSAGES: Record<string, string> = {
  "131047": "Прошло больше 24 часов с сообщения клиента. Обычным сообщением ответить нельзя.",
  noAccount: "У этого номера нет WhatsApp.",
  suspended: "Отправка временно ограничена.",
}

const ERROR_MESSAGES: Record<string, string> = {
  channel_not_configured: "WhatsApp не подключён.",
  channel_delivery_failed: "WhatsApp не принял сообщение. Текст остался в поле, попробуйте ещё раз.",
  conversation_invalid_state: "Чат закрыт. Откройте его снова, чтобы ответить.",
}

export function chatErrorMessage(error: ApiError): string {
  if (error.code && ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code]
  if (error.kind === "forbidden" && error.code !== "feature_not_in_plan") return "Нет прав на этот чат."
  return error.kind === "validation" ? API_ERROR_MESSAGES.validation : apiErrorMessage(error)
}

/** Адрес файла через BFF: браузер не видит токен, права на файл те же, что на чат */
export function attachmentHref(conversationId: string, messageId: string): string {
  return `/chat-attachments/${encodeURIComponent(conversationId)}/${encodeURIComponent(messageId)}`
}

/** Рядом с файлом метка `[Фото]` не нужна: остаётся только подпись */
export function messageCaption(message: Message): string {
  return message.attachment ? message.text.replace(/^\[[^\]]+\]\s*/, "") : message.text
}

/** Исходящее без автора написано в приложении на телефоне, а не из CRM */
export function messageAuthor(message: Message): string {
  if (message.direction === "inbound") return "Клиент"
  return message.senderUserId ? "Компания" : "С телефона"
}

/** `sent` значит только, что WhatsApp принял сообщение, поэтому «доставлено» не обещаем */
export function messageProblem(message: Message): string | null {
  if (message.status !== "failed") return null
  return (message.failureCode && FAILURE_MESSAGES[message.failureCode]) || "Не доставлено"
}
