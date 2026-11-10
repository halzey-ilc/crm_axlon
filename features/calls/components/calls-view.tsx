import Link from "next/link"
import { PhoneOff } from "lucide-react"

import { ApiErrorState } from "@/components/shared/api-error-state"
import { EmptyState } from "@/components/shared/empty-state"
import { FilterSelect } from "@/components/shared/filter-select"
import { ListGroup, ListPanel } from "@/components/shared/list-panel"
import { PaginationNav } from "@/components/shared/pagination-nav"
import { SearchInput } from "@/components/shared/search-input"
import { SegmentedLinks } from "@/components/shared/segmented-links"
import { Toolbar } from "@/components/shared/toolbar"
import { UrlSheet } from "@/components/shared/url-sheet"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { isMockDataSource } from "@/config/env"
import { routes } from "@/config/routes"
import { CallAiSection } from "@/features/ai-insights"
import { callsRepository, type CallsQuery } from "@/features/calls/api/calls-repository"
import {
  CallAnalysis,
  CallDirectionIcon,
  CallFacts,
  CallRating,
  CallTranscript,
  callTitle,
  RatingStars,
} from "@/features/calls/components/call-parts"
import type { Call } from "@/features/calls/schemas"
import { CallDateFilter } from "@/features/calls/components/call-date-filter"
import { CallLinkForm } from "@/features/calls/components/call-link-form"
import { LogCallButton } from "@/features/calls/components/log-call-button"
import { teamRepository } from "@/features/team"
import { companyDateOf } from "@/lib/datetime"
import { tryLoad } from "@/lib/api/load"
import { pageInfo, pageParams } from "@/lib/api/pagination"
import { formatDateTime, formatTime, formatWeekdayDate } from "@/lib/format"
import { hasPermission } from "@/lib/permissions/roles"
import { getPageParam, getParam, hrefWithParams, type ParamPatch, type SearchParamsRecord } from "@/lib/search-params"
import type { CurrentUser } from "@/lib/session/current-user"

const CALLS_PAGE_SIZE = 50

const KIND_FILTERS: readonly { value: string | null; label: string; query: Pick<CallsQuery, "direction" | "missedOnly"> }[] = [
  { value: null, label: "Все", query: { direction: null, missedOnly: false } },
  { value: "incoming", label: "Входящие", query: { direction: "incoming", missedOnly: false } },
  { value: "outgoing", label: "Исходящие", query: { direction: "outgoing", missedOnly: false } },
  { value: "missed", label: "Пропущенные", query: { direction: null, missedOnly: true } },
]

type CallsViewProps = {
  user: CurrentUser
  params: SearchParamsRecord
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** День из адреса (?from=, ?to=) — только YYYY-MM-DD, иначе без фильтра */
function dayParam(params: SearchParamsRecord, name: string): string | null {
  const value = getParam(params, name)
  return value && DAY.test(value) ? value : null
}

function groupByDay(calls: readonly Call[]): { day: string; calls: Call[] }[] {
  const groups = new Map<string, Call[]>()
  for (const call of calls) {
    const day = companyDateOf(call.at)
    groups.set(day, [...(groups.get(day) ?? []), call])
  }
  return [...groups].map(([day, items]) => ({ day, calls: items }))
}

export async function CallsView({ user, params }: CallsViewProps) {
  const isTeamView = hasPermission(user.role, "team.view")
  const kindParam = getParam(params, "kind")
  const kind = KIND_FILTERS.find((item) => item.value === kindParam) ?? KIND_FILTERS[0]
  const paging = pageParams(getPageParam(params), CALLS_PAGE_SIZE)
  const openCallId = getParam(params, "call")
  const href = (patch: ParamPatch) => hrefWithParams(routes.calls, params, patch)

  const loaded = await tryLoad(() =>
    Promise.all([
      callsRepository.listCalls({
        ...kind.query,
        // Видимость (свои, команда, все) решает backend; менеджер видит только свои звонки
        managerId: isTeamView ? getParam(params, "manager") : isMockDataSource ? user.id : null,
        leadId: null,
        dateFrom: dayParam(params, "from"),
        dateTo: dayParam(params, "to"),
        search: getParam(params, "q"),
        ...paging,
      }),
      isTeamView ? teamRepository.listMembers() : Promise.resolve([]),
      openCallId ? callsRepository.getCall(openCallId) : Promise.resolve(null),
    ])
  )
  if (!loaded.ok) return <ApiErrorState error={loaded.error} />
  const [result, members, openCall] = loaded.data
  const callHref = (id: string | null) => href({ call: id, page: getParam(params, "page") })

  return (
    <div className="space-y-3">
      <Toolbar>
        <SearchInput
          label="Поиск звонков"
          placeholder={isMockDataSource ? "Клиент или номер" : "Номер или заметка"}
          className="w-full sm:w-64"
        />
        <SegmentedLinks
          label="Тип звонка"
          variant="pill"
          items={KIND_FILTERS.map((item) => ({
            key: item.value ?? "all",
            label: item.label,
            href: href({ kind: item.value, call: null }),
            isActive: item.value === kind.value,
          }))}
        />
        <CallDateFilter />
        {isTeamView && (
          <FilterSelect
            label="Менеджер"
            param="manager"
            allLabel="Все сотрудники"
            options={members.map((member) => ({ value: member.id, label: member.name }))}
          />
        )}
        {!isMockDataSource && hasPermission(user.role, "records.edit") && (
          <div className="sm:ml-auto">
            <LogCallButton />
          </div>
        )}
      </Toolbar>

      {result.results.length === 0 ? (
        <ListPanel>
          <EmptyState
            icon={PhoneOff}
            title="Звонков нет"
            description={
              isMockDataSource
                ? "Измените фильтры. Звонки появятся здесь после подключения телефонии."
                : "Измените фильтры или запишите состоявшийся звонок. Автоматически звонки появятся после подключения телефонии."
            }
          />
        </ListPanel>
      ) : (
        <ListPanel>
          {groupByDay(result.results).map(({ day, calls }) => (
            <ListGroup key={day} id={`calls-${day}`} title={formatWeekdayDate(`${day}T12:00:00Z`)} count={calls.length}>
              {calls.map((call) => (
                <li key={call.id} className="relative transition-colors hover:bg-accent/50 focus-within:bg-accent/50">
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <CallDirectionIcon call={call} className="mt-0.5 size-4 shrink-0" />
                    <time dateTime={call.at} className="w-11 shrink-0 text-sm tabular-nums">
                      {formatTime(call.at)}
                    </time>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={callHref(call.id)}
                        scroll={false}
                        className="block truncate text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none"
                      >
                        {call.lead?.name ?? call.client?.name ?? call.phone}
                      </Link>
                      <p className="truncate text-meta text-muted-foreground">
                        {callTitle(call)}
                        {isTeamView && ` · ${call.manager.name}`}
                        {call.analysis && ` · ${call.analysis.summary}`}
                      </p>
                    </div>
                    {call.rating && <RatingStars score={call.rating.score} />}
                  </div>
                </li>
              ))}
            </ListGroup>
          ))}
        </ListPanel>
      )}
      <PaginationNav info={pageInfo(result.count, paging)} hrefForPage={(page) => href({ page: page > 1 ? String(page) : null })} />

      {openCall && (
        <UrlSheet closeHref={callHref(null)}>
          <CallDetail call={openCall} canLink={!isMockDataSource && hasPermission(user.role, "records.edit")} />
        </UrlSheet>
      )}
    </div>
  )
}

function CallDetail({ call, canLink }: { call: Call; canLink: boolean }) {
  return (
    <>
      <SheetHeader className="pr-10">
        <SheetTitle className="text-base">{call.lead?.name ?? call.client?.name ?? call.phone}</SheetTitle>
        <SheetDescription>
          {callTitle(call)} · {formatDateTime(call.at)}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-6">
        <CallFacts call={call} />
        {canLink && <CallLinkForm callId={call.id} isLinked={Boolean(call.lead ?? call.client)} />}
        {/* Разбор в режиме api — через backend, когда ИИ подключён: запись из АТС, иначе заметка к звонку */}
        {isMockDataSource ? <CallAnalysis call={call} isDemoData /> : call.status === "answered" && <CallAiSection callId={call.id} hasRecording={call.hasRecording} />}
        <CallRating call={call} />
        {(isMockDataSource || call.transcript) && (
          <section className="space-y-2" aria-labelledby={`transcript-${call.id}`}>
            <h3 id={`transcript-${call.id}`} className="text-xs font-medium text-muted-foreground">Транскрипция</h3>
            <CallTranscript call={call} />
          </section>
        )}
      </div>
    </>
  )
}

/** Звонки во вкладке карточки лида: тот же модуль, развёрнутый вид без отдельной панели */
export async function LeadCallsList({ leadId, actions }: { leadId: string; actions?: React.ReactNode }) {
  const result = await tryLoad(() =>
    callsRepository.listCalls({ direction: null, missedOnly: false, managerId: null, leadId, search: null, limit: 50, offset: 0 })
  )
  if (!result.ok) return <ApiErrorState error={result.error} bare />
  if (result.data.results.length === 0) {
    return (
      <div className="space-y-3">
        {actions}
        <EmptyState
          icon={PhoneOff}
          title="Звонков пока нет"
          description={
            isMockDataSource
              ? "Звонки появятся после подключения телефонии; разговоры от 30 секунд разбираются автоматически."
              : "Запишите состоявшийся звонок или привяжите его к сделке. Звонки телефонии появятся здесь автоматически."
          }
        />
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {actions}
      <ul className="space-y-3">
        {result.data.results.map((call) => (
          <li key={call.id} className="space-y-3 rounded-xl bg-card p-3 ring-1 ring-border">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <CallDirectionIcon call={call} className="size-4" />
                {callTitle(call)}
                <span className="font-normal text-muted-foreground">
                  · {formatDateTime(call.at)} · {call.manager.name}
                </span>
              </p>
              {call.rating && <RatingStars score={call.rating.score} />}
            </div>
            {call.status === "answered" && isMockDataSource && <CallAnalysis call={call} isDemoData />}
            {call.status === "answered" && !isMockDataSource && <CallAiSection callId={call.id} hasRecording={call.hasRecording} />}
            {call.notes && <p className="text-meta">{call.notes}</p>}
            {call.rating?.comment && <p className="text-meta text-muted-foreground">Комментарий руководителя: {call.rating.comment}</p>}
            {call.transcript && (
              <details className="rounded-lg bg-muted/40 px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none hover:text-foreground">
                  Транскрипция
                </summary>
                <div className="mt-2">
                  <CallTranscript call={call} />
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CallsViewSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-8 w-[32rem] max-w-full" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  )
}
