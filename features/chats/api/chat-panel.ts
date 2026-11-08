import { chatTimeLabel, type ChatList, type ChatPanelState } from "@/features/chats/lib/chat-list"
import { fetchWhatsappChats, fetchWhatsappConnection, type WhatsappConnection } from "@/features/communications/api/communications-repository"
import type { ApiAuth } from "@/lib/api/auth-session"
import { apiErrorMessage } from "@/lib/api/errors"
import { tryLoad } from "@/lib/api/load"

/** Список чатов: и для первой отрисовки, и для опроса из браузера */
export async function loadChatList(auth: ApiAuth, now: Date): Promise<ChatList> {
  const chats = await tryLoad(() => fetchWhatsappChats(auth))
  if (!chats.ok) return { chats: [], problem: apiErrorMessage(chats.error) }
  return { chats: chats.data.map((chat) => ({ ...chat, timeLabel: chatTimeLabel(chat.lastMessageAt, now) })), problem: null }
}

/** `null` — состояние неизвестно; панель работает и без него */
export async function loadConnection(auth: ApiAuth): Promise<WhatsappConnection | null> {
  const connection = await tryLoad(() => fetchWhatsappConnection(auth))
  return connection.ok ? connection.data : null
}

export async function loadChatPanel(auth: ApiAuth, now: Date): Promise<ChatPanelState> {
  const [list, connection] = await Promise.all([loadChatList(auth, now), loadConnection(auth)])
  return { ...list, connection }
}
