import { beforeEach, describe, expect, it, vi } from "vitest"

const apiRequest = vi.fn()
vi.mock("@/lib/api/client", () => ({ apiRequest }))
vi.mock("@/lib/auth/token-store", () => ({ getRenderAuth: async () => ({ tenant: "demo" }) }))
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }))

const { aiReportSchema, fetchAiAvailable, fetchCallSummary, replySuggestionSchema, requestDealBrief } = await import("@/features/ai-insights/api/ai-insights")
const { ApiError } = await import("@/lib/api/errors")

const auth = { tenant: "demo" } as never

describe("ИИ через backend CRM", () => {
  beforeEach(() => apiRequest.mockReset())

  it("блоки показываются, только когда ИИ включён на сервере и роль может его просить", async () => {
    apiRequest.mockResolvedValueOnce({ enabled: true, canRequest: true })
    expect(await fetchAiAvailable()).toBe(true)
    apiRequest.mockResolvedValueOnce({ enabled: false, canRequest: true })
    expect(await fetchAiAvailable()).toBe(false)
    apiRequest.mockResolvedValueOnce({ enabled: true, canRequest: false })
    expect(await fetchAiAvailable()).toBe(false)
  })

  it("модуль не в тарифе — блоков нет, а не ошибка на странице", async () => {
    apiRequest.mockRejectedValueOnce(new ApiError("forbidden", "feature_not_in_plan"))
    expect(await fetchAiAvailable()).toBe(false)
  })

  it("разбора ещё не просили: 404 — это null, другие ошибки не прячутся", async () => {
    apiRequest.mockRejectedValueOnce(new ApiError("not_found", "нет"))
    expect(await fetchCallSummary(auth, "c-1")).toBeNull()
    apiRequest.mockRejectedValueOnce(new ApiError("server", "сбой"))
    await expect(fetchCallSummary(auth, "c-1")).rejects.toBeInstanceOf(ApiError)
  })

  it("запросы идут только на адреса CRM, id кодируется", async () => {
    apiRequest.mockResolvedValueOnce({})
    await requestDealBrief(auth, "d/1")
    expect(apiRequest.mock.calls[0][0]).toBe("/api/v1/ai/deals/d%2F1/brief/")
    expect(apiRequest.mock.calls[0][1]).toMatchObject({ method: "POST" })
  })
})

describe("черновик ответа и отчёты ИИ", () => {
  it("черновик и отчёт разбираются, неизвестные поля отчёта не мешают", () => {
    const job = { id: "j", status: "succeeded", isMock: false, errorCode: null, createdAt: "2026-11-06T10:00:00+06:00", finishedAt: null }
    expect(replySuggestionSchema.parse({ ...job, result: { draftReply: null, needsHuman: true, urgency: "high", intent: "complaint" } }).result?.needsHuman).toBe(true)
    const report = aiReportSchema.parse({ ...job, result: { headline: "Итог", observations: [{ text: "Рост", metricCodes: ["a"] }], insufficientData: false } })
    expect(report.result?.observations[0].text).toBe("Рост")
    expect(report.result?.items).toEqual([])
  })
})
