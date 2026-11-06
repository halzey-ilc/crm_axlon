/** Подписи действий помощника: backend отдаёт технические имена инструментов, полей и ошибок */

export const TOOL_LABELS: Record<string, string> = {
  create_task: "Поставить задачу",
  log_note: "Записать заметку",
  request_deal_brief: "Запросить сводку по сделке",
  schedule_meeting: "Назначить встречу",
  move_deal_stage: "Перенести сделку на этап",
}

const ARG_LABELS: Record<string, string> = {
  title: "Название",
  due_date: "Срок",
  body: "Текст",
  start: "Начало",
  duration_minutes: "Длительность",
  stage: "Этап",
}

const ACTION_ERRORS: Record<string, string> = {
  not_allowed: "У вашей роли больше нет этого права.",
  next_step_required: "Сначала поставьте по сделке задачу со сроком: без следующего шага этап не меняется.",
  sale_requires_payment: "Сделка становится продажей только после подтверждённой оплаты.",
  validation_error: "Проверьте данные действия: сервер их не принял.",
  not_found: "Запись не найдена или больше недоступна.",
  access_denied: "У вашей роли нет права на это действие.",
}

function pad(value: string): string {
  return value.padStart(2, "0")
}

/** Дата и время приходят как местное время компании без часового пояса — показываем как есть */
function formatLocal(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{1,2}):(\d{2}))?/.exec(value)
  if (!match) return value
  const [, year, month, day, hours, minutes] = match
  const date = `${day}.${month}.${year}`
  return hours ? `${date} ${pad(hours)}:${minutes}` : date
}

function formatArg(key: string, value: unknown): string {
  if (value === null || value === undefined) return key === "due_date" ? "Без срока" : "—"
  if (key === "duration_minutes") return `${String(value)} мин`
  if ((key === "due_date" || key === "start") && typeof value === "string") return formatLocal(value)
  return typeof value === "string" ? value : JSON.stringify(value)
}

/** Поля действия для показа: подпись и значение; неизвестное поле показывается под своим именем */
export function actionFields(args: Record<string, unknown> | null | undefined): { key: string; label: string; value: string }[] {
  return Object.entries(args ?? {}).map(([key, value]) => ({ key, label: ARG_LABELS[key] ?? key, value: formatArg(key, value) }))
}

export function actionError(code: string): string {
  return ACTION_ERRORS[code] ?? "Сервер не выполнил действие. Попробуйте сделать это вручную."
}
