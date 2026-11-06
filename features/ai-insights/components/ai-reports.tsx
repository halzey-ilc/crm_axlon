"use client"

import { ArrowRight } from "lucide-react"

import { getAiReportAction, requestAiReportAction } from "@/features/ai-insights/actions"
import type { AiReport, AiReportKind } from "@/features/ai-insights/api/ai-insights"
import { AI_DISCLAIMER, AiHeading, AiNotes, AiRunButton } from "@/features/ai-insights/components/ai-parts"
import { useAiJob } from "@/features/ai-insights/components/use-ai-job"

const REPORTS: Record<AiReportKind, { title: string; run: string; empty: string }> = {
  kpi: { title: "Объяснение KPI", run: "Объяснить показатели месяца", empty: "За этот месяц пока нет показателей." },
  digest: { title: "Сводка нарушений", run: "Подготовить сводку", empty: "Нарушений нет: просроченных и забытых дел не найдено." },
  risk: { title: "Обзор рисков", run: "Разобрать риски", empty: "Сигналов риска нет." },
}

function points(result: NonNullable<AiReport["result"]>): string[] {
  return [...result.items, ...result.observations, ...result.recommendations, ...result.checks].map((point) => point.text)
}

function ReportBlock({ kind }: { kind: AiReportKind }) {
  const meta = REPORTS[kind]
  const { job, failure, isWaitingTooLong, isBusy, start } = useAiJob<AiReport>(
    null,
    () => requestAiReportAction(kind),
    () => getAiReportAction(kind)
  )
  const result = job?.status === "succeeded" ? job.result : null
  return (
    <section aria-label={meta.title} className="space-y-2 rounded-lg p-3 ring-1 ring-border">
      <AiHeading title={meta.title} at={job?.finishedAt ?? null} isMock={job?.isMock ?? false} />
      {result?.insufficientData && <p className="text-meta text-muted-foreground">{meta.empty}</p>}
      {result && !result.insufficientData && (
        <>
          <p className="text-sm">{result.headline}</p>
          <ul className="space-y-1">
            {points(result).map((text) => (
              <li key={text} className="flex items-start gap-2 text-meta text-muted-foreground">
                <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary/80" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{AI_DISCLAIMER}</p>
        </>
      )}
      <AiNotes failure={failure} failed={job?.status === "failed"} isWaitingTooLong={isWaitingTooLong} />
      <AiRunButton label={meta.run} isBusy={isBusy} onClick={start} />
    </section>
  )
}

/** Готовые отчёты ИИ рядом с помощником; цифры в них считает CRM, модель только объясняет */
export function AiReports({ kinds }: { kinds: readonly AiReportKind[] }) {
  if (kinds.length === 0) return null
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {kinds.map((kind) => (
        <ReportBlock key={kind} kind={kind} />
      ))}
    </div>
  )
}
