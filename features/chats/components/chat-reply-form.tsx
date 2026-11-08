"use client"

import { useEffect, useRef, useState } from "react"
import { Mic, Paperclip, Send, Square, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MAX_FILE_BYTES } from "@/features/chats/lib/chat-list"
import { MESSAGE_TEXT_MAX } from "@/features/communications/api/communications-repository"
import { formatDuration } from "@/lib/format"

type ChatReplyFormProps = {
  pending: boolean
  onError: (message: string | null) => void
  onSendText: (text: string, onSent: () => void) => void
  onSendFile: (file: File, caption: string, voice: boolean, onSent: () => void) => void
}

/** Подпись к файлу короче текста сообщения: таков предел backend */
const CAPTION_MAX = 1024

/** Ответ клиенту: текст, файл с подписью или голосовое с микрофона */
export function ChatReplyForm({ pending, onError, onSendText, onSendFile }: ChatReplyFormProps) {
  const [text, setText] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [recording, setRecording] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const canSend = !pending && (file !== null || text.trim().length > 0)

  function clear() {
    setText("")
    setFile(null)
  }

  function submit() {
    if (!canSend) return
    if (file) onSendFile(file, text.trim(), false, clear)
    else onSendText(text, clear)
  }

  function pick(chosen: File | undefined) {
    if (picker.current) picker.current.value = ""
    if (!chosen) return
    if (chosen.size > MAX_FILE_BYTES) return onError("Файл больше 20 МБ. Отправьте его из приложения WhatsApp.")
    onError(null)
    setFile(chosen)
  }

  if (recording) {
    return (
      <VoiceRecorder
        pending={pending}
        onError={onError}
        onCancel={() => setRecording(false)}
        onDone={(voice) => onSendFile(voice, "", true, () => setRecording(false))}
      />
    )
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {file && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm">
          <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Убрать файл" onClick={() => setFile(null)}>
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={picker} type="file" className="hidden" aria-label="Выбрать файл" onChange={(event) => pick(event.target.files?.[0])} />
        <Button type="button" variant="outline" size="icon" aria-label="Прикрепить файл" disabled={pending} onClick={() => picker.current?.click()}>
          <Paperclip className="size-4" aria-hidden />
        </Button>
        <Textarea
          aria-label={file ? "Подпись к файлу" : "Ответ клиенту"}
          rows={2}
          maxLength={file ? CAPTION_MAX : MESSAGE_TEXT_MAX}
          placeholder={file ? "Подпись…" : "Сообщение… Shift+Enter — новая строка"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
        />
        {canSend || pending ? (
          <Button type="submit" size="icon" aria-label="Отправить" disabled={!canSend}>
            <Send className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button type="button" size="icon" aria-label="Записать голосовое" onClick={() => setRecording(true)}>
            <Mic className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </form>
  )
}

type VoiceRecorderProps = {
  pending: boolean
  onError: (message: string | null) => void
  onCancel: () => void
  onDone: (voice: File) => void
}

const MICROPHONE_ERROR = "Нет доступа к микрофону. Разрешите его в настройках браузера."

/** Запись начинается при появлении; сервер сам перекодирует её в формат голосовых WhatsApp */
function VoiceRecorder({ pending, onError, onCancel, onDone }: VoiceRecorderProps) {
  const recorder = useRef<MediaRecorder | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [ready, setReady] = useState(false)
  const [voice, setVoice] = useState<File | null>(null)

  useEffect(() => {
    let active = true
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    const release = () => {
      clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        if (!active) return
        onError(MICROPHONE_ERROR)
        return onCancel()
      }
      if (!active) return release()
      const media = new MediaRecorder(stream)
      const chunks: Blob[] = []
      media.ondataavailable = (event) => chunks.push(event.data)
      media.onstop = () => {
        release()
        const type = media.mimeType.split(";")[0]
        if (active) setVoice(new File(chunks, `voice.${type.split("/")[1] ?? "webm"}`, { type }))
      }
      media.start()
      recorder.current = media
      setReady(true)
      timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    }
    onError(null)
    void start()
    return () => {
      active = false
      if (recorder.current?.state === "recording") recorder.current.stop()
      else release()
    }
    // Запись запускается один раз на появление; колбэки — новые функции на каждый рендер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (voice) onDone(voice)
    // onDone — новая функция на каждый рендер, а отправить запись нужно один раз
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice])

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="icon" aria-label="Отменить запись" disabled={pending} onClick={onCancel}>
        <Trash2 className="size-4" aria-hidden />
      </Button>
      <span className="flex-1 text-sm tabular-nums" role="status">
        <span className="mr-2 inline-block size-2 rounded-full bg-destructive" aria-hidden />
        {pending ? "Отправляем…" : voice ? "Не отправлено" : ready ? `Запись ${formatDuration(seconds)}` : "Включаем микрофон…"}
      </span>
      {voice ? (
        <Button type="button" size="icon" aria-label="Отправить ещё раз" disabled={pending} onClick={() => onDone(voice)}>
          <Send className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button type="button" size="icon" aria-label="Закончить и отправить" disabled={!ready} onClick={() => recorder.current?.stop()}>
          <Square className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}
