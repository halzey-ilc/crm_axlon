import { NextResponse } from "next/server"

import { isMockDataSource } from "@/config/env"
import type { ChatActionResult } from "@/features/chats/actions"
import { chatErrorMessage, MAX_FILE_BYTES } from "@/features/chats/lib/chat-list"
import { sendFile } from "@/features/communications/api/communications-repository"
import { ApiError } from "@/lib/api/errors"
import { getActionAuth } from "@/lib/auth/token-store"

function reply(body: ChatActionResult, status = 200) {
  return NextResponse.json(body, { status })
}

const refuse = (error: string) => reply({ error, denied: false }, 400)

/** Файл или голосовое в чат через BFF. Server Action не подходит: его предел запроса 1 МБ */
export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  if (isMockDataSource) return refuse("В демо-режиме файлы не отправляются.")
  const { conversationId } = await params
  const received = await request.formData().catch(() => null)
  const file = received?.get("file")
  if (!(file instanceof File)) return refuse("Не удалось прочитать файл. Попробуйте ещё раз.")
  if (file.size > MAX_FILE_BYTES) return refuse("Файл больше 20 МБ.")

  const form = new FormData()
  form.set("file", file, file.name)
  const caption = received?.get("caption")
  if (typeof caption === "string" && caption) form.set("caption", caption)
  if (received?.get("voice") === "true") form.set("voice", "true")
  try {
    await sendFile(await getActionAuth(), conversationId, form)
    return reply({ error: null, denied: false })
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    return reply({ error: chatErrorMessage(error), denied: error.kind === "forbidden" }, error.status ?? 502)
  }
}
