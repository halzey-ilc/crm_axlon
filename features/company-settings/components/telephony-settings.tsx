"use client"

import { useState, useTransition } from "react"
import { Copy, LoaderCircle, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ChecklistPoint, SipuniInput, SipuniSettings } from "@/features/company-settings/api/telephony"
import { saveChecklistAction, saveSipuniAction } from "@/features/company-settings/telephony-actions"

type Person = { userId: string; fullName: string }
type Row = { number: string; userId: string }

const SELECT = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"

/**
 * Подключение Sipuni компании: номер кабинета, ключ интеграции, внутренние номера сотрудников.
 * После подключения CRM показывает адрес, который нужно вставить в Sipuni — один раз.
 */
export function SipuniSettingsForm({ settings, people }: { settings: SipuniSettings | null; people: Person[] }) {
  const [isPending, startTransition] = useTransition()
  const [values, setValues] = useState({
    account: settings?.account ?? "",
    secret: "",
    companyNumber: settings?.companyNumber ?? "",
    callLanguage: settings?.callLanguage ?? "ru",
    recordChannels: settings?.recordChannels ?? "mono",
    analyzeCalls: settings?.analyzeCalls ?? true,
    enabled: settings?.enabled ?? true,
  })
  const [rows, setRows] = useState<Row[]>(Object.entries(settings?.extensions ?? {}).map(([number, userId]) => ({ number, userId })))
  const [eventsUrl, setEventsUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function save(rotateToken = false) {
    const input: SipuniInput = {
      ...values,
      countryCode: settings?.countryCode ?? "996",
      extensions: Object.fromEntries(rows.filter((row) => row.number.trim() && row.userId).map((row) => [row.number.trim(), row.userId])),
      rotateToken,
    }
    startTransition(async () => {
      const result = await saveSipuniAction(input)
      if (!result.ok) {
        setMessage({ ok: false, text: result.message })
        return
      }
      setValues((current) => ({ ...current, secret: "" }))
      setEventsUrl(result.data.eventsUrl ?? null)
      setMessage({ ok: true, text: settings ? "Сохранено." : "Sipuni подключён." })
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="sipuni-account">Номер кабинета Sipuni</Label>
          <Input id="sipuni-account" inputMode="numeric" value={values.account} onChange={(e) => setValues({ ...values, account: e.target.value })} placeholder="012345" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sipuni-secret">Ключ интеграции</Label>
          <Input
            id="sipuni-secret"
            type="password"
            autoComplete="off"
            value={values.secret}
            onChange={(e) => setValues({ ...values, secret: e.target.value })}
            placeholder={settings?.hasSecret ? "Сохранён — оставьте пустым" : "Sipuni → Настройки → Интеграция по API"}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sipuni-number">Номер компании</Label>
          <Input id="sipuni-number" value={values.companyNumber} onChange={(e) => setValues({ ...values, companyNumber: e.target.value })} placeholder="+996 312 123 456" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sipuni-language">Язык звонков</Label>
          <select id="sipuni-language" className={SELECT} value={values.callLanguage} onChange={(e) => setValues({ ...values, callLanguage: e.target.value as "ru" | "ky" })}>
            <option value="ru">В основном русский</option>
            <option value="ky">В основном кыргызский</option>
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="sipuni-channels">Как Sipuni записывает звонки</Label>
          <select
            id="sipuni-channels"
            className={SELECT}
            value={values.recordChannels}
            onChange={(e) => setValues({ ...values, recordChannels: e.target.value as SipuniInput["recordChannels"] })}
          >
            <option value="mono">Моно — ИИ не различает, кто говорит</option>
            <option value="manager_left">Стерео, менеджер в левом канале</option>
            <option value="manager_right">Стерео, менеджер в правом канале</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={values.analyzeCalls} onChange={(e) => setValues({ ...values, analyzeCalls: e.target.checked })} />
        ИИ расшифровывает и оценивает каждый отвеченный звонок
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={values.enabled} onChange={(e) => setValues({ ...values, enabled: e.target.checked })} />
        Принимать звонки из Sipuni
      </label>

      <div className="space-y-2">
        <p className="text-sm font-medium">Внутренние номера сотрудников</p>
        <p className="text-meta text-muted-foreground">Звонки с номера без сотрудника достаются тому, кто подключил Sipuni.</p>
        {rows.map((row, index) => (
          <div key={index} className="flex gap-2">
            <Input
              aria-label="Внутренний номер"
              className="w-28"
              inputMode="numeric"
              value={row.number}
              onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, number: e.target.value } : r)))}
              placeholder="101"
            />
            <select aria-label="Сотрудник" className={SELECT} value={row.userId} onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, userId: e.target.value } : r)))}>
              <option value="">Выберите сотрудника</option>
              {people.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.fullName}
                </option>
              ))}
            </select>
            <Button type="button" size="icon" variant="ghost" aria-label="Убрать" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setRows([...rows, { number: "", userId: "" }])}>
          <Plus data-icon="inline-start" aria-hidden />
          Добавить номер
        </Button>
      </div>

      {eventsUrl && <EventsUrl url={eventsUrl} />}
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => save()} disabled={isPending}>
          {isPending && <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden />}
          {settings ? "Сохранить" : "Подключить Sipuni"}
        </Button>
        {settings && (
          <Button type="button" variant="outline" onClick={() => save(true)} disabled={isPending}>
            Выдать новый адрес для событий
          </Button>
        )}
      </div>
    </div>
  )
}

function EventsUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1.5 rounded-lg bg-warning/10 p-3 text-sm">
      <p className="font-medium">Вставьте этот адрес в Sipuni: Настройки → API → События на АТС → «Подключить услугу».</p>
      <p className="text-meta text-muted-foreground">Адрес показывается один раз и содержит секрет. Если потеряете — выдайте новый.</p>
      <div className="flex gap-2">
        <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(url)
            setCopied(true)
          }}
        >
          <Copy data-icon="inline-start" aria-hidden />
          {copied ? "Скопировано" : "Копировать"}
        </Button>
      </div>
    </div>
  )
}

/** Чек-лист оценки звонков: что ИИ проверяет в каждом звонке менеджера */
export function CallChecklistForm({ initial }: { initial: ChecklistPoint[] }) {
  const [isPending, startTransition] = useTransition()
  const [points, setPoints] = useState(initial)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function save() {
    const criteria = points.map((point, index) => ({ ...point, code: point.code || `point_${index + 1}`, description: point.description?.trim() || undefined }))
    startTransition(async () => {
      const result = await saveChecklistAction(criteria)
      setMessage(result.ok ? { ok: true, text: "Чек-лист сохранён: новые звонки оцениваются по нему." } : { ok: false, text: result.message })
      if (result.ok) setPoints(result.data)
    })
  }

  return (
    <div className="space-y-2">
      {points.map((point, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
          <Input aria-label="Пункт" value={point.title} maxLength={100} onChange={(e) => setPoints(points.map((p, i) => (i === index ? { ...p, title: e.target.value } : p)))} />
          <Input
            aria-label="Что считается выполненным"
            value={point.description ?? ""}
            maxLength={300}
            placeholder="Что считается выполненным"
            onChange={(e) => setPoints(points.map((p, i) => (i === index ? { ...p, description: e.target.value } : p)))}
          />
          <Button type="button" size="icon" variant="ghost" aria-label="Убрать пункт" onClick={() => setPoints(points.filter((_, i) => i !== index))}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {points.length < 15 && (
          <Button type="button" size="sm" variant="outline" onClick={() => setPoints([...points, { code: "", title: "" }])}>
            <Plus data-icon="inline-start" aria-hidden />
            Добавить пункт
          </Button>
        )}
        <Button type="button" size="sm" onClick={save} disabled={isPending}>
          {isPending && <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden />}
          Сохранить чек-лист
        </Button>
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
