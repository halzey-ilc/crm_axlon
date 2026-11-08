"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { ChevronLeft, MessagesSquare, Search } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { refreshChatsAction, refreshConnectionAction } from "@/features/chats/actions"
import { ChatThreadSheet, type ChatAssignee } from "@/features/chats/components/chat-thread-sheet"
import { ConnectWhatsapp } from "@/features/chats/components/connect-whatsapp"
import { chatTitle, connectionView, filterChats, type ChatList, type ChatPanelState, type ChatRow } from "@/features/chats/lib/chat-list"
import { formatInitials, formatNumber } from "@/lib/format"

const COLLAPSED_KEY = "chats-panel-collapsed"
/** Push-событий у backend нет: новые сообщения узнаём опросом, пока вкладка на экране */
const REFRESH_MS = 15_000
const PANEL_CLASSES = "sticky top-14 hidden h-[calc(100svh-3.5rem)] shrink-0 self-start border-r lg:flex print:hidden"

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Свёрнутость — удобство на этом устройстве: без хранилища панель просто остаётся развёрнутой */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
}

function saveCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0")
  } catch {
    return
  }
  listeners.forEach((listener) => listener())
}

type ChatsSidebarProps = {
  initial: ChatPanelState
  /** Опрашивать сервер; в демо-режиме его нет */
  live: boolean
  canConnect: boolean
  /** Кому директор или РОП может передать чат; у менеджера список пуст */
  assignees: readonly ChatAssignee[]
}

export function ChatsSidebar({ initial, live, canConnect, assignees }: ChatsSidebarProps) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false)
  const [{ chats, connection, problem }, setPanel] = useState(initial)
  const [query, setQuery] = useState("")
  const [openChat, setOpenChat] = useState<ChatRow | null>(null)
  const unread = chats.reduce((sum, chat) => sum + chat.unreadCount, 0)
  const view = connectionView(connection, canConnect)

  // Сбой опроса не повод ломать панель: остаётся прежний список, следующий опрос повторит
  const applyChats = (list: ChatList) => setPanel((panel) => ({ ...panel, ...list }))
  const refresh = () => void refreshChatsAction().then(applyChats, () => undefined)

  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return
      void refreshChatsAction().then((list) => setPanel((panel) => ({ ...panel, ...list })), () => undefined)
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [live])

  function handleConnected() {
    void refreshConnectionAction().then((next) => setPanel((panel) => ({ ...panel, connection: next })), () => undefined)
    refresh()
  }

  if (collapsed) {
    return (
      <aside aria-label="Чаты" className={`${PANEL_CLASSES} w-10`}>
        <button
          type="button"
          aria-expanded={false}
          aria-label="Развернуть чаты"
          onClick={() => saveCollapsed(false)}
          className="flex w-full flex-col items-center gap-2 py-3 text-xs font-semibold tracking-widest text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MessagesSquare className="size-4" aria-hidden />
          <span className="[writing-mode:vertical-rl]">ЧАТЫ</span>
          {unread > 0 && <span className="rounded-full bg-primary px-1 text-[0.625rem] tracking-normal text-primary-foreground">{formatNumber(unread)}</span>}
        </button>
      </aside>
    )
  }

  const visible = filterChats(chats, query)
  return (
    <aside aria-label="Чаты" className={`${PANEL_CLASSES} w-72 flex-col`}>
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 className="text-sm font-semibold">Чаты</h2>
        <Button variant="ghost" size="icon-sm" aria-expanded aria-label="Свернуть чаты" onClick={() => saveCollapsed(true)}>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
      </div>
      {view.warning && (
        <p role="alert" className="mx-3 mb-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          {view.warning}
        </p>
      )}
      {problem ? (
        <p className="m-auto max-w-60 px-3 text-center text-sm text-muted-foreground">{problem}</p>
      ) : chats.length === 0 ? (
        <EmptyState
          className="m-auto"
          icon={MessagesSquare}
          title={view.empty.title}
          description={view.empty.description}
          action={view.offerConnect && <ConnectWhatsapp onConnected={handleConnected} />}
        />
      ) : (
        <>
          <div className="relative px-3 pb-2">
            <Search className="pointer-events-none absolute top-2 left-5 size-4 text-muted-foreground" aria-hidden />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени или номеру" aria-label="Поиск чатов" className="pl-8" />
          </div>
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto border-t">
            {visible.map((chat) => (
              <ChatItem key={chat.id} chat={chat} onOpen={() => setOpenChat(chat)} />
            ))}
            {visible.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</li>}
          </ul>
          {view.offerConnect && (
            <div className="border-t p-3 text-center">
              <ConnectWhatsapp onConnected={handleConnected} />
            </div>
          )}
        </>
      )}
      {openChat && <ChatThreadSheet key={openChat.id} chat={openChat} connected={connection?.connected ?? null} assignees={assignees} onChanged={refresh} onClose={() => setOpenChat(null)} />}
    </aside>
  )
}

function ChatItem({ chat, onOpen }: { chat: ChatRow; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground" aria-hidden>
          {chat.contactName ? formatInitials(chat.contactName) : "#"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium">{chatTitle(chat)}</span>
            {chat.timeLabel && <span className="shrink-0 text-xs text-muted-foreground">{chat.timeLabel}</span>}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">{chat.status === "closed" ? "WhatsApp · закрыт" : "WhatsApp"}</span>
            {chat.unreadCount > 0 && (
              <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                {formatNumber(chat.unreadCount)}
                <span className="sr-only"> непрочитанных</span>
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  )
}
