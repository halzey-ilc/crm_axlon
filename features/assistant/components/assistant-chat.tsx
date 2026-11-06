"use client"

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, LoaderCircle, MessageSquarePlus, Send, Sparkles, X } from "lucide-react"

import { StatusBadge, type StatusTone } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { leadRoute, routes } from "@/config/routes"
import { askAssistantAction, decideAssistantAction, getAssistantRunAction } from "@/features/assistant/actions"
import { LOCAL_PROVIDER, type AssistantAction, type AssistantChoice, type AssistantRun, type RunContext } from "@/features/assistant/api/assistant-repository"
import { actionError, actionFields, TOOL_LABELS } from "@/features/assistant/labels"
import { formatDateTime } from "@/lib/format"

const POLL_MS = 4000
const HISTORY_KEY = "axlon.assistant.history"
const HISTORY_LIMIT = 10

const RUN_STATUS: Record<AssistantRun["status"], { label: string; tone: StatusTone }> = {
  pending: { label: "В очереди", tone: "neutral" },
  submitted: { label: "Думает", tone: "info" },
  succeeded: { label: "Готово", tone: "success" },
  failed: { label: "Ошибка", tone: "danger" },
}

const ACTION_STATUS: Record<AssistantAction["status"], { label: string; tone: StatusTone }> = {
  proposed: { label: "Ждёт решения", tone: "warning" },
  executed: { label: "Выполнено", tone: "success" },
  failed: { label: "Не выполнено", tone: "danger" },
  rejected: { label: "Отклонено", tone: "neutral" },
}

type HistoryItem = { id: string; request: string; createdAt: string }

/** История запросов в этом браузере — только для удобства; сами запуски хранит сервер */
const historyListeners = new Set<() => void>()

function readRaw(): string {
  try {
    return window.localStorage.getItem(HISTORY_KEY) ?? "[]"
  } catch {
    return "[]"
  }
}

function subscribe(listener: () => void) {
  historyListeners.add(listener)
  return () => historyListeners.delete(listener)
}

function parseHistory(raw: string): HistoryItem[] {
  try {
    return (JSON.parse(raw) as HistoryItem[]).slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

function remember(run: AssistantRun) {
  const next = [{ id: run.id, request: run.request, createdAt: run.createdAt }, ...parseHistory(readRaw()).filter((item) => item.id !== run.id)].slice(0, HISTORY_LIMIT)
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // Хранилище недоступно (приватный режим) — история просто не запоминается
  }
  historyListeners.forEach((listener) => listener())
}

/**
 * Чат с ИИ-помощником: вопрос → запуск на сервере → опрос статуса (ответ готовится 1–3 минуты)
 * → сводка и предложенные действия, каждое из которых подтверждается отдельно.
 */
export function AssistantChat({ initialRun, initialError }: { initialRun: AssistantRun | null; initialError: string | null }) {
  const router = useRouter()
  const [run, setRun] = useState<AssistantRun | null>(initialRun)
  const [question, setQuestion] = useState("")
  const [failure, setFailure] = useState<string | null>(initialError)
  const historyRaw = useSyncExternalStore(subscribe, readRaw, () => "[]")
  const history = useMemo(() => parseHistory(historyRaw), [historyRaw])
  const [isPending, startTransition] = useTransition()
  const isWorking = run !== null && (run.status === "pending" || run.status === "submitted")

  useEffect(() => {
    // Открытый по ссылке запрос тоже попадает в историю этого браузера
    if (initialRun) remember(initialRun)
  }, [initialRun])

  useEffect(() => {
    if (!run || !isWorking) return
    const timer = setTimeout(async () => {
      const result = await getAssistantRunAction(run.id)
      if (result.ok) setRun(result.data)
      else setFailure(result.message)
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [run, isWorking])

  function send(request: string, context: RunContext) {
    startTransition(async () => {
      const result = await askAssistantAction(request, context)
      if (!result.ok) {
        setFailure(result.requestId ? `${result.message} Код запроса: ${result.requestId}` : result.message)
        return
      }
      setFailure(null)
      setQuestion("")
      setRun(result.data)
      remember(result.data)
      router.replace(`${routes.assistant}?run=${encodeURIComponent(result.data.id)}`, { scroll: false })
    })
  }

  function ask(event: React.FormEvent) {
    event.preventDefault()
    // Ответ на экране — контекст разговора: «лучше во вторник» относится к нему
    send(question, run?.status === "succeeded" ? { previousRunId: run.id } : {})
  }

  function choose(choice: AssistantChoice) {
    if (run) send(run.request, { dealId: choice.dealId })
  }

  function startOver() {
    setRun(null)
    setFailure(null)
    router.replace(routes.assistant, { scroll: false })
  }

  function decide(action: AssistantAction, decision: "confirm" | "reject") {
    if (!run) return
    startTransition(async () => {
      const result = await decideAssistantAction(run.id, action.index, decision)
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      setFailure(null)
      setRun({ ...run, actions: run.actions.map((item) => (item.index === action.index ? result.data : item)) })
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-4">
        <form onSubmit={ask} className="space-y-2 rounded-xl p-4 ring-1 ring-border">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="assistant-question">{run?.status === "succeeded" ? "Уточните или спросите дальше" : "Что нужно сделать?"}</Label>
            {run && (
              <Button type="button" size="sm" variant="ghost" onClick={startOver} disabled={isPending}>
                <MessageSquarePlus data-icon="inline-start" aria-hidden />
                Новый разговор
              </Button>
            )}
          </div>
          <Textarea
            id="assistant-question"
            rows={3}
            maxLength={1000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Например: назначь встречу по сделке Поставка оборудования во вторник в 15:00"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-meta text-muted-foreground">Помощник предлагает действия — ничего не выполняется без вашего подтверждения.</p>
            <Button type="submit" disabled={isPending || isWorking || question.trim().length < 3}>
              {isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden /> : <Send data-icon="inline-start" aria-hidden />}
              Спросить
            </Button>
          </div>
        </form>

        {failure && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {failure}
          </p>
        )}

        {run && <RunCard run={run} isPending={isPending} onDecide={decide} onChoose={choose} />}
      </div>

      <aside className="space-y-2">
        <h2 className="text-sm font-semibold">Недавние запросы</h2>
        {history.length === 0 ? (
          <p className="text-meta text-muted-foreground">Здесь появятся ваши запросы из этого браузера.</p>
        ) : (
          <ul className="space-y-1">
            {history.map((item) => (
              <li key={item.id}>
                <Link
                  href={`${routes.assistant}?run=${encodeURIComponent(item.id)}`}
                  className={`block rounded-md px-2 py-1.5 text-sm hover:bg-accent ${item.id === run?.id ? "bg-accent" : ""}`}
                >
                  <span className="line-clamp-2">{item.request}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  )
}

function RunCard({
  run,
  isPending,
  onDecide,
  onChoose,
}: {
  run: AssistantRun
  isPending: boolean
  onDecide: (action: AssistantAction, decision: "confirm" | "reject") => void
  onChoose: (choice: AssistantChoice) => void
}) {
  const status = RUN_STATUS[run.status]
  const isLocal = run.provider === LOCAL_PROVIDER
  return (
    <section aria-label="Ответ помощника" className="space-y-3 rounded-xl p-4 ring-1 ring-border">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium">{run.request}</p>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      {(run.status === "pending" || run.status === "submitted") && (
        <p className="flex items-center gap-2 text-meta text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          Ответ готовится — обычно 1–3 минуты. Страницу можно закрыть: запрос сохранён.
        </p>
      )}
      {run.status === "failed" && (
        <p className="text-sm text-destructive">ИИ-сервис не вернул ответ{run.errorCode ? ` (${run.errorCode})` : ""}. Попробуйте спросить ещё раз позже.</p>
      )}
      {run.summary && (
        <div className="space-y-1">
          {!isLocal && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Sparkles className="size-3.5" aria-hidden />
              Сгенерировано ИИ{run.isMock ? " · тестовый ответ (сервер без подключённой модели)" : ""}
            </p>
          )}
          <p className="text-sm whitespace-pre-line">{run.summary}</p>
        </div>
      )}
      {run.items.length > 0 && (
        <ul className="space-y-1 text-sm">
          {run.items.map((item) => (
            <li key={item.ref ?? item.title}>
              {item.ref?.startsWith("deal:") ? (
                <Link href={leadRoute(item.ref.slice("deal:".length))} className="text-primary hover:underline">
                  {item.title}
                </Link>
              ) : (
                item.title
              )}
            </li>
          ))}
        </ul>
      )}
      {run.choices.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {run.choices.map((choice) => (
            <Button key={choice.dealId} size="sm" variant="outline" onClick={() => onChoose(choice)} disabled={isPending}>
              {choice.title}
            </Button>
          ))}
        </div>
      )}
      {run.actions.length > 0 && (
        <ul className="space-y-2">
          {run.actions.map((action) => {
            const meta = ACTION_STATUS[action.status]
            return (
              <li key={action.index} className="space-y-1.5 rounded-lg bg-muted/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{TOOL_LABELS[action.tool] ?? action.tool}</span>
                  <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                </div>
                {action.reason && <p className="text-meta text-muted-foreground">{action.reason}</p>}
                {action.args && Object.keys(action.args).length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-meta">
                    {actionFields(action.args).map((field) => (
                      <div key={field.key} className="contents">
                        <dt className="text-muted-foreground">{field.label}</dt>
                        <dd className="min-w-0 break-words">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {action.errorCode && <p className="text-meta text-destructive">{actionError(action.errorCode)}</p>}
                {action.status === "proposed" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => onDecide(action, "confirm")} disabled={isPending}>
                      <Check data-icon="inline-start" aria-hidden />
                      Выполнить
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onDecide(action, "reject")} disabled={isPending}>
                      <X data-icon="inline-start" aria-hidden />
                      Отклонить
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Запрос от {formatDateTime(run.createdAt)}
        {run.finishedAt && ` · ответ ${formatDateTime(run.finishedAt)}`}
      </p>
    </section>
  )
}
