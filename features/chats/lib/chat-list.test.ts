import { describe, expect, it } from "vitest"

import type { Conversation, Message } from "@/features/communications/api/communications-repository"
import { chatContact, chatErrorMessage, chatHref, chatTimeLabel, chatTitle, connectionView, filterChats, messageAuthor, messageCaption, messageProblem } from "@/features/chats/lib/chat-list"
import { ApiError } from "@/lib/api/errors"
import { formatDayMonth, formatTime } from "@/lib/format"

function chat(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    channel: "whatsapp",
    externalContactId: "+996555000111",
    contactName: "Айгуль",
    status: "open",
    customerId: null,
    leadId: null,
    ownerUserId: null,
    unreadCount: 0,
    lastMessageAt: null,
    ...overrides,
  }
}

describe("chatTitle", () => {
  it("показывает номер, если имени нет", () => {
    expect(chatTitle(chat())).toBe("Айгуль")
    expect(chatTitle(chat({ contactName: null }))).toBe("+996555000111")
  })

  it("не показывает служебный идентификатор скрытого номера", () => {
    expect(chatContact(chat({ externalContactId: "123@lid" }))).toBe("Номер скрыт")
    expect(chatTitle(chat({ contactName: null, externalContactId: "123@lid" }))).toBe("Номер скрыт")
  })
})

describe("chatTimeLabel", () => {
  const now = new Date("2026-11-06T09:00:00Z")

  it("сегодня — время, раньше — дата, без сообщений — ничего", () => {
    expect(chatTimeLabel("2026-11-06T08:30:00Z", now)).toBe(formatTime("2026-11-06T08:30:00Z"))
    expect(chatTimeLabel("2026-10-01T08:30:00Z", now)).toBe(formatDayMonth("2026-10-01T08:30:00Z"))
    expect(chatTimeLabel(null, now)).toBeNull()
  })
})

describe("filterChats", () => {
  const chats = [chat({ id: "a" }), chat({ id: "b", contactName: null })]

  it("ищет по имени и номеру без учёта регистра", () => {
    expect(filterChats(chats, "  айг ").map((item) => item.id)).toEqual(["a"])
    expect(filterChats(chats, "555").map((item) => item.id)).toEqual(["b"])
    expect(filterChats(chats, "")).toHaveLength(2)
  })
})

describe("chatHref", () => {
  it("ведёт к лиду, затем к клиенту; непривязанный чат не открывается", () => {
    expect(chatHref(chat())).toBeNull()
    expect(chatHref(chat({ customerId: "x1" }))).toBe("/client-base?client=x1")
    expect(chatHref(chat({ customerId: "x1", leadId: "l1" }))).toBe("/prospects/l1")
  })
})

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    direction: "outbound",
    text: "Здравствуйте",
    status: "sent",
    senderUserId: "u1",
    failureCode: null,
    attachment: null,
    createdAt: "2026-11-06T08:30:00Z",
    ...overrides,
  }
}

describe("messageCaption", () => {
  const attachment = { kind: "image", contentType: "image/jpeg", fileName: "a.jpg", size: 1 } as const

  it("убирает метку только рядом с файлом", () => {
    expect(messageCaption(message({ text: "[Фото] Счёт", attachment }))).toBe("Счёт")
    expect(messageCaption(message({ text: "[Фото]", attachment }))).toBe("")
    expect(messageCaption(message({ text: "[Фото]" }))).toBe("[Фото]")
  })
})

describe("messageAuthor", () => {
  it("отличает клиента, ответ из CRM и ответ с телефона", () => {
    expect(messageAuthor(message({ direction: "inbound", senderUserId: null }))).toBe("Клиент")
    expect(messageAuthor(message())).toBe("Компания")
    expect(messageAuthor(message({ senderUserId: null }))).toBe("С телефона")
  })
})

describe("messageProblem", () => {
  it("называет закрытое окно 24 часов отдельно от прочих сбоев", () => {
    expect(messageProblem(message())).toBeNull()
    expect(messageProblem(message({ status: "failed" }))).toBe("Не доставлено")
    expect(messageProblem(message({ status: "failed", failureCode: "131047" }))).toContain("24 часов")
    expect(messageProblem(message({ status: "failed", failureCode: "noAccount" }))).toBe("У этого номера нет WhatsApp.")
  })
})

describe("chatErrorMessage", () => {
  it("объясняет отказы канала и прав", () => {
    expect(chatErrorMessage(new ApiError("conflict", "x", { code: "channel_not_configured" }))).toBe("WhatsApp не подключён.")
    expect(chatErrorMessage(new ApiError("conflict", "x", { code: "conversation_invalid_state" }))).toContain("Чат закрыт")
    expect(chatErrorMessage(new ApiError("forbidden", "x"))).toBe("Нет прав на этот чат.")
    expect(chatErrorMessage(new ApiError("forbidden", "x", { code: "feature_not_in_plan" }))).toContain("тариф")
  })
})

describe("connectionView", () => {
  const waiting = { configured: true, connected: false, state: "notAuthorized" }

  it("предлагает QR-код только тому, кто подключает, и только когда номер ждёт привязки", () => {
    expect(connectionView(waiting, true).offerConnect).toBe(true)
    expect(connectionView(waiting, false).offerConnect).toBe(false)
    expect(connectionView({ configured: true, connected: true, state: "authorized" }, true).offerConnect).toBe(false)
    expect(connectionView({ configured: false, connected: false, state: "not_configured" }, true).offerConnect).toBe(false)
    expect(connectionView(null, true).offerConnect).toBe(false)
  })

  it("предупреждает об ограниченном номере и не предлагает его привязать", () => {
    const view = connectionView({ configured: true, connected: false, state: "blocked" }, true)
    expect(view.warning).toContain("ограничил")
    expect(view.offerConnect).toBe(false)
  })

  it("честно говорит, что сервер не настроен", () => {
    expect(connectionView({ configured: false, connected: false, state: "not_configured" }, true).empty.title).toBe("WhatsApp ещё не настроен на сервере")
  })
})
