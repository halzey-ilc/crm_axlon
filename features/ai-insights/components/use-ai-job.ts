"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import type { AiActionResult } from "@/features/ai-insights/actions"

/** Как часто спрашивать результат: на CPU модель отвечает за 25–60 с, на GPU — за 2–15 с */
const POLL_MS = 3_000
/** Сколько ждать на экране; позже результат всё равно придёт уведомлением */
const WAIT_MS = 3 * 60_000

/** Любой статус, кроме итоговых, — задача ещё идёт (у разбора звонка их несколько: расшифровка, оценка) */
type Job = { status: string }

const inFlight = (job: Job | null) => job !== null && job.status !== "succeeded" && job.status !== "failed"

/** Запуск задачи ИИ и опрос до результата. Экран не блокируется; ошибка — понятным текстом */
export function useAiJob<T extends Job>(initial: T | null, request: () => Promise<AiActionResult<T>>, load: () => Promise<AiActionResult<T | null>>) {
  const [job, setJob] = useState(initial)
  const [failure, setFailure] = useState<string | null>(null)
  const [isWaitingTooLong, setWaitingTooLong] = useState(false)
  const [isStarting, startTransition] = useTransition()
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  const isPolling = inFlight(job) && !isWaitingTooLong
  useEffect(() => {
    if (!isPolling) return
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - startedAt > WAIT_MS) {
        setWaitingTooLong(true)
        return
      }
      void loadRef.current().then((result) => {
        if (result.ok) {
          if (result.data) setJob(result.data)
        } else setFailure(result.message)
      })
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [isPolling])

  function start() {
    setFailure(null)
    setWaitingTooLong(false)
    startTransition(async () => {
      const result = await request()
      if (result.ok) setJob(result.data)
      else setFailure(result.message)
    })
  }

  return { job, failure, isWaitingTooLong, isBusy: isStarting || inFlight(job), start }
}
