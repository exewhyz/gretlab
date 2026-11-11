import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { NotificationPreferences } from "@/features/notifications/components/preferences"

export const metadata: Metadata = {
  title: "Notification settings",
  robots: { index: false },
}

export default async function Page() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?callbackUrl=/notifications")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto grid max-w-2xl gap-4 p-4">
        <div>
          <h1 className="text-display-lg text-ink">Notification settings</h1>
          <p className="text-body-sm text-body">
            Everything appears under the bell. Choose what should also reach you
            by email.
          </p>
        </div>
        <NotificationPreferences />
      </main>
    </div>
  )
}
