import { describe, expect, it } from "vitest"

import { actionError, actionFields } from "@/features/assistant/labels"

describe("подписи действий помощника", () => {
  it("поля показываются по-русски, дата и время — как местное время", () => {
    expect(actionFields({ title: "Звонок", due_date: "2026-11-10" })).toEqual([
      { key: "title", label: "Название", value: "Звонок" },
      { key: "due_date", label: "Срок", value: "10.11.2026" },
    ])
    expect(actionFields({ start: "2026-11-10T15:00", duration_minutes: 30 })).toEqual([
      { key: "start", label: "Начало", value: "10.11.2026 15:00" },
      { key: "duration_minutes", label: "Длительность", value: "30 мин" },
    ])
  })

  it("пустой срок — словами", () => {
    expect(actionFields({ due_date: null })[0].value).toBe("Без срока")
  })

  it("неизвестное поле не теряется", () => {
    expect(actionFields({ extra: "x" })).toEqual([{ key: "extra", label: "extra", value: "x" }])
  })

  it("ошибка объясняется словами, код не показывается", () => {
    expect(actionError("next_step_required")).toMatch(/задачу со сроком/)
    expect(actionError("something_new")).not.toMatch(/something_new/)
  })
})
