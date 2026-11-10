import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { CalendarPage } from "@/features/calendar/components/calendar-page"

export const metadata: Metadata = { title: "Calendar", robots: { index: false } }

export default async function Page() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/calendar")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <CalendarPage />
      </main>
    </div>
  )
}
