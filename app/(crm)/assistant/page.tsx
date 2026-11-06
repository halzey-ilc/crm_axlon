import { Suspense } from "react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { Skeleton } from "@/components/ui/skeleton"
import { homeRouteFor } from "@/config/navigation"
import { AssistantView } from "@/features/assistant"
import { hasPermission } from "@/lib/permissions/roles"
import { getCurrentUser } from "@/lib/session/current-user"

export const metadata: Metadata = { title: "ИИ-помощник" }

type AssistantPageProps = PageProps<"/assistant">

/** Помощник — для сотрудников компании; администратор платформы не работает с данными компаний */
async function AssistantContent({ searchParams }: Pick<AssistantPageProps, "searchParams">) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams])
  if (hasPermission(user.role, "platform.manage")) redirect(homeRouteFor(user.role))
  return <AssistantView params={params} role={user.role} />
}

export default function AssistantPage({ searchParams }: AssistantPageProps) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-72 max-w-5xl rounded-xl" />}>
      <AssistantContent searchParams={searchParams} />
    </Suspense>
  )
}
