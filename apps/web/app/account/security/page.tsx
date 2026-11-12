import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { readSession } from "@/features/auth/current-user"
import { SecuritySettings } from "@/features/auth/components/security"

export const metadata: Metadata = {
  title: "Security",
  robots: { index: false },
}

export default async function Page() {
  const session = await readSession()
  if (session.pending) redirect("/sign-in/continue?next=/account/security")
  if (!session.user) redirect("/sign-in?callbackUrl=/account/security")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <SecuritySettings />
      </main>
    </div>
  )
}
