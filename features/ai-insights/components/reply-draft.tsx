"use client"

import { ClipboardPaste } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getReplySuggestionAction, requestReplySuggestionAction } from "@/features/ai-insights/actions"
import type { ReplySuggestion } from "@/features/ai-insights/api/ai-insights"
import { AiNotes, AiRunButton } from "@/features/ai-insights/components/ai-parts"
import { useAiJob } from "@/features/ai-insights/components/use-ai-job"

/** Черновик ответа клиенту: только вставляется в поле. Отправляет всегда человек */
export function ReplyDraft({ conversationId, onInsert }: { conversationId: string; onInsert: (text: string) => void }) {
  const { job, failure, isWaitingTooLong, isBusy, start } = useAiJob<ReplySuggestion>(
    null,
    () => requestReplySuggestionAction(conversationId),
    () => getReplySuggestionAction(conversationId)
  )
  const result = job?.status === "succeeded" ? job.result : null
  return (
    <div className="space-y-1.5">
      {result?.needsHuman && <p className="text-meta font-medium text-warning">Ответьте лично: нужны факты или решение, которых нет в переписке.</p>}
      {result && !result.draftReply && <p className="text-meta text-muted-foreground">ИИ не смог подготовить безопасный черновик.</p>}
      {result?.draftReply && (
        <div className="space-y-1.5 rounded-lg bg-muted/40 p-2">
          <p className="text-sm whitespace-pre-line">{result.draftReply}</p>
          <Button type="button" size="xs" variant="outline" onClick={() => onInsert(result.draftReply ?? "")}>
            <ClipboardPaste data-icon="inline-start" aria-hidden />
            Вставить в поле
          </Button>
        </div>
      )}
      <AiNotes failure={failure} failed={job?.status === "failed"} isWaitingTooLong={isWaitingTooLong} />
      <AiRunButton label="Предложить ответ" isBusy={isBusy} onClick={start} />
    </div>
  )
}
