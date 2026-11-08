import { NextResponse } from "next/server"

import { apiDownload } from "@/lib/api/client"
import { ApiError, apiErrorMessage } from "@/lib/api/errors"
import { getActionAuth } from "@/lib/auth/token-store"

/**
 * Файл из чата через BFF: браузер не видит токен, кто может его открыть — решает backend
 * (тот, кто видит чат). Фото и голосовые показываются в окне чата, документы скачиваются.
 */
export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string; messageId: string }> }) {
  const { conversationId, messageId } = await params
  const download = new URL(request.url).searchParams.get("download") === "1"
  const path = `/api/v1/communications/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/attachment/`
  try {
    const file = await apiDownload(path, { auth: await getActionAuth() })
    const filename = encodeURIComponent(file.filename ?? "file")
    return new NextResponse(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Файл прислал посторонний человек: никакие скрипты внутри него не выполняются
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    })
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    return new NextResponse(apiErrorMessage(error), { status: error.status ?? 502, headers: { "Content-Type": "text/plain; charset=utf-8" } })
  }
}
