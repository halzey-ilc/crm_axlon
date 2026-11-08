"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { loadWhatsappQrAction } from "@/features/chats/actions"
import type { WhatsappQr } from "@/features/communications/api/communications-repository"

/** QR-код меняется примерно каждые 20 секунд, а о сканировании сервер сообщает только в ответе на опрос */
const REFRESH_MS = 3_000

/** Подключение номера по QR-коду; панель уберёт кнопку, когда сервер подтвердит подключение */
export function ConnectWhatsapp({ onConnected }: { onConnected: () => void }) {
  const [open, setOpen] = useState(false)
  const [linked, setLinked] = useState(false)

  // Панель убирает кнопку вместе с этим окном, поэтому сообщаем ей только после закрытия:
  // иначе пользователь не увидит подтверждение
  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next && linked) onConnected()
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Подключить WhatsApp</Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Подключение WhatsApp</DialogTitle>
            <DialogDescription>Приложение на телефоне продолжит работать. Кто отсканирует код, тот подключит свой номер к CRM компании.</DialogDescription>
          </DialogHeader>
          {open && <QrStep onConnected={() => setLinked(true)} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => changeOpen(false)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function QrStep({ onConnected }: { onConnected: () => void }) {
  const [qr, setQr] = useState<WhatsappQr | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      const result = await loadWhatsappQrAction().catch(() => null)
      if (!active) return
      if (result?.error) return setError(result.error)
      if (result?.qr) setQr(result.qr)
      if (result?.qr?.status === "connected") return onConnected()
      timer = setTimeout(poll, REFRESH_MS)
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
    // Опрос запускается один раз на открытие окна, а onConnected — новая функция на каждый рендер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <p className="text-sm text-muted-foreground">{error}</p>
  if (qr?.status === "connected") return <p className="text-sm font-medium">Номер подключён. Новые обращения появятся в панели чатов.</p>
  if (qr?.status === "unavailable") return <p className="text-sm text-muted-foreground">Сервис подключения сейчас не отвечает. Пробуем снова…</p>
  return (
    <div className="space-y-3">
      {qr?.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL от сервера, оптимизировать нечего
        <img src={qr.image} alt="QR-код для подключения WhatsApp" className="mx-auto size-56 rounded-md bg-white p-2" />
      ) : (
        <Skeleton className="mx-auto size-56 rounded-md" />
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>На телефоне откройте WhatsApp Business.</li>
        <li>Настройки → Связанные устройства → Привязка устройства.</li>
        <li>Наведите камеру на код. Код обновляется сам.</li>
      </ol>
      <p className="text-xs text-muted-foreground">Не используйте номер для рассылок незнакомым людям: WhatsApp может его заблокировать.</p>
    </div>
  )
}
