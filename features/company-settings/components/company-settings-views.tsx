import Link from "next/link"
import { CircleCheck, Circle, ClipboardList, History, Settings } from "lucide-react"

import { ApiErrorState } from "@/components/shared/api-error-state"
import { EmptyState } from "@/components/shared/empty-state"
import { FilterSelect } from "@/components/shared/filter-select"
import { ListPanel } from "@/components/shared/list-panel"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationNav } from "@/components/shared/pagination-nav"
import { buttonVariants } from "@/components/ui/button"
import { isMockDataSource } from "@/config/env"
import { departmentRoute, leadRoute, routes } from "@/config/routes"
import {
  fetchAuditJournal,
  fetchCompanySettings,
  fetchJournalPeople,
  fetchSetupFacts,
  type JournalEntry,
} from "@/features/company-settings/api/company-settings"
import { fetchCallChecklist, fetchSipuniSettings } from "@/features/company-settings/api/telephony"
import { CompanySettingsForm } from "@/features/company-settings/components/company-settings-form"
import { JournalDateFilter } from "@/features/company-settings/components/journal-date-filter"
import { CallChecklistForm, SipuniSettingsForm } from "@/features/company-settings/components/telephony-settings"
import { actionLabel, AUDIT_SECTIONS, ownerChange, resourceLabel } from "@/features/company-settings/lib/audit-labels"
import { AUDIT_JOURNAL_ROUTE, COMPANY_SETTINGS_ROUTE } from "@/features/company-settings/lib/routes"
import { setupSteps, type SetupStepKey } from "@/features/company-settings/lib/setup-checklist"
import { pageInfo, pageParams } from "@/lib/api/pagination"
import { tryLoad } from "@/lib/api/load"
import { getRenderAuth } from "@/lib/auth/token-store"
import { nowIso } from "@/lib/clock"
import { companyDateOf } from "@/lib/datetime"
import { formatDateTime } from "@/lib/format"
import { getPageParam, getParam, hrefWithParams, type SearchParamsRecord } from "@/lib/search-params"

const API_ONLY = (
  <ListPanel>
    <EmptyState
      icon={Settings}
      title="Раздел работает только с сервером"
      description="В демо-режиме настроек компании и журнала изменений нет. Запустите интерфейс с NEXT_PUBLIC_DATA_SOURCE=api."
    />
  </ListPanel>
)

// --- настройки компании ---------------------------------------------------------------------

export async function CompanySettingsView() {
  const header = (
    <PageHeader
      title="Настройки компании"
      description="Общие параметры: от часового пояса зависят границы дня и месяца в отчётах, от валюты — суммы новых сделок."
      actions={
        <Link href={AUDIT_JOURNAL_ROUTE} className={buttonVariants({ variant: "outline", size: "sm" })}>
          <History data-icon="inline-start" aria-hidden />
          Журнал изменений
        </Link>
      }
    />
  )
  if (isMockDataSource) {
    return (
      <div className="space-y-4">
        {header}
        {API_ONLY}
      </div>
    )
  }
  const loaded = await tryLoad(async () => fetchCompanySettings(await getRenderAuth()))
  return (
    <div className="space-y-4">
      {header}
      {loaded.ok ? (
        <section className="rounded-xl bg-card p-4 ring-1 ring-border sm:p-6">
          <CompanySettingsForm settings={loaded.data} />
        </section>
      ) : (
        <ApiErrorState error={loaded.error} />
      )}
      <TelephonySection />
    </div>
  )
}

/** Телефония и чек-лист оценки звонков — у директора; другим ролям блока нет */
async function TelephonySection() {
  const auth = await getRenderAuth()
  const [sipuni, people, checklist] = await Promise.all([
    tryLoad(() => fetchSipuniSettings(auth)),
    tryLoad(() => fetchJournalPeople(auth)),
    tryLoad(() => fetchCallChecklist(auth)),
  ])
  if (sipuni.ok && sipuni.data === "forbidden") return null
  return (
    <>
      <section className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-border sm:p-6">
        <div>
          <h2 className="text-base font-semibold">Телефония: Sipuni</h2>
          <p className="text-meta text-muted-foreground">
            Звонки компании попадают в CRM сами, привязываются к клиенту и менеджеру, а ИИ расшифровывает и оценивает разговор.
          </p>
        </div>
        {sipuni.ok ? (
          <SipuniSettingsForm settings={sipuni.data === "forbidden" ? null : sipuni.data} people={people.ok ? people.data : []} />
        ) : (
          <ApiErrorState error={sipuni.error} bare />
        )}
      </section>
      {checklist.ok && (
        <section className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-border sm:p-6">
          <div>
            <h2 className="text-base font-semibold">Чек-лист оценки звонков</h2>
            <p className="text-meta text-muted-foreground">По этим пунктам ИИ проверяет каждый звонок менеджера; балл считает CRM.</p>
          </div>
          <CallChecklistForm initial={checklist.data} />
        </section>
      )}
    </>
  )
}

// --- чек-лист запуска -----------------------------------------------------------------------

const STEP_LINKS: Record<SetupStepKey, string> = {
  department: routes.staff,
  head: routes.staffNew,
  managers: routes.staff,
  plan: routes.company,
}

/**
 * Первые шаги директора на странице «Компания». Когда всё сделано, блок исчезает;
 * при ошибке загрузки тоже не показывается — это подсказка, а не часть рабочего экрана.
 */
export async function CompanySetupChecklist() {
  if (isMockDataSource) return null
  const loaded = await tryLoad(async () => fetchSetupFacts(await getRenderAuth(), companyDateOf(nowIso()).slice(0, 7)))
  if (!loaded.ok) return null
  const steps = setupSteps(loaded.data)
  const left = steps.filter((step) => !step.done).length
  if (left === 0) return null
  return (
    <section aria-labelledby="setup-checklist" className="mb-4 space-y-3 rounded-xl bg-card p-4 ring-1 ring-border">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h2 id="setup-checklist" className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="size-4 text-primary" aria-hidden />
            Запуск компании в CRM
          </h2>
          <p className="text-meta text-muted-foreground">
            Сделано {steps.length - left} из {steps.length}. Проверьте также{" "}
            <Link href={COMPANY_SETTINGS_ROUTE} className="text-primary underline-offset-4 hover:underline">
              валюту и часовой пояс
            </Link>
            .
          </p>
        </div>
      </div>
      <ol className="grid gap-1.5 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2 text-sm">
            {step.done ? (
              <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            {step.done ? (
              <span className="text-muted-foreground line-through">{step.title}</span>
            ) : (
              <Link href={STEP_LINKS[step.key]} className="underline-offset-4 hover:underline">
                {step.title}
              </Link>
            )}
            <span className="sr-only">{step.done ? "— выполнено" : "— не выполнено"}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

// --- журнал изменений -----------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/

function recordHref(entry: JournalEntry): string | null {
  if (entry.action.startsWith("lead.")) return leadRoute(entry.resourceId)
  if (entry.action.startsWith("department.")) return departmentRoute(entry.resourceId)
  return null
}

export async function AuditJournalView({ params, scopeHint }: { params: SearchParamsRecord; scopeHint: string }) {
  const header = <PageHeader title="Журнал изменений" description={scopeHint} />
  if (isMockDataSource) {
    return (
      <div className="space-y-4">
        {header}
        {API_ONLY}
      </div>
    )
  }
  const section = getParam(params, "section")
  const dateFrom = getParam(params, "from")
  const dateTo = getParam(params, "to")
  const page = pageParams(getPageParam(params))
  const filters = {
    actorId: getParam(params, "actor"),
    action: section && (AUDIT_SECTIONS as readonly string[]).includes(section) ? `${section}.` : null,
    dateFrom: dateFrom && DATE.test(dateFrom) ? dateFrom : null,
    dateTo: dateTo && DATE.test(dateTo) ? dateTo : null,
  }
  const loaded = await tryLoad(async () => {
    const auth = await getRenderAuth()
    return Promise.all([fetchAuditJournal(auth, filters, page), fetchJournalPeople(auth)])
  })
  if (!loaded.ok) {
    return (
      <div className="space-y-4">
        {header}
        <ApiErrorState error={loaded.error} />
      </div>
    )
  }
  const [journal, people] = loaded.data
  const names = new Map(people.map((person) => [person.userId, person.fullName]))
  const nameOf = (userId: string) => names.get(userId) ?? "сотрудник вне вашего отдела"

  return (
    <div className="space-y-4">
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Кто"
          param="actor"
          allLabel="Все сотрудники"
          options={people.map((person) => ({ value: person.userId, label: person.fullName }))}
        />
        <FilterSelect
          label="Раздел"
          param="section"
          allLabel="Все разделы"
          options={AUDIT_SECTIONS.map((value) => ({ value, label: resourceLabel(value) }))}
        />
        <JournalDateFilter label="С даты" param="from" />
        <JournalDateFilter label="По дату" param="to" />
      </div>
      <ListPanel>
        {journal.results.length === 0 ? (
          <EmptyState icon={History} title="Записей нет" description="За выбранный период и с этими фильтрами изменений не найдено." />
        ) : (
          <ul className="divide-y">
            {journal.results.map((entry) => {
              const href = recordHref(entry)
              const owner = ownerChange(entry.details)
              return (
                <li key={entry.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                  <time dateTime={entry.occurredAt} className="text-meta text-muted-foreground tabular-nums">
                    {formatDateTime(entry.occurredAt)}
                  </time>
                  <div className="min-w-0 space-y-0.5">
                    <p>
                      <span className="font-medium">{entry.actor?.name ?? "Система"}</span>
                      {" · "}
                      {href ? (
                        <Link href={href} className="text-primary underline-offset-4 hover:underline">
                          {actionLabel(entry.action)}
                        </Link>
                      ) : (
                        actionLabel(entry.action)
                      )}
                    </p>
                    {owner && (
                      <p className="text-meta text-muted-foreground">
                        Ответственный: {nameOf(owner.from)} → {nameOf(owner.to)}
                      </p>
                    )}
                    {entry.changedFields.length > 0 && (
                      <p className="text-meta text-muted-foreground">Изменённые поля: {entry.changedFields.join(", ")}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </ListPanel>
      <PaginationNav
        info={pageInfo(journal.count, page)}
        hrefForPage={(next) => hrefWithParams(AUDIT_JOURNAL_ROUTE, params, { page: String(next) })}
      />
    </div>
  )
}
