import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/errors"

const apiRequest = vi.fn()
vi.mock("@/lib/api/client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }))
vi.mock("@/lib/auth/token-store", () => ({ getActionAuth: async () => ({}) }))
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))

const { saveChecklistAction, saveSipuniAction } = await import("@/features/company-settings/telephony-actions")

const input = {
  account: " 012345 ",
  secret: "key",
  companyNumber: "+996312123456",
  extensions: { "101": "u-1" },
  countryCode: "996",
  callLanguage: "ru" as const,
  recordChannels: "mono" as const,
  analyzeCalls: true,
  enabled: true,
  rotateToken: false,
}

describe("телефония компании", () => {
  beforeEach(() => {
    apiRequest.mockReset()
  })

  it("подключение уходит на backend, адрес для событий возвращается", async () => {
    apiRequest.mockResolvedValue({ ...input, hasSecret: true, eventsUrl: "https://crm/x" })
    const result = await saveSipuniAction(input)
    expect(apiRequest).toHaveBeenCalledWith("/api/v1/telephony/sipuni/", expect.objectContaining({ method: "PUT", body: expect.objectContaining({ account: "012345" }) }))
    expect(result.ok && result.data.eventsUrl).toBe("https://crm/x")
  })

  it("не цифры в номере кабинета не отправляются", async () => {
    const result = await saveSipuniAction({ ...input, account: "abc" })
    expect(result.ok).toBe(false)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it("не директору — понятный отказ", async () => {
    apiRequest.mockImplementation(async () => {
      throw new ApiError("forbidden", "nope")
    })
    const result = await saveSipuniAction(input)
    expect(!result.ok && result.message).toMatch(/директор/)
  })

  it("пустые пункты чек-листа отбрасываются, пустой чек-лист не сохраняется", async () => {
    expect((await saveChecklistAction([{ code: "", title: "  " }])).ok).toBe(false)
    apiRequest.mockResolvedValue({ criteria: [{ code: "a", title: "A" }] })
    await saveChecklistAction([{ code: "a", title: "A" }, { code: "", title: "" }])
    expect(apiRequest).toHaveBeenCalledWith("/api/v1/ai/calls/checklist/", expect.objectContaining({ body: { criteria: [{ code: "a", title: "A" }] } }))
  })
})
