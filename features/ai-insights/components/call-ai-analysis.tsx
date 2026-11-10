"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

import { StatusBadge, type StatusTone } from "@/components/shared/status-badge"
import { getCallAnalysisAction, requestCallAnalysisAction } from "@/features/ai-insights/actions"
import type { CallAnalysis } from "@/features/ai-insights/api/ai-insights"
import { AI_DISCLAIMER, AiHeading, AiNotes, AiRunButton } from "@/features/ai-insights/components/ai-parts"
import { useAiJob } from "@/features/ai-insights/components/use-ai-job"

const STAGE: Partial<Record<CallAnalysis["status"], string>> = {
  pending: "Запись получена, готовлю расшифровку…",
  transcribing: "Расшифровываю разговор…",
  reviewing: "Оцениваю звонок по чек-листу…",
}

type VerdictStatus = NonNullable<CallAnalysis["review"]>["criteria"][number]["status"]

const VERDICT: Record<VerdictStatus, { label: string; tone: StatusTone }> = {
  met: { label: "Выполнено", tone: "success" },
  partial: { label: "Частично", tone: "warning" },
  missed: { label: "Пропущено", tone: "danger" },
  not_applicable: { label: "Не к месту", tone: "neutral" },
}

const SPEAKER = { manager: "Менеджер", customer: "Клиент", unknown: "Собеседник" } as const

export function scoreTone(score: number): StatusTone {
  if (score >= 75) return "success"
  if (score >= 50) return "warning"
  return "danger"
}

/**
 * Разбор записанного звонка из АТС: расшифровка с подписями сторон, оценка по чек-листу компании
 * с цитатами и балл. Балл считает CRM по статусам пунктов, а не модель.
 */
export function CallAiAnalysis({ callId, initial }: { callId: string; initial: CallAnalysis | null }) {
  const [language, setLanguage] = useState<"ru" | "ky">(initial?.language === "ru" ? "ky" : "ru")
  const { job, failure, isWaitingTooLong, isBusy, start } = useAiJob<CallAnalysis>(
    initial,
    () => requestCallAnalysisAction(callId, language),
    () => getCallAnalysisAction(callId)
  )
  const [showTranscript, setShowTranscript] = useState(false)
  const done = job?.status === "succeeded" ? job : null
  const review = done?.review ?? null

  return (
    <section aria-label="Оценка звонка" className="space-y-3 rounded-lg bg-primary/6 p-3 ring-1 ring-primary/15">
      <div className="flex items-start justify-between gap-2">
        <AiHeading title="Оценка звонка" at={job?.finishedAt ?? null} isMock={job?.isMock ?? false} />
        {done?.score !== null && done?.score !== undefined && <StatusBadge tone={scoreTone(done.score)}>{done.score} / 100</StatusBadge>}
      </div>
      {job && STAGE[job.status] && <p className="text-meta text-muted-foreground">{STAGE[job.status]}</p>}
      {done?.draft && <p className="text-meta text-warning">Кыргызская расшифровка черновая: модель речи ещё не проверена носителем языка.</p>}
      {done && done.segments.length === 0 && <p className="text-meta text-muted-foreground">В записи не найдено речи.</p>}
      {review && !review.insufficientData && (
        <>
          <ul className="space-y-2">
            {review.criteria.map((verdict) => (
              <li key={verdict.code} className="space-y-0.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{verdict.title}</span>
                  <StatusBadge tone={VERDICT[verdict.status].tone}>{VERDICT[verdict.status].label}</StatusBadge>
                </div>
                {verdict.evidence && <p className="text-xs text-muted-foreground italic">«{verdict.evidence.quote}»</p>}
                {verdict.comment && verdict.comment !== "—" && <p className="text-xs text-muted-foreground">{verdict.comment}</p>}
              </li>
            ))}
          </ul>
          {review.strengths.length > 0 && <p className="text-meta">Хорошо: {review.strengths.join(" ")}</p>}
          {review.improvements.length > 0 && <p className="text-meta text-warning">Совет: {review.improvements.join(" ")}</p>}
          <p className="text-xs text-muted-foreground">{AI_DISCLAIMER}</p>
        </>
      )}
      {review?.insufficientData && <p className="text-meta text-muted-foreground">Разговор слишком короткий для оценки.</p>}
      {done && done.segments.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowTranscript((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-primary">
            <ChevronDown className={`size-3.5 transition-transform ${showTranscript ? "rotate-180" : ""}`} aria-hidden />
            {showTranscript ? "Скрыть расшифровку" : "Показать расшифровку"}
          </button>
          {showTranscript && (
            <ol className="mt-2 max-h-80 space-y-1 overflow-y-auto text-sm">
              {done.segments.map((segment) => (
                <li key={segment.id}>
                  <span className="font-medium">{SPEAKER[segment.speaker]}:</span> {segment.text}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-1 text-xs text-muted-foreground">Машинная расшифровка, возможны ошибки.</p>
        </div>
      )}
      {job?.status === "failed" && job.errorCode === "no_recording" && (
        <p className="text-meta text-muted-foreground">Запись звонка недоступна в АТС.</p>
      )}
      <AiNotes failure={failure} failed={job?.status === "failed" && job.errorCode !== "no_recording"} isWaitingTooLong={isWaitingTooLong} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Язык разговора"
          value={language}
          onChange={(event) => setLanguage(event.target.value as "ru" | "ky")}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
          disabled={isBusy}
        >
          <option value="ru">Русский</option>
          <option value="ky">Кыргызский</option>
        </select>
        <AiRunButton label={job ? "Разобрать заново" : "Разобрать запись"} isBusy={isBusy} onClick={start} />
      </div>
    </section>
  )
}
