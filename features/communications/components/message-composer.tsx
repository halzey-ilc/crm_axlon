"use client"

import { useState } from "react"
import { Check, Copy, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ReplyDraft } from "@/features/ai-insights/components/reply-draft"
import type { MessageTemplate } from "@/features/communications/api/communications-repository"

type MessageComposerProps = {
  conversationId: string
  templates: readonly Pick<MessageTemplate, "id" | "title" | "body">[]
  /** Почему отправка из CRM недоступна. null — канал подключён (отправка из карточки пока не реализована) */
  sendBlockedReason: string | null
  /** Показывать черновик ИИ: модель подключена и у роли есть право */
  aiAvailable?: boolean
}

/**
 * Поле ответа с шаблонами. Пока у канала нет провайдера, отправка выключена:
 * текст можно собрать из шаблона и скопировать, чтобы отправить в приложении мессенджера.
 */
export function MessageComposer({ conversationId, templates, sendBlockedReason, aiAvailable = false }: MessageComposerProps) {
  const [text, setText] = useState("")
  const [copied, setCopied] = useState(false)
  const textId = `composer-${conversationId}`

  function insertTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId)
    if (!template) return
    setText((current) => (current.trim() ? `${current.trimEnd()}\n${template.body}` : template.body))
    setCopied(false)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Label htmlFor={textId}>Ответ</Label>
        {templates.length > 0 && (
          <select
            aria-label="Вставить шаблон"
            value=""
            onChange={(event) => insertTemplate(event.target.value)}
            className="h-7 max-w-56 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Вставить шаблон…</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {aiAvailable && (
        <ReplyDraft
          conversationId={conversationId}
          onInsert={(draft) => {
            setText(draft)
            setCopied(false)
          }}
        />
      )}
      <Textarea
        id={textId}
        rows={3}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setCopied(false)
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {/* Отправка из CRM ещё не подключена ни к одному провайдеру — кнопка только объясняет почему */}
        {sendBlockedReason && (
          <Button size="sm" disabled title={sendBlockedReason}>
            <Send data-icon="inline-start" aria-hidden />
            Отправить
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={copy} disabled={!text.trim()}>
          {copied ? <Check data-icon="inline-start" aria-hidden /> : <Copy data-icon="inline-start" aria-hidden />}
          {copied ? "Скопировано" : "Скопировать"}
        </Button>
        {sendBlockedReason && <span className="text-meta text-muted-foreground">{sendBlockedReason}</span>}
      </div>
    </div>
  )
}
