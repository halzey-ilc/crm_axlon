import { ApiErrorState } from "@/components/shared/api-error-state"
import { fetchAiAvailable, fetchCallAnalysis, fetchCallSummary, fetchDealBrief } from "@/features/ai-insights/api/ai-insights"
import { CallAiAnalysis } from "@/features/ai-insights/components/call-ai-analysis"
import { CallAiSummary } from "@/features/ai-insights/components/call-ai-summary"
import { DealAiBrief } from "@/features/ai-insights/components/deal-ai-brief"
import { tryLoad } from "@/lib/api/load"
import { getRenderAuth } from "@/lib/auth/token-store"

/**
 * Блоки ИИ в карточке звонка: оценка записи (расшифровка, чек-лист, балл) и резюме. Когда ИИ не
 * подключён, тарифом не разрешён или нет права — их нет
 */
export async function CallAiSection({ callId, hasRecording = false }: { callId: string; hasRecording?: boolean }) {
  if (!(await fetchAiAvailable())) return null
  const auth = await getRenderAuth()
  const [latest, analysis] = await Promise.all([tryLoad(() => fetchCallSummary(auth, callId)), tryLoad(() => fetchCallAnalysis(auth, callId))])
  if (!latest.ok) return <ApiErrorState error={latest.error} bare />
  const initialAnalysis = analysis.ok ? analysis.data : null
  return (
    <div className="space-y-3">
      {(hasRecording || initialAnalysis) && <CallAiAnalysis callId={callId} initial={initialAnalysis} />}
      <CallAiSummary callId={callId} initial={latest.data} />
    </div>
  )
}

/** Блок «Что по сделке?»; условия те же */
export async function DealAiSection({ dealId }: { dealId: string }) {
  if (!(await fetchAiAvailable())) return null
  const latest = await tryLoad(async () => fetchDealBrief(await getRenderAuth(), dealId))
  if (!latest.ok) return <ApiErrorState error={latest.error} bare />
  return <DealAiBrief dealId={dealId} initial={latest.data} />
}
