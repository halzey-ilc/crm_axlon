import { MessagesSquare } from "lucide-react"

import { ApiErrorState } from "@/components/shared/api-error-state"
import { EmptyState } from "@/components/shared/empty-state"
import { StatusBadge } from "@/components/shared/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { isMockDataSource } from "@/config/env"
import { fetchAiAvailable } from "@/features/ai-insights/api/ai-insights"
import {
  CHANNEL_LABELS,
  fetchChannels,
  fetchCustomerConversations,
  fetchMessages,
  fetchTemplates,
  type ChannelState,
  type Conversation,
  type Message,
  type MessageTemplate,
} from "@/features/communications/api/communications-repository"
import { MessageComposer } from "@/features/communications/components/message-composer"
import type { ApiAuth } from "@/lib/api/auth-session"
import { tryLoad } from "@/lib/api/load"
import { getRenderAuth } from "@/lib/auth/token-store"
import { formatDateTime, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

const NOT_CONNECTED = "Канал не подключён: отправка из CRM недоступна, нужны данные провайдера."

function sendBlockedReason(states: readonly ChannelState[], conversation: Conversation): string | null {
  const state = states.find((item) => item.channel === conversation.channel)
  return state?.canSend ? null : NOT_CONNECTED
}

async function loadThreads(auth: ApiAuth, conversations: readonly Conversation[]) {
  return Promise.all(conversations.map(async (conversation) => ({ conversation, messages: await tryLoad(() => fetchMessages(auth, conversation.id)) })))
}

/**
 * Вкладка «Переписка» в карточке клиента: диалоги из мессенджеров, привязанные к клиенту.
 * Видимость (менеджер — свои диалоги, РОП — отдел) решает backend.
 */
export async function ClientConversations({ customerId }: { customerId: string }) {
  if (isMockDataSource) {
    return <EmptyState icon={MessagesSquare} title="Переписка хранится на сервере" description="В демо-режиме диалогов нет." />
  }
  const auth = await getRenderAuth()
  const [conversations, templates, channels, aiAvailable] = await Promise.all([
    tryLoad(() => fetchCustomerConversations(auth, customerId)),
    tryLoad(() => fetchTemplates(auth)),
    tryLoad(() => fetchChannels(auth)),
    fetchAiAvailable(),
  ])
  if (!conversations.ok) return <ApiErrorState error={conversations.error} bare />
  if (conversations.data.items.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="Переписки с клиентом нет"
        description="Диалоги появятся, когда клиент напишет в подключённый мессенджер и диалог привяжут к карточке."
      />
    )
  }
  const threads = await loadThreads(auth, conversations.data.items)
  const templateList = templates.ok ? templates.data : []
  const channelStates = channels.ok ? channels.data : []

  return (
    <div className="space-y-4">
      {threads.map(({ conversation, messages }, index) => (
        <details key={conversation.id} open={index === 0} className="rounded-lg border">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="font-medium">{CHANNEL_LABELS[conversation.channel]}</span>
            {conversation.contactName && <span className="text-muted-foreground">{conversation.contactName}</span>}
            <StatusBadge tone={conversation.status === "open" ? "info" : "neutral"}>{conversation.status === "open" ? "Открыт" : "Закрыт"}</StatusBadge>
            {conversation.unreadCount > 0 && <StatusBadge tone="warning">непрочитанных {formatNumber(conversation.unreadCount)}</StatusBadge>}
            {conversation.lastMessageAt && <span className="text-meta ml-auto text-muted-foreground">{formatDateTime(conversation.lastMessageAt)}</span>}
          </summary>
          <div className="space-y-3 px-3 pb-3">
            {messages.ok ? <MessageList messages={messages.data} /> : <ApiErrorState error={messages.error} bare />}
            <MessageComposer
              conversationId={conversation.id}
              templates={pickTemplates(templateList)}
              sendBlockedReason={sendBlockedReason(channelStates, conversation)}
              aiAvailable={aiAvailable}
            />
          </div>
        </details>
      ))}
      {conversations.data.total > threads.length && (
        <p className="text-meta text-muted-foreground">
          Показаны последние {formatNumber(threads.length)} диалогов из {formatNumber(conversations.data.total)}.
        </p>
      )}
    </div>
  )
}

/** В клиентский компонент передаём только нужные поля */
function pickTemplates(templates: readonly MessageTemplate[]) {
  return templates.map(({ id, title, body }) => ({ id, title, body }))
}

const MESSAGE_STATUS: Partial<Record<Message["status"], string>> = {
  pending: "отправляется",
  failed: "не доставлено",
}

function MessageList({ messages }: { messages: readonly Message[] }) {
  if (messages.length === 0) return <p className="text-meta text-muted-foreground">Сообщений нет.</p>
  return (
    <ol className="max-h-96 space-y-2 overflow-y-auto">
      {messages.map((message) => {
        const isOutbound = message.direction === "outbound"
        return (
          <li key={message.id} className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm", isOutbound ? "bg-primary/10" : "bg-muted")}>
              <p className="whitespace-pre-wrap break-words">{message.text}</p>
              <p className="text-meta mt-1 text-muted-foreground">
                {isOutbound ? "Компания" : "Клиент"} · {formatDateTime(message.createdAt)}
                {MESSAGE_STATUS[message.status] && ` · ${MESSAGE_STATUS[message.status]}`}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function ClientConversationsSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  )
}
