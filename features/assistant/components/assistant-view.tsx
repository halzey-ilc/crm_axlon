import { PageHeader } from "@/components/shared/page-header"
import { DemoNotice } from "@/components/shared/demo-notice"
import { isMockDataSource } from "@/config/env"
import { fetchAiAvailable, type AiReportKind } from "@/features/ai-insights/api/ai-insights"
import { AiReports } from "@/features/ai-insights/components/ai-reports"
import { getAssistantRunAction } from "@/features/assistant/actions"
import { AssistantChat } from "@/features/assistant/components/assistant-chat"
import { hasPermission, type Role } from "@/lib/permissions/roles"
import { getParam, type SearchParamsRecord } from "@/lib/search-params"

/** Какие отчёты показать: те, что разрешены роли на backend (риски — только директору) */
function reportsFor(role: Role): AiReportKind[] {
  return [
    "digest",
    ...(hasPermission(role, "analytics.view") ? (["kpi"] as const) : []),
    ...(hasPermission(role, "company.view") ? (["risk"] as const) : []),
  ]
}

/** «ИИ-помощник»: вопрос на естественном языке и действия, которые выполняются только по подтверждению */
export async function AssistantView({ params, role }: { params: SearchParamsRecord; role: Role }) {
  const runId = getParam(params, "run")
  const loaded = runId && !isMockDataSource ? await getAssistantRunAction(runId) : null
  const aiAvailable = !isMockDataSource && (await fetchAiAvailable())

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="ИИ-помощник"
        description="Опишите задачу своими словами — помощник предложит действия в CRM. Числа и отчёты считает система, а не ИИ."
      />
      {isMockDataSource && <DemoNotice>Демо-режим: ИИ-помощник работает только с подключённым сервером.</DemoNotice>}
      <AssistantChat
        key={runId ?? "new"}
        initialRun={loaded?.ok ? loaded.data : null}
        initialError={loaded && !loaded.ok ? loaded.message : null}
      />
      {aiAvailable && <AiReports kinds={reportsFor(role)} />}
    </div>
  )
}
