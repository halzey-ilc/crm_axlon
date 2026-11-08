"use server"

import { z } from "zod"

import { loadChatList, loadConnection } from "@/features/chats/api/chat-panel"
import { chatErrorMessage, type ChatList, type ChatThread } from "@/features/chats/lib/chat-list"
import {
  fetchConversation,
  fetchThreadMessages,
  fetchWhatsappQr,
  MESSAGE_TEXT_MAX,
  runConversationCommand,
  sendMessage,
  transferConversation,
  type ConversationCommand,
  type WhatsappConnection,
  type WhatsappQr,
} from "@/features/communications/api/communications-repository"
import type { ApiAuth } from "@/lib/api/auth-session"
import { ApiError } from "@/lib/api/errors"
import { tryLoad } from "@/lib/api/load"
import { getActionAuth } from "@/lib/auth/token-store"

/** `error` — текст для пользователя; `denied` — отвечать в этом чате нельзя, поле ввода прячем */
export type ChatActionResult = { error: string | null; denied: boolean }

const replySchema = z.string().trim().min(1, "Введите сообщение").max(MESSAGE_TEXT_MAX, `Сообщение — до ${MESSAGE_TEXT_MAX} символов`)

export async function refreshChatsAction(): Promise<ChatList> {
  return loadChatList(await getActionAuth(), new Date())
}

export async function refreshConnectionAction(): Promise<WhatsappConnection | null> {
  return loadConnection(await getActionAuth())
}

/** `error` — QR-кода не будет, опрашивать дальше незачем */
export async function loadWhatsappQrAction(): Promise<{ qr: WhatsappQr; error: null } | { qr: null; error: string }> {
  const result = await tryLoad(async () => fetchWhatsappQr(await getActionAuth()))
  if (result.ok) return { qr: result.data, error: null }
  return { qr: null, error: chatErrorMessage(result.error) }
}

/** Открытый чат считается прочитанным; если сбросить счётчик нельзя, читать это не мешает */
async function loadThread(auth: ApiAuth, id: string): Promise<ChatThread> {
  const [conversation, thread] = await Promise.all([fetchConversation(auth, id), fetchThreadMessages(auth, id)])
  if (conversation.unreadCount === 0) return { conversation, ...thread }
  const read = await tryLoad(() => runConversationCommand(auth, id, "read"))
  return { conversation: read.ok ? read.data : conversation, ...thread }
}

export async function loadChatThreadAction(id: string): Promise<{ thread: ChatThread; error: null } | { thread: null; error: string }> {
  const result = await tryLoad(async () => loadThread(await getActionAuth(), id))
  return result.ok ? { thread: result.data, error: null } : { thread: null, error: chatErrorMessage(result.error) }
}

async function run(operation: () => Promise<unknown>): Promise<ChatActionResult> {
  try {
    await operation()
    return { error: null, denied: false }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    return { error: chatErrorMessage(error), denied: error.kind === "forbidden" }
  }
}

export async function sendChatMessageAction(id: string, text: unknown): Promise<ChatActionResult> {
  const parsed = replySchema.safeParse(text)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте сообщение", denied: false }
  return run(async () => sendMessage(await getActionAuth(), id, parsed.data))
}

export async function transferChatAction(id: string, ownerUserId: string): Promise<ChatActionResult> {
  return run(async () => transferConversation(await getActionAuth(), id, ownerUserId))
}

export async function chatCommandAction(id: string, command: Exclude<ConversationCommand, "read">): Promise<ChatActionResult> {
  return run(async () => runConversationCommand(await getActionAuth(), id, command))
}
