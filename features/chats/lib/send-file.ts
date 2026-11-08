import type { ChatActionResult } from "@/features/chats/actions"

const OFFLINE: ChatActionResult = { error: "Нет связи с сервером. Попробуйте ещё раз.", denied: false }

/** Файл идёт через route handler: у Server Action предел запроса 1 МБ */
export async function sendChatFile(conversationId: string, file: File, caption: string, voice: boolean): Promise<ChatActionResult> {
  const form = new FormData()
  form.set("file", file)
  if (caption) form.set("caption", caption)
  if (voice) form.set("voice", "true")
  try {
    const response = await fetch(`/chat-attachments/${encodeURIComponent(conversationId)}`, { method: "POST", body: form })
    return (await response.json()) as ChatActionResult
  } catch {
    return OFFLINE
  }
}
